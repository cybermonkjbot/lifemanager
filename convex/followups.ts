import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";

const followupStatusOrAll = v.union(
  v.literal("all"),
  v.literal("suggested"),
  v.literal("confirmed"),
  v.literal("queued"),
  v.literal("sent"),
  v.literal("failed"),
  v.literal("cancelled"),
);

const followupSort = v.union(v.literal("due_asc"), v.literal("due_desc"), v.literal("updated_desc"));

export const list = query({
  args: {
    limit: v.optional(v.number()),
    status: v.optional(followupStatusOrAll),
    sort: v.optional(followupSort),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 50, 100);
    const status = args.status || "all";
    const sort = args.sort || "due_asc";
    const base = status === "all"
      ? await ctx.db.query("followUps").withIndex("by_dueAt").order("asc").take(Math.min(limit * 3, 500))
      : await ctx.db
          .query("followUps")
          .withIndex("by_status_dueAt", (q) => q.eq("status", status as "suggested" | "confirmed" | "queued" | "sent" | "failed" | "cancelled"))
          .order("asc")
          .take(Math.min(limit * 3, 500));

    const items = [...base];
    if (sort === "due_desc") {
      items.sort((a, b) => b.dueAt - a.dueAt);
    } else if (sort === "updated_desc") {
      items.sort((a, b) => b.updatedAt - a.updatedAt);
    }

    return await Promise.all(
      items.slice(0, limit).map(async (item) => {
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

export const reschedule = mutation({
  args: {
    followUpId: v.id("followUps"),
    dueAt: v.number(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.followUpId);
    if (!row) {
      throw new Error("Follow-up not found.");
    }

    if (row.status === "sent" || row.status === "failed" || row.status === "cancelled") {
      throw new Error("Cannot reschedule a closed follow-up.");
    }

    await ctx.db.patch(row._id, {
      dueAt: Math.max(args.dueAt, Date.now()),
      updatedAt: Date.now(),
    });
    return row._id;
  },
});

export const snooze = mutation({
  args: {
    followUpId: v.id("followUps"),
    minutes: v.number(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.followUpId);
    if (!row) {
      throw new Error("Follow-up not found.");
    }

    if (row.status === "sent" || row.status === "failed" || row.status === "cancelled") {
      throw new Error("Cannot snooze a closed follow-up.");
    }

    const dueAt = Date.now() + Math.max(5, Math.round(args.minutes)) * 60 * 1000;
    await ctx.db.patch(row._id, {
      dueAt,
      updatedAt: Date.now(),
    });
    return row._id;
  },
});

export const cancel = mutation({
  args: {
    followUpId: v.id("followUps"),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.followUpId);
    if (!row) {
      return null;
    }

    if (row.status === "sent" || row.status === "failed" || row.status === "cancelled") {
      return row._id;
    }

    await ctx.db.patch(row._id, {
      status: "cancelled",
      updatedAt: Date.now(),
    });
    return row._id;
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
