export interface ModelUsage {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number | null;
  catalogCostUsd: number | null;
  /** False when any call omitted a catalog price. The dollar figure is then not a total. */
  costComplete: boolean;
}

export interface Unknown {
  topic: string;
  whyItMatters: string;
}

export interface LedgerEntry {
  recordedAt: string;
  source: "run" | "reconstructed";
  videoId: string;
  url: string;
  title: string;
  channel: string;
  language: string;
  model: string | null;
  videoDurationSeconds: number | null;
  podcastDurationSeconds: number | null;
  wallClockSeconds: number | null;
  transcriptSource: "captions" | "local-transcription" | "unknown";
  transcriptCharacters: number | null;
  notesCharacters: number | null;
  summaryCharacters: number | null;
  scriptCharacters: number | null;
  voice: string | null;
  segmentCount: number | null;
  scriptPasses: number | null;
  episodeBytes: number | null;
  usage: ModelUsage | null;
  stagesSeconds: Record<string, number>;
  unknowns: Unknown[];
  notes: string[];
}

export function emptyUsage(): ModelUsage {
  return {
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: null,
    catalogCostUsd: null,
    costComplete: true,
  };
}

export function addUsage(
  total: ModelUsage,
  usage:
    | {
        input?: number;
        output?: number;
        cacheRead?: number;
        cacheWrite?: number;
        reasoning?: number;
        cost?: { total?: number };
      }
    | undefined,
): void {
  total.calls += 1;
  if (!usage) {
    total.costComplete = false;
    return;
  }
  total.inputTokens += usage.input ?? 0;
  total.outputTokens += usage.output ?? 0;
  total.cacheReadTokens += usage.cacheRead ?? 0;
  total.cacheWriteTokens += usage.cacheWrite ?? 0;
  if (typeof usage.reasoning === "number") {
    total.reasoningTokens = (total.reasoningTokens ?? 0) + usage.reasoning;
  }
  const cost = usage.cost?.total;
  if (typeof cost !== "number" || !Number.isFinite(cost)) {
    total.costComplete = false;
    return;
  }
  total.catalogCostUsd = (total.catalogCostUsd ?? 0) + cost;
}

export function durationRatio(podcastSeconds: number | null, videoSeconds: number | null): number | null {
  if (podcastSeconds == null || videoSeconds == null || videoSeconds <= 0) return null;
  return podcastSeconds / videoSeconds;
}

export function perMinute(amount: number | null, seconds: number | null): number | null {
  if (amount == null || seconds == null || seconds <= 0) return null;
  return amount / (seconds / 60);
}

export function formatClock(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds)) return "unknown";
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remain = total % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${remain}s`;
  return `${minutes}m ${remain}s`;
}

export function formatRatio(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "unknown";
  return `${Math.round(value * 100)}%`;
}

export function formatUsd(value: number | null, complete: boolean): string {
  if (value == null || !complete) return "unknown";
  if (value === 0) return "$0.00";
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

export function totalTokens(usage: ModelUsage | null): number | null {
  if (!usage || usage.calls === 0) return null;
  return usage.inputTokens + usage.outputTokens;
}

export function entryKey(entry: LedgerEntry): string {
  return `${entry.videoId}:${entry.source}:${entry.recordedAt}`;
}
