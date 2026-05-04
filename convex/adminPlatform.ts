import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { DEFAULT_APP_CONFIG, getConfig, setConfigValue } from "./lib/config";

const PLAN_IDS = ["personal_connector", "business_whatsapp", "self_hosted"] as const;
const DAY_MS = 24 * 60 * 60 * 1000;

const planConfigValidator = v.object({
  enabled: v.boolean(),
  amount: v.number(),
  currency: v.string(),
  flutterwavePaymentPlanId: v.string(),
  maxSeats: v.number(),
  maxDevices: v.number(),
  monthlyAiMessages: v.number(),
  monthlyAiSpendUsd: v.number(),
  whatsappEnabled: v.boolean(),
  instagramEnabled: v.boolean(),
  imessageEnabled: v.boolean(),
  telegramEnabled: v.boolean(),
  mediaEnabled: v.boolean(),
  selfHostedEnabled: v.boolean(),
});

const subscriptionConfigValidator = v.object({
  trialDays: v.number(),
  graceDays: v.number(),
  dunningEmailEnabled: v.boolean(),
  tenantReportsEnabled: v.boolean(),
  plans: v.object({
    personal_connector: planConfigValidator,
    business_whatsapp: planConfigValidator,
    self_hosted: planConfigValidator,
  }),
});

const platformConfigValidator = v.object({
  aiFallbackMode: v.union(v.literal("all"), v.literal("azure_only")),
  aiModelFirstEnabled: v.boolean(),
  aiTemperature: v.number(),
  aiMaxOutputTokens: v.number(),
  aiMaxReplyChars: v.number(),
  aiHistoryLineLimit: v.number(),
  aiPrimaryConfidence: v.number(),
  aiFallbackConfidence: v.number(),
  outboxClaimLimit: v.number(),
  outboxPollMs: v.number(),
  inboundMergeWindowMs: v.number(),
  inboundConcurrency: v.number(),
  outboxSendConcurrency: v.number(),
  sendRateWindowMinutes: v.number(),
  sendMaxPerThreadInWindow: v.number(),
  sendMaxGlobalInWindow: v.number(),
  quietHoursEnabled: v.boolean(),
  quietHoursStartHour: v.number(),
  quietHoursEndHour: v.number(),
  statusRetentionMs: v.number(),
  statusCleanupIntervalMs: v.number(),
  statusCleanupBatchLimit: v.number(),
});

function readAdminSecret() {
  return process.env.ODOGWU_CONVEX_ADMIN_SECRET || process.env.ODOGWU_ADMIN_SECRET || process.env.SLM_ADMIN_SECRET || "";
}

function requireAdmin(adminSecret: string) {
  const expected = readAdminSecret();
  if (!expected || adminSecret !== expected) {
    throw new Error("Unauthorized.");
  }
}

function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(Number.isFinite(value) ? value : min, max));
}

function boolFromConfig(value: string | undefined, fallback: boolean) {
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  return fallback;
}

function numberFromConfig(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function readConfigMap(ctx: QueryCtx) {
  const rows = await ctx.db
    .query("appConfig")
    .withIndex("by_tenantId_and_key", (q) => q.eq("tenantId", undefined))
    .take(300);
  return new Map(rows.map((row) => [row.key, row.value]));
}

async function readMutationConfigMap(ctx: MutationCtx) {
  const rows = await ctx.db
    .query("appConfig")
    .withIndex("by_tenantId_and_key", (q) => q.eq("tenantId", undefined))
    .take(300);
  return new Map(rows.map((row) => [row.key, row.value]));
}

function serializeConfigValue(value: unknown) {
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "number") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.join("\n");
  }
  if (value && typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value ?? "");
}

async function seedConfigValue(
  ctx: MutationCtx,
  existing: Map<string, string>,
  key: string,
  value: unknown,
  overwrite: boolean,
) {
  if (!overwrite && existing.has(key)) {
    return "skipped" as const;
  }
  await setConfigValue(ctx, key, serializeConfigValue(value));
  existing.set(key, serializeConfigValue(value));
  return "seeded" as const;
}

function defaultPlanConfig(plan: typeof PLAN_IDS[number]) {
  if (plan === "business_whatsapp") {
    return {
      enabled: true,
      amount: 15000,
      currency: "NGN",
      flutterwavePaymentPlanId: "",
      maxSeats: 8,
      maxDevices: 3,
      monthlyAiMessages: 8000,
      monthlyAiSpendUsd: 75,
      whatsappEnabled: true,
      instagramEnabled: true,
      imessageEnabled: true,
      telegramEnabled: true,
      mediaEnabled: true,
      selfHostedEnabled: false,
    };
  }
  if (plan === "self_hosted") {
    return {
      enabled: true,
      amount: 0,
      currency: "USD",
      flutterwavePaymentPlanId: "",
      maxSeats: 3,
      maxDevices: 3,
      monthlyAiMessages: 0,
      monthlyAiSpendUsd: 0,
      whatsappEnabled: true,
      instagramEnabled: true,
      imessageEnabled: true,
      telegramEnabled: true,
      mediaEnabled: true,
      selfHostedEnabled: true,
    };
  }
  return {
    enabled: true,
    amount: 5000,
    currency: "NGN",
    flutterwavePaymentPlanId: "",
    maxSeats: 1,
    maxDevices: 1,
    monthlyAiMessages: 2000,
    monthlyAiSpendUsd: 15,
    whatsappEnabled: true,
    instagramEnabled: false,
    imessageEnabled: true,
    telegramEnabled: true,
    mediaEnabled: true,
    selfHostedEnabled: false,
  };
}

function readPlanConfig(map: Map<string, string>, plan: typeof PLAN_IDS[number]) {
  const defaults = defaultPlanConfig(plan);
  const prefix = `subscription.plan.${plan}.`;
  return {
    enabled: boolFromConfig(map.get(`${prefix}enabled`), defaults.enabled),
    amount: numberFromConfig(map.get(`${prefix}amount`), defaults.amount),
    currency: (map.get(`${prefix}currency`) || defaults.currency).trim().toUpperCase(),
    flutterwavePaymentPlanId: map.get(`${prefix}flutterwavePaymentPlanId`) || defaults.flutterwavePaymentPlanId,
    maxSeats: numberFromConfig(map.get(`${prefix}maxSeats`), defaults.maxSeats),
    maxDevices: numberFromConfig(map.get(`${prefix}maxDevices`), defaults.maxDevices),
    monthlyAiMessages: numberFromConfig(map.get(`${prefix}monthlyAiMessages`), defaults.monthlyAiMessages),
    monthlyAiSpendUsd: numberFromConfig(map.get(`${prefix}monthlyAiSpendUsd`), defaults.monthlyAiSpendUsd),
    whatsappEnabled: boolFromConfig(map.get(`${prefix}whatsappEnabled`), defaults.whatsappEnabled),
    instagramEnabled: boolFromConfig(map.get(`${prefix}instagramEnabled`), defaults.instagramEnabled),
    imessageEnabled: boolFromConfig(map.get(`${prefix}imessageEnabled`), defaults.imessageEnabled),
    telegramEnabled: boolFromConfig(map.get(`${prefix}telegramEnabled`), defaults.telegramEnabled),
    mediaEnabled: boolFromConfig(map.get(`${prefix}mediaEnabled`), defaults.mediaEnabled),
    selfHostedEnabled: boolFromConfig(map.get(`${prefix}selfHostedEnabled`), defaults.selfHostedEnabled),
  };
}

async function writePlanConfig(ctx: MutationCtx, plan: typeof PLAN_IDS[number], raw: ReturnType<typeof defaultPlanConfig>) {
  const prefix = `subscription.plan.${plan}.`;
  await setConfigValue(ctx, `${prefix}enabled`, raw.enabled ? "true" : "false");
  await setConfigValue(ctx, `${prefix}amount`, String(clampNumber(raw.amount, 0, 10_000_000)));
  await setConfigValue(ctx, `${prefix}currency`, raw.currency.trim().toUpperCase().slice(0, 8) || "USD");
  await setConfigValue(ctx, `${prefix}flutterwavePaymentPlanId`, raw.flutterwavePaymentPlanId.trim().slice(0, 160));
  await setConfigValue(ctx, `${prefix}maxSeats`, String(Math.round(clampNumber(raw.maxSeats, 1, 500))));
  await setConfigValue(ctx, `${prefix}maxDevices`, String(Math.round(clampNumber(raw.maxDevices, 1, 200))));
  await setConfigValue(ctx, `${prefix}monthlyAiMessages`, String(Math.round(clampNumber(raw.monthlyAiMessages, 0, 10_000_000))));
  await setConfigValue(ctx, `${prefix}monthlyAiSpendUsd`, String(clampNumber(raw.monthlyAiSpendUsd, 0, 100_000)));
  await setConfigValue(ctx, `${prefix}whatsappEnabled`, raw.whatsappEnabled ? "true" : "false");
  await setConfigValue(ctx, `${prefix}instagramEnabled`, raw.instagramEnabled ? "true" : "false");
  await setConfigValue(ctx, `${prefix}imessageEnabled`, raw.imessageEnabled ? "true" : "false");
  await setConfigValue(ctx, `${prefix}telegramEnabled`, raw.telegramEnabled ? "true" : "false");
  await setConfigValue(ctx, `${prefix}mediaEnabled`, raw.mediaEnabled ? "true" : "false");
  await setConfigValue(ctx, `${prefix}selfHostedEnabled`, raw.selfHostedEnabled ? "true" : "false");
}

export const subscriptionConfig = query({
  args: {
    adminSecret: v.string(),
  },
  handler: async (ctx, args) => {
    requireAdmin(args.adminSecret);
    const map = await readConfigMap(ctx);
    return {
      trialDays: numberFromConfig(map.get("subscription.trialDays"), 14),
      graceDays: numberFromConfig(map.get("subscription.graceDays"), 3),
      dunningEmailEnabled: boolFromConfig(map.get("subscription.dunningEmailEnabled"), true),
      tenantReportsEnabled: boolFromConfig(map.get("subscription.tenantReportsEnabled"), true),
      plans: {
        personal_connector: readPlanConfig(map, "personal_connector"),
        business_whatsapp: readPlanConfig(map, "business_whatsapp"),
        self_hosted: readPlanConfig(map, "self_hosted"),
      },
    };
  },
});

export const saveSubscriptionConfig = mutation({
  args: {
    adminSecret: v.string(),
    config: subscriptionConfigValidator,
  },
  handler: async (ctx, args) => {
    requireAdmin(args.adminSecret);
    await setConfigValue(ctx, "subscription.trialDays", String(Math.round(clampNumber(args.config.trialDays, 0, 365))));
    await setConfigValue(ctx, "subscription.graceDays", String(Math.round(clampNumber(args.config.graceDays, 0, 90))));
    await setConfigValue(ctx, "subscription.dunningEmailEnabled", args.config.dunningEmailEnabled ? "true" : "false");
    await setConfigValue(ctx, "subscription.tenantReportsEnabled", args.config.tenantReportsEnabled ? "true" : "false");
    for (const plan of PLAN_IDS) {
      await writePlanConfig(ctx, plan, args.config.plans[plan]);
    }
    await ctx.db.insert("systemEvents", {
      source: "dashboard",
      eventType: "admin.subscription_config.updated",
      detail: "Admin subscription configuration updated.",
      createdAt: Date.now(),
    });
    return true;
  },
});

export const platformConfig = query({
  args: {
    adminSecret: v.string(),
  },
  handler: async (ctx, args) => {
    requireAdmin(args.adminSecret);
    const config = await getConfig(ctx);
    return {
      aiFallbackMode: config.aiFallbackMode,
      aiModelFirstEnabled: config.aiModelFirstEnabled,
      aiTemperature: config.aiTemperature,
      aiMaxOutputTokens: config.aiMaxOutputTokens,
      aiMaxReplyChars: config.aiMaxReplyChars,
      aiHistoryLineLimit: config.aiHistoryLineLimit,
      aiPrimaryConfidence: config.aiPrimaryConfidence,
      aiFallbackConfidence: config.aiFallbackConfidence,
      outboxClaimLimit: config.outboxClaimLimit,
      outboxPollMs: config.outboxPollMs,
      inboundMergeWindowMs: config.inboundMergeWindowMs,
      inboundConcurrency: config.inboundConcurrency,
      outboxSendConcurrency: config.outboxSendConcurrency,
      sendRateWindowMinutes: config.sendRateWindowMinutes,
      sendMaxPerThreadInWindow: config.sendMaxPerThreadInWindow,
      sendMaxGlobalInWindow: config.sendMaxGlobalInWindow,
      quietHoursEnabled: config.quietHoursEnabled,
      quietHoursStartHour: config.quietHoursStartHour,
      quietHoursEndHour: config.quietHoursEndHour,
      statusRetentionMs: config.statusRetentionMs,
      statusCleanupIntervalMs: config.statusCleanupIntervalMs,
      statusCleanupBatchLimit: config.statusCleanupBatchLimit,
    };
  },
});

export const savePlatformConfig = mutation({
  args: {
    adminSecret: v.string(),
    config: platformConfigValidator,
  },
  handler: async (ctx, args) => {
    requireAdmin(args.adminSecret);
    const config = args.config;
    const pairs: Array<[string, string]> = [
      ["aiFallbackMode", config.aiFallbackMode],
      ["aiModelFirstEnabled", config.aiModelFirstEnabled ? "true" : "false"],
      ["aiTemperature", String(clampNumber(config.aiTemperature, 0, 1.3))],
      ["aiMaxOutputTokens", String(Math.round(clampNumber(config.aiMaxOutputTokens, 40, 2000)))],
      ["aiMaxReplyChars", String(Math.round(clampNumber(config.aiMaxReplyChars, 60, 2400)))],
      ["aiHistoryLineLimit", String(Math.round(clampNumber(config.aiHistoryLineLimit, 4, 120)))],
      ["aiPrimaryConfidence", String(clampNumber(config.aiPrimaryConfidence, 0.01, 1))],
      ["aiFallbackConfidence", String(clampNumber(config.aiFallbackConfidence, 0.01, 1))],
      ["outboxClaimLimit", String(Math.round(clampNumber(config.outboxClaimLimit, 1, 20)))],
      ["outboxPollMs", String(Math.round(clampNumber(config.outboxPollMs, 500, 60_000)))],
      ["inboundMergeWindowMs", String(Math.round(clampNumber(config.inboundMergeWindowMs, 2_000, 180_000)))],
      ["inboundConcurrency", String(Math.round(clampNumber(config.inboundConcurrency, 1, 16)))],
      ["outboxSendConcurrency", String(Math.round(clampNumber(config.outboxSendConcurrency, 1, 16)))],
      ["sendRateWindowMinutes", String(Math.round(clampNumber(config.sendRateWindowMinutes, 5, 24 * 60)))],
      ["sendMaxPerThreadInWindow", String(Math.round(clampNumber(config.sendMaxPerThreadInWindow, 1, 100)))],
      ["sendMaxGlobalInWindow", String(Math.round(clampNumber(config.sendMaxGlobalInWindow, 1, 1000)))],
      ["quietHoursEnabled", config.quietHoursEnabled ? "true" : "false"],
      ["quietHoursStartHour", String(Math.round(clampNumber(config.quietHoursStartHour, 0, 23)))],
      ["quietHoursEndHour", String(Math.round(clampNumber(config.quietHoursEndHour, 0, 23)))],
      ["statusRetentionMs", String(Math.round(clampNumber(config.statusRetentionMs, 5 * 60 * 1000, DAY_MS)))],
      ["statusCleanupIntervalMs", String(Math.round(clampNumber(config.statusCleanupIntervalMs, 5 * 60 * 1000, DAY_MS)))],
      ["statusCleanupBatchLimit", String(Math.round(clampNumber(config.statusCleanupBatchLimit, 20, 800)))],
    ];
    for (const [key, value] of pairs) {
      await setConfigValue(ctx, key, value);
    }
    await ctx.db.insert("systemEvents", {
      source: "dashboard",
      eventType: "admin.platform_config.updated",
      detail: "Admin platform configuration updated.",
      createdAt: Date.now(),
    });
    return true;
  },
});

export const seedDefaultConfigs = mutation({
  args: {
    adminSecret: v.string(),
    overwrite: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    requireAdmin(args.adminSecret);
    const overwrite = args.overwrite === true;
    const existing = await readMutationConfigMap(ctx);
    let seeded = 0;
    let skipped = 0;

    const seed = async (key: string, value: unknown) => {
      const result = await seedConfigValue(ctx, existing, key, value, overwrite);
      if (result === "seeded") {
        seeded += 1;
      } else {
        skipped += 1;
      }
    };

    for (const [key, value] of Object.entries(DEFAULT_APP_CONFIG)) {
      await seed(key, value);
    }

    await seed("subscription.trialDays", 14);
    await seed("subscription.graceDays", 3);
    await seed("subscription.dunningEmailEnabled", true);
    await seed("subscription.tenantReportsEnabled", true);
    for (const plan of PLAN_IDS) {
      const defaults = defaultPlanConfig(plan);
      const prefix = `subscription.plan.${plan}.`;
      for (const [key, value] of Object.entries(defaults)) {
        await seed(`${prefix}${key}`, value);
      }
    }

    await ctx.db.insert("systemEvents", {
      source: "dashboard",
      eventType: "admin.default_configs.seeded",
      detail: overwrite
        ? `Admin default configuration seed overwrote ${seeded} values.`
        : `Admin default configuration seed created ${seeded} missing values.`,
      createdAt: Date.now(),
    });

    return { seeded, skipped, overwrite };
  },
});

export const billingOps = query({
  args: {
    adminSecret: v.string(),
  },
  handler: async (ctx, args) => {
    requireAdmin(args.adminSecret);
    const now = Date.now();
    const expiredTrials = await ctx.db
      .query("tenantAccounts")
      .withIndex("by_billingStatus_and_trialEndsAt", (q) => q.eq("billingStatus", "trialing").lte("trialEndsAt", now))
      .take(200);
    const expiredSubscriptions = await ctx.db
      .query("tenantAccounts")
      .withIndex("by_billingStatus_and_subscriptionExpiresAt", (q) => q.eq("billingStatus", "active").lte("subscriptionExpiresAt", now))
      .take(200);
    const recentEvents = await ctx.db.query("subscriptionEvents").withIndex("by_createdAt").order("desc").take(80);
    const recentSubscriptions = await ctx.db.query("tenantSubscriptions").withIndex("by_status_and_currentPeriodEndsAt").take(120);
    return {
      expiredTrials: expiredTrials.length,
      expiredSubscriptions: expiredSubscriptions.length,
      recentEvents,
      statusCounts: recentSubscriptions.reduce<Record<string, number>>((counts, subscription) => {
        counts[subscription.status] = (counts[subscription.status] || 0) + 1;
        return counts;
      }, {}),
    };
  },
});

export const auditFeed = query({
  args: {
    adminSecret: v.string(),
  },
  handler: async (ctx, args) => {
    requireAdmin(args.adminSecret);
    const systemEvents = await ctx.db.query("systemEvents").withIndex("by_createdAt").order("desc").take(100);
    const subscriptionEvents = await ctx.db.query("subscriptionEvents").withIndex("by_createdAt").order("desc").take(60);
    return {
      events: [
        ...systemEvents.map((event) => ({
          id: event._id,
          source: event.source,
          eventType: event.eventType,
          detail: event.detail,
          createdAt: event.createdAt,
        })),
        ...subscriptionEvents.map((event) => ({
          id: event._id,
          source: event.provider,
          eventType: event.eventType,
          detail: event.detail,
          createdAt: event.createdAt,
        })),
      ].sort((a, b) => b.createdAt - a.createdAt).slice(0, 120),
    };
  },
});
