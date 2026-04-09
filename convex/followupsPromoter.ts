import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";

const BATCH_SIZE = 20;
const MAX_BATCHES_PER_RUN = 5;

export const run = internalAction({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    let promoted = 0;
    let filtered = 0;
    let lastBatchProcessed = 0;

    for (let i = 0; i < MAX_BATCHES_PER_RUN; i += 1) {
      const result = (await ctx.runMutation(internal.followups.promoteDueConfirmed, {
        now,
        limit: BATCH_SIZE,
      })) as { promoted: number; filtered?: number; processed?: number };

      promoted += result.promoted;
      filtered += result.filtered || 0;
      lastBatchProcessed = result.processed ?? result.promoted;

      if (lastBatchProcessed < BATCH_SIZE) {
        break;
      }
    }

    const continuationScheduled = lastBatchProcessed === BATCH_SIZE;
    if (continuationScheduled) {
      await ctx.scheduler.runAfter(0, internal.followupsPromoter.run, {});
    }

    return {
      promoted,
      filtered,
      continuationScheduled,
    };
  },
});
