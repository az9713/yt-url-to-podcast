import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { access, mkdir, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { inputBudgetChars } from "./budget.ts";
import { chunkText } from "./chunk.ts";
import { parseSummary, renderHtml, summaryPlainText, type SummaryDocument } from "./html.ts";
import { extractJson } from "./json.ts";
import { copiedSentences, prepareSpeech } from "./overlap.ts";
import { languagePrompt, notesPrompt, scriptPrompt, summaryPrompt } from "./prompts.ts";
import { appendLedger, type LedgerEntry } from "./ledger.ts";
import { emptyUsage, type ModelUsage, type Unknown } from "./metrics.ts";
import { fetchSource, packageEpisode, probeDuration, pythonPath, speak, transcribe, type SourceFiles } from "./tools.ts";
import { pickSubtitle, vttToText } from "./vtt.ts";
import { routeVoice, scriptToSegments, spokenText } from "./voices.ts";
import { videoIdFromUrl } from "./youtube.ts";

export interface CompleteText {
  (system: string, user: string): Promise<string>;
}

export interface RunInput {
  url: string;
  cwd: string;
  packageRoot: string;
  contextWindow: number;
  completeText: CompleteText;
  model?: string | null;
  usage?: ModelUsage;
  signal?: AbortSignal;
  log?: (message: string) => void;
}

export interface RunResult {
  directory: string;
  htmlPath: string;
  episodePath: string | null;
  voiceError: string | null;
}

interface Checkpoint {
  version: 1;
  url: string;
  videoId: string;
  title: string;
  channel: string;
  language: string;
  notesDone: number;
  scriptAttempts: number;
}

const SEGMENT_CHARS = 450;
const SCRIPT_ATTEMPTS = 3;

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function readCheckpoint(file: string): Promise<Checkpoint | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as Checkpoint;
  } catch {
    return null;
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error("Cancelled");
}

export async function runEpisode(input: RunInput): Promise<RunResult> {
  const log = input.log ?? (() => {});
  const url = input.url.trim();
  if (!url) throw new Error("Usage: /podcast <youtube-url>");
  try {
    await access(pythonPath(input.packageRoot));
  } catch {
    throw new Error(
      "The local voice environment is missing. In this folder run: py -3.11 -m venv .venv && .venv\\Scripts\\python -m pip install -r requirements.txt",
    );
  }

  const usage = input.usage ?? emptyUsage();
  const startedAt = Date.now();
  const stagesSeconds: Record<string, number> = {};
  let transcriptSource: "captions" | "local-transcription" | "unknown" = "unknown";
  let voiceLabel: string | null = null;
  let segmentCount: number | null = null;
  let episodePath: string | null = null;
  let voiceError: string | null = null;
  let videoDurationSeconds: number | null = null;
  let outcome = "finished";
  let failureMessage: string | null = null;

  const preliminaryId = videoIdFromUrl(url) ?? createHash("sha256").update(url).digest("hex").slice(0, 16);
  const directory = path.join(input.cwd, "episodes", preliminaryId);
  await mkdir(directory, { recursive: true });
  const checkpointPath = path.join(directory, "state.json");
  const saved = await readCheckpoint(checkpointPath);
  const state: Checkpoint = saved ?? {
    version: 1,
    url,
    videoId: preliminaryId,
    title: "",
    channel: "",
    language: "",
    notesDone: 0,
    scriptAttempts: 0,
  };
  const persist = async () => {
    await writeFile(checkpointPath, JSON.stringify(state, null, 2), "utf8");
  };

  try {

  throwIfAborted(input.signal);
  const transcriptPath = path.join(directory, "transcript.txt");
  const capturePath = path.join(directory, "capture.json");
  if (!(await exists(transcriptPath))) {
    const stageStarted = Date.now();
    log("Fetching captions");
    const source = await fetchSource(input.packageRoot, url, directory, input.signal);
    state.videoId = source.id || state.videoId;
    state.title = source.title;
    state.channel = source.channel;
    state.language = source.language ?? "";
    videoDurationSeconds = typeof source.duration === "number" ? source.duration : null;
    await persist();
    transcriptSource = await writeTranscript(input, source, transcriptPath, directory);
    stagesSeconds.transcript = (Date.now() - stageStarted) / 1000;
    await writeFile(capturePath, JSON.stringify({ transcriptSource, videoDurationSeconds }), "utf8");
  } else {
    const capture = await readCapture(capturePath);
    transcriptSource = capture.transcriptSource;
    videoDurationSeconds = capture.videoDurationSeconds ?? (await readVideoDuration(directory));
  }

  const transcript = (await readFile(transcriptPath, "utf8")).trim();
  if (!transcript) throw new Error("The transcript was empty.");
  if (!state.language) {
    log("Detecting language");
    const prompt = languagePrompt(transcript);
    const detected = (await input.completeText(prompt.system, prompt.user)).trim().toLowerCase();
    const match = detected.match(/[a-z]{2}/);
    state.language = match?.[0] ?? "";
    await persist();
  }

  const budget = inputBudgetChars(input.contextWindow);
  const notesPath = path.join(directory, "notes.txt");
  const slices = chunkText(transcript, budget);
  if (state.notesDone < slices.length || !(await exists(notesPath))) {
    log(`Writing notes (${slices.length} slices)`);
    const existing = state.notesDone > 0 && (await exists(notesPath)) ? await readFile(notesPath, "utf8") : "";
    const parts = existing ? [existing.trimEnd()] : [];
    for (let i = state.notesDone; i < slices.length; i++) {
      throwIfAborted(input.signal);
      log(`Notes ${i + 1} of ${slices.length}`);
      const prompt = notesPrompt(slices[i], i, slices.length, state.language || "the transcript language");
      parts.push((await input.completeText(prompt.system, prompt.user)).trim());
      state.notesDone = i + 1;
      await writeFile(notesPath, parts.join("\n\n"), "utf8");
      await persist();
    }
  }

  const notes = (await readFile(notesPath, "utf8")).trim();
  const htmlPath = path.join(directory, "summary.html");
  let summary: SummaryDocument;
  if (await exists(htmlPath)) {
    summary = JSON.parse(await readFile(path.join(directory, "summary.json"), "utf8")) as SummaryDocument;
  } else {
    log("Writing the HTML summary");
    summary = await writeSummary(input, notes, state, budget);
    await writeFile(path.join(directory, "summary.json"), JSON.stringify(summary, null, 2), "utf8");
    await writeFile(
      htmlPath,
      renderHtml(summary, { url, videoTitle: state.title || summary.title, channel: state.channel }),
      "utf8",
    );
  }

  const htmlText = summaryPlainText(summary);
  const scriptPath = path.join(directory, "script.txt");
  let script = (await exists(scriptPath)) ? await readFile(scriptPath, "utf8") : "";
  let forbidden: string[] = [];
  let copies = script ? copiedSentences(htmlText, spokenText(script)) : ["pending"];
  while (copies.length > 0 && state.scriptAttempts < SCRIPT_ATTEMPTS) {
    throwIfAborted(input.signal);
    state.scriptAttempts += 1;
    log(`Writing the spoken script (pass ${state.scriptAttempts})`);
    script = await writeScript(input, notes, state, budget, forbidden);
    await writeFile(scriptPath, script, "utf8");
    await persist();
    copies = copiedSentences(htmlText, spokenText(script));
    forbidden = copies.slice(0, 20);
  }
  const prepared = prepareSpeech(script, htmlText);
  if (prepared.removed.length > 0) {
    log(`Removed ${prepared.removed.length} sentence(s) that repeated the page. The rest will be spoken.`);
    script = prepared.script;
    await writeFile(scriptPath, script, "utf8");
  }

  try {
    const pageLanguage = summary.language.trim().toLowerCase();
    const language = /^[a-z]{2}(?:-[a-z]{2,8})?$/.test(pageLanguage) ? pageLanguage : state.language || pageLanguage;
    const voice = routeVoice(language);
    voiceLabel = voice.engine === "kokoro" ? `kokoro ${voice.voice}` : `chatterbox ${voice.languageId}`;
    const segments = scriptToSegments(script, SEGMENT_CHARS);
    segmentCount = segments.length;
    if (segments.length === 0) throw new Error("The spoken script was empty.");
    const audioDir = path.join(directory, "audio");
    await mkdir(audioDir, { recursive: true });
    const segmentsPath = path.join(audioDir, "segments.json");
    await writeFile(segmentsPath, JSON.stringify(segments), "utf8");
    const marker = path.join(audioDir, "done.json");
    const scriptHash = createHash("sha256").update(script).digest("hex");
    const previous = (await exists(marker))
      ? (JSON.parse(await readFile(marker, "utf8")) as { scriptHash?: string })
      : null;
    if (previous != null && previous.scriptHash !== scriptHash) {
      const leftovers = await readdir(audioDir).catch(() => []);
      for (const name of leftovers) {
        if (name.endsWith(".wav")) await unlink(path.join(audioDir, name));
      }
      const staleEpisode = path.join(directory, "episode.m4a");
      if (await exists(staleEpisode)) await unlink(staleEpisode);
    }
    if (previous?.scriptHash !== scriptHash) {
      const speakStarted = Date.now();
      log(`Rendering ${segments.length} voice segments with ${voice.engine}`);
      await speak(
        input.packageRoot,
        {
          engine: voice.engine,
          langCode: voice.engine === "kokoro" ? voice.langCode : undefined,
          voice: voice.engine === "kokoro" ? voice.voice : undefined,
          languageId: voice.engine === "chatterbox" ? voice.languageId : undefined,
          segmentsPath,
          outDir: audioDir,
        },
        input.signal,
        (line) => {
          const spoke = line.match(/^spoke (\d+)\/(\d+)/);
          if (spoke) log(`Speaking clip ${spoke[1]} of ${spoke[2]}`);
          const skipped = line.match(/^skipped (\d+)\/(\d+)/);
          if (skipped) log(`Skipped an empty clip ${skipped[1]} of ${skipped[2]}`);
        },
      );
      await writeFile(marker, JSON.stringify({ segments: segments.length, scriptHash }), "utf8");
      stagesSeconds.voice = (Date.now() - speakStarted) / 1000;
    }
    episodePath = path.join(directory, "episode.m4a");
    if (!(await exists(episodePath))) {
      const packageStarted = Date.now();
      log("Packaging the episode");
      const parts = segments
        .map((segment, index) => ({
          file: path.join(audioDir, `part-${String(index).padStart(4, "0")}.wav`),
          chapter: segment.chapter,
        }))
        .filter((part) => existsSync(part.file));
      if (parts.length === 0) throw new Error("The voice produced no audio.");
      await packageEpisode({
        parts,
        outFile: episodePath,
        title: state.title || summary.title,
        language: summary.language || state.language || "en",
        url,
        signal: input.signal,
      });
      stagesSeconds.package = (Date.now() - packageStarted) / 1000;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith("No publishable local voice")) {
      voiceError = message;
      await writeFile(path.join(directory, "voice-error.txt"), message, "utf8");
    } else {
      throw error;
    }
  }

  return { directory, htmlPath, episodePath, voiceError };
  } catch (error) {
    outcome = "failed";
    failureMessage = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    if (voiceError) outcome = "voice-missing";
    const podcastDurationSeconds = episodePath ? await podcastDuration(episodePath) : null;
    const entry = await buildLedgerEntry({
      cwd: input.cwd,
      directory,
      recordedAt: new Date().toISOString(),
      url,
      state,
      model: input.model ?? null,
      usage,
      videoDurationSeconds,
      podcastDurationSeconds,
      wallClockSeconds: (Date.now() - startedAt) / 1000,
      transcriptSource,
      voice: voiceLabel,
      segmentCount,
      stagesSeconds,
      outcome,
      voiceError,
      failureMessage,
    });
    const ledgerPath = await appendLedger(input.cwd, entry);
    if (outcome === "finished" || voiceError) log(`Ledger: ${ledgerPath}`);
  }
}

async function writeTranscript(
  input: RunInput,
  source: SourceFiles,
  transcriptPath: string,
  directory: string,
): Promise<"captions" | "local-transcription"> {
  const chosen = pickSubtitle(source.subtitles, source.language);
  if (chosen) {
    const text = vttToText(await readFile(chosen, "utf8")).trim();
    if (text) {
      await writeFile(transcriptPath, `${text}\n`, "utf8");
      return "captions";
    }
  }
  if (!source.audioPath) {
    throw new Error("This video has no captions and the audio download failed.");
  }
  input.log?.("No captions. Transcribing the audio in segments.");
  await transcribe(input.packageRoot, source.audioPath, transcriptPath, input.signal);
  if (!(await exists(path.join(directory, "transcript.txt")))) {
    throw new Error("Transcription did not write a transcript.");
  }
  return "local-transcription";
}

async function writeSummary(input: RunInput, notes: string, state: Checkpoint, budget: number): Promise<SummaryDocument> {
  let material = notes;
  for (let round = 0; round < 4 && chunkText(material, budget).length > 1; round++) {
    const blocks = chunkText(material, budget);
    const tightened: string[] = [];
    for (let i = 0; i < blocks.length; i++) {
      throwIfAborted(input.signal);
      const prompt = notesPrompt(blocks[i], i, blocks.length, state.language || "the notes language");
      tightened.push((await input.completeText(prompt.system, prompt.user)).trim());
    }
    material = tightened.join("\n\n");
  }
  const prompt = summaryPrompt(material, state.language || "the notes language", state.title);
  const raw = await input.completeText(prompt.system, prompt.user);
  return parseSummary(extractJson(raw));
}

async function writeScript(
  input: RunInput,
  notes: string,
  state: Checkpoint,
  budget: number,
  forbidden: string[],
): Promise<string> {
  const blocks = chunkText(notes, Math.min(budget, 12_000));
  const pieces: string[] = [];
  for (let i = 0; i < blocks.length; i++) {
    throwIfAborted(input.signal);
    input.log?.(`Script slice ${i + 1} of ${blocks.length}`);
    const prompt = scriptPrompt(blocks[i], state.language || "the notes language", state.title, forbidden);
    pieces.push((await input.completeText(prompt.system, prompt.user)).trim());
  }
  return pieces.join("\n\n");
}

async function readCapture(file: string): Promise<{
  transcriptSource: "captions" | "local-transcription" | "unknown";
  videoDurationSeconds: number | null;
}> {
  try {
    const parsed = JSON.parse(await readFile(file, "utf8")) as {
      transcriptSource?: string;
      videoDurationSeconds?: number;
    };
    const transcriptSource =
      parsed.transcriptSource === "captions" || parsed.transcriptSource === "local-transcription"
        ? parsed.transcriptSource
        : "unknown";
    return {
      transcriptSource,
      videoDurationSeconds: typeof parsed.videoDurationSeconds === "number" ? parsed.videoDurationSeconds : null,
    };
  } catch {
    return { transcriptSource: "unknown", videoDurationSeconds: null };
  }
}

async function readVideoDuration(directory: string): Promise<number | null> {
  try {
    const meta = JSON.parse(await readFile(path.join(directory, "meta.json"), "utf8")) as { duration?: number };
    return typeof meta.duration === "number" ? meta.duration : null;
  } catch {
    return null;
  }
}

async function podcastDuration(file: string): Promise<number | null> {
  try {
    return await probeDuration(file);
  } catch {
    return null;
  }
}

async function characterCount(file: string): Promise<number | null> {
  try {
    return (await readFile(file, "utf8")).length;
  } catch {
    return null;
  }
}

async function fileBytes(file: string): Promise<number | null> {
  try {
    return (await stat(file)).size;
  } catch {
    return null;
  }
}

function liveUnknowns(input: {
  usage: ModelUsage;
  transcriptSource: LedgerEntry["transcriptSource"];
  videoDurationSeconds: number | null;
  podcastDurationSeconds: number | null;
  voiceError: string | null;
}): Unknown[] {
  const items: Unknown[] = [];
  if (input.usage.calls === 0) {
    items.push({
      topic: "Model bill for this invocation",
      whyItMatters: "This invocation made no metered model call, so it does not show the tokens spent to write the summary and script.",
    });
  } else if (!input.usage.costComplete) {
    items.push({
      topic: "Catalog price",
      whyItMatters: "At least one model response did not include a price. Token counts are kept. The dollar total is withheld so a partial sum is not mistaken for the bill.",
    });
  }
  if (input.transcriptSource === "local-transcription") {
    items.push({
      topic: "Speech-to-text errors",
      whyItMatters: "The transcript was made on this computer, not taken from the video's captions. Misheard names and numbers can pass into the episode.",
    });
  }
  if (input.transcriptSource === "unknown") {
    items.push({
      topic: "Transcript origin",
      whyItMatters: "This resume reused a transcript without a record of whether it came from captions or local transcription.",
    });
  }
  if (input.videoDurationSeconds != null && input.podcastDurationSeconds != null && input.podcastDurationSeconds < input.videoDurationSeconds) {
    items.push({
      topic: "Claims left out",
      whyItMatters: "The episode is shorter than the video. The time ratio does not say which claims were dropped.",
    });
  }
  items.push({
    topic: "Right to publish",
    whyItMatters: "The ledger records the source video. It does not decide whether you may publish the episode.",
  });
  items.push({
    topic: "Electricity and disk",
    whyItMatters: "Local transcription and the voice model add machine time and files. That cost is not on the model bill.",
  });
  if (input.voiceError) {
    items.push({
      topic: "Missing voice",
      whyItMatters: input.voiceError,
    });
  }
  return items;
}

async function buildLedgerEntry(input: {
  cwd: string;
  directory: string;
  recordedAt: string;
  url: string;
  state: Checkpoint;
  model: string | null;
  usage: ModelUsage;
  videoDurationSeconds: number | null;
  podcastDurationSeconds: number | null;
  wallClockSeconds: number;
  transcriptSource: LedgerEntry["transcriptSource"];
  voice: string | null;
  segmentCount: number | null;
  stagesSeconds: Record<string, number>;
  outcome: string;
  voiceError: string | null;
  failureMessage: string | null;
}): Promise<LedgerEntry> {
  const episodePath = path.join(input.directory, "episode.m4a");
  return {
    recordedAt: input.recordedAt,
    source: "run",
    videoId: input.state.videoId,
    url: input.url,
    title: input.state.title,
    channel: input.state.channel,
    language: input.state.language,
    model: input.model,
    videoDurationSeconds: input.videoDurationSeconds,
    podcastDurationSeconds: input.podcastDurationSeconds,
    wallClockSeconds: input.wallClockSeconds,
    transcriptSource: input.transcriptSource,
    transcriptCharacters: await characterCount(path.join(input.directory, "transcript.txt")),
    notesCharacters: await characterCount(path.join(input.directory, "notes.txt")),
    summaryCharacters: await characterCount(path.join(input.directory, "summary.html")),
    scriptCharacters: await characterCount(path.join(input.directory, "script.txt")),
    voice: input.voice,
    segmentCount: input.segmentCount,
    scriptPasses: input.state.scriptAttempts,
    episodeBytes: await fileBytes(episodePath),
    usage: input.usage.calls > 0 ? input.usage : null,
    stagesSeconds: input.stagesSeconds,
    unknowns: liveUnknowns({
      usage: input.usage,
      transcriptSource: input.transcriptSource,
      videoDurationSeconds: input.videoDurationSeconds,
      podcastDurationSeconds: input.podcastDurationSeconds,
      voiceError: input.voiceError,
    }),
    notes: [input.failureMessage ? `Outcome: ${input.outcome}. ${input.failureMessage}` : `Outcome: ${input.outcome}.`],
  };
}
