import assert from "node:assert/strict";
import test from "node:test";
import { appendLedger, renderLedger } from "../src/ledger.ts";
import { addUsage, durationRatio, emptyUsage, formatClock, formatUsd, perMinute, totalTokens } from "../src/metrics.ts";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const testCase = {
  recordedAt: "2026-10-08T16:49:21.876Z",
  source: "reconstructed" as const,
  videoId: "S7tFyREI19I",
  url: "https://www.youtube.com/watch?v=S7tFyREI19I",
  title: "Training Your Own Embedding Model Is Not As Hard As You Think",
  channel: "Prompt Engineering",
  language: "en-US",
  model: "openai/gpt-4.1-mini",
  videoDurationSeconds: 756,
  podcastDurationSeconds: 317.8,
  wallClockSeconds: 4953.317,
  transcriptSource: "local-transcription" as const,
  transcriptCharacters: 11000,
  notesCharacters: 3813,
  summaryCharacters: 6885,
  scriptCharacters: 5363,
  voice: "kokoro af_heart",
  segmentCount: 19,
  scriptPasses: 1,
  episodeBytes: 5358388,
  usage: null,
  stagesSeconds: {},
  unknowns: [
    {
      topic: "API tokens and dollars",
      whyItMatters: "The model responses were not recorded, so token count and catalog cost for this conversion are unknown.",
    },
  ],
  notes: ["Reconstructed from the finished files and the run log."],
};

test("a 12m 36s video spoken as 5m 18s is a 42 percent conversion", () => {
  assert.equal(formatClock(756), "12m 36s");
  assert.equal(formatClock(317.8), "5m 18s");
  assert.equal(durationRatio(317.8, 756)?.toFixed(3), "0.420");
});

test("token totals add up and a missing price does not become a dollar total", () => {
  const usage = emptyUsage();
  addUsage(usage, { input: 1000, output: 200, cacheRead: 0, cacheWrite: 0, cost: { total: 0.01 } });
  addUsage(usage, { input: 50, output: 10 });
  assert.equal(totalTokens(usage), 1260);
  assert.equal(usage.costComplete, false);
  assert.equal(formatUsd(usage.catalogCostUsd, usage.costComplete), "unknown");
  assert.equal(perMinute(0.01, 756)?.toFixed(4), "0.0008");
});

test("the ledger names the test video and refuses a guessed token count", async () => {
  const html = renderLedger([testCase]);
  assert.match(html, /S7tFyREI19I/);
  assert.match(html, /12m 36s/);
  assert.match(html, /5m 18s/);
  assert.match(html, /42%/);
  assert.match(html, /Token count is the billing meter/);
  assert.match(html, /API tokens and dollars/);
  const directory = await mkdtemp(path.join(tmpdir(), "ledger-"));
  await appendLedger(directory, testCase);
  await appendLedger(directory, testCase);
  const stored = JSON.parse(await readFile(path.join(directory, "ledger.json"), "utf8")) as unknown[];
  assert.equal(stored.length, 1);
});
