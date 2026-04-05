import { query } from "./_generated/server";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const pendingDrafts = await ctx.db
      .query("replyDrafts")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .collect();

    const followupConfirmations = await ctx.db
      .query("followUps")
      .withIndex("by_status_dueAt", (q) => q.eq("status", "suggested"))
      .collect();

    const todoCandidates = await ctx.db
      .query("todoCandidates")
      .withIndex("by_status", (q) => q.eq("status", "suggested"))
      .collect();

    const guardrailFlags = await ctx.db.query("guardrailEvents").withIndex("by_createdAt").order("desc").take(20);

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
