import { api, internal } from "./_generated/api";
import { internalAction } from "./_generated/server";

export const run = internalAction({
  args: {},
  handler: async (ctx) => {
    const threads = await ctx.runQuery(api.threads.list, { limit: 50 });
    let summarized = 0;

    for (const thread of threads) {
      await ctx.runMutation(internal.memory.summarize, {
        threadId: thread._id,
      });
      summarized += 1;
    }

    return { summarized };
  },
});
