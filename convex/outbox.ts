import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { DEFAULT_LEASE_MS, DEFAULT_RETRY_LIMIT } from "./lib/constants";

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
    }>;

    for (const item of due) {
      const draft = await ctx.db.get(item.draftId);
      const thread = await ctx.db.get(item.threadId);
      if (!draft || !thread) {
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
    });

    const draft = await ctx.db.get(item.draftId);
    if (draft) {
      await ctx.db.patch(draft._id, {
        status: "sent",
        updatedAt: now,
      });
    }

    await ctx.db.insert("messages", {
      threadId: item.threadId,
      direction: "outbound",
      senderJid: "me",
      whatsappMessageId: args.whatsappMessageId,
      text: item.messageText,
      messageAt: now,
      createdAt: now,
    });

    await ctx.db.insert("systemEvents", {
      source: "worker",
      eventType: "outbox.sent",
      threadId: item.threadId,
      outboxId: item._id,
      detail: item.messageText.slice(0, 240),
      createdAt: now,
    });

    return item._id;
  },
});

export const markFailed = mutation({
  args: {
    outboxId: v.id("outbox"),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.outboxId);
    if (!item) {
      return null;
    }

    const now = Date.now();
    const exhausted = item.attempts >= DEFAULT_RETRY_LIMIT;

    await ctx.db.patch(item._id, {
      status: exhausted ? "failed" : "pending",
      error: args.error,
      updatedAt: now,
      leaseExpiresAt: undefined,
      workerId: undefined,
      sendAt: exhausted ? item.sendAt : now + Math.min(item.attempts * 15_000, 120_000),
    });

    await ctx.db.insert("systemEvents", {
      source: "worker",
      eventType: exhausted ? "outbox.failed.final" : "outbox.failed.retry",
      threadId: item.threadId,
      outboxId: item._id,
      detail: args.error.slice(0, 400),
      createdAt: now,
    });

    return item._id;
  },
});
