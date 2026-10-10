import { videoIdFromUrl } from "./youtube.ts";

const ID = /^[A-Za-z0-9_-]{11}$/;

export interface ShotRead {
  url: string;
  videoId: string;
  title: string;
  channel: string;
  /** Total length printed on the player, such as the 2:16 in "0:02 / 2:16". */
  durationSeconds: number | null;
}

export interface SearchHit {
  id: string;
  title: string;
  channel: string;
  duration: number | null;
}

export interface Resolution {
  confident: boolean;
  videoId: string | null;
  url: string | null;
  title: string;
  channel: string;
  /** What the page should say when the user still has to choose. */
  question: string;
  candidates: SearchHit[];
}

export function watchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function clockToSeconds(value: string): number | null {
  const clocks = [...value.matchAll(/(?:(\d+):)?(\d{1,2}):(\d{2})/g)];
  const last = clocks[clocks.length - 1];
  if (!last) return null;
  const hours = Number(last[1] ?? 0);
  const minutes = Number(last[2]);
  const seconds = Number(last[3]);
  if (minutes > 59 || seconds > 59) return null;
  return hours * 3600 + minutes * 60 + seconds;
}

export function shotFromModel(value: unknown): ShotRead {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const durationText = asText(record.duration);
  return {
    url: asText(record.url),
    videoId: asText(record.videoId),
    title: asText(record.title),
    channel: asText(record.channel),
    durationSeconds: typeof record.durationSeconds === "number" ? record.durationSeconds : clockToSeconds(durationText),
  };
}

export function idFromShot(shot: ShotRead): string | null {
  const fromUrl = videoIdFromUrl(shot.url) ?? videoIdFromLooseText(shot.url);
  if (fromUrl) return fromUrl;
  if (ID.test(shot.videoId) && shot.url.includes(shot.videoId)) return shot.videoId;
  return null;
}

function videoIdFromLooseText(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s"'<>]+/i);
  if (!match) return null;
  return videoIdFromUrl(match[0].replace(/[),.;]+$/, ""));
}

export function normalizeLabel(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function coverage(needle: string, haystack: string): number {
  const wanted = normalizeLabel(needle).split(" ").filter((word) => word.length > 2);
  if (wanted.length === 0) return 0;
  const found = new Set(normalizeLabel(haystack).split(" "));
  const hits = wanted.filter((word) => found.has(word)).length;
  return hits / wanted.length;
}

/** 1 only when the names are the same. A longer name that merely contains the visible name is a different channel. */
export function channelScore(visible: string, candidate: string): number {
  if (!visible) return 1;
  const left = normalizeLabel(visible);
  const right = normalizeLabel(candidate);
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (right.startsWith(`${left} `) || left.startsWith(`${right} `)) return 0.35;
  return coverage(visible, candidate) * 0.5;
}

function durationScore(visible: number | null, candidate: number | null): number {
  if (visible == null || candidate == null) return 0;
  const delta = Math.abs(visible - candidate);
  if (delta <= 2) return 1;
  if (delta <= 10) return 0.5;
  return 0;
}

export function resolveShot(shot: ShotRead, hits: SearchHit[]): Resolution {
  const direct = idFromShot(shot);
  if (direct) {
    return {
      confident: true,
      videoId: direct,
      url: watchUrl(direct),
      title: shot.title,
      channel: shot.channel,
      question: "",
      candidates: hits,
    };
  }
  const ranked = hits
    .map((hit) => ({
      hit,
      title: coverage(shot.title, hit.title),
      channel: channelScore(shot.channel, hit.channel),
      duration: durationScore(shot.durationSeconds, hit.duration),
    }))
    .sort((a, b) => b.title * 2 + b.channel + b.duration - (a.title * 2 + a.channel + a.duration));
  const best = ranked[0];
  const second = ranked[1];
  const exactChannel = Boolean(best && best.channel >= 0.9 && (!second || second.channel < 0.9));
  const durationSeparates = Boolean(best && best.duration >= 1 && (!second || second.duration < 1));
  const confident = Boolean(best && best.title >= 0.8 && (exactChannel || durationSeparates));
  const names = ranked
    .filter((row) => row.title >= 0.4)
    .map((row) => row.hit.channel)
    .filter(Boolean);
  const question = names.length > 1
    ? `The screen shows ${shot.channel || "a channel"}, and more than one upload uses this title. Which channel is it: ${names.join(" or ")}?`
    : "More than one upload matches this screenshot. Which one is it?";
  return {
    confident,
    videoId: best && best.title >= 0.6 ? best.hit.id : null,
    url: best && best.title >= 0.6 ? watchUrl(best.hit.id) : null,
    title: best?.hit.title || shot.title,
    channel: best?.hit.channel || shot.channel,
    question,
    candidates: ranked.filter((row) => row.title >= 0.4).map((row) => row.hit),
  };
}

export function parseSearchLines(stdout: string): SearchHit[] {
  const hits: SearchHit[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [id, title, channel, duration] = line.split("\t");
    if (!id || !ID.test(id)) continue;
    const seconds = Number(duration);
    hits.push({
      id,
      title: title ?? "",
      channel: channel ?? "",
      duration: Number.isFinite(seconds) ? seconds : null,
    });
  }
  return hits;
}
