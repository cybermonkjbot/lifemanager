import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { isTenantBillingActive, listHostedTenantBillingScopes } from "./lib/billingAccess";

const DAY_MS = 24 * 60 * 60 * 1000;
const MONTH_MS = 30 * DAY_MS;
const WEEK_MS = 7 * DAY_MS;

const sendSubscriptionEmailRef = makeFunctionReference<"action">("billingActions:sendSubscriptionEmail");
const sendTenantReportRef = makeFunctionReference<"action">("billingActions:sendTenantReport");

export const listHostedTenantBillingScopesForActions = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await listHostedTenantBillingScopes(ctx);
  },
});

const planValidator = v.union(v.literal("personal_connector"), v.literal("business_whatsapp"), v.literal("self_hosted"));
function readAdminSecret() {
  return process.env.ODOGWU_CONVEX_ADMIN_SECRET || process.env.ODOGWU_ADMIN_SECRET || process.env.SLM_ADMIN_SECRET || "";
}

function requireAdmin(adminSecret: string) {
  const expected = readAdminSecret();
  if (!expected || adminSecret !== expected) {
    throw new Error("Unauthorized.");
  }
}

function compactJson(value: unknown, maxChars = 1800) {
  const text = JSON.stringify(value);
  return text.length > maxChars ? `${text.slice(0, maxChars - 3)}...` : text;
}

function normalizeProviderStatus(value?: string) {
  const status = (value || "").toLowerCase();
  if (status === "successful" || status === "success" || status === "active") {
    return "active" as const;
  }
  if (status === "failed" || status === "past_due") {
    return "past_due" as const;
  }
  if (status === "cancelled" || status === "canceled") {
    return "canceled" as const;
  }
  if (status === "pending") {
    return "pending" as const;
  }
  return "active" as const;
}

function subscriptionStatusToBilling(status: "active" | "past_due" | "paused" | "canceled" | "expired" | "pending") {
  if (status === "active") {
    return "active" as const;
  }
  if (status === "canceled" || status === "expired") {
    return "canceled" as const;
  }
  if (status === "paused") {
    return "paused" as const;
  }
  if (status === "past_due") {
    return "past_due" as const;
  }
  return "trialing" as const;
}

async function requireTenantCheckoutAccess(ctx: MutationCtx, args: {
  tenantId: Id<"tenantAccounts">;
  deviceId: string;
  email: string;
}) {
  const tenant = await ctx.db.get(args.tenantId);
  if (!tenant) {
    throw new Error("Tenant was not found.");
  }
  if (tenant.serviceMode !== "hosted") {
    throw new Error("Subscriptions are only available for hosted tenants.");
  }
  const device = await ctx.db
    .query("tenantDevices")
    .withIndex("by_tenantId_and_deviceId", (q) => q.eq("tenantId", args.tenantId).eq("deviceId", args.deviceId.trim()))
    .unique();
  if (!device) {
    throw new Error("Tenant device was not recognized.");
  }
  const emailNormalized = args.email.trim().toLowerCase();
  const user = await ctx.db
    .query("tenantUsers")
    .withIndex("by_tenantId_and_emailNormalized", (q) => q.eq("tenantId", args.tenantId).eq("emailNormalized", emailNormalized))
    .unique();
  if (tenant.emailNormalized !== emailNormalized && !user) {
    throw new Error("Tenant email was not recognized.");
  }
  return {
    tenant,
    displayName: user?.displayName || tenant.displayName || tenant.email,
  };
}

export const getTenantBillingSummary = query({
  args: {
    tenantId: v.id("tenantAccounts"),
  },
  handler: async (ctx, args) => {
    const tenant = await ctx.db.get(args.tenantId);
    if (!tenant) {
      return null;
    }
    const subscriptions = await ctx.db
      .query("tenantSubscriptions")
      .withIndex("by_tenantId", (q) => q.eq("tenantId", args.tenantId))
      .order("desc")
      .take(5);
    return {
      tenant: {
        _id: tenant._id,
        email: tenant.email,
        displayName: tenant.displayName,
        plan: tenant.plan,
        billingStatus: tenant.billingStatus,
        trialEndsAt: tenant.trialEndsAt,
        subscriptionExpiresAt: tenant.subscriptionExpiresAt,
        subscriptionPausedAt: tenant.subscriptionPausedAt,
        subscriptionPauseReason: tenant.subscriptionPauseReason,
        flutterwaveSubscriptionId: tenant.flutterwaveSubscriptionId,
      },
      subscriptions,
    };
  },
});

export const createCheckoutFromTenantSession = mutation({
  args: {
    tenantId: v.id("tenantAccounts"),
    deviceId: v.string(),
    email: v.string(),
    plan: planValidator,
    amount: v.number(),
    currency: v.string(),
    flutterwavePaymentPlanId: v.string(),
    txRef: v.string(),
  },
  handler: async (ctx, args) => {
    const access = await requireTenantCheckoutAccess(ctx, args);
    const now = Date.now();
    const subscriptionId = await ctx.db.insert("tenantSubscriptions", {
      tenantId: args.tenantId,
      provider: "flutterwave",
      plan: args.plan,
      status: "pending",
      amount: args.amount,
      currency: args.currency.trim().toUpperCase(),
      providerPaymentPlanId: args.flutterwavePaymentPlanId.trim(),
      txRef: args.txRef.trim(),
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(args.tenantId, {
      plan: args.plan,
      subscriptionProvider: "flutterwave",
      flutterwavePaymentPlanId: args.flutterwavePaymentPlanId.trim(),
      flutterwaveTxRef: args.txRef.trim(),
      updatedAt: now,
    });
    await ctx.db.insert("subscriptionEvents", {
      tenantId: args.tenantId,
      subscriptionId,
      provider: "flutterwave",
      eventType: "checkout.created",
      txRef: args.txRef.trim(),
      status: "pending",
      detail: compactJson({ amount: args.amount, currency: args.currency, paymentPlanId: args.flutterwavePaymentPlanId }),
      createdAt: now,
    });
    return {
      subscriptionId,
      email: access.tenant.email,
      displayName: access.displayName,
    };
  },
});

export const adminCreateCheckout = mutation({
  args: {
    adminSecret: v.string(),
    tenantId: v.id("tenantAccounts"),
    plan: planValidator,
    amount: v.number(),
    currency: v.string(),
    flutterwavePaymentPlanId: v.string(),
    txRef: v.string(),
    paymentLink: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireAdmin(args.adminSecret);
    const tenant = await ctx.db.get(args.tenantId);
    if (!tenant) {
      throw new Error("Tenant was not found.");
    }
    const now = Date.now();
    const subscriptionId = await ctx.db.insert("tenantSubscriptions", {
      tenantId: args.tenantId,
      provider: "flutterwave",
      plan: args.plan,
      status: "pending",
      amount: args.amount,
      currency: args.currency.trim().toUpperCase(),
      providerPaymentPlanId: args.flutterwavePaymentPlanId.trim(),
      txRef: args.txRef.trim(),
      paymentLink: args.paymentLink,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(args.tenantId, {
      plan: args.plan,
      subscriptionProvider: "flutterwave",
      flutterwavePaymentPlanId: args.flutterwavePaymentPlanId.trim(),
      flutterwaveTxRef: args.txRef.trim(),
      updatedAt: now,
    });
    await ctx.db.insert("subscriptionEvents", {
      tenantId: args.tenantId,
      subscriptionId,
      provider: "flutterwave",
      eventType: "checkout.created",
      txRef: args.txRef.trim(),
      status: "pending",
      detail: compactJson({ amount: args.amount, currency: args.currency, paymentPlanId: args.flutterwavePaymentPlanId }),
      createdAt: now,
    });
    return subscriptionId;
  },
});

export const attachCheckoutLinkFromTenantSession = mutation({
  args: {
    tenantId: v.id("tenantAccounts"),
    deviceId: v.string(),
    email: v.string(),
    txRef: v.string(),
    paymentLink: v.string(),
  },
  handler: async (ctx, args) => {
    await requireTenantCheckoutAccess(ctx, args);
    const subscription = await ctx.db
      .query("tenantSubscriptions")
      .withIndex("by_txRef", (q) => q.eq("txRef", args.txRef))
      .unique();
    if (!subscription || subscription.tenantId !== args.tenantId) {
      return false;
    }
    await ctx.db.patch(subscription._id, {
      paymentLink: args.paymentLink,
      updatedAt: Date.now(),
    });
    return true;
  },
});

export const adminAttachCheckoutLink = mutation({
  args: {
    adminSecret: v.string(),
    txRef: v.string(),
    paymentLink: v.string(),
  },
  handler: async (ctx, args) => {
    requireAdmin(args.adminSecret);
    const subscription = await ctx.db
      .query("tenantSubscriptions")
      .withIndex("by_txRef", (q) => q.eq("txRef", args.txRef))
      .unique();
    if (!subscription) {
      return false;
    }
    await ctx.db.patch(subscription._id, {
      paymentLink: args.paymentLink,
      updatedAt: Date.now(),
    });
    return true;
  },
});

export const recordFlutterwaveEvent = mutation({
  args: {
    eventType: v.string(),
    providerEventId: v.optional(v.string()),
    txRef: v.optional(v.string()),
    transactionId: v.optional(v.string()),
    status: v.optional(v.string()),
    amount: v.optional(v.number()),
    currency: v.optional(v.string()),
    customerEmail: v.optional(v.string()),
    flutterwaveCustomerId: v.optional(v.string()),
    flutterwaveSubscriptionId: v.optional(v.string()),
    flutterwavePaymentPlanId: v.optional(v.string()),
    chargedAt: v.optional(v.number()),
    currentPeriodEndsAt: v.optional(v.number()),
    payloadSummary: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    let subscription: Doc<"tenantSubscriptions"> | null = null;
    if (args.flutterwaveSubscriptionId) {
      subscription = await ctx.db
        .query("tenantSubscriptions")
        .withIndex("by_providerSubscriptionId", (q) => q.eq("providerSubscriptionId", args.flutterwaveSubscriptionId))
        .unique();
    }
    if (!subscription && args.txRef) {
      subscription = await ctx.db
        .query("tenantSubscriptions")
        .withIndex("by_txRef", (q) => q.eq("txRef", args.txRef))
        .unique();
    }
    if (!subscription && args.customerEmail) {
      const tenant = await ctx.db
        .query("tenantAccounts")
        .withIndex("by_emailNormalized", (q) => q.eq("emailNormalized", args.customerEmail!.trim().toLowerCase()))
        .unique();
      if (tenant) {
        const rows = await ctx.db
          .query("tenantSubscriptions")
          .withIndex("by_tenantId_and_provider", (q) => q.eq("tenantId", tenant._id).eq("provider", "flutterwave"))
          .order("desc")
          .take(1);
        subscription = rows[0] || null;
      }
    }

    const eventStatus = normalizeProviderStatus(args.status);
    const isPaymentEvent = /charge|payment|transaction/i.test(args.eventType);
    const periodEndsAt = args.currentPeriodEndsAt || (eventStatus === "active" && isPaymentEvent ? (args.chargedAt || now) + MONTH_MS : undefined);
    const tenantId: Id<"tenantAccounts"> | undefined = subscription?.tenantId;

    if (subscription) {
      const nextStatus =
        args.eventType.toLowerCase().includes("cancel") ? "canceled" :
        args.eventType.toLowerCase().includes("expire") ? "expired" :
        eventStatus;
      await ctx.db.patch(subscription._id, {
        status: nextStatus,
        amount: args.amount ?? subscription.amount,
        currency: args.currency?.trim().toUpperCase() || subscription.currency,
        providerPaymentPlanId: args.flutterwavePaymentPlanId || subscription.providerPaymentPlanId,
        providerSubscriptionId: args.flutterwaveSubscriptionId || subscription.providerSubscriptionId,
        providerCustomerId: args.flutterwaveCustomerId || subscription.providerCustomerId,
        transactionId: args.transactionId || subscription.transactionId,
        currentPeriodStartedAt: eventStatus === "active" && isPaymentEvent ? args.chargedAt || now : subscription.currentPeriodStartedAt,
        currentPeriodEndsAt: periodEndsAt || subscription.currentPeriodEndsAt,
        lastPaymentAt: eventStatus === "active" && isPaymentEvent ? args.chargedAt || now : subscription.lastPaymentAt,
        lastWebhookAt: now,
        canceledAt: nextStatus === "canceled" ? now : subscription.canceledAt,
        updatedAt: now,
      });
      const tenant = await ctx.db.get(subscription.tenantId);
      if (tenant) {
        await ctx.db.patch(tenant._id, {
          plan: subscription.plan,
          billingStatus: subscriptionStatusToBilling(nextStatus),
          subscriptionProvider: "flutterwave",
          subscriptionExpiresAt: periodEndsAt || subscription.currentPeriodEndsAt || tenant.subscriptionExpiresAt,
          flutterwaveCustomerId: args.flutterwaveCustomerId || tenant.flutterwaveCustomerId,
          flutterwaveSubscriptionId: args.flutterwaveSubscriptionId || tenant.flutterwaveSubscriptionId,
          flutterwavePaymentPlanId: args.flutterwavePaymentPlanId || tenant.flutterwavePaymentPlanId,
          flutterwaveTxRef: args.txRef || tenant.flutterwaveTxRef,
          subscriptionPausedAt: undefined,
          subscriptionPauseReason: undefined,
          updatedAt: now,
        });
      }
    }

    const eventId = await ctx.db.insert("subscriptionEvents", {
      tenantId,
      subscriptionId: subscription?._id,
      provider: "flutterwave",
      eventType: args.eventType,
      providerEventId: args.providerEventId,
      txRef: args.txRef,
      transactionId: args.transactionId,
      status: args.status,
      detail: args.payloadSummary,
      createdAt: now,
    });

    if (tenantId && (eventStatus === "active" || eventStatus === "past_due" || args.eventType.toLowerCase().includes("cancel"))) {
      await ctx.scheduler.runAfter(0, sendSubscriptionEmailRef, {
        tenantId,
        kind: eventStatus === "active" ? "subscription_active" : args.eventType.toLowerCase().includes("cancel") ? "subscription_canceled" : "payment_failed",
      });
    }

    return { eventId, tenantId: tenantId ?? null, subscriptionId: subscription?._id ?? null };
  },
});

export const adminRecordFlutterwaveEvent = mutation({
  args: {
    adminSecret: v.string(),
    eventType: v.string(),
    providerEventId: v.optional(v.string()),
    txRef: v.optional(v.string()),
    transactionId: v.optional(v.string()),
    status: v.optional(v.string()),
    amount: v.optional(v.number()),
    currency: v.optional(v.string()),
    customerEmail: v.optional(v.string()),
    flutterwaveCustomerId: v.optional(v.string()),
    flutterwaveSubscriptionId: v.optional(v.string()),
    flutterwavePaymentPlanId: v.optional(v.string()),
    chargedAt: v.optional(v.number()),
    currentPeriodEndsAt: v.optional(v.number()),
    payloadSummary: v.string(),
  },
  handler: async (ctx, args) => {
    requireAdmin(args.adminSecret);
    return await ctx.runMutation(makeFunctionReference<"mutation">("billing:recordFlutterwaveEvent"), {
      eventType: args.eventType,
      providerEventId: args.providerEventId,
      txRef: args.txRef,
      transactionId: args.transactionId,
      status: args.status,
      amount: args.amount,
      currency: args.currency,
      customerEmail: args.customerEmail,
      flutterwaveCustomerId: args.flutterwaveCustomerId,
      flutterwaveSubscriptionId: args.flutterwaveSubscriptionId,
      flutterwavePaymentPlanId: args.flutterwavePaymentPlanId,
      chargedAt: args.chargedAt,
      currentPeriodEndsAt: args.currentPeriodEndsAt,
      payloadSummary: args.payloadSummary,
    });
  },
});

export const pauseExpiredBatch = internalMutation({
  args: {
    now: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    const limit = Math.min(Math.max(Math.floor(args.limit ?? 50), 1), 100);
    const expiredTrials = await ctx.db
      .query("tenantAccounts")
      .withIndex("by_billingStatus_and_trialEndsAt", (q) => q.eq("billingStatus", "trialing").lte("trialEndsAt", now))
      .take(limit);
    const remaining = Math.max(0, limit - expiredTrials.length);
    const expiredSubscriptions = remaining > 0
      ? await ctx.db
          .query("tenantAccounts")
          .withIndex("by_billingStatus_and_subscriptionExpiresAt", (q) => q.eq("billingStatus", "active").lte("subscriptionExpiresAt", now))
          .take(remaining)
      : [];
    const tenants = [...expiredTrials, ...expiredSubscriptions];
    for (const tenant of tenants) {
      const reason = tenant.billingStatus === "trialing" ? "trial_expired" : "subscription_expired";
      await ctx.db.patch(tenant._id, {
        billingStatus: "paused",
        subscriptionPausedAt: now,
        subscriptionPauseReason: reason,
        updatedAt: now,
      });
      await ctx.db.insert("subscriptionEvents", {
        tenantId: tenant._id,
        provider: "system",
        eventType: "subscription.paused",
        status: "paused",
        detail: `Tenant paused because ${reason}.`,
        createdAt: now,
      });
      await ctx.db.insert("systemEvents", {
        tenantId: tenant._id,
        source: "convex",
        eventType: "tenant.subscription.paused",
        detail: `Tenant service paused because ${reason}.`,
        createdAt: now,
      });
      await ctx.scheduler.runAfter(0, sendSubscriptionEmailRef, {
        tenantId: tenant._id,
        kind: "subscription_paused",
      });
    }
    return { paused: tenants.length, hasMore: tenants.length === limit };
  },
});

export const listTenantsDueForReports = internalQuery({
  args: {
    now: v.number(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(Math.floor(args.limit ?? 50), 1), 100);
    const tenants = await ctx.db.query("tenantAccounts").order("desc").take(200);
    const due: Array<{ tenantId: Id<"tenantAccounts"> }> = [];
    for (const tenant of tenants) {
      if (tenant.serviceMode !== "hosted") {
        continue;
      }
      if (!isTenantBillingActive(tenant, args.now)) {
        continue;
      }
      if ((tenant.lastTenantReportEmailAt || 0) > args.now - WEEK_MS) {
        continue;
      }
      due.push({ tenantId: tenant._id });
      if (due.length >= limit) {
        break;
      }
    }
    return due;
  },
});

export const buildTenantReport = internalQuery({
  args: {
    tenantId: v.id("tenantAccounts"),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const tenant = await ctx.db.get(args.tenantId);
    if (!tenant) {
      return null;
    }
    const windowStartAt = args.now - WEEK_MS;
    const providerRuns = await ctx.db
      .query("providerRuns")
      .withIndex("by_tenantId_and_createdAt", (q) => q.eq("tenantId", args.tenantId).gte("createdAt", windowStartAt))
      .take(1200);
    const whatsappOutboxRows = await ctx.db
      .query("outbox")
      .withIndex("by_tenantId_and_messageProvider_and_status_and_sendAt", (q) => q.eq("tenantId", args.tenantId).eq("messageProvider", "whatsapp").eq("status", "sent").gte("sendAt", windowStartAt))
      .take(1000);
    const instagramOutboxRows = await ctx.db
      .query("outbox")
      .withIndex("by_tenantId_and_messageProvider_and_status_and_sendAt", (q) => q.eq("tenantId", args.tenantId).eq("messageProvider", "instagram").eq("status", "sent").gte("sendAt", windowStartAt))
      .take(1000);
    const events = await ctx.db
      .query("systemEvents")
      .withIndex("by_tenantId_and_createdAt", (q) => q.eq("tenantId", args.tenantId).gte("createdAt", windowStartAt))
      .order("desc")
      .take(200);
    const successRuns = providerRuns.reduce((sum, run) => sum + (run.status === "success" ? 1 : 0), 0);
    const errorRuns = providerRuns.length - successRuns;
    const estimatedCostUsd = Number(providerRuns.reduce((sum, run) => sum + (run.estimatedCostUsd || 0), 0).toFixed(6));
    const alerts = events
      .filter((event) => event.eventType.includes("failed") || event.eventType.includes("paused") || event.eventType.includes("error"))
      .slice(0, 8)
      .map((event) => `${event.eventType}: ${event.detail}`.slice(0, 220));
    return {
      tenant: {
        _id: tenant._id,
        email: tenant.email,
        displayName: tenant.displayName || tenant.email,
        plan: tenant.plan,
        billingStatus: tenant.billingStatus,
        trialEndsAt: tenant.trialEndsAt,
        subscriptionExpiresAt: tenant.subscriptionExpiresAt,
      },
      windowStartAt,
      windowEndAt: args.now,
      metrics: {
        providerRuns: providerRuns.length,
        providerSuccess: successRuns,
        providerErrors: errorRuns,
        outboundSent: whatsappOutboxRows.length + instagramOutboxRows.length,
        estimatedCostUsd,
      },
      alerts,
    };
  },
});

export const markTenantReportSent = internalMutation({
  args: {
    tenantId: v.id("tenantAccounts"),
    sentAt: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.tenantId, {
      lastTenantReportEmailAt: args.sentAt,
      updatedAt: args.sentAt,
    });
    await ctx.db.insert("subscriptionEvents", {
      tenantId: args.tenantId,
      provider: "resend",
      eventType: "tenant_report.sent",
      status: "sent",
      detail: "Weekly tenant report emailed to owner.",
      createdAt: args.sentAt,
    });
    return true;
  },
});

export const markSubscriptionEmailSent = internalMutation({
  args: {
    tenantId: v.id("tenantAccounts"),
    kind: v.string(),
    sentAt: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.tenantId, {
      lastSubscriptionEmailAt: args.sentAt,
      updatedAt: args.sentAt,
    });
    await ctx.db.insert("subscriptionEvents", {
      tenantId: args.tenantId,
      provider: "resend",
      eventType: `email.${args.kind}.sent`,
      status: "sent",
      detail: "Subscription email sent.",
      createdAt: args.sentAt,
    });
    return true;
  },
});

export const sendDueTenantReport = internalAction({
  args: {
    tenantId: v.id("tenantAccounts"),
  },
  handler: async (ctx, args) => {
    await ctx.scheduler.runAfter(0, sendTenantReportRef, { tenantId: args.tenantId });
    return true;
  },
});
