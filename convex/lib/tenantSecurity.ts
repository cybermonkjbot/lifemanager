import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { isTenantBillingActive, tenantBillingInactiveReason } from "./billingAccess";

export type TenantScopedArgs = {
  tenantId?: Id<"tenantAccounts">;
  connectorTokenHash?: string;
};

export type VerifiedTenantConnector = {
  tenantId: Id<"tenantAccounts">;
  deviceId: string;
  token: Doc<"tenantConnectorTokens">;
};

export async function resolveTenantConnectorForMutation(
  ctx: MutationCtx,
  args: TenantScopedArgs,
): Promise<VerifiedTenantConnector | undefined> {
  if (!args.connectorTokenHash) {
    if (args.tenantId) {
      throw new Error("Connector token is required for tenant-scoped writes.");
    }
    return undefined;
  }

  const now = Date.now();
  const token = await ctx.db
    .query("tenantConnectorTokens")
    .withIndex("by_tokenHash", (q) => q.eq("tokenHash", args.connectorTokenHash || ""))
    .unique();
  if (!token || token.status !== "active" || (token.expiresAt && token.expiresAt <= now)) {
    throw new Error("Invalid connector token.");
  }
  if (args.tenantId && args.tenantId !== token.tenantId) {
    throw new Error("Connector token does not belong to this tenant.");
  }

  const tenant = await ctx.db.get(token.tenantId);
  if (!tenant || !isTenantBillingActive(tenant, now)) {
    throw new Error(tenant ? tenantBillingInactiveReason(tenant, now) : "Tenant subscription is not active.");
  }

  await ctx.db.patch(token._id, {
    lastUsedAt: now,
    updatedAt: now,
  });
  return {
    tenantId: token.tenantId,
    deviceId: token.deviceId,
    token,
  };
}

export async function resolveTenantForMutation(
  ctx: MutationCtx,
  args: TenantScopedArgs,
): Promise<Id<"tenantAccounts"> | undefined> {
  const connector = await resolveTenantConnectorForMutation(ctx, args);
  return connector?.tenantId;
}

export async function resolveTenantForQuery(
  ctx: QueryCtx,
  args: TenantScopedArgs,
): Promise<Id<"tenantAccounts"> | undefined> {
  if (!args.connectorTokenHash) {
    return args.tenantId;
  }

  const now = Date.now();
  const token = await ctx.db
    .query("tenantConnectorTokens")
    .withIndex("by_tokenHash", (q) => q.eq("tokenHash", args.connectorTokenHash || ""))
    .unique();
  if (!token || token.status !== "active" || (token.expiresAt && token.expiresAt <= now)) {
    throw new Error("Invalid connector token.");
  }
  if (args.tenantId && args.tenantId !== token.tenantId) {
    throw new Error("Connector token does not belong to this tenant.");
  }

  const tenant = await ctx.db.get(token.tenantId);
  if (!tenant || !isTenantBillingActive(tenant, now)) {
    throw new Error(tenant ? tenantBillingInactiveReason(tenant, now) : "Tenant subscription is not active.");
  }
  return token.tenantId;
}

export function assertTenantOwned(
  authorizedTenantId: Id<"tenantAccounts"> | undefined,
  documentTenantId: Id<"tenantAccounts"> | undefined,
) {
  if (!authorizedTenantId) {
    return;
  }
  if (documentTenantId !== authorizedTenantId) {
    throw new Error("Tenant access denied.");
  }
}
