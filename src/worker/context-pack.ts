import {
  FACT_STALE_THRESHOLD_DAYS,
  FACT_STALE_THRESHOLD_MS,
  RETRIEVAL_LOW_CONFIDENCE_THRESHOLD,
  type AiTuningRerankWeights,
  type AiTuningRetrievalWeights,
} from "../../convex/lib/aiSmartness";

export type ContextPackFactType = "preference" | "profile" | "schedule" | "relationship" | "promise" | "other";

export type ContextPackFact = {
  factKey?: string;
  factType: ContextPackFactType;
  factValue: string;
  confidence?: number;
  updatedAt?: number;
};

export type ContextPackRetrievalDiagnostics = {
  plannerSource?: "deterministic" | "hybrid";
  plannerConfidence?: number;
  hintApplied?: boolean;
  historySearchConfidence?: number;
  historySearchCandidateCount?: number;
  historySearchSemanticRerankCount?: number;
  historySearchRetrievalStage?: "lexical" | "semantic" | "semantic_fallback";
  lowConfidence?: boolean;
  lowConfidenceThreshold?: number;
  firstPassFactCoverageWeak?: boolean;
  firstPassFactsStale?: boolean;
  secondPassTriggered?: boolean;
  secondPassReason?: string;
  adaptiveHistoryDepthDelta?: number;
  adaptiveFactRefreshBias?: "low" | "normal" | "high";
  adaptiveSampleSize?: number;
};

export type ContextPackSnapshot = {
  intent: string;
  inboundOrSeedText: string;
  selectedHistoryLines: string[];
  selectedContactFacts: ContextPackFact[];
  styleHints: string[];
  retrievalDiagnostics: ContextPackRetrievalDiagnostics;
  capturedAt: number;
};

export type AdaptiveTuningHintsSnapshot = {
  historyDepthDelta?: number;
  factRefreshBias?: "low" | "normal" | "high";
  preferFactRefresh?: boolean;
  sampleSize?: number;
  retrievalLowConfidenceThreshold?: number;
  factStaleThresholdDays?: number;
  secondPassCoverageMinFacts?: number;
  retrievalWeights?: AiTuningRetrievalWeights;
  rerankWeights?: AiTuningRerankWeights;
  tuningProfileVersion?: number;
  anomalyFreezeActive?: boolean;
};

const MAX_INTENT_CHARS = 84;
const MAX_SEED_CHARS = 720;
const MAX_HISTORY_LINES = 12;
const MAX_HISTORY_LINE_CHARS = 320;
const MAX_FACTS = 8;
const MAX_FACT_KEY_CHARS = 72;
const MAX_FACT_VALUE_CHARS = 220;
const MAX_STYLE_HINTS = 16;
const MAX_STYLE_HINT_CHARS = 140;
const MAX_SECOND_PASS_REASON_CHARS = 180;

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(value, max));
}

function clamp01(value: number | undefined, fallback = 0.5) {
  if (!Number.isFinite(value)) {
    return clamp(fallback, 0, 1);
  }
  return clamp(value as number, 0, 1);
}

function compactText(value: string | undefined, maxChars: number) {
  const normalized = (value || "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxChars - 3)).trim()}...`;
}

function normalizeFactType(raw: string | undefined): ContextPackFactType {
  if (
    raw === "preference" ||
    raw === "profile" ||
    raw === "schedule" ||
    raw === "relationship" ||
    raw === "promise" ||
    raw === "other"
  ) {
    return raw;
  }
  return "other";
}

function toRoundedCount(value: number | undefined, min = 0, max = 9999) {
  return Math.round(clamp(value ?? min, min, max));
}

export function resolveFactStaleThresholdMs(hints?: AdaptiveTuningHintsSnapshot | null) {
  const days = clamp(Math.round(hints?.factStaleThresholdDays ?? FACT_STALE_THRESHOLD_DAYS), 3, 60);
  return days * 24 * 60 * 60 * 1000;
}

export function resolveRetrievalLowConfidenceThreshold(hints?: AdaptiveTuningHintsSnapshot | null) {
  return clamp(hints?.retrievalLowConfidenceThreshold ?? RETRIEVAL_LOW_CONFIDENCE_THRESHOLD, 0.2, 0.9);
}

export function isFactStale(updatedAt: number | undefined, staleThresholdMs = FACT_STALE_THRESHOLD_MS, now = Date.now()) {
  if (!Number.isFinite(updatedAt) || (updatedAt ?? 0) <= 0) {
    return true;
  }
  return Math.max(0, now - (updatedAt as number)) > Math.max(60_000, staleThresholdMs);
}

export function shouldTriggerFactExtractionSecondPass(args: {
  facts: Array<{ updatedAt?: number }>;
  factsLimit: number;
  historySearchConfidence?: number;
  adaptiveHints?: AdaptiveTuningHintsSnapshot | null;
  nowMs?: number;
}) {
  const nowMs = args.nowMs ?? Date.now();
  const staleThresholdMs = resolveFactStaleThresholdMs(args.adaptiveHints);
  const lowConfidenceThreshold = resolveRetrievalLowConfidenceThreshold(args.adaptiveHints);
  const lowConfidence = (args.historySearchConfidence ?? 0) < lowConfidenceThreshold;
  const minCoverage = Math.max(1, Math.min(Math.round(args.adaptiveHints?.secondPassCoverageMinFacts ?? 2), Math.max(1, args.factsLimit)));
  const coverageWeak = args.facts.length < minCoverage;
  const staleFacts = args.facts.length > 0 && args.facts.every((fact) => isFactStale(fact.updatedAt, staleThresholdMs, nowMs));
  const trigger = coverageWeak || staleFacts || lowConfidence;
  const reason = coverageWeak ? "coverage_weak" : staleFacts ? "facts_stale" : lowConfidence ? "low_retrieval_confidence" : undefined;
  return {
    trigger,
    coverageWeak,
    staleFacts,
    lowConfidence,
    reason,
    lowConfidenceThreshold,
    staleThresholdMs,
  };
}

export function normalizeContextPack(pack?: Partial<ContextPackSnapshot> | null): ContextPackSnapshot | undefined {
  if (!pack) {
    return undefined;
  }
  const intent = compactText(pack.intent || "", MAX_INTENT_CHARS);
  const inboundOrSeedText = compactText(pack.inboundOrSeedText || "", MAX_SEED_CHARS);
  if (!intent || !inboundOrSeedText) {
    return undefined;
  }

  const selectedHistoryLines = (pack.selectedHistoryLines || [])
    .map((line) => compactText(line, MAX_HISTORY_LINE_CHARS))
    .filter(Boolean)
    .slice(0, MAX_HISTORY_LINES);

  const selectedContactFacts = (pack.selectedContactFacts || [])
    .map((fact) => {
      const factValue = compactText(fact.factValue || "", MAX_FACT_VALUE_CHARS);
      if (!factValue) {
        return null;
      }
      const factKey = compactText(fact.factKey || "", MAX_FACT_KEY_CHARS);
      const updatedAt = Number.isFinite(fact.updatedAt) && (fact.updatedAt ?? 0) > 0 ? Math.round(fact.updatedAt as number) : undefined;
      return {
        factKey: factKey || undefined,
        factType: normalizeFactType(fact.factType),
        factValue,
        confidence: clamp01(fact.confidence, 0.55),
        updatedAt,
      } as ContextPackFact;
    })
    .filter((fact): fact is ContextPackFact => Boolean(fact))
    .slice(0, MAX_FACTS);

  const styleHints = (pack.styleHints || [])
    .map((hint) => compactText(hint, MAX_STYLE_HINT_CHARS))
    .filter(Boolean)
    .slice(0, MAX_STYLE_HINTS);

  const retrievalDiagnostics = {
    plannerSource:
      pack.retrievalDiagnostics?.plannerSource === "hybrid" || pack.retrievalDiagnostics?.plannerSource === "deterministic"
        ? pack.retrievalDiagnostics.plannerSource
        : undefined,
    plannerConfidence: clamp01(pack.retrievalDiagnostics?.plannerConfidence, 0.5),
    hintApplied: Boolean(pack.retrievalDiagnostics?.hintApplied),
    historySearchConfidence: clamp01(pack.retrievalDiagnostics?.historySearchConfidence, 0),
    historySearchCandidateCount: toRoundedCount(pack.retrievalDiagnostics?.historySearchCandidateCount, 0, 9999),
    historySearchSemanticRerankCount: toRoundedCount(pack.retrievalDiagnostics?.historySearchSemanticRerankCount, 0, 9999),
    historySearchRetrievalStage:
      pack.retrievalDiagnostics?.historySearchRetrievalStage === "semantic" ||
      pack.retrievalDiagnostics?.historySearchRetrievalStage === "lexical" ||
      pack.retrievalDiagnostics?.historySearchRetrievalStage === "semantic_fallback"
        ? pack.retrievalDiagnostics.historySearchRetrievalStage
        : undefined,
    lowConfidence: Boolean(pack.retrievalDiagnostics?.lowConfidence),
    lowConfidenceThreshold: clamp(pack.retrievalDiagnostics?.lowConfidenceThreshold ?? RETRIEVAL_LOW_CONFIDENCE_THRESHOLD, 0.2, 0.9),
    firstPassFactCoverageWeak: Boolean(pack.retrievalDiagnostics?.firstPassFactCoverageWeak),
    firstPassFactsStale: Boolean(pack.retrievalDiagnostics?.firstPassFactsStale),
    secondPassTriggered: Boolean(pack.retrievalDiagnostics?.secondPassTriggered),
    secondPassReason: compactText(pack.retrievalDiagnostics?.secondPassReason, MAX_SECOND_PASS_REASON_CHARS),
    adaptiveHistoryDepthDelta: Math.round(clamp(pack.retrievalDiagnostics?.adaptiveHistoryDepthDelta ?? 0, -4, 8)),
    adaptiveFactRefreshBias:
      pack.retrievalDiagnostics?.adaptiveFactRefreshBias === "high" ||
      pack.retrievalDiagnostics?.adaptiveFactRefreshBias === "low" ||
      pack.retrievalDiagnostics?.adaptiveFactRefreshBias === "normal"
        ? pack.retrievalDiagnostics.adaptiveFactRefreshBias
        : undefined,
    adaptiveSampleSize: toRoundedCount(pack.retrievalDiagnostics?.adaptiveSampleSize, 0, 500),
  } as ContextPackRetrievalDiagnostics;

  const capturedAt = Number.isFinite(pack.capturedAt) && (pack.capturedAt ?? 0) > 0 ? Math.round(pack.capturedAt as number) : Date.now();
  return {
    intent,
    inboundOrSeedText,
    selectedHistoryLines,
    selectedContactFacts,
    styleHints,
    retrievalDiagnostics,
    capturedAt,
  };
}

export function buildContextPack(args: {
  intent: string;
  inboundOrSeedText: string;
  selectedHistoryLines?: string[];
  selectedContactFacts?: ContextPackFact[];
  styleHints?: string[];
  retrievalDiagnostics?: ContextPackRetrievalDiagnostics;
  capturedAt?: number;
}) {
  return normalizeContextPack({
    intent: args.intent,
    inboundOrSeedText: args.inboundOrSeedText,
    selectedHistoryLines: args.selectedHistoryLines || [],
    selectedContactFacts: args.selectedContactFacts || [],
    styleHints: args.styleHints || [],
    retrievalDiagnostics: args.retrievalDiagnostics || {},
    capturedAt: args.capturedAt || Date.now(),
  });
}
