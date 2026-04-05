import { makeFunctionReference } from "convex/server";
import { action } from "./_generated/server";

const refFollowupsList = makeFunctionReference<"query">("followups:list");
const refSaveGenerated = makeFunctionReference<"mutation">("draft:saveGenerated");
const refApproveDraft = makeFunctionReference<"mutation">("draft:approve");
const refMarkQueued = makeFunctionReference<"mutation">("followupsMarkQueued:run");

export const run = action({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const due = await ctx.runQuery(refFollowupsList, { limit: 100 });
    const confirmed = due.filter((f: { status: string; dueAt: number }) => f.status === "confirmed" && f.dueAt <= now);

    for (const followup of confirmed) {
      const draftId = await ctx.runMutation(refSaveGenerated, {
        threadId: followup.threadId,
        sourceMessageId: followup.sourceMessageId,
        text: followup.draftText,
        provider: "heuristic",
        confidence: 0.55,
        delayMs: 5_000,
        typingMs: 2_000,
        reason: `Follow-up: ${followup.reason}`,
      });

      await ctx.runMutation(refApproveDraft, {
        draftId,
      });

      await ctx.runMutation(refMarkQueued, {
        followUpId: followup._id,
      });
    }

    return {
      promoted: confirmed.length,
    };
  },
});
