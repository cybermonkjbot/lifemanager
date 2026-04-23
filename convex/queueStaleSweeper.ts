import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";

const DRAFT_BATCH_SIZE = 40;
const TODO_BATCH_SIZE = 40;
const MAX_BATCHES_PER_RUN = 4;

export const run = internalAction({
  args: {},
  handler: async (ctx) => {
    let staleDrafts = 0;
    let staleTodoCandidates = 0;
    let lastRemoved = 0;

    for (let index = 0; index < MAX_BATCHES_PER_RUN; index += 1) {
      const result = (await ctx.runMutation(internal.queue.removeStaleQueueEntries, {
        draftLimit: DRAFT_BATCH_SIZE,
        todoLimit: TODO_BATCH_SIZE,
      })) as {
        staleDrafts?: number;
        staleTodoCandidates?: number;
        removed?: number;
      };

      staleDrafts += result.staleDrafts || 0;
      staleTodoCandidates += result.staleTodoCandidates || 0;
      lastRemoved = result.removed || 0;

      if (lastRemoved === 0) {
        break;
      }
    }

    const continuationScheduled = lastRemoved > 0;
    if (continuationScheduled) {
      await ctx.scheduler.runAfter(0, internal.queueStaleSweeper.run, {});
    }

    return {
      staleDrafts,
      staleTodoCandidates,
      continuationScheduled,
    };
  },
});
