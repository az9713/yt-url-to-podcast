const SENTENCE = /(?<=[.!?。！？])\s+/;

export function splitSentences(text: string): string[] {
  return text
    .split(SENTENCE)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[“”«»]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(text: string): string[] {
  return text.split(" ").filter(Boolean);
}

function jaccard(a: string[], b: string[]): number {
  const left = new Set(a);
  const right = new Set(b);
  let shared = 0;
  for (const token of left) {
    if (right.has(token)) shared += 1;
  }
  const union = left.size + right.size - shared;
  return union === 0 ? 0 : shared / union;
}

function isRecitation(candidate: string, htmlSentences: string[]): boolean {
  const normalized = normalize(candidate);
  if (normalized.length < 40) return false;
  const candidateTokens = tokens(normalized);
  for (const htmlSentence of htmlSentences) {
    const other = normalize(htmlSentence);
    if (other.length < 40) continue;
    if (normalized === other) return true;
    const otherTokens = tokens(other);
    if (candidateTokens.length >= 8 && otherTokens.length >= 8 && jaccard(candidateTokens, otherTokens) >= 0.8) {
      return true;
    }
  }
  return false;
}

/**
 * One repair before speech. Recited sentences are removed. Markdown rules and
 * lines with no words are left for the segmenter to drop. The episode speaks
 * whatever remains.
 */
export function prepareSpeech(script: string, htmlText: string): { script: string; removed: string[] } {
  const removed = copiedSentences(htmlText, script);
  return {
    script: removed.length > 0 ? dropCopiedSentences(script, removed) : script,
    removed,
  };
}

/** Remove recited sentences and leave the rest of the script, including chapter markers. */
export function dropCopiedSentences(script: string, copies: string[]): string {
  const banned = new Set(copies.map((sentence) => sentence.trim()));
  return script
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed || /^---\s*chapter:/i.test(trimmed)) return line;
      const kept = splitSentences(trimmed).filter((sentence) => !banned.has(sentence.trim()));
      return kept.join(" ");
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function spokenLines(text: string): string {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !/^---\s*chapter:/i.test(line) && !/^(?:---+|\*\*\*+|___+)$/.test(line))
    .join("\n");
}

/** Sentences in the spoken script that recite the HTML summary. */
export function copiedSentences(htmlText: string, script: string): string[] {
  const htmlSentences = splitSentences(spokenLines(htmlText));
  const copies: string[] = [];
  for (const sentence of splitSentences(spokenLines(script))) {
    if (isRecitation(sentence, htmlSentences)) copies.push(sentence.trim());
  }
  return copies;
}
