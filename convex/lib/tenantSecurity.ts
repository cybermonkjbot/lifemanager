import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { UserIdentity } from "convex/server";
import {
  assertTenantConnectorEnabled,
  isTenantBillingActive,
  tenantBillingInactiveReason,
  type ConnectorProvider,
} from "./billingAccess";

export type TenantScopedArgs = {
  tenantId?: Id<"tenantAccounts">;
  connectorTokenHash?: string;
  provider?: string;
  messageProvider?: string;
};

export type VerifiedTenantConnector = {
  tenantId: Id<"tenantAccounts">;
  deviceId: string;
  token: Doc<"tenantConnectorTokens">;
};

type AuthenticatedTenantIdentity = {
  tenantId?: Id<"tenantAccounts">;
  isSuperAdmin: boolean;
};

function requireConvexAuthForTenantArgs() {
  return process.env.ODOGWU_REQUIRE_CONVEX_AUTH === "1";
}

function parseAuthenticatedTenantIdentity(identity: UserIdentity | null): AuthenticatedTenantIdentity | null {
  if (!identity) {
    return null;
  }
  const tenantId = typeof identity.tenantId === "string" && identity.tenantId ? identity.tenantId as Id<"tenantAccounts"> : undefined;
  return {
    tenantId,
    isSuperAdmin: identity.isSuperAdmin === true,
  };
}

async function resolveTenantFromAuthenticatedIdentity(
  ctx: QueryCtx | MutationCtx,
  args: TenantScopedArgs,
): Promise<Id<"tenantAccounts"> | undefined> {
  const authIdentity = parseAuthenticatedTenantIdentity(await ctx.auth.getUserIdentity());
  if (!authIdentity) {
    if (args.tenantId && requireConvexAuthForTenantArgs()) {
      throw new Error("Not authenticated.");
    }
    return args.tenantId;
  }
  if (authIdentity.isSuperAdmin) {
    return args.tenantId || authIdentity.tenantId;
  }
  if (!authIdentity.tenantId) {
    throw new Error("Tenant access denied.");
  }
  if (args.tenantId && args.tenantId !== authIdentity.tenantId) {
    throw new Error("Tenant access denied.");
  }
  return authIdentity.tenantId;
}

export function asConnectorProvider(value: string | undefined): ConnectorProvider | undefined {
  if (value === "whatsapp" || value === "instagram" || value === "imessage" || value === "telegram") {
    return value;
  }
  return undefined;
}

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
  await assertTenantConnectorEnabled(ctx, tenant, asConnectorProvider(args.provider) || asConnectorProvider(args.messageProvider));

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
  if (connector) {
    return connector.tenantId;
  }
  return await resolveTenantFromAuthenticatedIdentity(ctx, args);
}

export async function resolveTenantForQuery(
  ctx: QueryCtx,
  args: TenantScopedArgs,
): Promise<Id<"tenantAccounts"> | undefined> {
  if (!args.connectorTokenHash) {
    return await resolveTenantFromAuthenticatedIdentity(ctx, args);
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
  await assertTenantConnectorEnabled(ctx, tenant, asConnectorProvider(args.provider) || asConnectorProvider(args.messageProvider));
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
