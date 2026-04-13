import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import {
  DEFAULT_AI_RERANK_WEIGHTS,
  DEFAULT_AI_RETRIEVAL_WEIGHTS,
  DEFAULT_AI_TUNING_THRESHOLDS,
  FACT_STALE_THRESHOLD_DAYS,
  NEUTRAL_EVALUATION_HORIZON_MS,
  OUTCOME_BACKFILL_WINDOW_DAYS,
  POSITIVE_ENGAGEMENT_WINDOW_MS,
  RETRIEVAL_LOW_CONFIDENCE_THRESHOLD,
  TUNING_DAILY_DELTA_CAP,
  TUNING_FREEZE_GUARDRAIL_REGRESSION,
  TUNING_FREEZE_MANUAL_REGRESSION,
  TUNING_TRAINING_WINDOW_DAYS,
  aiCandidateFeatureVectorValidator,
  aiCandidateScoreBreakdownValidator,
  aiFeedbackMetadataValidator,
  aiFeedbackPathValidator,
  clampDailyDelta,
  clampFactStaleThresholdDaysModerate,
  clampRetrievalLowConfidenceThresholdModerate,
  clampWeightMultiplierModerate,
  resolveFeedbackPath,
  type AiTuningRerankWeights,
  type AiTuningRetrievalWeights,
  type AiTuningThresholds,
} from "./lib/aiSmartness";

type FeedbackPath = "reply" | "outreach" | "status";

type FeedbackSignalRow = Pick<Doc<"aiFeedbackSignals">, "signalType" | "score" | "metadata" | "createdAt">;

type OutcomeSignalCounts = {
  engagedReply: number;
  noReplyHorizon: number;
  suppressedStale: number;
  suppressedManual: number;
  manualRewrite: number;
  totalSignals: number;
};

type OutcomeSummary = {
  signalCounts: OutcomeSignalCounts;
  engagementScore: number;
  frictionScore: number;
  qualityScore: number;
  label: "positive" | "neutral" | "negative" | "mixed";
};

type TuningProfileSnapshot = {
  path: FeedbackPath;
  version: number;
  sampleSize: number;
  trainingWindowDays: number;
  retrievalWeights: AiTuningRetrievalWeights;
  rerankWeights: AiTuningRerankWeights;
  thresholds: AiTuningThresholds;
  boundsProfile: "moderate";
  anomalyFreezeActive: boolean;
  anomalyReason?: string;
  learnedAt: number;
};

const BACKFILL_JOB_KEY = "smartness_v2_outcomes_backfill_30d";
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_SIGNAL_SCAN = 240;
const MAX_OUTCOME_ROWS = 1600;
const MAX_CANDIDATE_ROWS = 2200;

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(value, max));
}

function safeNumber(value: unknown, fallback = 0) {
  return Number.isFinite(value) ? (value as number) : fallback;
}

function stableTextHash(value: string) {
  let hash = 2166136261;
  const text = value || "";
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function countSignals(signals: FeedbackSignalRow[]): OutcomeSignalCounts {
  const counts: OutcomeSignalCounts = {
    engagedReply: 0,
    noReplyHorizon: 0,
    suppressedStale: 0,
    suppressedManual: 0,
    manualRewrite: 0,
    totalSignals: signals.length,
  };

  for (const signal of signals) {
    if (signal.signalType === "engaged_reply") {
      counts.engagedReply += 1;
    } else if (signal.signalType === "no_reply_horizon") {
      counts.noReplyHorizon += 1;
    } else if (signal.signalType === "suppressed_stale") {
      counts.suppressedStale += 1;
    } else if (signal.signalType === "suppressed_manual_intervention" || signal.signalType === "suppressed_manual_cooldown") {
      counts.suppressedManual += 1;
    } else if (signal.signalType === "manual_rewrite") {
      counts.manualRewrite += 1;
    }
  }

  return counts;
}

export function summarizeOutcomeFromSignals(signals: FeedbackSignalRow[]): OutcomeSummary {
  const signalCounts = countSignals(signals);
  const engagementScore = signalCounts.engagedReply * 1 - signalCounts.noReplyHorizon * 0.35;
  const frictionScore = signalCounts.suppressedStale * 1.15 + signalCounts.suppressedManual * 1 + signalCounts.manualRewrite * 0.8;
  const qualityScore = clamp(0.55 + engagementScore * 0.2 - frictionScore * 0.15, 0, 1);

  const label: OutcomeSummary["label"] =
    engagementScore > 0.75 && frictionScore < 0.8
      ? "positive"
      : frictionScore >= 1.5 && engagementScore <= 0
      ? "negative"
      : engagementScore > 0 && frictionScore > 0
      ? "mixed"
      : "neutral";

  return {
    signalCounts,
    engagementScore,
    frictionScore,
    qualityScore,
    label,
  };
}

export function summarizeAdaptiveHintsFromSignals(signals: FeedbackSignalRow[]) {
  let positiveCount = 0;
  let negativeCount = 0;
  let neutralCount = 0;
  let staleSuppressions = 0;
  let manualInterventionSuppressions = 0;
  let manualRewrites = 0;
  let scoreSum = 0;

  for (const signal of signals) {
    const score = Number.isFinite(signal.score) ? signal.score : 0;
    scoreSum += score;
    if (score > 0) {
      positiveCount += 1;
    } else if (score < 0) {
      negativeCount += 1;
    } else {
      neutralCount += 1;
    }

    if (signal.signalType === "suppressed_stale") {
      staleSuppressions += 1;
    } else if (signal.signalType === "suppressed_manual_intervention" || signal.signalType === "suppressed_manual_cooldown") {
      manualInterventionSuppressions += 1;
    } else if (signal.signalType === "manual_rewrite") {
      manualRewrites += 1;
    }
  }

  const sampleSize = signals.length;
  const friction = staleSuppressions * 1.15 + manualInterventionSuppressions * 1 + manualRewrites * 0.8;
  const recovery = positiveCount * 0.8 + neutralCount * 0.25;
  const historyDepthDelta = Math.round(clamp(friction - recovery, -2, 6));
  const factRefreshBias: "low" | "normal" | "high" =
    friction >= recovery + 1 ? "high" : positiveCount >= negativeCount + 2 && staleSuppressions === 0 ? "low" : "normal";

  return {
    sampleSize,
    positiveCount,
    negativeCount,
    neutralCount,
    averageScore: sampleSize > 0 ? scoreSum / sampleSize : 0,
    staleSuppressions,
    manualInterventionSuppressions,
    manualRewrites,
    historyDepthDelta,
    factRefreshBias,
    preferFactRefresh: factRefreshBias === "high" || staleSuppressions >= 2,
    retrievalLowConfidenceThreshold: RETRIEVAL_LOW_CONFIDENCE_THRESHOLD,
    factStaleThresholdDays: FACT_STALE_THRESHOLD_DAYS,
  };
}

async function loadLatestTuningProfile(ctx: QueryCtx, path: FeedbackPath): Promise<TuningProfileSnapshot> {
  const latest = await ctx.db
    .query("aiTuningProfiles")
    .withIndex("by_path_and_learnedAt", (q) => q.eq("path", path))
    .order("desc")
    .first();

  if (latest) {
    return {
      path: latest.path,
      version: latest.version,
      sampleSize: latest.sampleSize,
      trainingWindowDays: latest.trainingWindowDays,
      retrievalWeights: latest.retrievalWeights,
      rerankWeights: latest.rerankWeights,
      thresholds: latest.thresholds,
      boundsProfile: latest.boundsProfile,
      anomalyFreezeActive: latest.anomalyFreezeActive,
      anomalyReason: latest.anomalyReason,
      learnedAt: latest.learnedAt,
    };
  }

  return {
    path,
    version: 0,
    sampleSize: 0,
    trainingWindowDays: TUNING_TRAINING_WINDOW_DAYS,
    retrievalWeights: DEFAULT_AI_RETRIEVAL_WEIGHTS,
    rerankWeights: DEFAULT_AI_RERANK_WEIGHTS,
    thresholds: DEFAULT_AI_TUNING_THRESHOLDS,
    boundsProfile: "moderate",
    anomalyFreezeActive: false,
    learnedAt: 0,
  };
}

async function loadThreadAdaptiveHints(
  ctx: QueryCtx,
  args: {
    threadId: Id<"threads">;
    path?: FeedbackPath;
    limit?: number;
  },
) {
  const limit = Math.max(12, Math.min(Math.round(args.limit ?? 60), 180));
  const rows = await ctx.db
    .query("aiFeedbackSignals")
    .withIndex("by_threadId_and_createdAt", (q) => q.eq("threadId", args.threadId))
    .order("desc")
    .take(limit * 2);
  const filtered = args.path ? rows.filter((row) => row.path === args.path).slice(0, limit) : rows.slice(0, limit);
  const summary = summarizeAdaptiveHintsFromSignals(filtered);
  const path = args.path || "reply";
  const profile = await loadLatestTuningProfile(ctx, path);
  return {
    threadId: args.threadId,
    path: args.path,
    ...summary,
    retrievalLowConfidenceThreshold: profile.thresholds.retrievalLowConfidenceThreshold,
    factStaleThresholdDays: profile.thresholds.factStaleThresholdDays,
    secondPassCoverageMinFacts: profile.thresholds.secondPassCoverageMinFacts,
    retrievalWeights: profile.retrievalWeights,
    rerankWeights: profile.rerankWeights,
    tuningProfileVersion: profile.version,
    anomalyFreezeActive: profile.anomalyFreezeActive,
  };
}

async function upsertOutcomeForOutbox(
  ctx: MutationCtx,
  outboxId: Id<"outbox">,
  now = Date.now(),
): Promise<{ outcomeId: Id<"aiOutcomes"> | null; summary?: OutcomeSummary }> {
  const outbox = await ctx.db.get(outboxId);
  if (!outbox) {
    return { outcomeId: null };
  }

  const rows = await ctx.db
    .query("aiFeedbackSignals")
    .withIndex("by_outboxId_and_createdAt", (q) => q.eq("outboxId", outbox._id))
    .order("desc")
    .take(MAX_SIGNAL_SCAN);
  const signals = rows.slice().reverse();
  const summary = summarizeOutcomeFromSignals(signals);

  const signalTimes = signals.map((signal) => signal.createdAt).filter((value) => Number.isFinite(value));
  const sentCandidates = [
    outbox.sendAt,
    outbox.createdAt,
    outbox.updatedAt,
    ...signals.map((signal) => safeNumber(signal.metadata?.sentAt, 0)),
  ]
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);

  const windowStartAt = sentCandidates[0] || signalTimes[0] || now;
  const windowEndAt = Math.max(windowStartAt, ...signalTimes, now);

  const existing = await ctx.db
    .query("aiOutcomes")
    .withIndex("by_outboxId_and_updatedAt", (q) => q.eq("outboxId", outbox._id))
    .order("desc")
    .first();

  const payload = {
    threadId: outbox.threadId,
    outboxId: outbox._id,
    toolRunId: outbox.toolRunId,
    path: outbox.isStatusPost
      ? ("status" as const)
      : outbox.outreachMode
      ? ("outreach" as const)
      : ("reply" as const),
    windowStartAt,
    windowEndAt,
    signalCounts: summary.signalCounts,
    engagementScore: summary.engagementScore,
    frictionScore: summary.frictionScore,
    qualityScore: summary.qualityScore,
    label: summary.label,
    updatedAt: now,
  };

  if (existing) {
    await ctx.db.patch(existing._id, payload);
    return { outcomeId: existing._id, summary };
  }

  const outcomeId = await ctx.db.insert("aiOutcomes", {
    ...payload,
    createdAt: now,
  });
  return { outcomeId, summary };
}

async function insertSignalAndQueueOutcome(args: {
  ctx: MutationCtx;
  threadId: Id<"threads">;
  outboxId?: Id<"outbox">;
  toolRunId?: string;
  path: FeedbackPath;
  signalType: string;
  score: number;
  metadata?: Doc<"aiFeedbackSignals">["metadata"];
}) {
  const id = await args.ctx.db.insert("aiFeedbackSignals", {
    threadId: args.threadId,
    outboxId: args.outboxId,
    toolRunId: args.toolRunId,
    path: args.path,
    signalType: args.signalType,
    score: args.score,
    metadata: args.metadata,
    createdAt: Date.now(),
  });

  if (args.outboxId) {
    await args.ctx.scheduler
      .runAfter(0, internal.aiFeedback.rollupOutcomeForOutbox, {
        outboxId: args.outboxId,
      })
      .catch(() => undefined);
  }

  return id;
}

async function maybeInsertBaselineCandidateEval(args: {
  ctx: MutationCtx;
  outbox: Doc<"outbox">;
  summary?: OutcomeSummary;
  now?: number;
}) {
  const existing = await args.ctx.db
    .query("aiCandidateEvals")
    .withIndex("by_outboxId_and_createdAt", (q) => q.eq("outboxId", args.outbox._id))
    .order("desc")
    .first();
  if (existing) {
    return existing._id;
  }

  const now = args.now ?? Date.now();
  const qualityScore = clamp(args.summary?.qualityScore ?? 0.55, 0, 1);
  return await args.ctx.db.insert("aiCandidateEvals", {
    threadId: args.outbox.threadId,
    outboxId: args.outbox._id,
    toolRunId: args.outbox.toolRunId,
    path: args.outbox.isStatusPost ? "status" : args.outbox.outreachMode ? "outreach" : "reply",
    candidateId: `baseline:${String(args.outbox._id)}`,
    selected: true,
    guardrailBlocked: false,
    featureVector: {
      contextSupport: 0.5,
      steeringFit: 0.5,
      engagementProxy: 0.5,
      copyRiskPenalty: 0,
      selfRepeatPenalty: 0,
      freshnessSupport: 0.5,
      qualityScore,
    },
    scoreBreakdown: {
      weightedTotal: qualityScore,
      contextSupport: 0,
      steeringFit: 0,
      engagementProxy: 0,
      copyRiskPenalty: 0,
      selfRepeatPenalty: 0,
      freshnessSupport: 0,
      qualityScore,
      weightsVersion: 0,
    },
    provider: args.outbox.provider,
    model: args.outbox.provider === "heuristic" ? "historical_baseline" : `${args.outbox.provider}_historical_baseline`,
    textHash: stableTextHash(args.outbox.messageText || ""),
    createdAt: now,
  });
}

function resolveWeightedAverage(args: Array<{ value: number; weight: number }>) {
  let valueWeight = 0;
  let weightSum = 0;
  for (const item of args) {
    if (!Number.isFinite(item.value) || !Number.isFinite(item.weight) || item.weight <= 0) {
      continue;
    }
    valueWeight += item.value * item.weight;
    weightSum += item.weight;
  }
  if (weightSum <= 0) {
    return 0;
  }
  return valueWeight / weightSum;
}

function calcDecayWeight(ageDays: number) {
  return Math.exp(-Math.max(0, ageDays) / 14);
}

function computeManualSuppressionRate(rows: Array<Pick<Doc<"aiOutcomes">, "signalCounts">>) {
  if (rows.length === 0) {
    return 0;
  }
  const numerator = rows.reduce(
    (sum, row) => sum + row.signalCounts.manualRewrite + row.signalCounts.suppressedManual + row.signalCounts.suppressedStale,
    0,
  );
  const denominator = rows.reduce((sum, row) => sum + Math.max(1, row.signalCounts.totalSignals), 0);
  return denominator <= 0 ? 0 : numerator / denominator;
}

function computeGuardrailRate(rows: Array<Pick<Doc<"aiCandidateEvals">, "guardrailBlocked">>) {
  if (rows.length === 0) {
    return 0;
  }
  const blocked = rows.filter((row) => row.guardrailBlocked).length;
  return blocked / rows.length;
}

function tuneWeights(
  previous: AiTuningRetrievalWeights,
  targets: Partial<AiTuningRetrievalWeights>,
): AiTuningRetrievalWeights {
  const next = {
    overlapWeight: previous.overlapWeight,
    confidenceWeight: previous.confidenceWeight,
    freshnessWeight: previous.freshnessWeight,
    typeWeight: previous.typeWeight,
    conflictPenaltyWeight: previous.conflictPenaltyWeight,
  };

  (Object.keys(next) as Array<keyof AiTuningRetrievalWeights>).forEach((key) => {
    const target = safeNumber(targets[key], next[key]);
    const deltaBounded = clampDailyDelta(target, next[key], TUNING_DAILY_DELTA_CAP);
    next[key] = clampWeightMultiplierModerate(deltaBounded);
  });

  return next;
}

function tuneRerankWeights(
  previous: AiTuningRerankWeights,
  targets: Partial<AiTuningRerankWeights>,
): AiTuningRerankWeights {
  const next = {
    contextSupport: previous.contextSupport,
    steeringFit: previous.steeringFit,
    engagementProxy: previous.engagementProxy,
    copyRiskPenalty: previous.copyRiskPenalty,
    selfRepeatPenalty: previous.selfRepeatPenalty,
    freshnessSupport: previous.freshnessSupport,
    qualityScore: previous.qualityScore,
  };

  (Object.keys(next) as Array<keyof AiTuningRerankWeights>).forEach((key) => {
    const target = safeNumber(targets[key], next[key]);
    const deltaBounded = clampDailyDelta(target, next[key], TUNING_DAILY_DELTA_CAP);
    next[key] = clampWeightMultiplierModerate(deltaBounded);
  });

  return next;
}

async function computeTrainedProfile(
  ctx: MutationCtx,
  path: FeedbackPath,
  now: number,
  trainingWindowDays: number,
): Promise<TuningProfileSnapshot> {
  const previous = await loadLatestTuningProfile(ctx, path);

  const outcomes = await ctx.db
    .query("aiOutcomes")
    .withIndex("by_path_and_updatedAt", (q) => q.eq("path", path))
    .order("desc")
    .take(MAX_OUTCOME_ROWS);
  const candidates = await ctx.db
    .query("aiCandidateEvals")
    .withIndex("by_path_and_createdAt", (q) => q.eq("path", path))
    .order("desc")
    .take(MAX_CANDIDATE_ROWS);

  const windowStart = now - trainingWindowDays * DAY_MS;
  const filteredOutcomes = outcomes.filter((row) => row.updatedAt >= windowStart);
  const filteredCandidates = candidates.filter((row) => row.createdAt >= windowStart);

  const weightedEngagement = resolveWeightedAverage(
    filteredOutcomes.map((row) => ({
      value: row.engagementScore,
      weight: calcDecayWeight((now - row.updatedAt) / DAY_MS),
    })),
  );
  const weightedFriction = resolveWeightedAverage(
    filteredOutcomes.map((row) => ({
      value: row.frictionScore,
      weight: calcDecayWeight((now - row.updatedAt) / DAY_MS),
    })),
  );

  const guardrailRate24h = computeGuardrailRate(filteredCandidates.filter((row) => row.createdAt >= now - DAY_MS));
  const guardrailRate7d = computeGuardrailRate(filteredCandidates.filter((row) => row.createdAt >= now - 7 * DAY_MS));
  const manualRate24h = computeManualSuppressionRate(filteredOutcomes.filter((row) => row.updatedAt >= now - DAY_MS));
  const manualRate7d = computeManualSuppressionRate(filteredOutcomes.filter((row) => row.updatedAt >= now - 7 * DAY_MS));

  const guardrailWorsened = guardrailRate7d > 0 && (guardrailRate24h - guardrailRate7d) / guardrailRate7d > TUNING_FREEZE_GUARDRAIL_REGRESSION;
  const manualWorsened = manualRate7d > 0 && (manualRate24h - manualRate7d) / manualRate7d > TUNING_FREEZE_MANUAL_REGRESSION;
  const anomalyFreezeActive = guardrailWorsened || manualWorsened;

  const retrievalTarget: AiTuningRetrievalWeights = {
    overlapWeight: previous.retrievalWeights.overlapWeight + (weightedEngagement < 0.2 ? 0.06 : 0),
    confidenceWeight: previous.retrievalWeights.confidenceWeight + (weightedEngagement < 0 ? 0.04 : 0),
    freshnessWeight:
      previous.retrievalWeights.freshnessWeight + (weightedFriction > 0.8 ? 0.09 : weightedEngagement > 0.9 ? -0.04 : 0),
    typeWeight: previous.retrievalWeights.typeWeight,
    conflictPenaltyWeight: previous.retrievalWeights.conflictPenaltyWeight + (weightedFriction > 0.8 ? 0.08 : 0),
  };

  const rerankTarget: AiTuningRerankWeights = {
    contextSupport: previous.rerankWeights.contextSupport + (weightedEngagement < 0.1 ? 0.06 : 0),
    steeringFit: previous.rerankWeights.steeringFit + (weightedEngagement < 0.1 ? 0.04 : 0),
    engagementProxy: previous.rerankWeights.engagementProxy + (weightedEngagement < 0.25 ? 0.05 : -0.02),
    copyRiskPenalty: previous.rerankWeights.copyRiskPenalty + (weightedFriction > 1 ? 0.08 : 0),
    selfRepeatPenalty: previous.rerankWeights.selfRepeatPenalty + (weightedFriction > 0.85 ? 0.06 : 0),
    freshnessSupport: previous.rerankWeights.freshnessSupport + (weightedFriction > 0.7 ? 0.08 : 0),
    qualityScore: previous.rerankWeights.qualityScore,
  };

  const nextRetrieval = tuneWeights(previous.retrievalWeights, retrievalTarget);
  const nextRerank = tuneRerankWeights(previous.rerankWeights, rerankTarget);

  const targetLowConfidence = previous.thresholds.retrievalLowConfidenceThreshold + (weightedFriction > 0.8 ? -0.02 : weightedEngagement < 0 ? 0.02 : 0);
  const targetStaleDays = previous.thresholds.factStaleThresholdDays + (weightedFriction > 1 ? -1 : weightedEngagement > 0.9 ? 1 : 0);
  const targetCoverageMin = previous.thresholds.secondPassCoverageMinFacts + (weightedFriction > 0.9 ? 1 : weightedEngagement > 0.6 ? -1 : 0);

  const nextThresholds: AiTuningThresholds = {
    retrievalLowConfidenceThreshold: clampRetrievalLowConfidenceThresholdModerate(
      clampDailyDelta(targetLowConfidence, previous.thresholds.retrievalLowConfidenceThreshold, TUNING_DAILY_DELTA_CAP),
    ),
    factStaleThresholdDays: clampFactStaleThresholdDaysModerate(
      clampDailyDelta(targetStaleDays, previous.thresholds.factStaleThresholdDays, TUNING_DAILY_DELTA_CAP),
    ),
    secondPassCoverageMinFacts: Math.round(clamp(clampDailyDelta(targetCoverageMin, previous.thresholds.secondPassCoverageMinFacts, TUNING_DAILY_DELTA_CAP), 1, 4)),
  };

  const resolvedRetrieval = anomalyFreezeActive ? previous.retrievalWeights : nextRetrieval;
  const resolvedRerank = anomalyFreezeActive ? previous.rerankWeights : nextRerank;
  const resolvedThresholds = anomalyFreezeActive ? previous.thresholds : nextThresholds;

  return {
    path,
    version: previous.version + 1,
    sampleSize: filteredOutcomes.length,
    trainingWindowDays,
    retrievalWeights: resolvedRetrieval,
    rerankWeights: resolvedRerank,
    thresholds: resolvedThresholds,
    boundsProfile: "moderate",
    anomalyFreezeActive,
    anomalyReason: anomalyFreezeActive
      ? guardrailWorsened && manualWorsened
        ? "guardrail_and_manual_regression"
        : guardrailWorsened
        ? "guardrail_regression"
        : "manual_regression"
      : undefined,
    learnedAt: now,
  };
}

export const getThreadAdaptiveHintsInternal = internalQuery({
  args: {
    threadId: v.id("threads"),
    path: v.optional(aiFeedbackPathValidator),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => await loadThreadAdaptiveHints(ctx, args),
});

export const getThreadAdaptiveHints = query({
  args: {
    threadId: v.id("threads"),
    path: v.optional(aiFeedbackPathValidator),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => await loadThreadAdaptiveHints(ctx, args),
});

export const getActiveTuningProfileInternal = internalQuery({
  args: {
    path: aiFeedbackPathValidator,
  },
  handler: async (ctx, args) => await loadLatestTuningProfile(ctx, args.path),
});

export const getActiveTuningProfile = query({
  args: {
    path: aiFeedbackPathValidator,
  },
  handler: async (ctx, args) => await loadLatestTuningProfile(ctx, args.path),
});

export const recordSignal = mutation({
  args: {
    threadId: v.id("threads"),
    outboxId: v.optional(v.id("outbox")),
    toolRunId: v.optional(v.string()),
    path: aiFeedbackPathValidator,
    signalType: v.string(),
    score: v.number(),
    metadata: aiFeedbackMetadataValidator,
  },
  handler: async (ctx, args) => {
    return await insertSignalAndQueueOutcome({
      ctx,
      threadId: args.threadId,
      outboxId: args.outboxId,
      toolRunId: args.toolRunId,
      path: args.path,
      signalType: args.signalType,
      score: args.score,
      metadata: args.metadata,
    });
  },
});

export const recordCandidateEvals = mutation({
  args: {
    threadId: v.id("threads"),
    outboxId: v.optional(v.id("outbox")),
    toolRunId: v.optional(v.string()),
    path: aiFeedbackPathValidator,
    rows: v.array(
      v.object({
        candidateId: v.string(),
        selected: v.boolean(),
        guardrailBlocked: v.boolean(),
        featureVector: aiCandidateFeatureVectorValidator,
        scoreBreakdown: aiCandidateScoreBreakdownValidator,
        provider: v.union(v.literal("azure"), v.literal("codex"), v.literal("heuristic")),
        model: v.string(),
        textHash: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    let inserted = 0;

    for (const row of args.rows) {
      await ctx.db.insert("aiCandidateEvals", {
        threadId: args.threadId,
        outboxId: args.outboxId,
        toolRunId: args.toolRunId,
        path: args.path,
        candidateId: row.candidateId,
        selected: row.selected,
        guardrailBlocked: row.guardrailBlocked,
        featureVector: row.featureVector,
        scoreBreakdown: row.scoreBreakdown,
        provider: row.provider,
        model: row.model,
        textHash: row.textHash,
        createdAt: now,
      });
      inserted += 1;
    }

    return {
      inserted,
      outboxId: args.outboxId,
    };
  },
});

export const linkCandidateEvalsToOutbox = internalMutation({
  args: {
    threadId: v.id("threads"),
    outboxId: v.id("outbox"),
    toolRunId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (!args.toolRunId || !args.toolRunId.trim()) {
      return {
        linked: 0,
      };
    }

    const rows = await ctx.db
      .query("aiCandidateEvals")
      .withIndex("by_toolRunId_and_createdAt", (q) => q.eq("toolRunId", args.toolRunId))
      .order("desc")
      .take(80);

    let linked = 0;
    for (const row of rows) {
      if (row.threadId !== args.threadId || row.outboxId) {
        continue;
      }
      await ctx.db.patch(row._id, {
        outboxId: args.outboxId,
      });
      linked += 1;
    }

    return {
      linked,
    };
  },
});

export const rollupOutcomeForOutbox = internalMutation({
  args: {
    outboxId: v.id("outbox"),
  },
  handler: async (ctx, args) => {
    const result = await upsertOutcomeForOutbox(ctx, args.outboxId, Date.now());
    return {
      outboxId: args.outboxId,
      outcomeId: result.outcomeId,
      label: result.summary?.label,
    };
  },
});

export const backfillOutcomes30d = internalMutation({
  args: {
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const batchSize = Math.max(10, Math.min(Math.round(args.batchSize ?? 80), 200));
    const cutoff = now - OUTCOME_BACKFILL_WINDOW_DAYS * DAY_MS;

    const existingJob = await ctx.db
      .query("aiBackfillJobs")
      .withIndex("by_jobKey", (q) => q.eq("jobKey", BACKFILL_JOB_KEY))
      .first();

    if (existingJob?.status === "completed") {
      return {
        status: "completed",
        processed: 0,
        totalProcessed: existingJob.processedCount,
      } as const;
    }

    const page = await ctx.db
      .query("outbox")
      .withIndex("by_status_sendAt", (q) => q.eq("status", "sent").gte("sendAt", cutoff))
      .order("asc")
      .paginate({
        numItems: batchSize,
        cursor: existingJob?.cursor ?? null,
      });

    let processed = 0;
    for (const row of page.page) {
      const rolled = await upsertOutcomeForOutbox(ctx, row._id, now);
      await maybeInsertBaselineCandidateEval({
        ctx,
        outbox: row,
        summary: rolled.summary,
        now,
      });
      processed += 1;
    }

    const processedCount = (existingJob?.processedCount || 0) + processed;
    const nextCursor = page.isDone ? null : page.continueCursor;

    if (existingJob) {
      await ctx.db.patch(existingJob._id, {
        status: page.isDone ? "completed" : "running",
        cursor: nextCursor,
        processedCount,
        completedAt: page.isDone ? now : undefined,
        error: undefined,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("aiBackfillJobs", {
        jobKey: BACKFILL_JOB_KEY,
        status: page.isDone ? "completed" : "running",
        cursor: nextCursor,
        processedCount,
        completedAt: page.isDone ? now : undefined,
        createdAt: now,
        updatedAt: now,
      });
    }

    if (!page.isDone) {
      await ctx.scheduler
        .runAfter(0, internal.aiFeedback.backfillOutcomes30d, {
          batchSize,
        })
        .catch(() => undefined);
    }

    return {
      status: page.isDone ? "completed" : "running",
      processed,
      totalProcessed: processedCount,
      cursor: nextCursor,
    } as const;
  },
});

export const trainTuningProfiles = internalMutation({
  args: {
    trainingWindowDays: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const trainingWindowDays = Math.max(7, Math.min(Math.round(args.trainingWindowDays ?? TUNING_TRAINING_WINDOW_DAYS), 90));

    const updated: Array<{
      path: FeedbackPath;
      version: number;
      sampleSize: number;
      anomalyFreezeActive: boolean;
      anomalyReason?: string;
    }> = [];

    const paths: FeedbackPath[] = ["reply", "outreach", "status"];
    for (const path of paths) {
      const profile = await computeTrainedProfile(ctx, path, now, trainingWindowDays);
      await ctx.db.insert("aiTuningProfiles", {
        path: profile.path,
        version: profile.version,
        sampleSize: profile.sampleSize,
        trainingWindowDays: profile.trainingWindowDays,
        retrievalWeights: profile.retrievalWeights,
        rerankWeights: profile.rerankWeights,
        thresholds: profile.thresholds,
        boundsProfile: profile.boundsProfile,
        anomalyFreezeActive: profile.anomalyFreezeActive,
        anomalyReason: profile.anomalyReason,
        learnedAt: profile.learnedAt,
        createdAt: now,
        updatedAt: now,
      });

      updated.push({
        path,
        version: profile.version,
        sampleSize: profile.sampleSize,
        anomalyFreezeActive: profile.anomalyFreezeActive,
        anomalyReason: profile.anomalyReason,
      });
    }

    return {
      updated,
      trainingWindowDays,
    };
  },
});

export const evaluateNoReplySignal = internalMutation({
  args: {
    outboxId: v.id("outbox"),
    sentAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const outbox = await ctx.db.get(args.outboxId);
    if (!outbox || outbox.status !== "sent") {
      return {
        evaluated: false,
        reason: "outbox_not_sent",
      };
    }

    const draft = await ctx.db.get(outbox.draftId);
    const sentAt = Math.max(0, args.sentAt || outbox.updatedAt || outbox.createdAt || Date.now());
    const horizonEnd = sentAt + NEUTRAL_EVALUATION_HORIZON_MS;
    const existingSignals = await ctx.db
      .query("aiFeedbackSignals")
      .withIndex("by_outboxId_and_createdAt", (q) => q.eq("outboxId", outbox._id))
      .order("desc")
      .take(40);
    if (existingSignals.some((signal) => signal.signalType === "engaged_reply" || signal.signalType === "no_reply_horizon")) {
      return {
        evaluated: false,
        reason: "already_evaluated",
      };
    }

    const replies = await ctx.db
      .query("messages")
      .withIndex("by_thread_messageAt", (q) => q.eq("threadId", outbox.threadId).gt("messageAt", sentAt).lte("messageAt", horizonEnd))
      .order("desc")
      .take(80);
    const hasEngagedReply = replies.some(
      (message) => message.direction === "inbound" && !message.isStatus && (message.messageType || "text") !== "reaction",
    );

    if (hasEngagedReply) {
      return {
        evaluated: false,
        reason: "inbound_reply_detected",
      };
    }

    const path = resolveFeedbackPath({
      isStatusPost: outbox.isStatusPost,
      explicitOutreachMode: outbox.outreachMode || draft?.outreachMode,
      reason: draft?.reason,
    });
    const metadata = {
      sentAt,
      evaluationHorizonMs: NEUTRAL_EVALUATION_HORIZON_MS,
      engagementWindowMs: POSITIVE_ENGAGEMENT_WINDOW_MS,
      tags: ["auto_horizon_evaluation"],
    };

    await insertSignalAndQueueOutcome({
      ctx,
      threadId: outbox.threadId,
      outboxId: outbox._id,
      toolRunId: outbox.toolRunId,
      path,
      signalType: "no_reply_horizon",
      score: 0,
      metadata,
    });

    return {
      evaluated: true,
      reason: "neutral_written",
    };
  },
});
