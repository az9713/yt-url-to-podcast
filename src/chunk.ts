function breakIndex(text: string, start: number, end: number): number {
  const window = text.slice(start, end);
  const min = Math.floor(window.length * 0.5);
  for (const pattern of [/\n\n/g, /(?<=[.!?。！？])\s+/g, /\n/g, /\s/g]) {
    let last = -1;
    for (const match of window.matchAll(pattern)) {
      const at = match.index + match[0].length;
      if (at >= min) last = at;
    }
    if (last > 0) return start + last;
  }
  return end;
}

/** Split text into pieces that cover every character. Pieces stay within maxChars unless one gap has no break. */
export function chunkText(text: string, maxChars: number): string[] {
  if (maxChars < 1) throw new Error("maxChars must be positive");
  const trimmed = text.trim();
  if (!trimmed) return [];
  const chunks: string[] = [];
  let start = 0;
  while (start < trimmed.length) {
    if (trimmed.length - start <= maxChars) {
      chunks.push(trimmed.slice(start).trim());
      break;
    }
    let end = breakIndex(trimmed, start, start + maxChars);
    if (end <= start) end = Math.min(trimmed.length, start + maxChars);
    const piece = trimmed.slice(start, end).trim();
    if (piece) chunks.push(piece);
    start = end;
  }
  return chunks.filter((piece) => piece.length > 0);
}
