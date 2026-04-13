import { v } from "convex/values";
import { deriveOutreachModeFromReason, type OutreachMode } from "./outreachModes";

export const FACT_STALE_THRESHOLD_DAYS = 14;
export const FACT_STALE_THRESHOLD_MS = FACT_STALE_THRESHOLD_DAYS * 24 * 60 * 60 * 1000;
export const RETRIEVAL_LOW_CONFIDENCE_THRESHOLD = 0.45;
export const POSITIVE_ENGAGEMENT_WINDOW_MS = 6 * 60 * 60 * 1000;
export const NEUTRAL_EVALUATION_HORIZON_MS = 24 * 60 * 60 * 1000;
export const OUTCOME_BACKFILL_WINDOW_DAYS = 30;
export const TUNING_TRAINING_WINDOW_DAYS = 30;
export const TUNING_DAILY_DELTA_CAP = 0.1;
export const TUNING_MODERATE_RETRIEVAL_LOW_CONFIDENCE_MIN = 0.35;
export const TUNING_MODERATE_RETRIEVAL_LOW_CONFIDENCE_MAX = 0.65;
export const TUNING_MODERATE_FACT_STALE_DAYS_MIN = 7;
export const TUNING_MODERATE_FACT_STALE_DAYS_MAX = 30;
export const TUNING_MODERATE_WEIGHT_MULTIPLIER_MIN = 0.5;
export const TUNING_MODERATE_WEIGHT_MULTIPLIER_MAX = 2.0;
export const TUNING_FREEZE_GUARDRAIL_REGRESSION = 0.25;
export const TUNING_FREEZE_MANUAL_REGRESSION = 0.2;

export const outreachModeValidator = v.union(
  v.literal("proactive"),
  v.literal("good_morning"),
  v.literal("compliment"),
);

export const contextPackFactTypeValidator = v.union(
  v.literal("preference"),
  v.literal("profile"),
  v.literal("schedule"),
  v.literal("relationship"),
  v.literal("promise"),
  v.literal("other"),
);

export const contextPackFactValidator = v.object({
  factKey: v.optional(v.string()),
  factType: contextPackFactTypeValidator,
  factValue: v.string(),
  confidence: v.optional(v.number()),
  updatedAt: v.optional(v.number()),
});

export const contextPackRetrievalDiagnosticsValidator = v.object({
  plannerSource: v.optional(v.union(v.literal("deterministic"), v.literal("hybrid"))),
  plannerConfidence: v.optional(v.number()),
  hintApplied: v.optional(v.boolean()),
  historySearchConfidence: v.optional(v.number()),
  historySearchCandidateCount: v.optional(v.number()),
  historySearchSemanticRerankCount: v.optional(v.number()),
  historySearchRetrievalStage: v.optional(v.union(v.literal("lexical"), v.literal("semantic"), v.literal("semantic_fallback"))),
  lowConfidence: v.optional(v.boolean()),
  lowConfidenceThreshold: v.optional(v.number()),
  firstPassFactCoverageWeak: v.optional(v.boolean()),
  firstPassFactsStale: v.optional(v.boolean()),
  secondPassTriggered: v.optional(v.boolean()),
  secondPassReason: v.optional(v.string()),
  adaptiveHistoryDepthDelta: v.optional(v.number()),
  adaptiveFactRefreshBias: v.optional(v.union(v.literal("low"), v.literal("normal"), v.literal("high"))),
  adaptiveSampleSize: v.optional(v.number()),
});

export const contextPackValidator = v.object({
  intent: v.string(),
  inboundOrSeedText: v.string(),
  selectedHistoryLines: v.array(v.string()),
  selectedContactFacts: v.array(contextPackFactValidator),
  styleHints: v.array(v.string()),
  retrievalDiagnostics: contextPackRetrievalDiagnosticsValidator,
  capturedAt: v.number(),
});

export const aiFeedbackPathValidator = v.union(v.literal("reply"), v.literal("outreach"), v.literal("status"));

export const aiOutcomeLabelValidator = v.union(
  v.literal("positive"),
  v.literal("neutral"),
  v.literal("negative"),
  v.literal("mixed"),
);

export const aiOutcomeSignalCountsValidator = v.object({
  engagedReply: v.number(),
  noReplyHorizon: v.number(),
  suppressedStale: v.number(),
  suppressedManual: v.number(),
  manualRewrite: v.number(),
  totalSignals: v.number(),
});

export const aiCandidateFeatureVectorValidator = v.object({
  contextSupport: v.number(),
  steeringFit: v.number(),
  engagementProxy: v.number(),
  copyRiskPenalty: v.number(),
  selfRepeatPenalty: v.number(),
  freshnessSupport: v.number(),
  qualityScore: v.number(),
});

export const aiCandidateScoreBreakdownValidator = v.object({
  weightedTotal: v.number(),
  contextSupport: v.number(),
  steeringFit: v.number(),
  engagementProxy: v.number(),
  copyRiskPenalty: v.number(),
  selfRepeatPenalty: v.number(),
  freshnessSupport: v.number(),
  qualityScore: v.number(),
  weightsVersion: v.number(),
});

export const aiTuningBoundsProfileValidator = v.union(v.literal("moderate"));

export const aiTuningRetrievalWeightsValidator = v.object({
  overlapWeight: v.number(),
  confidenceWeight: v.number(),
  freshnessWeight: v.number(),
  typeWeight: v.number(),
  conflictPenaltyWeight: v.number(),
});

export const aiTuningRerankWeightsValidator = v.object({
  contextSupport: v.number(),
  steeringFit: v.number(),
  engagementProxy: v.number(),
  copyRiskPenalty: v.number(),
  selfRepeatPenalty: v.number(),
  freshnessSupport: v.number(),
  qualityScore: v.number(),
});

export const aiTuningThresholdsValidator = v.object({
  retrievalLowConfidenceThreshold: v.number(),
  factStaleThresholdDays: v.number(),
  secondPassCoverageMinFacts: v.number(),
});

export type AiTuningRetrievalWeights = {
  overlapWeight: number;
  confidenceWeight: number;
  freshnessWeight: number;
  typeWeight: number;
  conflictPenaltyWeight: number;
};

export type AiTuningRerankWeights = {
  contextSupport: number;
  steeringFit: number;
  engagementProxy: number;
  copyRiskPenalty: number;
  selfRepeatPenalty: number;
  freshnessSupport: number;
  qualityScore: number;
};

export type AiTuningThresholds = {
  retrievalLowConfidenceThreshold: number;
  factStaleThresholdDays: number;
  secondPassCoverageMinFacts: number;
};

export const DEFAULT_AI_RETRIEVAL_WEIGHTS: AiTuningRetrievalWeights = {
  overlapWeight: 2.2,
  confidenceWeight: 1.1,
  freshnessWeight: 0.9,
  typeWeight: 1,
  conflictPenaltyWeight: 0.9,
};

export const DEFAULT_AI_RERANK_WEIGHTS: AiTuningRerankWeights = {
  contextSupport: 1.1,
  steeringFit: 1.05,
  engagementProxy: 0.95,
  copyRiskPenalty: 1.3,
  selfRepeatPenalty: 1.2,
  freshnessSupport: 0.9,
  qualityScore: 1,
};

export const DEFAULT_AI_TUNING_THRESHOLDS: AiTuningThresholds = {
  retrievalLowConfidenceThreshold: RETRIEVAL_LOW_CONFIDENCE_THRESHOLD,
  factStaleThresholdDays: FACT_STALE_THRESHOLD_DAYS,
  secondPassCoverageMinFacts: 2,
};

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(value, max));
}

export function clamp01(value: number, fallback = 0.5) {
  if (!Number.isFinite(value)) {
    return clamp(fallback, 0, 1);
  }
  return clamp(value, 0, 1);
}

export function clampDailyDelta(nextValue: number, previousValue: number, deltaCap = TUNING_DAILY_DELTA_CAP) {
  const safePrev = Number.isFinite(previousValue) ? previousValue : nextValue;
  const maxDelta = Math.abs(safePrev) * clamp(deltaCap, 0, 1);
  if (!Number.isFinite(nextValue) || !Number.isFinite(safePrev)) {
    return safePrev;
  }
  if (maxDelta <= 0) {
    return safePrev;
  }
  return clamp(nextValue, safePrev - maxDelta, safePrev + maxDelta);
}

export function clampWeightMultiplierModerate(value: number) {
  return clamp(
    value,
    TUNING_MODERATE_WEIGHT_MULTIPLIER_MIN,
    TUNING_MODERATE_WEIGHT_MULTIPLIER_MAX,
  );
}

export function clampRetrievalLowConfidenceThresholdModerate(value: number) {
  return clamp(
    value,
    TUNING_MODERATE_RETRIEVAL_LOW_CONFIDENCE_MIN,
    TUNING_MODERATE_RETRIEVAL_LOW_CONFIDENCE_MAX,
  );
}

export function clampFactStaleThresholdDaysModerate(value: number) {
  return Math.round(
    clamp(
      value,
      TUNING_MODERATE_FACT_STALE_DAYS_MIN,
      TUNING_MODERATE_FACT_STALE_DAYS_MAX,
    ),
  );
}

export const aiFeedbackMetadataValidator = v.optional(
  v.object({
    reason: v.optional(v.string()),
    detail: v.optional(v.string()),
    eventType: v.optional(v.string()),
    signalAt: v.optional(v.number()),
    sentAt: v.optional(v.number()),
    engagementWindowMs: v.optional(v.number()),
    evaluationHorizonMs: v.optional(v.number()),
    staleMessageAt: v.optional(v.number()),
    staleMessagePreview: v.optional(v.string()),
    inboundMessageId: v.optional(v.id("messages")),
    inboundMessageType: v.optional(v.string()),
    draftId: v.optional(v.id("replyDrafts")),
    tags: v.optional(v.array(v.string())),
  }),
);

export function resolveOutreachModeWithFallback(args: {
  explicitOutreachMode?: OutreachMode | null;
  reason?: string | null;
}): OutreachMode | undefined {
  return args.explicitOutreachMode || deriveOutreachModeFromReason(args.reason);
}

export function resolveFeedbackPath(args: {
  isStatusPost?: boolean;
  explicitOutreachMode?: OutreachMode | null;
  reason?: string | null;
}): "reply" | "outreach" | "status" {
  if (args.isStatusPost) {
    return "status";
  }
  const outreachMode = resolveOutreachModeWithFallback({
    explicitOutreachMode: args.explicitOutreachMode,
    reason: args.reason,
  });
  return outreachMode ? "outreach" : "reply";
}
