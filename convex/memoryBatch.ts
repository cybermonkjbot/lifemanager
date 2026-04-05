import { makeFunctionReference } from "convex/server";
import { action } from "./_generated/server";

const refThreadsList = makeFunctionReference<"query">("threads:list");
const refMemorySummarize = makeFunctionReference<"action">("memory:summarize");

export const run = action({
  args: {},
  handler: async (ctx) => {
    const threads = await ctx.runQuery(refThreadsList, { limit: 50 });
    let summarized = 0;

    for (const thread of threads) {
      await ctx.runAction(refMemorySummarize, {
        threadId: thread._id,
      });
      summarized += 1;
    }

    return { summarized };
  },
});
