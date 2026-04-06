import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";

const BATCH_SIZE = 20;
const MAX_BATCHES_PER_RUN = 5;

export const run = internalAction({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    let promoted = 0;
    let lastBatchCount = 0;

    for (let i = 0; i < MAX_BATCHES_PER_RUN; i += 1) {
      const result = (await ctx.runMutation(internal.followups.promoteDueConfirmed, {
        now,
        limit: BATCH_SIZE,
      })) as { promoted: number };

      promoted += result.promoted;
      lastBatchCount = result.promoted;

      if (result.promoted < BATCH_SIZE) {
        break;
      }
    }

    const continuationScheduled = lastBatchCount === BATCH_SIZE;
    if (continuationScheduled) {
      await ctx.scheduler.runAfter(0, internal.followupsPromoter.run, {});
    }

    return {
      promoted,
      continuationScheduled,
    };
  },
});
