import assert from "node:assert/strict";
import test from "node:test";
import { inputBudgetChars } from "../src/budget.ts";
import { chunkText } from "../src/chunk.ts";
import { renderHtml } from "../src/html.ts";
import { extractJson } from "../src/json.ts";
import { copiedSentences } from "../src/overlap.ts";
import { pickSubtitle, vttToText } from "../src/vtt.ts";
import { routeVoice, scriptToSegments } from "../src/voices.ts";
import { videoIdFromUrl } from "../src/youtube.ts";

const VERBATIM = "The reactor uses molten salt to move heat from the core to the exchanger.";
const ONE_WORD = "The reactor uses molten salt to move heat from the core to the turbine.";
const RETELLING = "Picture a loop of hot salt leaving the core and coming back cooler.";

test("a YouTube watch URL, short link, and shorts link share one video id", () => {
  assert.equal(videoIdFromUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(videoIdFromUrl("https://youtu.be/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(videoIdFromUrl("https://www.youtube.com/shorts/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(videoIdFromUrl("https://www.youtube.com/embed/dQw4w9WgXcQ?si=1"), "dQw4w9WgXcQ");
  assert.equal(videoIdFromUrl("not a url"), null);
});

test("a long transcript is split without dropping the start, middle, or end", () => {
  const text = `${"a".repeat(1200)} STARTMARK ${"b".repeat(1200)} MIDMARK ${"c".repeat(1200)} ENDMARK`;
  const chunks = chunkText(text, 800);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.length <= 800));
  assert.ok(chunks.some((chunk) => chunk.includes("STARTMARK")));
  assert.ok(chunks.some((chunk) => chunk.includes("MIDMARK")));
  assert.ok(chunks.some((chunk) => chunk.includes("ENDMARK")));
});

test("input budget stays inside a small window and caps a large one", () => {
  assert.equal(inputBudgetChars(200_000), 48_000);
  assert.equal(inputBudgetChars(1_000), 2_000);
});

test("captions collapse repeated cues and drop timestamps", () => {
  const vtt = `WEBVTT

00:00:00.000 --> 00:00:02.000
Hello there.

00:00:02.000 --> 00:00:04.000
Hello there.

00:00:04.000 --> 00:00:06.000
The reactor uses <c>molten</c> salt.
`;
  assert.equal(vttToText(vtt), "Hello there.\nThe reactor uses molten salt.");
});

test("subtitle choice prefers the video language", () => {
  const files = ["auto.abc.fr.vtt", "auto.abc.en-US.vtt", "manual.abc.en.vtt"];
  assert.equal(pickSubtitle(files, "en"), "manual.abc.en.vtt");
  assert.equal(pickSubtitle(files, "fr"), "auto.abc.fr.vtt");
  assert.equal(pickSubtitle([], "en"), null);
});

test("a verbatim sentence and a one-word edit are recitation; a retelling is not", () => {
  const html = `How the core is cooled. ${VERBATIM} Hello.`;
  assert.deepEqual(copiedSentences(html, VERBATIM), [VERBATIM]);
  assert.deepEqual(copiedSentences(html, ONE_WORD), [ONE_WORD]);
  assert.deepEqual(copiedSentences(html, `${RETELLING} Hello.`), []);
});

test("voice routing keeps Kokoro for English and Chatterbox for Korean", () => {
  assert.deepEqual(routeVoice("en-US"), { engine: "kokoro", langCode: "a", voice: "af_heart" });
  assert.deepEqual(routeVoice("ko"), { engine: "chatterbox", languageId: "ko" });
  assert.throws(() => routeVoice("th"), /No publishable local voice/);
});

test("chapter markers are not spoken", () => {
  const segments = scriptToSegments("--- chapter: Salt loop ---\nThe salt leaves the core.\n--- chapter: Return ---\nIt comes back cooler.", 500);
  assert.deepEqual(
    segments.map((segment) => segment.chapter),
    ["Salt loop", "Return"],
  );
  assert.equal(segments.map((segment) => segment.text).join(" "), "The salt leaves the core. It comes back cooler.");
});

test("the HTML page names the source video and escapes markup", () => {
  const html = renderHtml(
    {
      title: "Salt <loop>",
      language: "en",
      dek: "A cooling loop.",
      rights: "Publish only with rights.",
      sections: [{ heading: "Core", paragraphs: ["Heat moves."] }],
    },
    { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", videoTitle: "Original", channel: "Plant" },
  );
  assert.match(html, /https:\/\/www\.youtube\.com\/watch\?v=dQw4w9WgXcQ/);
  assert.match(html, /Salt &lt;loop&gt;/);
  assert.doesNotMatch(html, /<loop>/);
  assert.match(html, /Publish only with rights/);
});

test("JSON extraction ignores a fence", () => {
  const value = extractJson('Sure\n```json\n{"title":"Salt"}\n```');
  assert.deepEqual(value, { title: "Salt" });
});
