import { v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import { action, internalAction, internalQuery, mutation } from "./_generated/server";
import { getConfig } from "./lib/config";
import { estimateHumanTiming, evaluateGuardrail, looksLikeQuestion } from "./lib/heuristics";

const refGetGenerationContext = makeFunctionReference<"query">("threads:getGenerationContext");
const refSystemRecordEvent = makeFunctionReference<"mutation">("system:recordEvent");
const refCreateGuardrailHold = makeFunctionReference<"mutation">("draft:createGuardrailHold");
const refSaveGenerated = makeFunctionReference<"mutation">("draft:saveGenerated");
const refGetAutonomyConfig = makeFunctionReference<"query">("draft:getAutonomyConfig");
const refApproveDraft = makeFunctionReference<"mutation">("draft:approve");
const refGenerateDraft = makeFunctionReference<"action">("draft:generate");

function heuristicReply(input: string) {
  if (looksLikeQuestion(input)) {
    return "Yeah that works on my side. Give me a bit and I'll send the details.";
  }
  return "Noted. I’m on it and I’ll circle back shortly.";
}

export const generate = internalAction({
  args: {
    threadId: v.id("threads"),
    sourceMessageId: v.id("messages"),
  },
  handler: async (ctx, args) => {
    const context = await ctx.runQuery(refGetGenerationContext, {
      threadId: args.threadId,
      sourceMessageId: args.sourceMessageId,
    });

    if (!context) {
      return null;
    }

    const sourceText = context.sourceMessage.text;
    const guardrail = evaluateGuardrail(sourceText);

    if (guardrail.severity !== "low") {
      await ctx.runMutation(refSystemRecordEvent, {
        source: "convex",
        eventType: "guardrail.detected",
        detail: guardrail.reason,
        threadId: args.threadId,
      });
    }

    if (guardrail.blocked) {
      await ctx.runMutation(refCreateGuardrailHold, {
        threadId: args.threadId,
        sourceMessageId: args.sourceMessageId,
        reason: guardrail.reason,
      });
      return {
        blocked: true,
      };
    }

    const text = heuristicReply(sourceText);
    const timing = estimateHumanTiming(text);

    const draftId = await ctx.runMutation(refSaveGenerated, {
      threadId: args.threadId,
      sourceMessageId: args.sourceMessageId,
      text,
      provider: "heuristic",
      confidence: 0.62,
      delayMs: timing.delayMs,
      typingMs: timing.typingMs,
      reason: "Heuristic fallback draft",
    });

    const config = await ctx.runQuery(refGetAutonomyConfig, {});

    if (!config.autonomyPaused && guardrail.severity !== "high") {
      await ctx.runMutation(refApproveDraft, { draftId });
    }

    return {
      blocked: false,
      draftId,
    };
  },
});

export const generateManual = action({
  args: {
    threadId: v.id("threads"),
    sourceMessageId: v.id("messages"),
  },
  handler: async (ctx, args) => {
    return await ctx.runAction(refGenerateDraft, args);
  },
});

export const getAutonomyConfig = internalQuery({
  args: {},
  handler: async (ctx) => {
    const config = await getConfig(ctx);
    return config;
  },
});

export const saveGenerated = mutation({
  args: {
    threadId: v.id("threads"),
    sourceMessageId: v.id("messages"),
    text: v.string(),
    provider: v.union(v.literal("azure"), v.literal("codex"), v.literal("heuristic")),
    confidence: v.number(),
    delayMs: v.number(),
    typingMs: v.number(),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const draftId = await ctx.db.insert("replyDrafts", {
      ...args,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });

    return draftId;
  },
});

export const createGuardrailHold = mutation({
  args: {
    threadId: v.id("threads"),
    sourceMessageId: v.id("messages"),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const draftId = await ctx.db.insert("replyDrafts", {
      threadId: args.threadId,
      sourceMessageId: args.sourceMessageId,
      text: "Manual review required before sending.",
      status: "pending",
      confidence: 0,
      provider: "heuristic",
      delayMs: 0,
      typingMs: 0,
      reason: args.reason,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("guardrailEvents", {
      threadId: args.threadId,
      draftId,
      severity: "high",
      reason: args.reason,
      blocked: true,
      createdAt: now,
    });

    return draftId;
  },
});

export const approve = mutation({
  args: {
    draftId: v.id("replyDrafts"),
  },
  handler: async (ctx, args) => {
    const draft = await ctx.db.get(args.draftId);
    if (!draft) {
      throw new Error("Draft not found");
    }

    const now = Date.now();
    await ctx.db.patch(draft._id, {
      status: "approved",
      updatedAt: now,
    });

    const outboxId = await ctx.db.insert("outbox", {
      threadId: draft.threadId,
      draftId: draft._id,
      messageText: draft.text,
      sendAt: now + draft.delayMs,
      status: "pending",
      attempts: 0,
      idempotencyKey: `${draft._id}-${now}`,
      provider: draft.provider,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("systemEvents", {
      source: "dashboard",
      eventType: "draft.approved",
      threadId: draft.threadId,
      outboxId,
      detail: draft.text.slice(0, 240),
      createdAt: now,
    });

    return outboxId;
  },
});

export const reject = mutation({
  args: {
    draftId: v.id("replyDrafts"),
  },
  handler: async (ctx, args) => {
    const draft = await ctx.db.get(args.draftId);
    if (!draft) {
      return null;
    }

    await ctx.db.patch(draft._id, {
      status: "rejected",
      updatedAt: Date.now(),
    });

    return draft._id;
  },
});

export const snooze = mutation({
  args: {
    draftId: v.id("replyDrafts"),
    minutes: v.number(),
  },
  handler: async (ctx, args) => {
    const draft = await ctx.db.get(args.draftId);
    if (!draft) {
      return null;
    }

    await ctx.db.patch(draft._id, {
      status: "snoozed",
      updatedAt: Date.now(),
    });

    const now = Date.now();
    return await ctx.db.insert("outbox", {
      threadId: draft.threadId,
      draftId: draft._id,
      messageText: draft.text,
      sendAt: now + args.minutes * 60 * 1000,
      status: "pending",
      attempts: 0,
      idempotencyKey: `${draft._id}-snooze-${now}`,
      provider: draft.provider,
      createdAt: now,
      updatedAt: now,
    });
  },
});
