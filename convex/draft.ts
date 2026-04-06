import { v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import { internal } from "./_generated/api";
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
    const config = await ctx.runQuery(refGetAutonomyConfig, {});

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

    if (config.aiFallbackMode === "azure_only") {
      const reason = "Azure-only mode enabled. Scheduled non-Azure draft generation is blocked.";
      await ctx.runMutation(refCreateGuardrailHold, {
        threadId: args.threadId,
        sourceMessageId: args.sourceMessageId,
        reason,
      });
      await ctx.runMutation(refSystemRecordEvent, {
        source: "convex",
        eventType: "draft.azureOnly.blocked",
        detail: reason,
        threadId: args.threadId,
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
    sendKind: v.optional(v.union(v.literal("text"), v.literal("reaction"), v.literal("sticker"), v.literal("meme"))),
    reactionEmoji: v.optional(v.string()),
    reactionTargetMessageId: v.optional(v.id("messages")),
    mediaAssetId: v.optional(v.id("mediaAssets")),
    mediaCaption: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const draftId = await ctx.db.insert("replyDrafts", {
      ...args,
      sendKind: args.sendKind || "text",
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });

    return draftId;
  },
});

export const saveOrReplacePending = mutation({
  args: {
    threadId: v.id("threads"),
    sourceMessageId: v.id("messages"),
    text: v.string(),
    provider: v.union(v.literal("azure"), v.literal("codex"), v.literal("heuristic")),
    confidence: v.number(),
    delayMs: v.number(),
    typingMs: v.number(),
    reason: v.optional(v.string()),
    sendKind: v.optional(v.union(v.literal("text"), v.literal("reaction"), v.literal("sticker"), v.literal("meme"))),
    reactionEmoji: v.optional(v.string()),
    reactionTargetMessageId: v.optional(v.id("messages")),
    mediaAssetId: v.optional(v.id("mediaAssets")),
    mediaCaption: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const config = await getConfig(ctx);
    const sendKind = args.sendKind || "text";
    const mergeWindowMs = Math.max(2_000, Math.min(config.inboundMergeWindowMs, 180_000));
    const reactionTargetWhatsAppMessageId = args.reactionTargetMessageId
      ? (await ctx.db.get(args.reactionTargetMessageId))?.whatsappMessageId
      : undefined;

    const pendingOutbox = await ctx.db
      .query("outbox")
      .withIndex("by_thread_and_status", (q) => q.eq("threadId", args.threadId).eq("status", "pending"))
      .order("desc")
      .take(25);

    const pendingAutoReplies = pendingOutbox.filter((item) => !item.followUpId);
    const [primaryPending, ...stalePending] = pendingAutoReplies;

    for (const stale of stalePending) {
      await ctx.db.patch(stale._id, {
        status: "failed",
        error: "Superseded by a newer pending reply before send.",
        workerId: undefined,
        leaseExpiresAt: undefined,
        updatedAt: now,
      });

      const staleDraft = await ctx.db.get(stale.draftId);
      if (staleDraft && staleDraft.status === "approved") {
        await ctx.db.patch(staleDraft._id, {
          status: "rejected",
          updatedAt: now,
        });
      }
    }

    const withinMergeWindow = Boolean(
      primaryPending && now <= Math.max(primaryPending.updatedAt, primaryPending.createdAt) + mergeWindowMs,
    );

    if (primaryPending && withinMergeWindow) {
      const draft = await ctx.db.get(primaryPending.draftId);
      if (draft && draft.status !== "sent" && draft.status !== "rejected") {
        await ctx.db.patch(draft._id, {
          sourceMessageId: args.sourceMessageId,
          text: args.text,
          sendKind,
          reactionEmoji: args.reactionEmoji,
          reactionTargetMessageId: args.reactionTargetMessageId,
          mediaAssetId: args.mediaAssetId,
          mediaCaption: args.mediaCaption,
          status: "approved",
          confidence: args.confidence,
          provider: args.provider,
          delayMs: args.delayMs,
          typingMs: args.typingMs,
          reason: args.reason,
          updatedAt: now,
        });

        await ctx.db.patch(primaryPending._id, {
          draftId: draft._id,
          messageText: args.text,
          sendKind,
          reactionEmoji: args.reactionEmoji,
          reactionTargetWhatsAppMessageId,
          mediaAssetId: args.mediaAssetId,
          mediaCaption: args.mediaCaption,
          sendAt: now + args.delayMs,
          status: "pending",
          workerId: undefined,
          leaseExpiresAt: undefined,
          error: undefined,
          provider: args.provider,
          updatedAt: now,
        });

        await ctx.db.insert("systemEvents", {
          source: "dashboard",
          eventType: "draft.pendingReplaced",
          threadId: args.threadId,
          outboxId: primaryPending._id,
          detail: args.text.slice(0, 240),
          createdAt: now,
        });

        await ctx.scheduler.runAfter(0, internal.backlog.refreshThread, {
          threadId: args.threadId,
        });

        return {
          draftId: draft._id,
          outboxId: primaryPending._id,
          replaced: true,
        };
      }
    }

    if (primaryPending && !withinMergeWindow) {
      await ctx.db.insert("systemEvents", {
        source: "dashboard",
        eventType: "draft.pendingReplaceSkipped.windowExpired",
        threadId: args.threadId,
        outboxId: primaryPending._id,
        detail: `Pending reply kept because merge window expired (${mergeWindowMs}ms).`,
        createdAt: now,
      });
    }

    const draftId = await ctx.db.insert("replyDrafts", {
      ...args,
      sendKind,
      status: "approved",
      createdAt: now,
      updatedAt: now,
    });

    const outboxId = await ctx.db.insert("outbox", {
      threadId: args.threadId,
      draftId,
      messageText: args.text,
      sendKind,
      reactionEmoji: args.reactionEmoji,
      reactionTargetWhatsAppMessageId,
      mediaAssetId: args.mediaAssetId,
      mediaCaption: args.mediaCaption,
      sendAt: now + args.delayMs,
      status: "pending",
      attempts: 0,
      idempotencyKey: `${draftId}-${now}`,
      provider: args.provider,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("systemEvents", {
      source: "dashboard",
      eventType: "draft.approved",
      threadId: args.threadId,
      outboxId,
      detail: args.text.slice(0, 240),
      createdAt: now,
    });

    await ctx.scheduler.runAfter(0, internal.backlog.refreshThread, {
      threadId: args.threadId,
    });

    return {
      draftId,
      outboxId,
      replaced: false,
    };
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
      sendKind: "text",
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
    const existingOutbox = await ctx.db
      .query("outbox")
      .withIndex("by_draft", (q) => q.eq("draftId", draft._id))
      .order("desc")
      .take(20);
    const sendKind = draft.sendKind || "text";
    const reactionTargetWhatsAppMessageId = draft.reactionTargetMessageId
      ? (await ctx.db.get(draft.reactionTargetMessageId))?.whatsappMessageId
      : undefined;

    const sentOutbox = existingOutbox.find((item) => item.status === "sent");
    if (sentOutbox) {
      await ctx.db.patch(draft._id, {
        status: "sent",
        updatedAt: now,
      });
      await ctx.scheduler.runAfter(0, internal.backlog.refreshThread, {
        threadId: draft.threadId,
      });
      return sentOutbox._id;
    }

    const claimedOutbox = existingOutbox.find((item) => item.status === "claimed");
    if (claimedOutbox) {
      await ctx.db.patch(draft._id, {
        status: "approved",
        updatedAt: now,
      });
      await ctx.scheduler.runAfter(0, internal.backlog.refreshThread, {
        threadId: draft.threadId,
      });
      return claimedOutbox._id;
    }

    const pendingOutbox = existingOutbox.find((item) => item.status === "pending");
    if (pendingOutbox) {
      await ctx.db.patch(draft._id, {
        status: "approved",
        updatedAt: now,
      });

      await ctx.db.patch(pendingOutbox._id, {
        sendAt: now + draft.delayMs,
        messageText: draft.text,
        sendKind,
        reactionEmoji: draft.reactionEmoji,
        reactionTargetWhatsAppMessageId,
        mediaAssetId: draft.mediaAssetId,
        mediaCaption: draft.mediaCaption,
        status: "pending",
        workerId: undefined,
        leaseExpiresAt: undefined,
        error: undefined,
        updatedAt: now,
      });

      await ctx.scheduler.runAfter(0, internal.backlog.refreshThread, {
        threadId: draft.threadId,
      });
      return pendingOutbox._id;
    }

    await ctx.db.patch(draft._id, {
      status: "approved",
      updatedAt: now,
    });

    const outboxId = await ctx.db.insert("outbox", {
      threadId: draft.threadId,
      draftId: draft._id,
      messageText: draft.text,
      sendKind,
      reactionEmoji: draft.reactionEmoji,
      reactionTargetWhatsAppMessageId,
      mediaAssetId: draft.mediaAssetId,
      mediaCaption: draft.mediaCaption,
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

    await ctx.scheduler.runAfter(0, internal.backlog.refreshThread, {
      threadId: draft.threadId,
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

    await ctx.scheduler.runAfter(0, internal.backlog.refreshThread, {
      threadId: draft.threadId,
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

    const now = Date.now();
    await ctx.db.patch(draft._id, {
      status: "snoozed",
      updatedAt: now,
    });

    const sendAt = now + args.minutes * 60 * 1000;
    const existingOutbox = await ctx.db
      .query("outbox")
      .withIndex("by_draft", (q) => q.eq("draftId", draft._id))
      .order("desc")
      .take(20);

    const activeOutbox = existingOutbox.find((item) => item.status === "pending" || item.status === "claimed");
    if (activeOutbox) {
      await ctx.db.patch(activeOutbox._id, {
        messageText: draft.text,
        sendKind: draft.sendKind || "text",
        reactionEmoji: draft.reactionEmoji,
        reactionTargetWhatsAppMessageId: draft.reactionTargetMessageId
          ? (await ctx.db.get(draft.reactionTargetMessageId))?.whatsappMessageId
          : undefined,
        mediaAssetId: draft.mediaAssetId,
        mediaCaption: draft.mediaCaption,
        sendAt,
        status: "pending",
        workerId: undefined,
        leaseExpiresAt: undefined,
        error: undefined,
        updatedAt: now,
      });

      await ctx.scheduler.runAfter(0, internal.backlog.refreshThread, {
        threadId: draft.threadId,
      });
      return activeOutbox._id;
    }
    const outboxId = await ctx.db.insert("outbox", {
      threadId: draft.threadId,
      draftId: draft._id,
      messageText: draft.text,
      sendKind: draft.sendKind || "text",
      reactionEmoji: draft.reactionEmoji,
      reactionTargetWhatsAppMessageId: draft.reactionTargetMessageId
        ? (await ctx.db.get(draft.reactionTargetMessageId))?.whatsappMessageId
        : undefined,
      mediaAssetId: draft.mediaAssetId,
      mediaCaption: draft.mediaCaption,
      sendAt,
      status: "pending",
      attempts: 0,
      idempotencyKey: `${draft._id}-snooze-${now}`,
      provider: draft.provider,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.scheduler.runAfter(0, internal.backlog.refreshThread, {
      threadId: draft.threadId,
    });

    return outboxId;
  },
});
