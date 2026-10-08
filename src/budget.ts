/** Characters of source text sent in one model call. Long videos become more calls, not a bigger call. */
export function inputBudgetChars(contextWindow: number): number {
  const windowTokens = Math.max(1, Math.floor(contextWindow));
  const preferred = Math.min(12_000, Math.floor(windowTokens * 0.4));
  const tokens = Math.min(Math.max(500, preferred), Math.max(1, windowTokens - 256));
  return tokens * 4;
}
