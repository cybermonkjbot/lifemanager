import { v } from "convex/values";
import { query } from "./_generated/server";

export const list = query({
  args: {
    draftLimit: v.optional(v.number()),
    followupLimit: v.optional(v.number()),
    todoLimit: v.optional(v.number()),
    guardrailLimit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const draftLimit = Math.min(args.draftLimit ?? 40, 100);
    const followupLimit = Math.min(args.followupLimit ?? 40, 100);
    const todoLimit = Math.min(args.todoLimit ?? 40, 100);
    const guardrailLimit = Math.min(args.guardrailLimit ?? 20, 100);

    const pendingDrafts = await ctx.db
      .query("replyDrafts")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .order("desc")
      .take(draftLimit);

    const followupConfirmations = await ctx.db
      .query("followUps")
      .withIndex("by_status_dueAt", (q) => q.eq("status", "suggested"))
      .order("asc")
      .take(followupLimit);

    const todoCandidates = await ctx.db
      .query("todoCandidates")
      .withIndex("by_status", (q) => q.eq("status", "suggested"))
      .order("desc")
      .take(todoLimit);

    const guardrailFlags = await ctx.db.query("guardrailEvents").withIndex("by_createdAt").order("desc").take(guardrailLimit);

    const enrichedDrafts = await Promise.all(
      pendingDrafts.map(async (draft) => {
        const thread = await ctx.db.get(draft.threadId);
        const sourceMessage = await ctx.db.get(draft.sourceMessageId);
        return {
          ...draft,
          thread,
          sourceMessage,
        };
      }),
    );

    return {
      needsReply: enrichedDrafts,
      followupConfirmations,
      todoCandidates,
      guardrailFlags,
    };
  },
});
