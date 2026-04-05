import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action, internalMutation } from "./_generated/server";

const DEFAULT_RETENTION_DAYS = 60;

export const run = action({
  args: {},
  handler: async (ctx) => {
    const olderThan = Date.now() - DEFAULT_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const threads = await ctx.runQuery(internal.threads.list, { limit: 200 });
    let deleted = 0;

    for (const thread of threads) {
      const context = await ctx.runQuery(internal.threads.get, { threadId: thread._id });
      if (!context) {
        continue;
      }

      for (const message of context.messages) {
        if (message.createdAt < olderThan) {
          await ctx.runMutation(internal.retention.deleteMessage, { messageId: message._id });
          deleted += 1;
        }
      }
    }

    return {
      deleted,
    };
  },
});

export const deleteMessage = internalMutation({
  args: {
    messageId: v.id("messages"),
  },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.messageId);
    return true;
  },
});
