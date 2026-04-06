import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

export const summarize = internalMutation({
  args: {
    threadId: v.id("threads"),
  },
  handler: async (ctx, args) => {
    const thread = await ctx.db.get(args.threadId);
    if (!thread) {
      return null;
    }

    const recentMessages = await ctx.db
      .query("messages")
      .withIndex("by_thread_messageAt", (q) => q.eq("threadId", args.threadId))
      .order("desc")
      .take(10);

    const snippet = recentMessages
      .reverse()
      .map((message) => `${message.direction === "inbound" ? "Them" : "You"}: ${message.text}`)
      .join("\n");

    const summary = `Recent thread summary:\n${snippet}`.slice(0, 2000);
    const now = Date.now();

    const existing = await ctx.db
      .query("threadMemory")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        summary,
        styleNotes: ["Conversational", "Personal tone"],
        updatedAt: now,
      });
      return summary;
    }

    await ctx.db.insert("threadMemory", {
      threadId: args.threadId,
      summary,
      styleNotes: ["Conversational", "Personal tone"],
      updatedAt: now,
    });

    return summary;
  },
});
