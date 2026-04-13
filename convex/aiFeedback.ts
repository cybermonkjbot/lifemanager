import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, mutation, query } from "./_generated/server";
import {
  FACT_STALE_THRESHOLD_DAYS,
  NEUTRAL_EVALUATION_HORIZON_MS,
  POSITIVE_ENGAGEMENT_WINDOW_MS,
  RETRIEVAL_LOW_CONFIDENCE_THRESHOLD,
  aiFeedbackMetadataValidator,
  aiFeedbackPathValidator,
  resolveFeedbackPath,
} from "./lib/aiSmartness";

type FeedbackSignalRow = Pick<Doc<"aiFeedbackSignals">, "signalType" | "score">;

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(value, max));
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

export const getThreadAdaptiveHints = query({
  args: {
    threadId: v.id("threads"),
    path: v.optional(aiFeedbackPathValidator),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.max(12, Math.min(Math.round(args.limit ?? 60), 180));
    const rows = await ctx.db
      .query("aiFeedbackSignals")
      .withIndex("by_threadId_and_createdAt", (q) => q.eq("threadId", args.threadId))
      .order("desc")
      .take(limit * 2);
    const filtered = args.path ? rows.filter((row) => row.path === args.path).slice(0, limit) : rows.slice(0, limit);
    const summary = summarizeAdaptiveHintsFromSignals(filtered);
    return {
      threadId: args.threadId,
      path: args.path,
      ...summary,
    };
  },
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
    return await ctx.db.insert("aiFeedbackSignals", {
      threadId: args.threadId,
      outboxId: args.outboxId,
      toolRunId: args.toolRunId,
      path: args.path,
      signalType: args.signalType,
      score: args.score,
      metadata: args.metadata,
      createdAt: Date.now(),
    });
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

    await ctx.db.insert("aiFeedbackSignals", {
      threadId: outbox.threadId,
      outboxId: outbox._id,
      toolRunId: outbox.toolRunId,
      path,
      signalType: "no_reply_horizon",
      score: 0,
      metadata,
      createdAt: Date.now(),
    });

    return {
      evaluated: true,
      reason: "neutral_written",
    };
  },
});
