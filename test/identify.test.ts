import assert from "node:assert/strict";
import test from "node:test";
import { clockToSeconds, idFromShot, parseSearchLines, resolveShot, type SearchHit } from "../src/identify.ts";

const hits: SearchHit[] = [
  { id: "S7tFyREI19I", title: "Training Your Own Embedding Model Is Not As Hard As You Think", channel: "Prompt Engineering", duration: 756 },
  { id: "aaaaaaaaaaa", title: "Training Your Own Embedding Model", channel: "Someone Else", duration: 100 },
];

test("a screenshot that shows the address bar resolves without a search", () => {
  const id = idFromShot({
    url: "https://www.youtube.com/watch?v=S7tFyREI19I&t=12s",
    videoId: "",
    title: "Training Your Own Embedding Model",
    channel: "Prompt Engineering",
    durationSeconds: null,
  });
  assert.equal(id, "S7tFyREI19I");
});

test("one strong title and channel match starts the episode", () => {
  const resolved = resolveShot(
    { url: "", videoId: "", title: "Training Your Own Embedding Model Is Not As Hard As You Think", channel: "Prompt Engineering" },
    hits,
  );
  assert.equal(resolved.confident, true);
  assert.equal(resolved.videoId, "S7tFyREI19I");
});

test("two close titles wait for a choice", () => {
  const close: SearchHit[] = [
    { id: "S7tFyREI19I", title: "Training Your Own Embedding Model Is Not As Hard As You Think", channel: "Prompt Engineering", duration: 756 },
    { id: "bbbbbbbbbbb", title: "Training Your Own Embedding Model Is Not As Hard As You Think", channel: "Prompt Engineering", duration: 400 },
  ];
  const resolved = resolveShot(
    { url: "", videoId: "", title: "Training Your Own Embedding Model Is Not As Hard As You Think", channel: "Prompt Engineering" },
    close,
  );
  assert.equal(resolved.confident, false);
  assert.equal(resolved.candidates.length, 2);
});

test("the visible channel Forbes beats Forbes Breaking News", () => {
  const resolved = resolveShot(
    {
      url: "",
      videoId: "",
      title: "Anthropic Pauses Free Claude Startup Perks Days After Launch",
      channel: "Forbes",
      durationSeconds: 136,
    },
    [
      { id: "aaaaaaaaaaa", title: "Anthropic Pauses Free Claude Startup Perks Days After Launch", channel: "Forbes Breaking News", duration: 136 },
      { id: "bbbbbbbbbbb", title: "Anthropic Pauses Free Claude Startup Perks Days After Launch", channel: "Forbes", duration: 136 },
    ],
  );
  assert.equal(resolved.confident, true);
  assert.equal(resolved.videoId, "bbbbbbbbbbb");
});

test("the player total is the length after the slash", () => {
  assert.equal(clockToSeconds("0:02 / 2:16"), 136);
});

test("search lines keep the video id", () => {
  const parsed = parseSearchLines("S7tFyREI19I\tTraining\tPrompt Engineering\t756\nbad id\tNope\tX\t1\n");
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].duration, 756);
});
