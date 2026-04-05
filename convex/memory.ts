import { v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import { action, internalMutation } from "./_generated/server";

const refThreadGet = makeFunctionReference<"query">("threads:get");
const refUpsertSummary = makeFunctionReference<"mutation">("memory:upsertSummary");

export const summarize = action({
  args: {
    threadId: v.id("threads"),
  },
  handler: async (ctx, args) => {
    const context = await ctx.runQuery(refThreadGet, {
      threadId: args.threadId,
    });

    if (!context) {
      return null;
    }

    const snippet = context.messages
      .slice(-10)
      .map((m: { direction: "inbound" | "outbound"; text: string }) => `${m.direction === "inbound" ? "Them" : "You"}: ${m.text}`)
      .join("\n");

    const summary = `Recent thread summary:\n${snippet}`.slice(0, 2000);

    await ctx.runMutation(refUpsertSummary, {
      threadId: args.threadId,
      summary,
      styleNotes: ["Conversational", "Personal tone"],
    });

    return summary;
  },
});

export const upsertSummary = internalMutation({
  args: {
    threadId: v.id("threads"),
    summary: v.string(),
    styleNotes: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("threadMemory")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        summary: args.summary,
        styleNotes: args.styleNotes,
        updatedAt: Date.now(),
      });
      return existing._id;
    }

    return await ctx.db.insert("threadMemory", {
      threadId: args.threadId,
      summary: args.summary,
      styleNotes: args.styleNotes,
      updatedAt: Date.now(),
    });
  },
});
