import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

export type TenantBillingSnapshot = {
  serviceMode?: string;
  billingStatus: string;
  trialEndsAt: number;
  subscriptionExpiresAt?: number;
};

export function isTenantBillingActive(tenant: TenantBillingSnapshot, now = Date.now()) {
  if (tenant.serviceMode === "self_hosted") {
    return true;
  }
  if (tenant.billingStatus === "trialing") {
    return tenant.trialEndsAt >= now;
  }
  if (tenant.billingStatus === "active") {
    return typeof tenant.subscriptionExpiresAt !== "number" || tenant.subscriptionExpiresAt > now;
  }
  return false;
}

export function tenantBillingInactiveReason(tenant: TenantBillingSnapshot, now = Date.now()) {
  if (tenant.billingStatus === "trialing" && tenant.trialEndsAt < now) {
    return "Tenant trial has expired.";
  }
  if (tenant.billingStatus === "active" && typeof tenant.subscriptionExpiresAt === "number" && tenant.subscriptionExpiresAt <= now) {
    return "Tenant subscription has expired.";
  }
  return "Tenant subscription is not active.";
}

export async function assertTenantBillingActive(
  ctx: QueryCtx | MutationCtx,
  tenantId: Id<"tenantAccounts"> | undefined,
  now = Date.now(),
) {
  if (!tenantId) {
    return;
  }
  const tenant = await ctx.db.get(tenantId);
  if (!tenant || !isTenantBillingActive(tenant, now)) {
    throw new Error(tenant ? tenantBillingInactiveReason(tenant, now) : "Tenant subscription is not active.");
  }
}

export async function assertThreadTenantBillingActive(
  ctx: QueryCtx | MutationCtx,
  threadId: Id<"threads">,
  now = Date.now(),
) {
  const thread = await ctx.db.get(threadId);
  await assertTenantBillingActive(ctx, thread?.tenantId, now);
  return thread;
}

export async function listHostedTenantBillingScopes(ctx: QueryCtx | MutationCtx, now = Date.now(), limit = 200) {
  const rows = await ctx.db.query("tenantAccounts").order("desc").take(Math.min(Math.max(limit, 1), 500));
  const hosted = rows.filter((tenant) => tenant.serviceMode === "hosted");
  return {
    hasHostedTenants: hosted.length > 0,
    activeTenantIds: hosted
      .filter((tenant) => isTenantBillingActive(tenant, now))
      .map((tenant) => tenant._id),
  };
}
