import { v } from "convex/values";
import { deriveOutreachModeFromReason, type OutreachMode } from "./outreachModes";

export const FACT_STALE_THRESHOLD_DAYS = 14;
export const FACT_STALE_THRESHOLD_MS = FACT_STALE_THRESHOLD_DAYS * 24 * 60 * 60 * 1000;
export const RETRIEVAL_LOW_CONFIDENCE_THRESHOLD = 0.45;
export const POSITIVE_ENGAGEMENT_WINDOW_MS = 6 * 60 * 60 * 1000;
export const NEUTRAL_EVALUATION_HORIZON_MS = 24 * 60 * 60 * 1000;

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
