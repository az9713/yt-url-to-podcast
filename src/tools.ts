import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const wingetLinks = path.join(process.env.LOCALAPPDATA ?? "", "Microsoft", "WinGet", "Links");
if (wingetLinks && existsSync(path.join(wingetLinks, "ffprobe.exe"))) {
  const currentPath = process.env.PATH ?? "";
  if (!currentPath.toLowerCase().includes(wingetLinks.toLowerCase())) {
    process.env.PATH = `${wingetLinks}${path.delimiter}${currentPath}`;
  }
}

export function pythonPath(packageRoot: string): string {
  return path.join(packageRoot, ".venv", "Scripts", "python.exe");
}

function usefulError(stderr: string, stdout: string): string {
  const lines = `${stderr}\n${stdout}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !line.startsWith("Warning:"))
    .filter((line) => !line.includes("UserWarning") && !line.includes("FutureWarning"))
    .filter((line) => !line.includes("site-packages") && !line.startsWith("warnings.warn"));
  return lines.at(-1) || "The command failed.";
}

export async function runProcess(
  command: string,
  args: string[],
  options: { cwd: string; signal?: AbortSignal; onLine?: (line: string) => void },
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      signal: options.signal,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let pending = "";
    const take = (chunk: string) => {
      pending += chunk;
      const parts = pending.split(/\r?\n/);
      pending = parts.pop() ?? "";
      for (const line of parts) {
        if (line.trim()) options.onLine?.(line.trim());
      }
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
      process.stderr.write(chunk);
      take(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (pending.trim()) options.onLine?.(pending.trim());
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(usefulError(stderr, stdout)));
    });
  });
}

export interface SourceFiles {
  id: string;
  title: string;
  channel: string;
  language: string | null;
  duration: number | null;
  subtitles: string[];
  audioPath: string | null;
}

export async function fetchSource(packageRoot: string, url: string, dir: string, signal?: AbortSignal): Promise<SourceFiles> {
  await mkdir(dir, { recursive: true });
  const python = pythonPath(packageRoot);
  await runProcess(python, [path.join(packageRoot, "scripts", "fetch_source.py"), url, dir], { cwd: dir, signal });
  const meta = JSON.parse(await readFile(path.join(dir, "meta.json"), "utf8")) as SourceFiles;
  const subsDir = path.join(dir, "subs");
  let subtitles: string[] = [];
  try {
    const names = await readdir(subsDir);
    subtitles = names.filter((name) => name.toLowerCase().endsWith(".vtt")).map((name) => path.join(subsDir, name));
  } catch {
    subtitles = [];
  }
  const audioCandidate = path.join(dir, "audio.wav");
  let audioPath: string | null = null;
  try {
    await access(audioCandidate);
    audioPath = audioCandidate;
  } catch {
    audioPath = null;
  }
  return { ...meta, subtitles, audioPath };
}

export async function transcribe(
  packageRoot: string,
  audioPath: string,
  transcriptPath: string,
  signal?: AbortSignal,
): Promise<void> {
  const python = pythonPath(packageRoot);
  await runProcess(python, [path.join(packageRoot, "scripts", "transcribe.py"), audioPath, transcriptPath], {
    cwd: path.dirname(transcriptPath),
    signal,
  });
}

export interface SpeakRequest {
  engine: "kokoro" | "chatterbox";
  langCode?: string;
  voice?: string;
  languageId?: string;
  segmentsPath: string;
  outDir: string;
}

export async function speak(
  packageRoot: string,
  request: SpeakRequest,
  signal?: AbortSignal,
  onLine?: (line: string) => void,
): Promise<void> {
  const python = pythonPath(packageRoot);
  const args = [
    path.join(packageRoot, "scripts", "speak.py"),
    "--engine",
    request.engine,
    "--segments",
    request.segmentsPath,
    "--outdir",
    request.outDir,
  ];
  if (request.langCode) args.push("--lang-code", request.langCode);
  if (request.voice) args.push("--voice", request.voice);
  if (request.languageId) args.push("--language-id", request.languageId);
  await runProcess(python, args, { cwd: request.outDir, signal, onLine });
}

export async function probeDuration(file: string, signal?: AbortSignal): Promise<number> {
  const { stdout } = await runProcess(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file],
    { cwd: path.dirname(file), signal },
  );
  const duration = Number(stdout.trim());
  if (!Number.isFinite(duration)) throw new Error(`Could not read duration of ${file}`);
  return duration;
}

export async function packageEpisode(options: {
  parts: { file: string; chapter: string }[];
  outFile: string;
  title: string;
  language: string;
  url: string;
  signal?: AbortSignal;
}): Promise<void> {
  const dir = path.dirname(options.outFile);
  await mkdir(dir, { recursive: true });
  const listPath = path.join(dir, "concat.txt");
  const list = options.parts.map((part) => `file '${part.file.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`).join("\n");
  await writeFile(listPath, list, "utf8");

  const durations: number[] = [];
  for (const part of options.parts) durations.push(await probeDuration(part.file, options.signal));

  const metadataPath = path.join(dir, "chapters.ffmeta");
  let cursor = 0;
  const chapters: string[] = [];
  let chapterStart = 0;
  let chapterTitle = options.parts[0]?.chapter ?? "Episode";
  for (let i = 0; i < options.parts.length; i++) {
    const nextTitle = options.parts[i].chapter;
    const atBoundary = i > 0 && nextTitle !== chapterTitle;
    if (atBoundary) {
      chapters.push(chapterBlock(chapterStart, cursor, chapterTitle));
      chapterStart = cursor;
      chapterTitle = nextTitle;
    }
    cursor += Math.round(durations[i] * 1000);
  }
  chapters.push(chapterBlock(chapterStart, cursor, chapterTitle));
  const metadata = [
    ";FFMETADATA1",
    `title=${escapeMeta(options.title)}`,
    `language=${escapeMeta(options.language)}`,
    `comment=${escapeMeta(`Synthetic-voice retelling of ${options.url}`)}`,
    ...chapters,
    "",
  ].join("\n");
  await writeFile(metadataPath, metadata, "utf8");

  const outputArgs = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    listPath,
    "-i",
    metadataPath,
    "-map_metadata",
    "1",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-ar",
    "44100",
    "-ac",
    "1",
  ];
  try {
    await runProcess("ffmpeg", [...outputArgs, "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", options.outFile], {
      cwd: dir,
      signal: options.signal,
    });
  } catch {
    await runProcess("ffmpeg", [...outputArgs, options.outFile], { cwd: dir, signal: options.signal });
  }
}

function chapterBlock(startMs: number, endMs: number, title: string): string {
  const end = Math.max(endMs, startMs + 1);
  return ["[CHAPTER]", "TIMEBASE=1/1000", `START=${startMs}`, `END=${end}`, `title=${escapeMeta(title)}`].join("\n");
}

function escapeMeta(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/[\r\n]/g, " ")
    .replace(/[=;#]/g, (char) => `\\${char}`)
    .trim();
}
