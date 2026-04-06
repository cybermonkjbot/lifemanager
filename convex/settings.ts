import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { DEFAULT_APP_CONFIG, getConfig, setConfigValue } from "./lib/config";

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max));
}

function clampInt(value: number, min: number, max: number) {
  return Math.round(clamp(value, min, max));
}

export const get = query({
  args: {},
  handler: async (ctx) => {
    return await getConfig(ctx);
  },
});

export const save = mutation({
  args: {
    ignoreGroupsByDefault: v.boolean(),
    reactionsEnabled: v.boolean(),
    stickersEnabled: v.boolean(),
    memesEnabled: v.boolean(),
    aiFallbackMode: v.union(v.literal("all"), v.literal("azure_only")),
    aiTemperature: v.number(),
    aiMaxOutputTokens: v.number(),
    aiMaxReplyChars: v.number(),
    aiHistoryLineLimit: v.number(),
    aiPrimaryConfidence: v.number(),
    aiFallbackConfidence: v.number(),
    aiReplyPolicy: v.optional(v.string()),
    aiSystemInstruction: v.optional(v.string()),
    humanDelayMinMs: v.number(),
    humanDelayMaxMs: v.number(),
    humanTypingMinMs: v.number(),
    humanTypingMaxMs: v.number(),
    outboxClaimLimit: v.number(),
    outboxPollMs: v.number(),
    outreachEnabled: v.boolean(),
    outreachCadenceHours: v.number(),
    outreachMaxContactsPerRun: v.number(),
    outreachContactJids: v.array(v.string()),
    outreachStarterTemplate: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const outreachContactJids = [...new Set(args.outreachContactJids.map((item) => item.trim()).filter(Boolean))];
    const normalized = {
      ignoreGroupsByDefault: args.ignoreGroupsByDefault,
      reactionsEnabled: args.reactionsEnabled,
      stickersEnabled: args.stickersEnabled,
      memesEnabled: args.memesEnabled,
      aiFallbackMode: args.aiFallbackMode,
      aiTemperature: clamp(args.aiTemperature, 0, 1.3),
      aiMaxOutputTokens: clampInt(args.aiMaxOutputTokens, 40, 1000),
      aiMaxReplyChars: clampInt(args.aiMaxReplyChars, 60, 1200),
      aiHistoryLineLimit: clampInt(args.aiHistoryLineLimit, 4, 40),
      aiPrimaryConfidence: clamp(args.aiPrimaryConfidence, 0.01, 1),
      aiFallbackConfidence: clamp(args.aiFallbackConfidence, 0.01, 1),
      aiReplyPolicy: args.aiReplyPolicy?.trim() || "",
      aiSystemInstruction: args.aiSystemInstruction?.trim() || "",
      humanDelayMinMs: clampInt(args.humanDelayMinMs, 500, 180_000),
      humanDelayMaxMs: clampInt(args.humanDelayMaxMs, 500, 240_000),
      humanTypingMinMs: clampInt(args.humanTypingMinMs, 200, 60_000),
      humanTypingMaxMs: clampInt(args.humanTypingMaxMs, 200, 120_000),
      outboxClaimLimit: clampInt(args.outboxClaimLimit, 1, 20),
      outboxPollMs: clampInt(args.outboxPollMs, 500, 60_000),
      outreachEnabled: args.outreachEnabled,
      outreachCadenceHours: clampInt(args.outreachCadenceHours, 6, 24 * 14),
      outreachMaxContactsPerRun: clampInt(args.outreachMaxContactsPerRun, 1, 25),
      outreachContactJids,
      outreachStarterTemplate: args.outreachStarterTemplate?.trim() || DEFAULT_APP_CONFIG.outreachStarterTemplate,
    };

    // Keep ranges valid after clamping.
    if (normalized.humanDelayMinMs > normalized.humanDelayMaxMs) {
      const swapped = normalized.humanDelayMinMs;
      normalized.humanDelayMinMs = normalized.humanDelayMaxMs;
      normalized.humanDelayMaxMs = swapped;
    }
    if (normalized.humanTypingMinMs > normalized.humanTypingMaxMs) {
      const swapped = normalized.humanTypingMinMs;
      normalized.humanTypingMinMs = normalized.humanTypingMaxMs;
      normalized.humanTypingMaxMs = swapped;
    }

    await setConfigValue(ctx, "ignoreGroupsByDefault", normalized.ignoreGroupsByDefault ? "true" : "false");
    await setConfigValue(ctx, "reactionsEnabled", normalized.reactionsEnabled ? "true" : "false");
    await setConfigValue(ctx, "stickersEnabled", normalized.stickersEnabled ? "true" : "false");
    await setConfigValue(ctx, "memesEnabled", normalized.memesEnabled ? "true" : "false");
    await setConfigValue(ctx, "aiFallbackMode", normalized.aiFallbackMode);
    await setConfigValue(ctx, "aiTemperature", String(normalized.aiTemperature));
    await setConfigValue(ctx, "aiMaxOutputTokens", String(normalized.aiMaxOutputTokens));
    await setConfigValue(ctx, "aiMaxReplyChars", String(normalized.aiMaxReplyChars));
    await setConfigValue(ctx, "aiHistoryLineLimit", String(normalized.aiHistoryLineLimit));
    await setConfigValue(ctx, "aiPrimaryConfidence", String(normalized.aiPrimaryConfidence));
    await setConfigValue(ctx, "aiFallbackConfidence", String(normalized.aiFallbackConfidence));
    await setConfigValue(ctx, "aiReplyPolicy", normalized.aiReplyPolicy);
    await setConfigValue(ctx, "aiSystemInstruction", normalized.aiSystemInstruction);
    await setConfigValue(ctx, "humanDelayMinMs", String(normalized.humanDelayMinMs));
    await setConfigValue(ctx, "humanDelayMaxMs", String(normalized.humanDelayMaxMs));
    await setConfigValue(ctx, "humanTypingMinMs", String(normalized.humanTypingMinMs));
    await setConfigValue(ctx, "humanTypingMaxMs", String(normalized.humanTypingMaxMs));
    await setConfigValue(ctx, "outboxClaimLimit", String(normalized.outboxClaimLimit));
    await setConfigValue(ctx, "outboxPollMs", String(normalized.outboxPollMs));
    await setConfigValue(ctx, "outreachEnabled", normalized.outreachEnabled ? "true" : "false");
    await setConfigValue(ctx, "outreachCadenceHours", String(normalized.outreachCadenceHours));
    await setConfigValue(ctx, "outreachMaxContactsPerRun", String(normalized.outreachMaxContactsPerRun));
    await setConfigValue(ctx, "outreachContactJids", normalized.outreachContactJids.join("\n"));
    await setConfigValue(ctx, "outreachStarterTemplate", normalized.outreachStarterTemplate);

    await ctx.db.insert("systemEvents", {
      source: "dashboard",
      eventType: "settings.updated",
      detail: "Runtime settings updated from Settings page.",
      createdAt: Date.now(),
    });

    return normalized;
  },
});

export const defaults = query({
  args: {},
  handler: async () => {
    return DEFAULT_APP_CONFIG;
  },
});
