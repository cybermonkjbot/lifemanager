import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, mutation, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";

const followupStatusOrAll = v.union(
  v.literal("all"),
  v.literal("suggested"),
  v.literal("confirmed"),
  v.literal("queued"),
  v.literal("sent"),
  v.literal("failed"),
  v.literal("cancelled"),
);

const FOLLOWUP_PROMOTION_MIN_CONFIDENCE = 0.78;
const FOLLOWUP_PROMOTION_STALE_WINDOW_MS = 21 * 24 * 60 * 60 * 1000;

const followupSort = v.union(v.literal("due_asc"), v.literal("due_desc"), v.literal("updated_desc"));
const followupTimelineFilter = v.union(
  v.literal("all"),
  v.literal("needs_review"),
  v.literal("confirmed"),
  v.literal("queued_sent"),
  v.literal("failed"),
  v.literal("dismissed"),
);

function startOfDay(ms: number) {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function statusMatchesTimelineFilter(
  status: "suggested" | "confirmed" | "queued" | "sent" | "failed" | "cancelled",
  filter: "all" | "needs_review" | "confirmed" | "queued_sent" | "failed" | "dismissed",
) {
  if (filter === "all") {
    return true;
  }
  if (filter === "needs_review") {
    return status === "suggested";
  }
  if (filter === "confirmed") {
    return status === "confirmed";
  }
  if (filter === "queued_sent") {
    return status === "queued" || status === "sent";
  }
  if (filter === "failed") {
    return status === "failed";
  }
  return status === "cancelled";
}

type PromotionEligibility = {
  allow: boolean;
  reasonCode?: string;
  detail?: string;
};

export function evaluateFollowupPromotionEligibility(args: {
  followUp: Pick<Doc<"followUps">, "kind" | "direction" | "confidence" | "dueAt" | "reason">;
  thread: Pick<Doc<"threads">, "isArchived" | "isIgnored" | "threadKind"> | null;
  now: number;
}): PromotionEligibility {
  if (!args.thread) {
    return {
      allow: false,
      reasonCode: "missing_thread",
      detail: "Thread not found for follow-up.",
    };
  }

  if (args.thread.isArchived) {
    return {
      allow: false,
      reasonCode: "archived_thread",
      detail: "Thread is archived.",
    };
  }

  if (args.thread.isIgnored) {
    return {
      allow: false,
      reasonCode: "ignored_thread",
      detail: "Thread is ignored.",
    };
  }

  if (args.thread.threadKind === "group" || args.thread.threadKind === "broadcast_or_system") {
    return {
      allow: false,
      reasonCode: "non_direct_thread",
      detail: `Thread kind is ${args.thread.threadKind}.`,
    };
  }

  if (args.followUp.kind === "request" && args.followUp.direction === "inbound") {
    return {
      allow: false,
      reasonCode: "inbound_request_kind",
      detail: "Inbound request follow-ups are filtered from auto-promotion.",
    };
  }

  const confidence = Number(args.followUp.confidence ?? 0);
  if (Number.isFinite(confidence) && confidence > 0 && confidence < FOLLOWUP_PROMOTION_MIN_CONFIDENCE) {
    return {
      allow: false,
      reasonCode: "low_confidence",
      detail: `Confidence ${confidence.toFixed(2)} is below ${FOLLOWUP_PROMOTION_MIN_CONFIDENCE.toFixed(2)}.`,
    };
  }

  const overdueAgeMs = Math.max(0, args.now - args.followUp.dueAt);
  if (overdueAgeMs > FOLLOWUP_PROMOTION_STALE_WINDOW_MS) {
    return {
      allow: false,
      reasonCode: "stale_due",
      detail: `Follow-up is stale by ${Math.round(overdueAgeMs / (24 * 60 * 60 * 1000))} days.`,
    };
  }

  return { allow: true };
}

async function enrichFollowups(
  ctx: QueryCtx,
  items: Doc<"followUps">[],
) {
  return await Promise.all(
    items.map(async (item) => {
      const [thread, sourceMessage] = await Promise.all([
        ctx.db.get(item.threadId),
        ctx.db.get(item.sourceMessageId),
      ]);
      return {
        ...item,
        thread,
        sourceMessage: sourceMessage
          ? {
              _id: sourceMessage._id,
              text: sourceMessage.text,
              messageAt: sourceMessage.messageAt,
              direction: sourceMessage.direction,
            }
          : null,
      };
    }),
  );
}

export const list = query({
  args: {
    provider: v.optional(v.union(v.literal("whatsapp"), v.literal("instagram"), v.literal("all"))),
    limit: v.optional(v.number()),
    status: v.optional(followupStatusOrAll),
    sort: v.optional(followupSort),
  },
  handler: async (ctx, args) => {
    const provider = args.provider || "all";
    const limit = Math.min(args.limit ?? 50, 100);
    const status = args.status || "all";
    const sort = args.sort || "due_asc";
    const base =
      status === "all"
        ? await ctx.db.query("followUps").withIndex("by_dueAt").order("asc").take(Math.min(limit * 3, 500))
        : await ctx.db
            .query("followUps")
            .withIndex("by_status_dueAt", (q) =>
              q.eq("status", status as "suggested" | "confirmed" | "queued" | "sent" | "failed" | "cancelled"),
            )
            .order("asc")
            .take(Math.min(limit * 3, 500));

    const items = [...base];
    if (sort === "due_desc") {
      items.sort((a, b) => b.dueAt - a.dueAt);
    } else if (sort === "updated_desc") {
      items.sort((a, b) => b.updatedAt - a.updatedAt);
    }

    const enriched = await enrichFollowups(ctx, items.slice(0, limit));
    return provider === "all"
      ? enriched
      : enriched.filter((item) => (item.thread?.provider || "whatsapp") === provider);
  },
});

export const timeline = query({
  args: {
    provider: v.optional(v.union(v.literal("whatsapp"), v.literal("instagram"), v.literal("all"))),
    limit: v.optional(v.number()),
    filter: v.optional(followupTimelineFilter),
  },
  handler: async (ctx, args) => {
    const provider = args.provider || "all";
    const now = Date.now();
    const todayStart = startOfDay(now);
    const tomorrowStart = todayStart + 24 * 60 * 60 * 1000;
    const limit = Math.min(args.limit ?? 160, 300);
    const filter = args.filter || "all";

    const base = await ctx.db
      .query("followUps")
      .withIndex("by_dueAt")
      .order("asc")
      .take(Math.min(limit * 5, 900));

    const filtered = base.filter((item) => statusMatchesTimelineFilter(item.status, filter)).slice(0, limit);
    const enriched = (await enrichFollowups(ctx, filtered)).filter((item) =>
      provider === "all" ? true : (item.thread?.provider || "whatsapp") === provider,
    );

    const overdue: typeof enriched = [];
    const today: typeof enriched = [];
    const upcoming: typeof enriched = [];

    for (const item of enriched) {
      if (item.dueAt < now) {
        overdue.push(item);
      } else if (item.dueAt >= todayStart && item.dueAt < tomorrowStart) {
        today.push(item);
      } else {
        upcoming.push(item);
      }
    }

    return {
      now,
      filter,
      totals: {
        all: base.length,
        visible: enriched.length,
        overdue: overdue.length,
        today: today.length,
        upcoming: upcoming.length,
      },
      sections: {
        overdue,
        today,
        upcoming,
      },
    };
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

    const now = Date.now();
    await ctx.db.patch(followUp._id, {
      status: "confirmed",
      updatedAt: now,
    });
    await ctx.db.insert("systemEvents", {
      source: "dashboard",
      eventType: "followup.confirmed",
      threadId: followUp.threadId,
      detail: followUp.reason.slice(0, 240),
      createdAt: now,
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

    const now = Date.now();
    await ctx.db.patch(row._id, {
      status: "cancelled",
      updatedAt: now,
    });
    await ctx.db.insert("systemEvents", {
      source: "dashboard",
      eventType: "followup.dismissed",
      threadId: row.threadId,
      detail: row.reason.slice(0, 240),
      createdAt: now,
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

    let promoted = 0;
    let filtered = 0;

    for (const followUp of dueConfirmed) {
      const thread = await ctx.db.get(followUp.threadId);
      const eligibility = evaluateFollowupPromotionEligibility({
        followUp,
        thread,
        now,
      });
      if (!eligibility.allow) {
        filtered += 1;
        await ctx.db.patch(followUp._id, {
          status: "cancelled",
          updatedAt: now,
        });
        await ctx.db.insert("systemEvents", {
          source: "convex",
          eventType: "followup.promoted.filtered",
          threadId: followUp.threadId,
          detail: `${eligibility.reasonCode || "filtered"}: ${(eligibility.detail || followUp.reason).slice(0, 200)}`,
          createdAt: now,
        });
        continue;
      }
      const messageProvider = thread?.provider || "whatsapp";
      const draftId = await ctx.db.insert("replyDrafts", {
        messageProvider,
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
        messageProvider,
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
      promoted += 1;
    }

    return {
      promoted,
      filtered,
      processed: dueConfirmed.length,
    };
  },
});
