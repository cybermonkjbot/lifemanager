import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

const DRAFT_BATCH_SIZE = 40;
const TODO_BATCH_SIZE = 40;
const GUARDRAIL_BATCH_SIZE = 80;
const MAX_BATCHES_PER_RUN = 4;

async function sweepScope(ctx: ActionCtx, tenantId?: Id<"tenantAccounts">) {
  let staleDrafts = 0;
  let staleTodoCandidates = 0;
  let lastRemoved = 0;

  for (let index = 0; index < MAX_BATCHES_PER_RUN; index += 1) {
    const result = (await ctx.runMutation(internal.queue.removeStaleQueueEntries, {
      tenantId,
      draftLimit: DRAFT_BATCH_SIZE,
      todoLimit: TODO_BATCH_SIZE,
      guardrailLimit: GUARDRAIL_BATCH_SIZE,
    })) as {
      staleDrafts?: number;
      cleanedUnsentDrafts?: number;
      staleTodoCandidates?: number;
      resolvedGuardrailEvents?: number;
      removed?: number;
    };

    staleDrafts += result.staleDrafts || 0;
    staleTodoCandidates += result.staleTodoCandidates || 0;
    lastRemoved = result.removed || 0;

    if (lastRemoved === 0) {
      break;
    }
  }

  return {
    staleDrafts,
    staleTodoCandidates,
    lastRemoved,
  };
}

export const run = internalAction({
  args: {},
  handler: async (ctx) => {
    const scopes = (await ctx.runQuery(internal.billing.listHostedTenantBillingScopesForActions, {})) as {
      hasHostedTenants: boolean;
      activeTenantIds: Id<"tenantAccounts">[];
    };
    const results = scopes.hasHostedTenants
      ? await Promise.all(scopes.activeTenantIds.map((tenantId) => sweepScope(ctx, tenantId)))
      : [await sweepScope(ctx)];
    const staleDrafts = results.reduce((sum, result) => sum + result.staleDrafts, 0);
    const staleTodoCandidates = results.reduce((sum, result) => sum + result.staleTodoCandidates, 0);
    const lastRemoved = results.reduce((max, result) => Math.max(max, result.lastRemoved), 0);

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
