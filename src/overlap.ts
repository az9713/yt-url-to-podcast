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

/** Sentences in the spoken script that recite the HTML summary. */
export function copiedSentences(htmlText: string, spokenText: string): string[] {
  const htmlSentences = splitSentences(htmlText);
  const copies: string[] = [];
  for (const sentence of splitSentences(spokenText)) {
    if (isRecitation(sentence, htmlSentences)) copies.push(sentence.trim());
  }
  return copies;
}
