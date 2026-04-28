import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

const BATCH_SIZE = 20;
const MAX_BATCHES_PER_RUN = 5;

async function promoteForScope(
  ctx: ActionCtx,
  args: {
    now: number;
    tenantId?: Id<"tenantAccounts">;
  },
) {
  let promoted = 0;
  let filtered = 0;
  let lastBatchProcessed = 0;

  for (let i = 0; i < MAX_BATCHES_PER_RUN; i += 1) {
    const result = (await ctx.runMutation(internal.followups.promoteDueConfirmed, {
      tenantId: args.tenantId,
      now: args.now,
      limit: BATCH_SIZE,
    })) as { promoted: number; filtered?: number; processed?: number };

    promoted += result.promoted;
    filtered += result.filtered || 0;
    lastBatchProcessed = result.processed ?? result.promoted;

    if (lastBatchProcessed < BATCH_SIZE) {
      break;
    }
  }

  return {
    promoted,
    filtered,
    lastBatchProcessed,
  };
}

export const run = internalAction({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const scopes = (await ctx.runQuery(internal.billing.listHostedTenantBillingScopesForActions, {})) as {
      hasHostedTenants: boolean;
      activeTenantIds: Id<"tenantAccounts">[];
    };
    const results = scopes.hasHostedTenants
      ? await Promise.all(scopes.activeTenantIds.map((tenantId) => promoteForScope(ctx, { now, tenantId })))
      : [await promoteForScope(ctx, { now })];
    const promoted = results.reduce((sum, result) => sum + result.promoted, 0);
    const filtered = results.reduce((sum, result) => sum + result.filtered, 0);
    const lastBatchProcessed = results.reduce((max, result) => Math.max(max, result.lastBatchProcessed), 0);

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
