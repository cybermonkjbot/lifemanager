import { internal } from "./_generated/api";
import { action } from "./_generated/server";

export const run = action({
  args: {},
  handler: async (ctx) => {
    const threads = await ctx.runQuery(internal.threads.list, { limit: 50 });
    let summarized = 0;

    for (const thread of threads) {
      await ctx.runAction(internal.memory.summarize, {
        threadId: thread._id,
      });
      summarized += 1;
    }

    return { summarized };
  },
});
