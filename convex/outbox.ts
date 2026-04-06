import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, mutation } from "./_generated/server";
import { DEFAULT_LEASE_MS, DEFAULT_RETRY_LIMIT } from "./lib/constants";
import { getConfig } from "./lib/config";
import {
  classifyThreadKind,
  eligibilityReasonLabel,
  resolveThreadEligibility,
} from "./lib/threadEligibility";

export const claimDue = mutation({
  args: {
    workerId: v.string(),
    limit: v.optional(v.number()),
    leaseMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const leaseMs = args.leaseMs ?? DEFAULT_LEASE_MS;
    const max = Math.min(args.limit ?? 5, 20);
    const config = await getConfig(ctx);

    const expiredClaims = await ctx.db
      .query("outbox")
      .withIndex("by_status_leaseExpiresAt", (q) => q.eq("status", "claimed").lte("leaseExpiresAt", now))
      .take(max);

    for (const item of expiredClaims) {
      await ctx.db.patch(item._id, {
        status: "pending",
        workerId: undefined,
        leaseExpiresAt: undefined,
        sendAt: Math.min(item.sendAt, now),
        updatedAt: now,
      });
    }

    const due = await ctx.db
      .query("outbox")
      .withIndex("by_status_sendAt", (q) => q.eq("status", "pending").lte("sendAt", now))
      .take(max);

    const claimed = [] as Array<{
      outboxId: string;
      threadId: string;
      draftId: string;
      messageText: string;
      typingMs: number;
      jid: string;
      idempotencyKey: string;
      provider: "azure" | "codex" | "heuristic";
      sendKind: "text" | "reaction" | "sticker" | "meme";
      reactionEmoji?: string;
      reactionTargetWhatsAppMessageId?: string;
      preReactionEmoji?: string;
      mediaAssetId?: string;
      mediaCaption?: string;
    }>;

    for (const item of due) {
      const draft = await ctx.db.get(item.draftId);
      const thread = await ctx.db.get(item.threadId);
      if (!draft || !thread) {
        continue;
      }

      const threadKind = thread.threadKind || classifyThreadKind({ jid: thread.jid, isGroupHint: thread.isGroup });
      const explicitIgnore = await ctx.db
        .query("ignoreRules")
        .withIndex("by_target", (q) =>
          q.eq("targetType", threadKind === "group" ? "group" : "contact").eq("targetValue", thread.jid),
        )
        .first();
      const eligibility = resolveThreadEligibility({
        thread: {
          jid: thread.jid,
          isIgnored: thread.isIgnored,
          isArchived: thread.isArchived,
          threadKind,
        },
        ignoreGroupsByDefault: config.ignoreGroupsByDefault,
        explicitIgnoreEnabled: Boolean(explicitIgnore?.enabled),
      });
      if (!eligibility.allowed) {
        const reason = `Blocked by eligibility: ${eligibility.reason} (${eligibilityReasonLabel(eligibility.reason)}).`;
        await ctx.db.patch(item._id, {
          status: "failed",
          workerId: undefined,
          leaseExpiresAt: undefined,
          error: reason,
          updatedAt: now,
        });
        await ctx.db.patch(draft._id, {
          status: "rejected",
          updatedAt: now,
        });
        if (item.followUpId) {
          const followUp = await ctx.db.get(item.followUpId);
          if (followUp && followUp.status === "queued") {
            await ctx.db.patch(followUp._id, {
              status: "failed",
              updatedAt: now,
            });
          }
        }
        await ctx.db.insert("systemEvents", {
          source: "worker",
          eventType: "outbox.blocked.eligibility",
          threadId: item.threadId,
          outboxId: item._id,
          detail: reason,
          createdAt: now,
        });
        continue;
      }

      await ctx.db.patch(item._id, {
        status: "claimed",
        workerId: args.workerId,
        leaseExpiresAt: now + leaseMs,
        attempts: item.attempts + 1,
        updatedAt: now,
      });

      claimed.push({
        outboxId: item._id,
        threadId: item.threadId,
        draftId: item.draftId,
        messageText: item.messageText,
        typingMs: draft.typingMs,
        jid: thread.jid,
        idempotencyKey: item.idempotencyKey,
        provider: item.provider,
        sendKind: item.sendKind || "text",
        reactionEmoji: item.reactionEmoji,
        reactionTargetWhatsAppMessageId: item.reactionTargetWhatsAppMessageId,
        preReactionEmoji: item.preReactionEmoji,
        mediaAssetId: item.mediaAssetId,
        mediaCaption: item.mediaCaption,
      });
    }

    return claimed;
  },
});

export const markTyping = mutation({
  args: {
    outboxId: v.id("outbox"),
  },
  handler: async (ctx, args) => {
    const outbox = await ctx.db.get(args.outboxId);
    if (!outbox) {
      return null;
    }

    await ctx.db.insert("systemEvents", {
      source: "worker",
      eventType: "outbox.typing",
      threadId: outbox.threadId,
      outboxId: outbox._id,
      detail: "Typing indicator emitted.",
      createdAt: Date.now(),
    });

    return outbox._id;
  },
});

export const hydrateAiOutreach = mutation({
  args: {
    outboxId: v.id("outbox"),
    text: v.string(),
    provider: v.union(v.literal("azure"), v.literal("codex"), v.literal("heuristic")),
    confidence: v.number(),
    typingMs: v.number(),
  },
  handler: async (ctx, args) => {
    const outbox = await ctx.db.get(args.outboxId);
    if (!outbox) {
      return null;
    }

    const now = Date.now();
    await ctx.db.patch(outbox._id, {
      messageText: args.text,
      provider: args.provider,
      updatedAt: now,
    });

    const draft = await ctx.db.get(outbox.draftId);
    if (draft) {
      await ctx.db.patch(draft._id, {
        text: args.text,
        provider: args.provider,
        confidence: args.confidence,
        typingMs: args.typingMs,
        updatedAt: now,
      });
    }

    await ctx.db.insert("systemEvents", {
      source: "worker",
      eventType: "outbox.aiOutreachHydrated",
      threadId: outbox.threadId,
      outboxId: outbox._id,
      detail: args.text.slice(0, 240),
      createdAt: now,
    });

    return outbox._id;
  },
});

export const markSent = mutation({
  args: {
    outboxId: v.id("outbox"),
    whatsappMessageId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.outboxId);
    if (!item) {
      return null;
    }

    if (item.status === "sent") {
      return item._id;
    }

    const now = Date.now();
    await ctx.db.patch(item._id, {
      status: "sent",
      updatedAt: now,
      leaseExpiresAt: undefined,
      workerId: undefined,
      error: undefined,
    });

    const draft = await ctx.db.get(item.draftId);
    if (draft) {
      await ctx.db.patch(draft._id, {
        status: "sent",
        updatedAt: now,
      });
    }

    if (item.followUpId) {
      const followUp = await ctx.db.get(item.followUpId);
      if (followUp && followUp.status === "queued") {
        await ctx.db.patch(followUp._id, {
          status: "sent",
          updatedAt: now,
        });
      }
    }

    await ctx.db.insert("messages", {
      threadId: item.threadId,
      direction: "outbound",
      senderJid: "me",
      whatsappMessageId: args.whatsappMessageId,
      text: item.messageText,
      messageType: item.sendKind || "text",
      reactionEmoji: item.reactionEmoji,
      reactionTargetWhatsAppMessageId: item.reactionTargetWhatsAppMessageId,
      mediaAssetId: item.mediaAssetId,
      mediaCaption: item.mediaCaption,
      messageAt: now,
      createdAt: now,
    });

    if (
      ((item.sendKind || "text") === "reaction" || (item.sendKind || "text") === "text") &&
      item.reactionTargetWhatsAppMessageId &&
      item.reactionEmoji
    ) {
      const targetMessage = await ctx.db
        .query("messages")
        .withIndex("by_thread_whatsappMessageId", (q) =>
          q.eq("threadId", item.threadId).eq("whatsappMessageId", item.reactionTargetWhatsAppMessageId),
        )
        .first();

      if (targetMessage) {
        const existingReaction = await ctx.db
          .query("messageReactions")
          .withIndex("by_messageId_and_actorJid", (q) => q.eq("messageId", targetMessage._id).eq("actorJid", "me"))
          .first();

        if (existingReaction) {
          await ctx.db.patch(existingReaction._id, {
            emoji: item.reactionEmoji,
            direction: "outbound",
            whatsappMessageId: args.whatsappMessageId,
            updatedAt: now,
          });
        } else {
          await ctx.db.insert("messageReactions", {
            threadId: item.threadId,
            messageId: targetMessage._id,
            actorJid: "me",
            direction: "outbound",
            emoji: item.reactionEmoji,
            whatsappMessageId: args.whatsappMessageId,
            createdAt: now,
            updatedAt: now,
          });
        }
      }
    }

    await ctx.db.insert("systemEvents", {
      source: "worker",
      eventType: "outbox.sent",
      threadId: item.threadId,
      outboxId: item._id,
      detail: item.messageText.slice(0, 240),
      createdAt: now,
    });

    await ctx.scheduler.runAfter(0, internal.backlog.refreshThread, {
      threadId: item.threadId,
    });

    return item._id;
  },
});

export const markFailed = mutation({
  args: {
    outboxId: v.id("outbox"),
    error: v.string(),
    forceFinal: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.outboxId);
    if (!item) {
      return null;
    }

    const now = Date.now();
    const exhausted = Boolean(args.forceFinal) || item.attempts >= DEFAULT_RETRY_LIMIT;

    await ctx.db.patch(item._id, {
      status: exhausted ? "failed" : "pending",
      error: args.error,
      updatedAt: now,
      leaseExpiresAt: undefined,
      workerId: undefined,
      sendAt: exhausted ? item.sendAt : now + Math.min(item.attempts * 15_000, 120_000),
    });

    if (item.followUpId && exhausted) {
      const followUp = await ctx.db.get(item.followUpId);
      if (followUp && followUp.status === "queued") {
        await ctx.db.patch(followUp._id, {
          status: "failed",
          updatedAt: now,
        });
      }
    }

    await ctx.db.insert("systemEvents", {
      source: "worker",
      eventType: exhausted ? "outbox.failed.final" : "outbox.failed.retry",
      threadId: item.threadId,
      outboxId: item._id,
      detail: args.error.slice(0, 400),
      createdAt: now,
    });

    await ctx.scheduler.runAfter(0, internal.backlog.refreshThread, {
      threadId: item.threadId,
    });

    return item._id;
  },
});

export const recoverExpiredClaims = internalMutation({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const limit = Math.min(args.limit ?? 100, 250);
    const expiredClaims = await ctx.db
      .query("outbox")
      .withIndex("by_status_leaseExpiresAt", (q) => q.eq("status", "claimed").lte("leaseExpiresAt", now))
      .take(limit);

    for (const item of expiredClaims) {
      await ctx.db.patch(item._id, {
        status: "pending",
        workerId: undefined,
        leaseExpiresAt: undefined,
        sendAt: Math.min(item.sendAt, now),
        updatedAt: now,
      });
    }

    if (expiredClaims.length > 0) {
      await ctx.db.insert("systemEvents", {
        source: "convex",
        eventType: "outbox.recoveredExpiredClaims",
        detail: `Recovered ${expiredClaims.length} stuck outbox items.`,
        createdAt: now,
      });
    }

    return {
      recovered: expiredClaims.length,
    };
  },
});
