import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";

export const list = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 50, 100);
    const items = await ctx.db
      .query("followUps")
      .withIndex("by_dueAt")
      .order("asc")
      .take(limit);

    return await Promise.all(
      items.map(async (item) => {
        const thread = await ctx.db.get(item.threadId);
        return {
          ...item,
          thread,
        };
      }),
    );
  },
});

export const confirm = mutation({
  args: {
    followUpId: v.id("followUps"),
  },
  handler: async (ctx, args) => {
    const followUp = await ctx.db.get(args.followUpId);
    if (!followUp) {
      throw new Error("Follow-up not found");
    }

    if (followUp.status !== "suggested") {
      return followUp._id;
    }

    await ctx.db.patch(followUp._id, {
      status: "confirmed",
      updatedAt: Date.now(),
    });

    return followUp._id;
  },
});

export const promoteDueConfirmed = internalMutation({
  args: {
    now: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    const limit = Math.min(args.limit ?? 20, 50);

    const dueConfirmed = await ctx.db
      .query("followUps")
      .withIndex("by_status_dueAt", (q) => q.eq("status", "confirmed").lte("dueAt", now))
      .order("asc")
      .take(limit);

    for (const followUp of dueConfirmed) {
      const draftId = await ctx.db.insert("replyDrafts", {
        threadId: followUp.threadId,
        sourceMessageId: followUp.sourceMessageId,
        text: followUp.draftText,
        status: "approved",
        confidence: 0.55,
        provider: "heuristic",
        delayMs: 5_000,
        typingMs: 2_000,
        reason: `Follow-up: ${followUp.reason}`,
        createdAt: now,
        updatedAt: now,
      });

      const outboxId = await ctx.db.insert("outbox", {
        threadId: followUp.threadId,
        draftId,
        followUpId: followUp._id,
        messageText: followUp.draftText,
        sendAt: now + 5_000,
        status: "pending",
        attempts: 0,
        idempotencyKey: `${followUp._id}-${now}`,
        provider: "heuristic",
        createdAt: now,
        updatedAt: now,
      });

      await ctx.db.patch(followUp._id, {
        status: "queued",
        updatedAt: now,
      });

      await ctx.db.insert("systemEvents", {
        source: "convex",
        eventType: "followup.promoted",
        threadId: followUp.threadId,
        outboxId,
        detail: followUp.reason.slice(0, 240),
        createdAt: now,
      });
    }

    return {
      promoted: dueConfirmed.length,
    };
  },
});
