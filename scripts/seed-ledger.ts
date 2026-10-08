import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { appendLedger } from "../src/ledger.ts";
import type { LedgerEntry } from "../src/metrics.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const episode = path.join(root, "episodes", "S7tFyREI19I");

const started = Date.parse("2026-10-08T15:26:48.559Z");
const finished = Date.parse("2026-10-08T16:49:21.876Z");

async function lengthOf(name: string): Promise<number | null> {
  try {
    return (await readFile(path.join(episode, name), "utf8")).length;
  } catch {
    return null;
  }
}

const entry: LedgerEntry = {
  recordedAt: "2026-10-08T16:49:21.876Z",
  source: "reconstructed",
  videoId: "S7tFyREI19I",
  url: "https://www.youtube.com/watch?v=S7tFyREI19I",
  title: "Training Your Own Embedding Model Is Not As Hard As You Think",
  channel: "Prompt Engineering",
  language: "en-US",
  model: "openai/gpt-4.1-mini",
  videoDurationSeconds: 756,
  podcastDurationSeconds: 317.8,
  wallClockSeconds: (finished - started) / 1000,
  transcriptSource: "local-transcription",
  transcriptCharacters: await lengthOf("transcript.txt"),
  notesCharacters: await lengthOf("notes.txt"),
  summaryCharacters: await lengthOf("summary.html"),
  scriptCharacters: await lengthOf("script.txt"),
  voice: "kokoro af_heart",
  segmentCount: 19,
  scriptPasses: 1,
  episodeBytes: (await stat(path.join(episode, "episode.m4a"))).size,
  usage: null,
  stagesSeconds: {},
  unknowns: [
    {
      topic: "API tokens and dollars",
      whyItMatters:
        "Pi can report input, output, cache, reasoning tokens, and a catalog price on each response. This conversion ran before that was saved. Character counts of the files are not tokens, so no dollar figure is estimated.",
    },
    {
      topic: "Speech-to-text errors",
      whyItMatters:
        "English auto-captions existed, but YouTube returned HTTP 429 after repeated fetches. The transcript is local faster-whisper (small, CPU). Its mistakes against the soundtrack were not measured.",
    },
    {
      topic: "Claims left out",
      whyItMatters:
        "The video is 12m 36s and the episode is 5m 18s, about 42 percent of the runtime. The sentence check only rejects a script that recites the HTML. It does not say which claims were dropped.",
    },
    {
      topic: "How the waiting time splits",
      whyItMatters:
        "Wall clock is 1h 22m 33s from the launcher log, 15:26:48Z to 16:49:22Z. About 54 minutes of that was a Kokoro segment that stopped advancing and was resumed. The split is reconstructed from log times, not from a stage timer.",
    },
    {
      topic: "The stopped first attempt",
      whyItMatters:
        "An earlier attempt was killed during transcription, before any model call. It should not have added model tokens. That was not confirmed from a provider bill.",
    },
    {
      topic: "One-time voice download",
      whyItMatters: "Kokoro weights were downloaded on this machine during testing. That download is not assigned to this episode.",
    },
    {
      topic: "Right to publish",
      whyItMatters: "The source is the Prompt Engineering channel. The ledger does not decide whether this episode may be published.",
    },
    {
      topic: "Electricity and disk",
      whyItMatters: "Local transcription, a 145 MB wav, 19 voice parts, and the final m4a used this laptop. None of that is on the model bill.",
    },
  ],
  notes: [
    "Reconstructed on 2026-10-08 from the finished files and the run log. This row is not a second conversion.",
    "Checkpoint shows one notes pass and one script pass. The first script passed the overlap check.",
    "A later repackage fixed the source URL stored in the audio metadata. It did not call the model again.",
  ],
};

const ledgerPath = await appendLedger(root, entry);
await writeFile(
  path.join(episode, "capture.json"),
  JSON.stringify({ transcriptSource: "local-transcription", videoDurationSeconds: 756 }),
  "utf8",
);
console.log(ledgerPath);
