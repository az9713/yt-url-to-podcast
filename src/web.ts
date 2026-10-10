import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractJson } from "./json.ts";
import { idFromShot, parseSearchLines, resolveShot, shotFromModel, watchUrl, type Resolution, type SearchHit } from "./identify.ts";
import { emptyUsage } from "./metrics.ts";
import { openaiChat, podcastModel } from "./openai.ts";
import { runEpisode } from "./run.ts";
import { runProcess } from "./tools.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PORT || 8787);
const model = podcastModel();

interface JobEvent {
  id: number;
  event: string;
  data: unknown;
}

interface Job {
  id: string;
  events: JobEvent[];
  listeners: Set<(event: JobEvent) => void>;
  done: boolean;
}

const jobs = new Map<string, Job>();
let busy = false;
let eventId = 0;

function emit(job: Job, event: string, data: unknown): void {
  const item = { id: ++eventId, event, data };
  job.events.push(item);
  for (const listener of job.listeners) listener(item);
}

function createJob(): Job {
  const job: Job = { id: randomUUID(), events: [], listeners: new Set(), done: false };
  jobs.set(job.id, job);
  return job;
}

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 12_000_000) throw new Error("The screenshot is larger than 12 MB.");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

async function searchYouTube(title: string, channel: string): Promise<SearchHit[]> {
  const query = [title, channel].filter(Boolean).join(" ");
  if (!query) return [];
  const { stdout } = await runProcess(
    "yt-dlp",
    ["--flat-playlist", "--no-warnings", "--print", "%(id)s\t%(title)s\t%(channel)s\t%(duration)s", `ytsearch5:${query}`],
    { cwd: root },
  );
  return parseSearchLines(stdout);
}

async function readScreenshot(imageBase64: string, mediaType: string): Promise<Resolution> {
  const text = await openaiChat({
    model,
    usage: emptyUsage(),
    system: [
      "You read a screenshot of a YouTube watch page.",
      "Return only JSON: {\"url\":\"\",\"videoId\":\"\",\"title\":\"\",\"channel\":\"\",\"duration\":\"\"}.",
      "channel is the name printed next to the avatar, not a longer name you infer.",
      "duration is the total length on the player, the number after the slash in 0:02 / 2:16.",
      "Copy the address bar into url when it is visible.",
      "Leave a field empty when it is not visible. Do not invent a video id.",
    ].join(" "),
    user: [
      { type: "text", text: "Read this YouTube screenshot." },
      { type: "image_url", image_url: { url: `data:${mediaType};base64,${imageBase64}` } },
    ],
  });
  const shot = shotFromModel(extractJson(text));
  const hits = idFromShot(shot) ? [] : await searchYouTube(shot.title, shot.channel);
  const resolution = resolveShot(shot, hits);
  if (!resolution.videoId && resolution.candidates.length === 0) {
    throw new Error("The screenshot needs a visible title or address bar. A frame of the video alone is not enough.");
  }
  return resolution;
}

function startEpisode(url: string): Job {
  if (busy) throw new Error("An episode is already being made. Wait for it to finish.");
  busy = true;
  const job = createJob();
  const usage = emptyUsage();
  emit(job, "log", { message: `Starting ${url}` });
  void runEpisode({
    url,
    cwd: root,
    packageRoot: root,
    contextWindow: 128_000,
    model: `openai/${model}`,
    usage,
    log: (message) => emit(job, "log", { message }),
    completeText: (system, user) => openaiChat({ model, system, user, usage }),
  })
    .then((result) => {
      emit(job, "done", {
        videoId: url,
        htmlPath: result.htmlPath,
        episodePath: result.episodePath,
        voiceError: result.voiceError,
        ledger: "/ledger.html",
      });
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`podcast failed: ${message}\n`);
      emit(job, "fail", { message });
    })
    .finally(() => {
      job.done = true;
      busy = false;
    });
  return job;
}

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(body);
}

function contentType(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".html") return "text/html; charset=utf-8";
  if (extension === ".m4a") return "audio/mp4";
  if (extension === ".css") return "text/css; charset=utf-8";
  if (extension === ".js") return "text/javascript; charset=utf-8";
  if (extension === ".json") return "application/json; charset=utf-8";
  if (extension === ".png") return "image/png";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  return "application/octet-stream";
}

async function serveFile(response: ServerResponse, filePath: string): Promise<void> {
  const resolved = path.resolve(filePath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    sendJson(response, 403, { error: "Forbidden" });
    return;
  }
  try {
    const info = await stat(resolved);
    if (!info.isFile()) throw new Error("missing");
    const body = await readFile(resolved);
    response.writeHead(200, { "content-type": contentType(resolved) });
    response.end(body);
  } catch {
    sendJson(response, 404, { error: "Not found" });
  }
}

function streamJob(request: IncomingMessage, response: ServerResponse, job: Job): void {
  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-store",
    connection: "keep-alive",
  });
  const write = (event: JobEvent) => {
    response.write(`id: ${event.id}\nevent: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`);
  };
  for (const event of job.events) write(event);
  if (job.done) {
    response.end();
    return;
  }
  job.listeners.add(write);
  request.on("close", () => job.listeners.delete(write));
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`);
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/app")) {
      await serveFile(response, path.join(root, "web", "app.html"));
      return;
    }
    if (request.method === "GET" && url.pathname === "/library") {
      await serveFile(response, path.join(root, "index.html"));
      return;
    }
    if (request.method === "GET" && url.pathname.startsWith("/api/jobs/")) {
      const job = jobs.get(url.pathname.slice("/api/jobs/".length));
      if (!job) {
        sendJson(response, 404, { error: "That run was not found." });
        return;
      }
      streamJob(request, response, job);
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/screenshot") {
      const payload = JSON.parse((await readBody(request)).toString("utf8")) as { imageBase64?: string; mediaType?: string };
      if (!payload.imageBase64) throw new Error("Choose a screenshot first.");
      const mediaType = payload.mediaType || "image/png";
      const resolution = await readScreenshot(payload.imageBase64, mediaType);
      if (!resolution.confident || !resolution.url) {
        sendJson(response, 200, { status: "choose", resolution });
        return;
      }
      const job = startEpisode(resolution.url);
      emit(job, "log", { message: `Matched ${resolution.title || resolution.videoId}` });
      sendJson(response, 200, { status: "started", jobId: job.id, resolution });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/start") {
      const payload = JSON.parse((await readBody(request)).toString("utf8")) as { videoId?: string };
      if (!payload.videoId) throw new Error("Choose a video.");
      const job = startEpisode(watchUrl(payload.videoId));
      sendJson(response, 200, { status: "started", jobId: job.id });
      return;
    }
    if (request.method === "GET") {
      const filePath = path.join(root, decodeURIComponent(url.pathname.slice(1)));
      await serveFile(response, filePath);
      return;
    }
    sendJson(response, 404, { error: "Not found" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!response.headersSent) sendJson(response, 400, { error: message });
  }
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`Podcast app: http://127.0.0.1:${port}\n`);
});
