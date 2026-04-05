import { internal } from "./_generated/api";
import { action } from "./_generated/server";

export const run = action({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const due = await ctx.runQuery(internal.followups.list, { limit: 100 });
    const confirmed = due.filter((f) => f.status === "confirmed" && f.dueAt <= now);

    for (const followup of confirmed) {
      const draftId = await ctx.runMutation(internal.draft.saveGenerated, {
        threadId: followup.threadId,
        sourceMessageId: followup.sourceMessageId,
        text: followup.draftText,
        provider: "heuristic",
        confidence: 0.55,
        delayMs: 5_000,
        typingMs: 2_000,
        reason: `Follow-up: ${followup.reason}`,
      });

      await ctx.runMutation(internal.draft.approve, {
        draftId,
      });

      await ctx.runMutation(internal.followupsMarkQueued.run, {
        followUpId: followup._id,
      });
    }

    return {
      promoted: confirmed.length,
    };
  },
});
