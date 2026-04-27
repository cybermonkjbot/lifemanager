import { v } from "convex/values";
import { internalQuery, mutation, query } from "./_generated/server";

const ENV_FALLBACKS: Record<string, string[]> = {
  "azure.ai.endpoint": ["AZURE_AI_ENDPOINT", "AZURE_OPENAI_ENDPOINT"],
  "azure.ai.apiKey": ["AZURE_AI_API_KEY", "AZURE_OPENAI_API_KEY", "OPENAI_API_KEY"],
  "azure.ai.model": ["AZURE_AI_MODEL", "AZURE_OPENAI_MODEL"],
  "azure.ai.apiStyle": ["AZURE_AI_API_STYLE"],
  "azure.image.endpoint": ["AZURE_AI_IMAGE_ENDPOINT"],
  "azure.image.apiKey": ["AZURE_AI_IMAGE_API_KEY"],
  "azure.image.model": ["AZURE_AI_IMAGE_MODEL", "AZURE_OPENAI_IMAGE_MODEL"],
  "azure.video.endpoint": ["AZURE_AI_VIDEO_ENDPOINT", "AZURE_OPENAI_VIDEO_ENDPOINT"],
  "azure.video.apiKey": ["AZURE_AI_VIDEO_API_KEY", "AZURE_OPENAI_VIDEO_API_KEY"],
  "azure.video.model": ["AZURE_AI_VIDEO_MODEL", "AZURE_OPENAI_VIDEO_MODEL"],
  "gateway.apiKey": ["SLM_API_GATEWAY_KEY"],
  "flutterwave.secretKey": ["FLUTTERWAVE_SECRET_KEY", "FLW_SECRET_KEY"],
  "flutterwave.webhookHash": ["FLUTTERWAVE_WEBHOOK_HASH", "FLW_WEBHOOK_HASH"],
  "flutterwave.personalPlanId": ["FLUTTERWAVE_PERSONAL_PLAN_ID", "FLW_PERSONAL_PLAN_ID"],
  "flutterwave.businessPlanId": ["FLUTTERWAVE_BUSINESS_PLAN_ID", "FLW_BUSINESS_PLAN_ID"],
  "billing.personalAmount": ["ODOGWU_PERSONAL_PLAN_AMOUNT", "SLM_PERSONAL_PLAN_AMOUNT"],
  "billing.businessAmount": ["ODOGWU_BUSINESS_PLAN_AMOUNT", "SLM_BUSINESS_PLAN_AMOUNT"],
  "billing.currency": ["ODOGWU_BILLING_CURRENCY", "SLM_BILLING_CURRENCY"],
  "billing.redirectBaseUrl": ["ODOGWU_PUBLIC_APP_URL", "NEXT_PUBLIC_APP_URL", "VERCEL_URL"],
  "resend.apiKey": ["RESEND_API_KEY"],
  "resend.fromEmail": ["RESEND_FROM_EMAIL", "ODOGWU_RESEND_FROM_EMAIL"],
};

function readAdminSecret() {
  return process.env.ODOGWU_CONVEX_ADMIN_SECRET || process.env.ODOGWU_ADMIN_SECRET || process.env.SLM_ADMIN_SECRET || "";
}

function requireAdmin(adminSecret: string) {
  const expected = readAdminSecret();
  if (!expected || adminSecret !== expected) {
    throw new Error("Unauthorized.");
  }
}

function normalizeKey(key: string) {
  return key.trim();
}

function hasConvexEnvFallback(key: string) {
  return (ENV_FALLBACKS[key] || []).some((envName) => Boolean((process.env[envName] || "").trim()));
}

export const list = query({
  args: {
    adminSecret: v.string(),
  },
  handler: async (ctx, args) => {
    requireAdmin(args.adminSecret);
    const rows = await ctx.db.query("managedSecrets").take(200);
    return rows
      .map((row) => ({
        key: row.key,
        valuePreview: row.valuePreview,
        updatedAt: row.updatedAt,
        updatedBy: row.updatedBy,
        envFallbackConfigured: hasConvexEnvFallback(row.key),
      }))
      .sort((a, b) => a.key.localeCompare(b.key));
  },
});

export const getEncrypted = query({
  args: {
    adminSecret: v.string(),
    key: v.string(),
  },
  handler: async (ctx, args) => {
    requireAdmin(args.adminSecret);
    const key = normalizeKey(args.key);
    if (!key) {
      return null;
    }
    const row = await ctx.db
      .query("managedSecrets")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    if (!row) {
      return null;
    }
    return {
      key: row.key,
      algorithm: row.algorithm,
      iv: row.iv,
      tag: row.tag,
      encryptedValue: row.encryptedValue,
    };
  },
});

export const getEncryptedInternal = internalQuery({
  args: {
    key: v.string(),
  },
  handler: async (ctx, args) => {
    const key = normalizeKey(args.key);
    if (!key) {
      return null;
    }
    const row = await ctx.db
      .query("managedSecrets")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    if (!row) {
      return null;
    }
    return {
      key: row.key,
      algorithm: row.algorithm,
      iv: row.iv,
      tag: row.tag,
      encryptedValue: row.encryptedValue,
    };
  },
});

export const upsert = mutation({
  args: {
    adminSecret: v.string(),
    key: v.string(),
    algorithm: v.string(),
    iv: v.string(),
    tag: v.string(),
    encryptedValue: v.string(),
    valuePreview: v.string(),
    updatedBy: v.string(),
  },
  handler: async (ctx, args) => {
    requireAdmin(args.adminSecret);
    const key = normalizeKey(args.key);
    if (!key) {
      throw new Error("Secret key is required.");
    }
    const now = Date.now();
    const existing = await ctx.db
      .query("managedSecrets")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    const next = {
      key,
      algorithm: args.algorithm,
      iv: args.iv,
      tag: args.tag,
      encryptedValue: args.encryptedValue,
      valuePreview: args.valuePreview,
      updatedAt: now,
      updatedBy: args.updatedBy,
    };
    if (existing) {
      await ctx.db.patch(existing._id, next);
      return existing._id;
    }
    return await ctx.db.insert("managedSecrets", next);
  },
});

export const remove = mutation({
  args: {
    adminSecret: v.string(),
    key: v.string(),
  },
  handler: async (ctx, args) => {
    requireAdmin(args.adminSecret);
    const key = normalizeKey(args.key);
    const existing = await ctx.db
      .query("managedSecrets")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    if (!existing) {
      return false;
    }
    await ctx.db.delete(existing._id);
    return true;
  },
});
