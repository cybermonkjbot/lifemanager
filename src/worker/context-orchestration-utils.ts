type HistoryRetrievalStage = "lexical" | "semantic" | "semantic_fallback";

export type HistorySearchOverrideLike = {
  lines: string[];
  candidateCount: number;
  semanticRerankCount: number;
  confidence: number;
  retrievalStage?: HistoryRetrievalStage;
};

const HISTORY_QUERY_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "been",
  "by",
  "for",
  "from",
  "how",
  "i",
  "if",
  "in",
  "is",
  "it",
  "its",
  "me",
  "my",
  "of",
  "on",
  "or",
  "our",
  "that",
  "the",
  "their",
  "them",
  "they",
  "this",
  "to",
  "us",
  "was",
  "we",
  "were",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "you",
  "your",
]);

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(value, max));
}

function normalizeHistoryLine(line: string) {
  return line.replace(/\s+/g, " ").trim().slice(0, 320);
}

function tokenizeKeywords(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !HISTORY_QUERY_STOPWORDS.has(token));
}

function pickRetrievalStage(stages: Array<HistoryRetrievalStage | undefined>): HistoryRetrievalStage {
  if (stages.some((stage) => stage === "semantic")) {
    return "semantic";
  }
  if (stages.some((stage) => stage === "lexical")) {
    return "lexical";
  }
  return "semantic_fallback";
}

function buildHistoryKeywordHints(historyLines: string[], maxKeywords: number) {
  const counts = new Map<string, number>();
  const sample = historyLines.slice(-Math.max(6, Math.min(historyLines.length, 24)));
  for (const line of sample) {
    const body = line.replace(/^(Me|Them):\s*/i, "");
    const tokens = tokenizeKeywords(body);
    for (const token of tokens) {
      counts.set(token, (counts.get(token) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, Math.max(1, maxKeywords))
    .map(([token]) => token);
}

export function buildHistorySearchRewriteQuery(args: {
  inboundText: string;
  historyLines: string[];
  maxInboundKeywords?: number;
  maxHistoryKeywords?: number;
}) {
  const inbound = args.inboundText.replace(/\s+/g, " ").trim();
  if (!inbound) {
    return undefined;
  }

  const inboundKeywords = Array.from(
    new Set(tokenizeKeywords(inbound).slice(0, Math.max(2, Math.min(args.maxInboundKeywords ?? 7, 12)))),
  );
  if (inboundKeywords.length === 0) {
    return undefined;
  }

  const historyHints = buildHistoryKeywordHints(
    args.historyLines,
    Math.max(1, Math.min(args.maxHistoryKeywords ?? 4, 8)),
  ).filter((token) => !inboundKeywords.includes(token));

  const merged = [...inboundKeywords, ...historyHints].slice(0, 12);
  if (merged.length === 0) {
    return undefined;
  }

  const rewritten = merged.join(" ").trim().slice(0, 220);
  const inboundLower = inbound.toLowerCase();
  if (!rewritten || rewritten === inboundLower) {
    return undefined;
  }

  return rewritten;
}

export function mergeHistorySearchOverrides(args: {
  base?: HistorySearchOverrideLike;
  incoming?: HistorySearchOverrideLike;
  limit: number;
}) {
  const limit = Math.round(clamp(args.limit, 1, 32));
  if (!args.base && !args.incoming) {
    return undefined;
  }
  if (!args.base) {
    return {
      ...args.incoming!,
      lines: (args.incoming?.lines || []).map(normalizeHistoryLine).filter(Boolean).slice(0, limit),
      retrievalStage: pickRetrievalStage([args.incoming?.retrievalStage]),
    } as HistorySearchOverrideLike;
  }
  if (!args.incoming) {
    return {
      ...args.base,
      lines: (args.base?.lines || []).map(normalizeHistoryLine).filter(Boolean).slice(0, limit),
      retrievalStage: pickRetrievalStage([args.base?.retrievalStage]),
    } as HistorySearchOverrideLike;
  }

  const primary = args.incoming.confidence >= args.base.confidence ? args.incoming : args.base;
  const secondary = primary === args.incoming ? args.base : args.incoming;
  const mergedLines = [...(primary.lines || []), ...(secondary.lines || [])]
    .map(normalizeHistoryLine)
    .filter(Boolean);
  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const line of mergedLines) {
    const key = line.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(line);
  }

  return {
    lines: deduped.slice(0, limit),
    candidateCount: Math.max(args.base.candidateCount || 0, args.incoming.candidateCount || 0),
    semanticRerankCount: Math.max(args.base.semanticRerankCount || 0, args.incoming.semanticRerankCount || 0),
    confidence: Math.max(args.base.confidence || 0, args.incoming.confidence || 0),
    retrievalStage: pickRetrievalStage([args.base.retrievalStage, args.incoming.retrievalStage]),
  } as HistorySearchOverrideLike;
}

export function isHistoryContextWeak(args: {
  override?: HistorySearchOverrideLike;
  lowConfidenceThreshold: number;
  minStrongLines: number;
}) {
  if (!args.override) {
    return true;
  }
  const lines = Math.max(0, args.override.lines.length);
  const confidence = Number.isFinite(args.override.confidence) ? args.override.confidence : 0;
  return lines < Math.max(1, Math.round(args.minStrongLines)) || confidence < Math.max(0, args.lowConfidenceThreshold);
}
