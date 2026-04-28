import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, type MutationCtx } from "./_generated/server";
import { resolveTenantConnectorForMutation } from "./lib/tenantSecurity";

const providerValidator = v.union(v.literal("whatsapp"), v.literal("instagram"));
const authStateValidator = v.union(
  v.literal("connected"),
  v.literal("disconnected"),
  v.literal("expired"),
  v.literal("unknown"),
);

function cleanOptionalText(value: string | undefined) {
  const trimmed = (value || "").trim();
  return trimmed || undefined;
}

async function upsertTenantDevice(
  ctx: MutationCtx,
  args: {
    tenantId: Id<"tenantAccounts">;
    deviceId: string;
    now: number;
  },
) {
  const existing = await ctx.db
    .query("tenantDevices")
    .withIndex("by_tenantId_and_deviceId", (q) => q.eq("tenantId", args.tenantId).eq("deviceId", args.deviceId))
    .unique();

  if (existing) {
    await ctx.db.patch(existing._id, {
      lastSeenAt: args.now,
      updatedAt: args.now,
    });
    return;
  }

  await ctx.db.insert("tenantDevices", {
    tenantId: args.tenantId,
    deviceId: args.deviceId,
    label: args.deviceId,
    lastSeenAt: args.now,
    createdAt: args.now,
    updatedAt: args.now,
  });
}

export const upsertFromConnector = mutation({
  args: {
    tenantId: v.optional(v.id("tenantAccounts")),
    connectorTokenHash: v.optional(v.string()),
    deviceId: v.optional(v.string()),
    provider: providerValidator,
    providerAccountId: v.string(),
    accountLabel: v.optional(v.string()),
    displayName: v.optional(v.string()),
    phoneNumberMasked: v.optional(v.string()),
    username: v.optional(v.string()),
    authState: authStateValidator,
    lastSeenAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const connector = await resolveTenantConnectorForMutation(ctx, args);
    if (!connector) {
      return { upserted: false };
    }

    const now = Date.now();
    const providerAccountId = args.providerAccountId.trim();
    if (!providerAccountId) {
      throw new Error("Provider account id is required.");
    }

    const deviceId = connector.deviceId || cleanOptionalText(args.deviceId) || "unknown-device";
    const lastSeenAt = args.lastSeenAt ?? now;
    await upsertTenantDevice(ctx, {
      tenantId: connector.tenantId,
      deviceId,
      now: lastSeenAt,
    });

    const existing = await ctx.db
      .query("tenantConnectedAccounts")
      .withIndex("by_tenantId_and_provider_and_providerAccountId", (q) =>
        q.eq("tenantId", connector.tenantId).eq("provider", args.provider).eq("providerAccountId", providerAccountId),
      )
      .unique();
    const connectedAt =
      args.authState === "connected" ? existing?.connectedAt ?? lastSeenAt : existing?.connectedAt;
    const disconnectedAt =
      args.authState === "disconnected" || args.authState === "expired" ? lastSeenAt : undefined;
    const common = {
      tenantId: connector.tenantId,
      deviceId,
      provider: args.provider,
      providerAccountId,
      accountLabel: cleanOptionalText(args.accountLabel),
      displayName: cleanOptionalText(args.displayName),
      phoneNumberMasked: cleanOptionalText(args.phoneNumberMasked),
      username: cleanOptionalText(args.username),
      authState: args.authState,
      connectedAt,
      disconnectedAt,
      lastSeenAt,
      updatedAt: now,
    };

    if (existing) {
      await ctx.db.patch(existing._id, common);
      return { upserted: true, connectedAccountId: existing._id };
    }

    const connectedAccountId = await ctx.db.insert("tenantConnectedAccounts", {
      ...common,
      createdAt: now,
    });
    return { upserted: true, connectedAccountId };
  },
});

export const markDisconnectedFromConnector = mutation({
  args: {
    tenantId: v.optional(v.id("tenantAccounts")),
    connectorTokenHash: v.optional(v.string()),
    deviceId: v.optional(v.string()),
    provider: providerValidator,
    authState: v.optional(v.union(v.literal("disconnected"), v.literal("expired"), v.literal("unknown"))),
    lastSeenAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const connector = await resolveTenantConnectorForMutation(ctx, args);
    if (!connector) {
      return { updated: 0 };
    }

    const now = Date.now();
    const deviceId = connector.deviceId || cleanOptionalText(args.deviceId) || "unknown-device";
    const lastSeenAt = args.lastSeenAt ?? now;
    const authState = args.authState ?? "disconnected";
    const accounts = await ctx.db
      .query("tenantConnectedAccounts")
      .withIndex("by_tenantId_and_deviceId_and_provider", (q) =>
        q.eq("tenantId", connector.tenantId).eq("deviceId", deviceId).eq("provider", args.provider),
      )
      .take(10);

    for (const account of accounts) {
      await ctx.db.patch(account._id, {
        authState,
        disconnectedAt: lastSeenAt,
        lastSeenAt,
        updatedAt: now,
      });
    }

    await upsertTenantDevice(ctx, {
      tenantId: connector.tenantId,
      deviceId,
      now: lastSeenAt,
    });
    return { updated: accounts.length };
  },
});
