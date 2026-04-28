import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction } from "./_generated/server";

export const run = internalAction({
  args: {},
  handler: async (ctx) => {
    const scopes = (await ctx.runQuery(internal.billing.listHostedTenantBillingScopesForActions, {})) as {
      hasHostedTenants: boolean;
      activeTenantIds: Id<"tenantAccounts">[];
    };
    const threadBatches = scopes.hasHostedTenants
      ? await Promise.all(
          scopes.activeTenantIds.map((tenantId) =>
            ctx.runQuery(api.threads.list, {
              tenantId,
              limit: 50,
            }),
          ),
        )
      : [await ctx.runQuery(api.threads.list, { limit: 50 })];
    const threads = threadBatches.flat();
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
