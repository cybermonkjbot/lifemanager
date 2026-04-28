import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { isTenantBillingActive, tenantBillingInactiveReason } from "./lib/billingAccess";

const TRIAL_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
const FAKE_LOGIN_PIN_SALT = "00000000000000000000000000000000";

function readAdminSecret() {
  return process.env.ODOGWU_CONVEX_ADMIN_SECRET || process.env.ODOGWU_ADMIN_SECRET || process.env.SLM_ADMIN_SECRET || "";
}

function requireAdmin(adminSecret: string) {
  const expected = readAdminSecret();
  if (!expected || adminSecret !== expected) {
    throw new Error("Unauthorized.");
  }
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function requireValidEmail(email: string) {
  const normalized = normalizeEmail(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new Error("Valid email is required.");
  }
  return normalized;
}

function tenantAccessStatus(
  tenant: { billingStatus: string; trialEndsAt: number; subscriptionExpiresAt?: number },
  now = Date.now(),
) {
  return isTenantBillingActive(tenant, now) ? "active" as const : "billing_required" as const;
}

async function isTenantAccountPlatformAdmin(ctx: MutationCtx, tenantId: Id<"tenantAccounts">) {
  const tenant = await ctx.db.get(tenantId);
  if (!tenant) {
    return false;
  }

  const adminUser = await ctx.db
    .query("adminUsers")
    .withIndex("by_emailNormalized", (q) => q.eq("emailNormalized", tenant.emailNormalized))
    .unique();
  if (adminUser) {
    return true;
  }

  const configuredAdminUsers = await ctx.db.query("adminUsers").take(1);
  if (configuredAdminUsers.length > 0) {
    return false;
  }

  const tenants = await ctx.db.query("tenantAccounts").take(2);
  return tenants.length === 1 && tenants[0]?._id === tenantId;
}

export const registerFromDesktop = mutation({
  args: {
    email: v.string(),
    displayName: v.optional(v.string()),
    deviceId: v.string(),
    serviceMode: v.union(v.literal("hosted"), v.literal("self_hosted")),
    pinSalt: v.optional(v.string()),
    pinHash: v.optional(v.string()),
    pinUpdatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const emailNormalized = requireValidEmail(args.email);
    const now = Date.now();
    const existing = await ctx.db
      .query("tenantAccounts")
      .withIndex("by_emailNormalized", (q) => q.eq("emailNormalized", emailNormalized))
      .unique();
    const serviceMode = args.serviceMode;
    const plan = serviceMode === "self_hosted" ? "self_hosted" : "personal_connector";
    const billingStatus = existing?.billingStatus || "trialing";
    const trialStartedAt = existing?.trialStartedAt || now;
    const trialEndsAt = existing?.trialEndsAt || trialStartedAt + TRIAL_DAYS * DAY_MS;
    const pinPatch =
      args.pinSalt && args.pinHash
        ? {
            pinSalt: args.pinSalt,
            pinHash: args.pinHash,
            pinUpdatedAt: args.pinUpdatedAt || now,
          }
        : {};

    const tenantId =
      existing?._id ||
      (await ctx.db.insert("tenantAccounts", {
        emailNormalized,
        email: args.email.trim(),
        displayName: args.displayName?.trim() || undefined,
        serviceMode,
        plan,
        billingStatus,
        ...pinPatch,
        trialStartedAt,
        trialEndsAt,
        createdAt: now,
        updatedAt: now,
      }));

    if (existing) {
      await ctx.db.patch(existing._id, {
        email: args.email.trim(),
        displayName: args.displayName?.trim() || existing.displayName,
        serviceMode,
        plan,
        ...pinPatch,
        updatedAt: now,
      });
    }

    const existingOwner = await ctx.db
      .query("tenantUsers")
      .withIndex("by_tenantId_and_emailNormalized", (q) => q.eq("tenantId", tenantId).eq("emailNormalized", emailNormalized))
      .unique();
    let userId = existingOwner?._id;
    if (existingOwner) {
      await ctx.db.patch(existingOwner._id, {
        email: args.email.trim(),
        displayName: args.displayName?.trim() || existingOwner.displayName,
        role: "owner",
        isSuperAdmin: true,
        ...pinPatch,
        updatedAt: now,
      });
    } else {
      userId = await ctx.db.insert("tenantUsers", {
        tenantId,
        emailNormalized,
        email: args.email.trim(),
        displayName: args.displayName?.trim() || undefined,
        role: "owner",
        isSuperAdmin: true,
        ...pinPatch,
        createdAt: now,
        updatedAt: now,
      });
    }

    const deviceId = args.deviceId.trim();
    if (deviceId) {
      const existingDevice = await ctx.db
        .query("tenantDevices")
        .withIndex("by_tenantId_and_deviceId", (q) => q.eq("tenantId", tenantId).eq("deviceId", deviceId))
        .unique();
      if (existingDevice) {
        await ctx.db.patch(existingDevice._id, {
          lastSeenAt: now,
          updatedAt: now,
        });
      } else {
        await ctx.db.insert("tenantDevices", {
          tenantId,
          deviceId,
          label: "Desktop app",
          lastSeenAt: now,
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    return {
      tenantId,
      userId,
      trialStartedAt,
      trialEndsAt,
      billingStatus,
      pinConfigured: Boolean((args.pinSalt && args.pinHash) || (existing?.pinSalt && existing?.pinHash)),
    };
  },
});

export const issueConnectorToken = mutation({
  args: {
    email: v.string(),
    pinHash: v.string(),
    deviceId: v.string(),
    tokenHash: v.string(),
    tokenPreview: v.string(),
    expiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const emailNormalized = requireValidEmail(args.email);
    const tenant = await ctx.db
      .query("tenantAccounts")
      .withIndex("by_emailNormalized", (q) => q.eq("emailNormalized", emailNormalized))
      .unique();
    if (!tenant || !tenant.pinHash || tenant.pinHash !== args.pinHash) {
      throw new Error("Invalid tenant PIN.");
    }

    const now = Date.now();
    if (!isTenantBillingActive(tenant, now)) {
      throw new Error(tenantBillingInactiveReason(tenant, now));
    }

    const deviceId = args.deviceId.trim();
    if (!deviceId) {
      throw new Error("Device ID is required.");
    }

    const existingDevice = await ctx.db
      .query("tenantDevices")
      .withIndex("by_tenantId_and_deviceId", (q) => q.eq("tenantId", tenant._id).eq("deviceId", deviceId))
      .unique();
    if (existingDevice) {
      await ctx.db.patch(existingDevice._id, {
        lastSeenAt: now,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("tenantDevices", {
        tenantId: tenant._id,
        deviceId,
        label: "Desktop app",
        lastSeenAt: now,
        createdAt: now,
        updatedAt: now,
      });
    }

    const existingToken = await ctx.db
      .query("tenantConnectorTokens")
      .withIndex("by_tokenHash", (q) => q.eq("tokenHash", args.tokenHash))
      .unique();
    if (existingToken) {
      await ctx.db.patch(existingToken._id, {
        status: "active",
        expiresAt: args.expiresAt,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("tenantConnectorTokens", {
        tenantId: tenant._id,
        deviceId,
        tokenHash: args.tokenHash,
        tokenPreview: args.tokenPreview,
        status: "active",
        scopes: ["connector:heartbeat", "connector:outbox", "connector:setup"],
        expiresAt: args.expiresAt,
        createdAt: now,
        updatedAt: now,
      });
    }

    return {
      tenantId: tenant._id,
      billingStatus: tenant.billingStatus,
      trialEndsAt: tenant.trialEndsAt,
      expiresAt: args.expiresAt ?? null,
    };
  },
});

export const verifyConnectorToken = mutation({
  args: {
    tokenHash: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const token = await ctx.db
      .query("tenantConnectorTokens")
      .withIndex("by_tokenHash", (q) => q.eq("tokenHash", args.tokenHash))
      .unique();
    if (!token || token.status !== "active" || (token.expiresAt && token.expiresAt <= now)) {
      return null;
    }
    const tenant = await ctx.db.get(token.tenantId);
    if (!tenant || !isTenantBillingActive(tenant, now)) {
      return null;
    }
    await ctx.db.patch(token._id, {
      lastUsedAt: now,
      updatedAt: now,
    });
    return {
      tenantId: tenant._id,
      email: tenant.email,
      deviceId: token.deviceId,
      scopes: token.scopes,
      billingStatus: tenant.billingStatus,
      canUseSelfControl: await isTenantAccountPlatformAdmin(ctx, tenant._id),
    };
  },
});

export const getConnectorSelfControlAccess = mutation({
  args: {
    tenantId: v.id("tenantAccounts"),
    connectorTokenHash: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const token = await ctx.db
      .query("tenantConnectorTokens")
      .withIndex("by_tokenHash", (q) => q.eq("tokenHash", args.connectorTokenHash))
      .unique();
    if (!token || token.status !== "active" || (token.expiresAt && token.expiresAt <= now)) {
      return { allowed: false, reason: "invalid_connector" };
    }
    if (token.tenantId !== args.tenantId) {
      return { allowed: false, reason: "tenant_mismatch" };
    }

    const tenant = await ctx.db.get(token.tenantId);
    if (!tenant || !isTenantBillingActive(tenant, now)) {
      return { allowed: false, reason: "inactive_tenant" };
    }

    await ctx.db.patch(token._id, {
      lastUsedAt: now,
      updatedAt: now,
    });

    const allowed = await isTenantAccountPlatformAdmin(ctx, tenant._id);
    return {
      allowed,
      reason: allowed ? "admin_tenant" : "not_admin_tenant",
    };
  },
});

export const getLoginPinSalt = query({
  args: {
    email: v.string(),
  },
  handler: async (ctx, args) => {
    const emailNormalized = requireValidEmail(args.email);
    const users = await ctx.db
      .query("tenantUsers")
      .withIndex("by_emailNormalized", (q) => q.eq("emailNormalized", emailNormalized))
      .take(2);
    if (users.length === 1 && users[0].pinSalt) {
      return {
        pinSalt: users[0].pinSalt,
      };
    }
    if (users.length > 1) {
      return { pinSalt: FAKE_LOGIN_PIN_SALT };
    }
    const tenant = await ctx.db
      .query("tenantAccounts")
      .withIndex("by_emailNormalized", (q) => q.eq("emailNormalized", emailNormalized))
      .unique();
    return {
      pinSalt: tenant?.pinSalt || FAKE_LOGIN_PIN_SALT,
    };
  },
});

export const verifyTenantLogin = mutation({
  args: {
    email: v.string(),
    pinHash: v.string(),
    deviceId: v.optional(v.string()),
    expectedTenantId: v.optional(v.id("tenantAccounts")),
  },
  handler: async (ctx, args) => {
    const emailNormalized = requireValidEmail(args.email);
    const now = Date.now();
    const tenantUsers = await ctx.db
      .query("tenantUsers")
      .withIndex("by_emailNormalized", (q) => q.eq("emailNormalized", emailNormalized))
      .take(2);
    if (tenantUsers.length > 1) {
      return null;
    }

    const loginUser = tenantUsers[0];
    if (loginUser?.pinHash && loginUser.pinHash === args.pinHash) {
      const tenant = await ctx.db.get(loginUser.tenantId);
      if (!tenant) {
        return null;
      }
      if (args.expectedTenantId && tenant._id !== args.expectedTenantId) {
        return null;
      }

      const deviceId = args.deviceId?.trim();
      if (deviceId) {
        const existingDevice = await ctx.db
          .query("tenantDevices")
          .withIndex("by_tenantId_and_deviceId", (q) => q.eq("tenantId", tenant._id).eq("deviceId", deviceId))
          .unique();
        if (existingDevice) {
          await ctx.db.patch(existingDevice._id, {
            lastSeenAt: now,
            updatedAt: now,
          });
        } else {
          await ctx.db.insert("tenantDevices", {
            tenantId: tenant._id,
            deviceId,
            label: "Desktop app",
            lastSeenAt: now,
            createdAt: now,
            updatedAt: now,
          });
        }
      }

      return {
        tenantId: tenant._id,
        userId: loginUser._id,
        email: loginUser.email,
        displayName: loginUser.displayName || tenant.displayName || "",
        role: loginUser.role,
        isSuperAdmin: loginUser.isSuperAdmin,
        billingStatus: tenant.billingStatus,
        accessStatus: tenantAccessStatus(tenant, now),
        trialStartedAt: tenant.trialStartedAt,
        trialEndsAt: tenant.trialEndsAt,
      };
    }

    const tenant = await ctx.db
      .query("tenantAccounts")
      .withIndex("by_emailNormalized", (q) => q.eq("emailNormalized", emailNormalized))
      .unique();
    if (!tenant) {
      return null;
    }
    if (args.expectedTenantId && tenant._id !== args.expectedTenantId) {
      return null;
    }

    const user = await ctx.db
      .query("tenantUsers")
      .withIndex("by_tenantId_and_emailNormalized", (q) => q.eq("tenantId", tenant._id).eq("emailNormalized", emailNormalized))
      .unique();
    const expectedPinHash = user?.pinHash || tenant.pinHash;
    if (!expectedPinHash || expectedPinHash !== args.pinHash) {
      return null;
    }

    const deviceId = args.deviceId?.trim();
    if (deviceId) {
      const existingDevice = await ctx.db
        .query("tenantDevices")
        .withIndex("by_tenantId_and_deviceId", (q) => q.eq("tenantId", tenant._id).eq("deviceId", deviceId))
        .unique();
      if (existingDevice) {
        await ctx.db.patch(existingDevice._id, {
          lastSeenAt: now,
          updatedAt: now,
        });
      } else {
        await ctx.db.insert("tenantDevices", {
          tenantId: tenant._id,
          deviceId,
          label: "Desktop app",
          lastSeenAt: now,
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    return {
      tenantId: tenant._id,
      ...(user?._id ? { userId: user._id } : {}),
      email: user?.email || tenant.email,
      displayName: user?.displayName || tenant.displayName || "",
      role: user?.role || "owner",
      isSuperAdmin: user?.isSuperAdmin || false,
      billingStatus: tenant.billingStatus,
      accessStatus: tenantAccessStatus(tenant, now),
      trialStartedAt: tenant.trialStartedAt,
      trialEndsAt: tenant.trialEndsAt,
    };
  },
});

export const adminList = query({
  args: {
    adminSecret: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    requireAdmin(args.adminSecret);
    const limit = Math.min(Math.max(Math.round(args.limit || 100), 1), 200);
    const rows = await ctx.db.query("tenantAccounts").order("desc").take(limit);
    return rows.map((row) => ({
      _id: row._id,
      email: row.email,
      displayName: row.displayName,
      serviceMode: row.serviceMode,
      plan: row.plan,
      billingStatus: row.billingStatus,
      subscriptionProvider: row.subscriptionProvider,
      subscriptionExpiresAt: row.subscriptionExpiresAt,
      subscriptionPausedAt: row.subscriptionPausedAt,
      subscriptionPauseReason: row.subscriptionPauseReason,
      flutterwaveSubscriptionId: row.flutterwaveSubscriptionId,
      pinConfigured: Boolean(row.pinSalt && row.pinHash),
      pinUpdatedAt: row.pinUpdatedAt,
      trialStartedAt: row.trialStartedAt,
      trialEndsAt: row.trialEndsAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  },
});

export const adminGet = query({
  args: {
    adminSecret: v.string(),
    tenantId: v.id("tenantAccounts"),
  },
  handler: async (ctx, args) => {
    requireAdmin(args.adminSecret);
    const tenant = await ctx.db.get(args.tenantId);
    if (!tenant) {
      throw new Error("Tenant was not found.");
    }
    const users = await ctx.db
      .query("tenantUsers")
      .withIndex("by_tenantId", (q) => q.eq("tenantId", args.tenantId))
      .order("desc")
      .take(200);
    const devices = await ctx.db
      .query("tenantDevices")
      .withIndex("by_tenantId", (q) => q.eq("tenantId", args.tenantId))
      .order("desc")
      .take(50);
    const connectorTokens = await ctx.db
      .query("tenantConnectorTokens")
      .withIndex("by_tenantId", (q) => q.eq("tenantId", args.tenantId))
      .order("desc")
      .take(50);
    const connectedAccounts = await ctx.db
      .query("tenantConnectedAccounts")
      .withIndex("by_tenantId", (q) => q.eq("tenantId", args.tenantId))
      .order("desc")
      .take(50);
    const subscriptions = await ctx.db
      .query("tenantSubscriptions")
      .withIndex("by_tenantId", (q) => q.eq("tenantId", args.tenantId))
      .order("desc")
      .take(25);
    const subscriptionEvents = await ctx.db
      .query("subscriptionEvents")
      .withIndex("by_tenantId_and_createdAt", (q) => q.eq("tenantId", args.tenantId))
      .order("desc")
      .take(25);
    return {
      tenant: {
        _id: tenant._id,
        email: tenant.email,
        displayName: tenant.displayName,
        serviceMode: tenant.serviceMode,
        plan: tenant.plan,
        billingStatus: tenant.billingStatus,
        subscriptionProvider: tenant.subscriptionProvider,
        subscriptionExpiresAt: tenant.subscriptionExpiresAt,
        subscriptionPausedAt: tenant.subscriptionPausedAt,
        subscriptionPauseReason: tenant.subscriptionPauseReason,
        flutterwaveSubscriptionId: tenant.flutterwaveSubscriptionId,
        flutterwavePaymentPlanId: tenant.flutterwavePaymentPlanId,
        pinConfigured: Boolean(tenant.pinSalt && tenant.pinHash),
        pinUpdatedAt: tenant.pinUpdatedAt,
        trialStartedAt: tenant.trialStartedAt,
        trialEndsAt: tenant.trialEndsAt,
        createdAt: tenant.createdAt,
        updatedAt: tenant.updatedAt,
      },
      users: users.map((user) => ({
        _id: user._id,
        email: user.email,
        displayName: user.displayName,
        role: user.role,
        isSuperAdmin: user.isSuperAdmin,
        pinConfigured: Boolean(user.pinSalt && user.pinHash),
        pinUpdatedAt: user.pinUpdatedAt,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      })),
      devices: devices.map((device) => ({
        _id: device._id,
        deviceId: device.deviceId,
        label: device.label,
        lastSeenAt: device.lastSeenAt,
        createdAt: device.createdAt,
        updatedAt: device.updatedAt,
      })),
      connectorTokens: connectorTokens.map((token) => ({
        _id: token._id,
        deviceId: token.deviceId,
        tokenPreview: token.tokenPreview,
        status: token.status,
        scopes: token.scopes,
        lastUsedAt: token.lastUsedAt,
        expiresAt: token.expiresAt,
        createdAt: token.createdAt,
        updatedAt: token.updatedAt,
      })),
      connectedAccounts: connectedAccounts.map((account) => ({
        _id: account._id,
        deviceId: account.deviceId,
        provider: account.provider,
        providerAccountId: account.providerAccountId,
        accountLabel: account.accountLabel,
        displayName: account.displayName,
        phoneNumberMasked: account.phoneNumberMasked,
        username: account.username,
        authState: account.authState,
        connectedAt: account.connectedAt,
        disconnectedAt: account.disconnectedAt,
        lastSeenAt: account.lastSeenAt,
        createdAt: account.createdAt,
        updatedAt: account.updatedAt,
      })),
      subscriptions: subscriptions.map((subscription) => ({
        _id: subscription._id,
        provider: subscription.provider,
        plan: subscription.plan,
        status: subscription.status,
        amount: subscription.amount,
        currency: subscription.currency,
        providerPaymentPlanId: subscription.providerPaymentPlanId,
        providerSubscriptionId: subscription.providerSubscriptionId,
        providerCustomerId: subscription.providerCustomerId,
        txRef: subscription.txRef,
        transactionId: subscription.transactionId,
        paymentLink: subscription.paymentLink,
        currentPeriodStartedAt: subscription.currentPeriodStartedAt,
        currentPeriodEndsAt: subscription.currentPeriodEndsAt,
        lastPaymentAt: subscription.lastPaymentAt,
        lastWebhookAt: subscription.lastWebhookAt,
        cancelAt: subscription.cancelAt,
        canceledAt: subscription.canceledAt,
        pausedAt: subscription.pausedAt,
        pauseReason: subscription.pauseReason,
        createdAt: subscription.createdAt,
        updatedAt: subscription.updatedAt,
      })),
      subscriptionEvents: subscriptionEvents.map((event) => ({
        _id: event._id,
        subscriptionId: event.subscriptionId,
        provider: event.provider,
        eventType: event.eventType,
        providerEventId: event.providerEventId,
        txRef: event.txRef,
        transactionId: event.transactionId,
        status: event.status,
        detail: event.detail,
        createdAt: event.createdAt,
      })),
    };
  },
});

export const adminUpdateSubscription = mutation({
  args: {
    adminSecret: v.string(),
    tenantId: v.id("tenantAccounts"),
    plan: v.union(v.literal("personal_connector"), v.literal("business_whatsapp"), v.literal("self_hosted")),
    billingStatus: v.union(v.literal("trialing"), v.literal("active"), v.literal("past_due"), v.literal("paused"), v.literal("canceled")),
    trialEndsAt: v.number(),
    subscriptionExpiresAt: v.optional(v.number()),
    subscriptionPauseReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireAdmin(args.adminSecret);
    const tenant = await ctx.db.get(args.tenantId);
    if (!tenant) {
      throw new Error("Tenant was not found.");
    }
    const now = Date.now();
    await ctx.db.patch(args.tenantId, {
      plan: args.plan,
      billingStatus: args.billingStatus,
      trialEndsAt: args.trialEndsAt,
      subscriptionExpiresAt: args.subscriptionExpiresAt,
      subscriptionPausedAt: args.billingStatus === "paused" ? now : undefined,
      subscriptionPauseReason: args.billingStatus === "paused" ? args.subscriptionPauseReason || "manual_admin_pause" : undefined,
      updatedAt: now,
    });
    return true;
  },
});

export const adminUpsertUser = mutation({
  args: {
    adminSecret: v.string(),
    tenantId: v.id("tenantAccounts"),
    email: v.string(),
    displayName: v.optional(v.string()),
    role: v.union(v.literal("owner"), v.literal("admin"), v.literal("member")),
    isSuperAdmin: v.boolean(),
    pinSalt: v.optional(v.string()),
    pinHash: v.optional(v.string()),
    pinUpdatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    requireAdmin(args.adminSecret);
    const tenant = await ctx.db.get(args.tenantId);
    if (!tenant) {
      throw new Error("Tenant was not found.");
    }
    const emailNormalized = requireValidEmail(args.email);
    const now = Date.now();
    const existing = await ctx.db
      .query("tenantUsers")
      .withIndex("by_tenantId_and_emailNormalized", (q) => q.eq("tenantId", args.tenantId).eq("emailNormalized", emailNormalized))
      .unique();
    const pinPatch =
      args.pinSalt && args.pinHash
        ? {
            pinSalt: args.pinSalt,
            pinHash: args.pinHash,
            pinUpdatedAt: args.pinUpdatedAt || now,
          }
        : {};
    const next = {
      tenantId: args.tenantId,
      emailNormalized,
      email: args.email.trim(),
      displayName: args.displayName?.trim() || undefined,
      role: args.role,
      isSuperAdmin: args.isSuperAdmin,
      ...pinPatch,
      updatedAt: now,
    };
    if (existing) {
      await ctx.db.patch(existing._id, next);
      return existing._id;
    }
    return await ctx.db.insert("tenantUsers", {
      ...next,
      createdAt: now,
    });
  },
});

export const adminRemoveUser = mutation({
  args: {
    adminSecret: v.string(),
    tenantId: v.id("tenantAccounts"),
    userId: v.id("tenantUsers"),
  },
  handler: async (ctx, args) => {
    requireAdmin(args.adminSecret);
    const user = await ctx.db.get(args.userId);
    if (!user || user.tenantId !== args.tenantId) {
      throw new Error("Tenant user was not found.");
    }
    const tenantUsers = await ctx.db
      .query("tenantUsers")
      .withIndex("by_tenantId", (q) => q.eq("tenantId", args.tenantId))
      .take(200);
    const otherOwners = tenantUsers.filter((tenantUser) => tenantUser._id !== args.userId && tenantUser.role === "owner");
    if (user.role === "owner" && otherOwners.length === 0) {
      throw new Error("At least one tenant owner must remain.");
    }
    await ctx.db.delete(args.userId);
    return true;
  },
});

type BackfillTable =
  | "threads"
  | "messages"
  | "replyDrafts"
  | "outbox"
  | "inboundDedupeKeys"
  | "providerRuns"
  | "toolRuns"
  | "systemEvents"
  | "setupRuntime"
  | "messageReactions"
  | "mediaAssets"
  | "followUps"
  | "todoCandidates"
  | "todos"
  | "appConfig"
  | "styleProfiles"
  | "styleProfileHistory"
  | "personalityProfiles"
  | "personalityProfileVersions"
  | "threadPersonalitySettings"
  | "ignoreRules";

async function patchTenantBatch(ctx: MutationCtx, table: BackfillTable, tenantId: Id<"tenantAccounts">, limit: number) {
  if (table === "threads") {
    const rows = await ctx.db
      .query("threads")
      .withIndex("by_tenantId_and_jid", (q) => q.eq("tenantId", undefined))
      .take(limit);
    for (const row of rows) {
      await ctx.db.patch(row._id, { tenantId });
    }
    return { table, patched: rows.length, hasMore: rows.length === limit };
  }
  if (table === "messages") {
    const rows = await ctx.db
      .query("messages")
      .withIndex("by_tenantId_and_provider_and_createdAt", (q) => q.eq("tenantId", undefined))
      .take(limit);
    for (const row of rows) {
      await ctx.db.patch(row._id, { tenantId });
    }
    return { table, patched: rows.length, hasMore: rows.length === limit };
  }
  if (table === "replyDrafts") {
    const rows = await ctx.db
      .query("replyDrafts")
      .withIndex("by_tenantId_and_status", (q) => q.eq("tenantId", undefined))
      .take(limit);
    for (const row of rows) {
      await ctx.db.patch(row._id, { tenantId });
    }
    return { table, patched: rows.length, hasMore: rows.length === limit };
  }
  if (table === "outbox") {
    const rows = await ctx.db
      .query("outbox")
      .withIndex("by_tenantId_and_messageProvider_and_status_and_sendAt", (q) => q.eq("tenantId", undefined))
      .take(limit);
    for (const row of rows) {
      await ctx.db.patch(row._id, { tenantId });
    }
    return { table, patched: rows.length, hasMore: rows.length === limit };
  }
  if (table === "inboundDedupeKeys") {
    const rows = await ctx.db
      .query("inboundDedupeKeys")
      .withIndex("by_tenantId_and_provider_and_providerMessageId", (q) => q.eq("tenantId", undefined))
      .take(limit);
    for (const row of rows) {
      await ctx.db.patch(row._id, { tenantId });
    }
    return { table, patched: rows.length, hasMore: rows.length === limit };
  }
  if (table === "providerRuns") {
    const rows = await ctx.db
      .query("providerRuns")
      .withIndex("by_tenantId_and_createdAt", (q) => q.eq("tenantId", undefined))
      .take(limit);
    for (const row of rows) {
      await ctx.db.patch(row._id, { tenantId });
    }
    return { table, patched: rows.length, hasMore: rows.length === limit };
  }
  if (table === "toolRuns") {
    const rows = await ctx.db
      .query("toolRuns")
      .withIndex("by_tenantId_and_createdAt", (q) => q.eq("tenantId", undefined))
      .take(limit);
    for (const row of rows) {
      await ctx.db.patch(row._id, { tenantId });
    }
    return { table, patched: rows.length, hasMore: rows.length === limit };
  }
  if (table === "systemEvents") {
    const rows = await ctx.db
      .query("systemEvents")
      .withIndex("by_tenantId_and_createdAt", (q) => q.eq("tenantId", undefined))
      .take(limit);
    for (const row of rows) {
      await ctx.db.patch(row._id, { tenantId });
    }
    return { table, patched: rows.length, hasMore: rows.length === limit };
  }
  if (table === "setupRuntime") {
    const rows = await ctx.db
      .query("setupRuntime")
      .withIndex("by_tenantId_and_provider", (q) => q.eq("tenantId", undefined))
      .take(limit);
    for (const row of rows) {
      await ctx.db.patch(row._id, { tenantId });
    }
    return { table, patched: rows.length, hasMore: rows.length === limit };
  }
  if (table === "messageReactions") {
    const rows = await ctx.db
      .query("messageReactions")
      .withIndex("by_tenantId_and_messageId_and_actorJid", (q) => q.eq("tenantId", undefined))
      .take(limit);
    for (const row of rows) {
      await ctx.db.patch(row._id, { tenantId });
    }
    return { table, patched: rows.length, hasMore: rows.length === limit };
  }
  if (table === "mediaAssets") {
    const rows = await ctx.db
      .query("mediaAssets")
      .withIndex("by_tenantId_and_kind", (q) => q.eq("tenantId", undefined))
      .take(limit);
    for (const row of rows) {
      await ctx.db.patch(row._id, { tenantId });
    }
    return { table, patched: rows.length, hasMore: rows.length === limit };
  }
  if (table === "followUps") {
    const rows = await ctx.db
      .query("followUps")
      .withIndex("by_tenantId_and_status_and_dueAt", (q) => q.eq("tenantId", undefined))
      .take(limit);
    for (const row of rows) {
      await ctx.db.patch(row._id, { tenantId });
    }
    return { table, patched: rows.length, hasMore: rows.length === limit };
  }
  if (table === "todoCandidates") {
    const rows = await ctx.db
      .query("todoCandidates")
      .withIndex("by_tenantId_and_status", (q) => q.eq("tenantId", undefined))
      .take(limit);
    for (const row of rows) {
      await ctx.db.patch(row._id, { tenantId });
    }
    return { table, patched: rows.length, hasMore: rows.length === limit };
  }
  if (table === "todos") {
    const rows = await ctx.db
      .query("todos")
      .withIndex("by_tenantId_and_status", (q) => q.eq("tenantId", undefined))
      .take(limit);
    for (const row of rows) {
      await ctx.db.patch(row._id, { tenantId });
    }
    return { table, patched: rows.length, hasMore: rows.length === limit };
  }
  if (table === "appConfig") {
    const rows = await ctx.db
      .query("appConfig")
      .withIndex("by_tenantId_and_key", (q) => q.eq("tenantId", undefined))
      .take(limit);
    for (const row of rows) {
      await ctx.db.patch(row._id, { tenantId });
    }
    return { table, patched: rows.length, hasMore: rows.length === limit };
  }
  if (table === "styleProfiles") {
    const rows = await ctx.db
      .query("styleProfiles")
      .withIndex("by_tenantId_and_scope", (q) => q.eq("tenantId", undefined))
      .take(limit);
    for (const row of rows) {
      await ctx.db.patch(row._id, { tenantId });
    }
    return { table, patched: rows.length, hasMore: rows.length === limit };
  }
  if (table === "styleProfileHistory") {
    const rows = await ctx.db
      .query("styleProfileHistory")
      .withIndex("by_tenantId_and_scope_and_createdAt", (q) => q.eq("tenantId", undefined))
      .take(limit);
    for (const row of rows) {
      await ctx.db.patch(row._id, { tenantId });
    }
    return { table, patched: rows.length, hasMore: rows.length === limit };
  }
  if (table === "personalityProfiles") {
    const rows = await ctx.db
      .query("personalityProfiles")
      .withIndex("by_tenantId_and_slug", (q) => q.eq("tenantId", undefined))
      .take(limit);
    for (const row of rows) {
      await ctx.db.patch(row._id, { tenantId });
    }
    return { table, patched: rows.length, hasMore: rows.length === limit };
  }
  if (table === "personalityProfileVersions") {
    const rows = await ctx.db
      .query("personalityProfileVersions")
      .withIndex("by_tenantId_and_profileSlug_and_createdAt", (q) => q.eq("tenantId", undefined))
      .take(limit);
    for (const row of rows) {
      await ctx.db.patch(row._id, { tenantId });
    }
    return { table, patched: rows.length, hasMore: rows.length === limit };
  }
  if (table === "threadPersonalitySettings") {
    const rows = await ctx.db
      .query("threadPersonalitySettings")
      .withIndex("by_tenantId_and_thread", (q) => q.eq("tenantId", undefined))
      .take(limit);
    for (const row of rows) {
      await ctx.db.patch(row._id, { tenantId });
    }
    return { table, patched: rows.length, hasMore: rows.length === limit };
  }
  const rows = await ctx.db
    .query("ignoreRules")
    .withIndex("by_tenantId_and_type", (q) => q.eq("tenantId", undefined))
    .take(limit);
  for (const row of rows) {
    await ctx.db.patch(row._id, { tenantId });
  }
  return { table, patched: rows.length, hasMore: rows.length === limit };
}

export const adminSeedOwnerAndBackfill = mutation({
  args: {
    adminSecret: v.string(),
    email: v.string(),
    displayName: v.string(),
    pinSalt: v.string(),
    pinHash: v.string(),
    pinUpdatedAt: v.optional(v.number()),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    requireAdmin(args.adminSecret);
    const emailNormalized = requireValidEmail(args.email);
    const now = Date.now();
    const existing = await ctx.db
      .query("tenantAccounts")
      .withIndex("by_emailNormalized", (q) => q.eq("emailNormalized", emailNormalized))
      .unique();
    const trialStartedAt = existing?.trialStartedAt || now;
    const tenantId =
      existing?._id ||
      (await ctx.db.insert("tenantAccounts", {
        emailNormalized,
        email: args.email.trim(),
        displayName: args.displayName.trim() || undefined,
        serviceMode: "hosted",
        plan: "personal_connector",
        billingStatus: "active",
        pinSalt: args.pinSalt,
        pinHash: args.pinHash,
        pinUpdatedAt: args.pinUpdatedAt || now,
        trialStartedAt,
        trialEndsAt: trialStartedAt + TRIAL_DAYS * DAY_MS,
        createdAt: now,
        updatedAt: now,
      }));

    if (existing) {
      await ctx.db.patch(existing._id, {
        email: args.email.trim(),
        displayName: args.displayName.trim() || existing.displayName,
        serviceMode: "hosted",
        plan: "personal_connector",
        billingStatus: "active",
        pinSalt: args.pinSalt,
        pinHash: args.pinHash,
        pinUpdatedAt: args.pinUpdatedAt || now,
        updatedAt: now,
      });
    }

    const existingUser = await ctx.db
      .query("tenantUsers")
      .withIndex("by_tenantId_and_emailNormalized", (q) => q.eq("tenantId", tenantId).eq("emailNormalized", emailNormalized))
      .unique();
    if (existingUser) {
      await ctx.db.patch(existingUser._id, {
        email: args.email.trim(),
        displayName: args.displayName.trim() || existingUser.displayName,
        role: "owner",
        isSuperAdmin: true,
        pinSalt: args.pinSalt,
        pinHash: args.pinHash,
        pinUpdatedAt: args.pinUpdatedAt || now,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("tenantUsers", {
        tenantId,
        emailNormalized,
        email: args.email.trim(),
        displayName: args.displayName.trim() || undefined,
        role: "owner",
        isSuperAdmin: true,
        pinSalt: args.pinSalt,
        pinHash: args.pinHash,
        pinUpdatedAt: args.pinUpdatedAt || now,
        createdAt: now,
        updatedAt: now,
      });
    }

    const batchSize = Math.min(Math.max(Math.round(args.batchSize || 100), 1), 250);
    const tables: BackfillTable[] = [
      "threads",
      "messages",
      "replyDrafts",
      "outbox",
      "inboundDedupeKeys",
      "providerRuns",
      "toolRuns",
      "systemEvents",
      "setupRuntime",
      "messageReactions",
      "mediaAssets",
      "followUps",
      "todoCandidates",
      "todos",
      "appConfig",
      "styleProfiles",
      "styleProfileHistory",
      "personalityProfiles",
      "personalityProfileVersions",
      "threadPersonalitySettings",
      "ignoreRules",
    ];
    const backfill = [];
    for (const table of tables) {
      backfill.push(await patchTenantBatch(ctx, table, tenantId, batchSize));
    }

    return {
      tenantId,
      email: args.email.trim(),
      displayName: args.displayName.trim(),
      role: "owner",
      isSuperAdmin: true,
      backfill,
      hasMore: backfill.some((row) => row.hasMore),
    };
  },
});
