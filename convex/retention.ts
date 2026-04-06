import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import { internalAction, internalMutation } from "./_generated/server";

const DEFAULT_RETENTION_DAYS = 60;
const BATCH_SIZE = 100;
const MAX_BATCHES_PER_RUN = 10;

export const run = internalAction({
  args: {
    olderThan: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const olderThan = args.olderThan ?? Date.now() - DEFAULT_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    let deleted = 0;
    let lastBatchCount = 0;

    for (let i = 0; i < MAX_BATCHES_PER_RUN; i += 1) {
      const result = (await ctx.runMutation(internal.retention.deleteBatch, {
        olderThan,
        limit: BATCH_SIZE,
      })) as { deleted: number };

      deleted += result.deleted;
      lastBatchCount = result.deleted;

      if (result.deleted < BATCH_SIZE) {
        break;
      }
    }

    const continuationScheduled = lastBatchCount === BATCH_SIZE;
    if (continuationScheduled) {
      await ctx.scheduler.runAfter(0, internal.retention.run, { olderThan });
    }

    if (deleted > 0) {
      await ctx.runMutation(api.system.recordEvent, {
        source: "convex",
        eventType: "retention.cleanup",
        detail: `Deleted ${deleted} messages older than ${new Date(olderThan).toISOString()}.`,
      });
    }

    return {
      deleted,
      continuationScheduled,
    };
  },
});

export const deleteBatch = internalMutation({
  args: {
    olderThan: v.number(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? BATCH_SIZE, 500);
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_createdAt", (q) => q.lt("createdAt", args.olderThan))
      .take(limit);

    for (const message of messages) {
      await ctx.db.delete(message._id);
    }

    return {
      deleted: messages.length,
    };
  },
});
