import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  durationRatio,
  entryKey,
  formatClock,
  formatRatio,
  formatUsd,
  perMinute,
  totalTokens,
  type LedgerEntry,
  type ModelUsage,
} from "./metrics.ts";

export const LEDGER_HTML = "ledger.html";
export const LEDGER_JSON = "ledger.json";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function tokensCell(usage: ModelUsage | null): string {
  const total = totalTokens(usage);
  if (!usage || total == null) return "unknown";
  const reasoning = usage.reasoningTokens == null ? "" : `, reasoning ${usage.reasoningTokens.toLocaleString("en-US")}`;
  return `${total.toLocaleString("en-US")} (in ${usage.inputTokens.toLocaleString("en-US")} / out ${usage.outputTokens.toLocaleString("en-US")}${reasoning})`;
}

function costCell(usage: ModelUsage | null): string {
  if (!usage || usage.calls === 0) return "unknown";
  return formatUsd(usage.catalogCostUsd, usage.costComplete);
}

export function renderLedger(entries: LedgerEntry[]): string {
  const rows = [...entries].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
  const body = rows
    .map((entry) => {
      const ratio = durationRatio(entry.podcastDurationSeconds, entry.videoDurationSeconds);
      const cost = entry.usage?.costComplete ? entry.usage.catalogCostUsd : null;
      const videoMinutes = entry.videoDurationSeconds;
      return `<tr>
<td>${escapeHtml(entry.recordedAt)}</td>
<td><a href="${escapeHtml(entry.url)}">${escapeHtml(entry.title || entry.videoId)}</a><br><span class="meta">${escapeHtml(entry.channel)} · ${escapeHtml(entry.videoId)}</span></td>
<td>${formatClock(entry.videoDurationSeconds)}</td>
<td>${formatClock(entry.podcastDurationSeconds)}</td>
<td>${formatRatio(ratio)}</td>
<td>${formatClock(entry.wallClockSeconds)}</td>
<td>${escapeHtml(entry.model ?? "unknown")}</td>
<td>${tokensCell(entry.usage)}</td>
<td>${costCell(entry.usage)}</td>
<td>${formatUsd(perMinute(cost, videoMinutes), entry.usage?.costComplete === true && cost != null)}</td>
<td>${escapeHtml(entry.transcriptSource)}</td>
<td>${escapeHtml(entry.voice ?? "unknown")}</td>
<td>${entry.scriptPasses ?? "unknown"}</td>
</tr>`;
    })
    .join("\n");

  const details = rows
    .map((entry) => {
      const unknownItems = entry.unknowns
        .map((item) => `<li><strong>${escapeHtml(item.topic)}.</strong> ${escapeHtml(item.whyItMatters)}</li>`)
        .join("\n");
      const notes = entry.notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("\n");
      const stages = Object.entries(entry.stagesSeconds)
        .map(([name, seconds]) => `${escapeHtml(name)} ${formatClock(seconds)}`)
        .join(", ");
      return `<article>
<h2>${escapeHtml(entry.title || entry.videoId)}</h2>
<p class="meta">${escapeHtml(entry.source)} · ${escapeHtml(entry.recordedAt)}</p>
${stages ? `<p>Stages this invocation: ${stages}</p>` : ""}
${notes ? `<ul>${notes}</ul>` : ""}
<h3>Unknowns</h3>
<ul>${unknownItems}</ul>
</article>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Conversion ledger</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; background: #f4f1ea; color: #1c1915; font: 1rem/1.5 Georgia, "Iowan Old Style", Palatino, serif; }
  main { max-width: 72rem; margin: 0 auto; padding: 2.5rem 1.25rem 4rem; }
  h1 { font-size: 2rem; font-weight: 600; margin-bottom: 0.4rem; }
  h2 { font-size: 1.25rem; margin-top: 2rem; }
  .meta, td .meta { font-family: "Segoe UI", sans-serif; font-size: 0.8rem; color: #5c564c; }
  table { width: 100%; border-collapse: collapse; font-family: "Segoe UI", sans-serif; font-size: 0.82rem; background: #fffdf8; }
  th, td { text-align: left; vertical-align: top; padding: 0.55rem 0.45rem; border-bottom: 1px solid #e4ddd0; }
  th { font-size: 0.72rem; letter-spacing: 0.03em; text-transform: uppercase; color: #5c564c; }
  a { color: #1f4d3a; }
  article { border-top: 1px solid #e4ddd0; padding-top: 0.5rem; }
</style>
</head>
<body>
<main>
<h1>Conversion ledger</h1>
<p>Each row is one video turned into an HTML summary and a spoken episode. This file is the ledger. Later runs append to it.</p>
<p>Token count is the billing meter: input, output, cache, and reasoning tokens, priced by the model catalog when Pi reports a cost. It is not the conversion. The conversion is the change from video time to episode time, and what that change cost in money and waiting.</p>
<p>Read three rates together. Podcast length divided by video length shows how much speaking time remains. Wall-clock time shows how long the machine worked. Catalog dollars per minute of video show the metered price. A short episode can still be expensive if the model reread a long transcript. A long episode can still be cheap if the voice ran locally.</p>
<p>Dollar amounts stay <strong>unknown</strong> unless every model call returned a catalog price. Character counts are not converted into pretend tokens.</p>
<table>
<thead>
<tr>
<th>Recorded</th>
<th>Video</th>
<th>Video length</th>
<th>Podcast length</th>
<th>Podcast / video</th>
<th>Wall clock</th>
<th>Model</th>
<th>Tokens</th>
<th>Catalog cost</th>
<th>Cost / video minute</th>
<th>Transcript</th>
<th>Voice</th>
<th>Script passes</th>
</tr>
</thead>
<tbody>
${body}
</tbody>
</table>
${details}
</main>
</body>
</html>
`;
}

export async function readLedger(directory: string): Promise<LedgerEntry[]> {
  try {
    const parsed = JSON.parse(await readFile(path.join(directory, LEDGER_JSON), "utf8")) as LedgerEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function appendLedger(directory: string, entry: LedgerEntry): Promise<string> {
  const entries = await readLedger(directory);
  const key = entryKey(entry);
  const next = entries.filter((existing) => entryKey(existing) !== key);
  next.push(entry);
  await writeFile(path.join(directory, LEDGER_JSON), JSON.stringify(next, null, 2), "utf8");
  const htmlPath = path.join(directory, LEDGER_HTML);
  await writeFile(htmlPath, renderLedger(next), "utf8");
  return htmlPath;
}
