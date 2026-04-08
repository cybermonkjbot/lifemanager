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
    generatedMemesEnabled: v.boolean(),
    generatedMemesAutoSendEnabled: v.boolean(),
    memeThreadCooldownMs: v.number(),
    memeSendProbability: v.number(),
    soulModeEnabled: v.boolean(),
    humorLearningEnabled: v.boolean(),
    statusAutoReplyEnabled: v.boolean(),
    statusReplyRequireFunny: v.boolean(),
    captureGroupMediaEnabled: v.optional(v.boolean()),
    funnyStatusKeywords: v.optional(v.array(v.string())),
    funnyStatusEmojis: v.optional(v.array(v.string())),
    aiFallbackMode: v.union(v.literal("all"), v.literal("azure_only")),
    aiTemperature: v.number(),
    aiMaxOutputTokens: v.number(),
    aiMaxReplyChars: v.number(),
    aiHistoryLineLimit: v.number(),
    aiPrimaryConfidence: v.number(),
    aiFallbackConfidence: v.number(),
    aiReplyPolicy: v.optional(v.string()),
    aiSystemInstruction: v.optional(v.string()),
    activePersonaPackId: v.optional(v.string()),
    qualityGateMode: v.optional(v.union(v.literal("auto_rewrite_once"), v.literal("manual_review"), v.literal("log_only"))),
    qualityGateThreshold: v.optional(v.number()),
    humanDelayMinMs: v.number(),
    humanDelayMaxMs: v.number(),
    humanTypingMinMs: v.number(),
    humanTypingMaxMs: v.number(),
    outboxClaimLimit: v.number(),
    outboxPollMs: v.number(),
    inboundMergeWindowMs: v.number(),
    manualInterventionCooldownMs: v.optional(v.number()),
    inboundConcurrency: v.optional(v.number()),
    outboxSendConcurrency: v.optional(v.number()),
    statusRetentionMs: v.optional(v.number()),
    statusCleanupIntervalMs: v.optional(v.number()),
    statusCleanupBatchLimit: v.optional(v.number()),
    statusContextKeepPerThread: v.optional(v.number()),
    groupContextKeepPerThread: v.optional(v.number()),
    contextCompactionIntervalMs: v.optional(v.number()),
    contextCompactionMaxThreads: v.optional(v.number()),
    contextCompactionMaxDeletes: v.optional(v.number()),
    compactContextGroupJids: v.optional(v.array(v.string())),
    quietHoursEnabled: v.optional(v.boolean()),
    quietHoursStartHour: v.optional(v.number()),
    quietHoursEndHour: v.optional(v.number()),
    sendRateWindowMinutes: v.optional(v.number()),
    sendMaxPerThreadInWindow: v.optional(v.number()),
    sendMaxGlobalInWindow: v.optional(v.number()),
    outreachEnabled: v.boolean(),
    outreachCadenceHours: v.number(),
    outreachMaxContactsPerRun: v.number(),
    outreachContactJids: v.array(v.string()),
    outreachStarterTemplate: v.optional(v.string()),
    statusBuilderEnabled: v.boolean(),
    statusBuilderCadenceHours: v.number(),
    statusBuilderDailyMaxPosts: v.number(),
    statusBuilderTextPostRatio: v.number(),
    statusBuilderReviewRatio: v.optional(v.number()),
    statusBuilderAudienceJids: v.optional(v.array(v.string())),
    statusBuilderAudienceSampleSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const outreachContactJids = [...new Set(args.outreachContactJids.map((item) => item.trim()).filter(Boolean))];
    const statusBuilderAudienceJids = [
      ...new Set((args.statusBuilderAudienceJids || []).map((item) => item.trim()).filter(Boolean)),
    ];
    const funnyStatusKeywords = [...new Set((args.funnyStatusKeywords || []).map((item) => item.trim().toLowerCase()).filter(Boolean))].slice(
      0,
      40,
    );
    const funnyStatusEmojis = [...new Set((args.funnyStatusEmojis || []).map((item) => item.trim()).filter(Boolean))].slice(0, 40);
    const normalized = {
      ignoreGroupsByDefault: args.ignoreGroupsByDefault,
      reactionsEnabled: args.reactionsEnabled,
      stickersEnabled: args.stickersEnabled,
      memesEnabled: args.memesEnabled,
      generatedMemesEnabled: args.generatedMemesEnabled,
      generatedMemesAutoSendEnabled: args.generatedMemesAutoSendEnabled,
      memeThreadCooldownMs: clampInt(args.memeThreadCooldownMs, 5 * 60 * 1000, 7 * 24 * 60 * 60 * 1000),
      memeSendProbability: clamp(args.memeSendProbability, 0, 1),
      soulModeEnabled: args.soulModeEnabled,
      humorLearningEnabled: args.humorLearningEnabled,
      statusAutoReplyEnabled: args.statusAutoReplyEnabled,
      statusReplyRequireFunny: args.statusReplyRequireFunny,
      captureGroupMediaEnabled: args.captureGroupMediaEnabled ?? DEFAULT_APP_CONFIG.captureGroupMediaEnabled,
      funnyStatusKeywords: funnyStatusKeywords.length ? funnyStatusKeywords : DEFAULT_APP_CONFIG.funnyStatusKeywords,
      funnyStatusEmojis: funnyStatusEmojis.length ? funnyStatusEmojis : DEFAULT_APP_CONFIG.funnyStatusEmojis,
      aiFallbackMode: args.aiFallbackMode,
      aiTemperature: clamp(args.aiTemperature, 0, 1.3),
      aiMaxOutputTokens: clampInt(args.aiMaxOutputTokens, 40, 1000),
      aiMaxReplyChars: clampInt(args.aiMaxReplyChars, 60, 1200),
      aiHistoryLineLimit: clampInt(args.aiHistoryLineLimit, 4, 40),
      aiPrimaryConfidence: clamp(args.aiPrimaryConfidence, 0.01, 1),
      aiFallbackConfidence: clamp(args.aiFallbackConfidence, 0.01, 1),
      aiReplyPolicy: args.aiReplyPolicy?.trim() || "",
      aiSystemInstruction: args.aiSystemInstruction?.trim() || "",
      activePersonaPackId: args.activePersonaPackId?.trim() || "",
      qualityGateMode: args.qualityGateMode || DEFAULT_APP_CONFIG.qualityGateMode,
      qualityGateThreshold: clamp(args.qualityGateThreshold ?? DEFAULT_APP_CONFIG.qualityGateThreshold, 0.4, 0.95),
      humanDelayMinMs: clampInt(args.humanDelayMinMs, 500, 180_000),
      humanDelayMaxMs: clampInt(args.humanDelayMaxMs, 500, 240_000),
      humanTypingMinMs: clampInt(args.humanTypingMinMs, 200, 60_000),
      humanTypingMaxMs: clampInt(args.humanTypingMaxMs, 200, 120_000),
      outboxClaimLimit: clampInt(args.outboxClaimLimit, 1, 20),
      outboxPollMs: clampInt(args.outboxPollMs, 500, 60_000),
      inboundMergeWindowMs: clampInt(args.inboundMergeWindowMs, 2_000, 180_000),
      manualInterventionCooldownMs: clampInt(
        args.manualInterventionCooldownMs ?? DEFAULT_APP_CONFIG.manualInterventionCooldownMs,
        0,
        7_200_000,
      ),
      inboundConcurrency: clampInt(args.inboundConcurrency ?? DEFAULT_APP_CONFIG.inboundConcurrency, 1, 16),
      outboxSendConcurrency: clampInt(args.outboxSendConcurrency ?? DEFAULT_APP_CONFIG.outboxSendConcurrency, 1, 16),
      statusRetentionMs: clampInt(
        args.statusRetentionMs ?? DEFAULT_APP_CONFIG.statusRetentionMs,
        5 * 60 * 1000,
        24 * 60 * 60 * 1000,
      ),
      statusCleanupIntervalMs: clampInt(
        args.statusCleanupIntervalMs ?? DEFAULT_APP_CONFIG.statusCleanupIntervalMs,
        5 * 60 * 1000,
        24 * 60 * 60 * 1000,
      ),
      statusCleanupBatchLimit: clampInt(args.statusCleanupBatchLimit ?? DEFAULT_APP_CONFIG.statusCleanupBatchLimit, 20, 800),
      statusContextKeepPerThread: clampInt(
        args.statusContextKeepPerThread ?? DEFAULT_APP_CONFIG.statusContextKeepPerThread,
        8,
        120,
      ),
      groupContextKeepPerThread: clampInt(
        args.groupContextKeepPerThread ?? DEFAULT_APP_CONFIG.groupContextKeepPerThread,
        8,
        120,
      ),
      contextCompactionIntervalMs: clampInt(
        args.contextCompactionIntervalMs ?? DEFAULT_APP_CONFIG.contextCompactionIntervalMs,
        2 * 60 * 1000,
        24 * 60 * 60 * 1000,
      ),
      contextCompactionMaxThreads: clampInt(
        args.contextCompactionMaxThreads ?? DEFAULT_APP_CONFIG.contextCompactionMaxThreads,
        2,
        80,
      ),
      contextCompactionMaxDeletes: clampInt(
        args.contextCompactionMaxDeletes ?? DEFAULT_APP_CONFIG.contextCompactionMaxDeletes,
        20,
        800,
      ),
      compactContextGroupJids: [
        ...new Set((args.compactContextGroupJids || []).map((item) => item.trim()).filter(Boolean)),
      ].slice(0, 80),
      quietHoursEnabled: args.quietHoursEnabled ?? DEFAULT_APP_CONFIG.quietHoursEnabled,
      quietHoursStartHour: clampInt(args.quietHoursStartHour ?? DEFAULT_APP_CONFIG.quietHoursStartHour, 0, 23),
      quietHoursEndHour: clampInt(args.quietHoursEndHour ?? DEFAULT_APP_CONFIG.quietHoursEndHour, 0, 23),
      sendRateWindowMinutes: clampInt(args.sendRateWindowMinutes ?? DEFAULT_APP_CONFIG.sendRateWindowMinutes, 5, 24 * 60),
      sendMaxPerThreadInWindow: clampInt(
        args.sendMaxPerThreadInWindow ?? DEFAULT_APP_CONFIG.sendMaxPerThreadInWindow,
        1,
        100,
      ),
      sendMaxGlobalInWindow: clampInt(args.sendMaxGlobalInWindow ?? DEFAULT_APP_CONFIG.sendMaxGlobalInWindow, 1, 1000),
      outreachEnabled: args.outreachEnabled,
      outreachCadenceHours: clampInt(args.outreachCadenceHours, 6, 24 * 14),
      outreachMaxContactsPerRun: clampInt(args.outreachMaxContactsPerRun, 1, 25),
      outreachContactJids,
      outreachStarterTemplate: args.outreachStarterTemplate?.trim() || DEFAULT_APP_CONFIG.outreachStarterTemplate,
      statusBuilderEnabled: args.statusBuilderEnabled,
      statusBuilderCadenceHours: clampInt(args.statusBuilderCadenceHours, 1, 24 * 7),
      statusBuilderDailyMaxPosts: clampInt(args.statusBuilderDailyMaxPosts, 1, 24),
      statusBuilderTextPostRatio: clamp(args.statusBuilderTextPostRatio, 0, 1),
      statusBuilderReviewRatio: clamp(
        args.statusBuilderReviewRatio ?? DEFAULT_APP_CONFIG.statusBuilderReviewRatio,
        0,
        1,
      ),
      statusBuilderAudienceJids,
      statusBuilderAudienceSampleSize: clampInt(
        args.statusBuilderAudienceSampleSize ?? DEFAULT_APP_CONFIG.statusBuilderAudienceSampleSize,
        10,
        256,
      ),
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
    await setConfigValue(ctx, "generatedMemesEnabled", normalized.generatedMemesEnabled ? "true" : "false");
    await setConfigValue(ctx, "generatedMemesAutoSendEnabled", normalized.generatedMemesAutoSendEnabled ? "true" : "false");
    await setConfigValue(ctx, "memeThreadCooldownMs", String(normalized.memeThreadCooldownMs));
    await setConfigValue(ctx, "memeSendProbability", String(normalized.memeSendProbability));
    await setConfigValue(ctx, "soulModeEnabled", normalized.soulModeEnabled ? "true" : "false");
    await setConfigValue(ctx, "humorLearningEnabled", normalized.humorLearningEnabled ? "true" : "false");
    await setConfigValue(ctx, "statusAutoReplyEnabled", normalized.statusAutoReplyEnabled ? "true" : "false");
    await setConfigValue(ctx, "statusReplyRequireFunny", normalized.statusReplyRequireFunny ? "true" : "false");
    await setConfigValue(ctx, "captureGroupMediaEnabled", normalized.captureGroupMediaEnabled ? "true" : "false");
    await setConfigValue(ctx, "funnyStatusKeywords", normalized.funnyStatusKeywords.join("\n"));
    await setConfigValue(ctx, "funnyStatusEmojis", normalized.funnyStatusEmojis.join("\n"));
    await setConfigValue(ctx, "aiFallbackMode", normalized.aiFallbackMode);
    await setConfigValue(ctx, "aiTemperature", String(normalized.aiTemperature));
    await setConfigValue(ctx, "aiMaxOutputTokens", String(normalized.aiMaxOutputTokens));
    await setConfigValue(ctx, "aiMaxReplyChars", String(normalized.aiMaxReplyChars));
    await setConfigValue(ctx, "aiHistoryLineLimit", String(normalized.aiHistoryLineLimit));
    await setConfigValue(ctx, "aiPrimaryConfidence", String(normalized.aiPrimaryConfidence));
    await setConfigValue(ctx, "aiFallbackConfidence", String(normalized.aiFallbackConfidence));
    await setConfigValue(ctx, "aiReplyPolicy", normalized.aiReplyPolicy);
    await setConfigValue(ctx, "aiSystemInstruction", normalized.aiSystemInstruction);
    await setConfigValue(ctx, "activePersonaPackId", normalized.activePersonaPackId);
    await setConfigValue(ctx, "qualityGateMode", normalized.qualityGateMode);
    await setConfigValue(ctx, "qualityGateThreshold", String(normalized.qualityGateThreshold));
    await setConfigValue(ctx, "humanDelayMinMs", String(normalized.humanDelayMinMs));
    await setConfigValue(ctx, "humanDelayMaxMs", String(normalized.humanDelayMaxMs));
    await setConfigValue(ctx, "humanTypingMinMs", String(normalized.humanTypingMinMs));
    await setConfigValue(ctx, "humanTypingMaxMs", String(normalized.humanTypingMaxMs));
    await setConfigValue(ctx, "outboxClaimLimit", String(normalized.outboxClaimLimit));
    await setConfigValue(ctx, "outboxPollMs", String(normalized.outboxPollMs));
    await setConfigValue(ctx, "inboundMergeWindowMs", String(normalized.inboundMergeWindowMs));
    await setConfigValue(ctx, "manualInterventionCooldownMs", String(normalized.manualInterventionCooldownMs));
    await setConfigValue(ctx, "inboundConcurrency", String(normalized.inboundConcurrency));
    await setConfigValue(ctx, "outboxSendConcurrency", String(normalized.outboxSendConcurrency));
    await setConfigValue(ctx, "statusRetentionMs", String(normalized.statusRetentionMs));
    await setConfigValue(ctx, "statusCleanupIntervalMs", String(normalized.statusCleanupIntervalMs));
    await setConfigValue(ctx, "statusCleanupBatchLimit", String(normalized.statusCleanupBatchLimit));
    await setConfigValue(ctx, "statusContextKeepPerThread", String(normalized.statusContextKeepPerThread));
    await setConfigValue(ctx, "groupContextKeepPerThread", String(normalized.groupContextKeepPerThread));
    await setConfigValue(ctx, "contextCompactionIntervalMs", String(normalized.contextCompactionIntervalMs));
    await setConfigValue(ctx, "contextCompactionMaxThreads", String(normalized.contextCompactionMaxThreads));
    await setConfigValue(ctx, "contextCompactionMaxDeletes", String(normalized.contextCompactionMaxDeletes));
    await setConfigValue(ctx, "compactContextGroupJids", normalized.compactContextGroupJids.join("\n"));
    await setConfigValue(ctx, "quietHoursEnabled", normalized.quietHoursEnabled ? "true" : "false");
    await setConfigValue(ctx, "quietHoursStartHour", String(normalized.quietHoursStartHour));
    await setConfigValue(ctx, "quietHoursEndHour", String(normalized.quietHoursEndHour));
    await setConfigValue(ctx, "sendRateWindowMinutes", String(normalized.sendRateWindowMinutes));
    await setConfigValue(ctx, "sendMaxPerThreadInWindow", String(normalized.sendMaxPerThreadInWindow));
    await setConfigValue(ctx, "sendMaxGlobalInWindow", String(normalized.sendMaxGlobalInWindow));
    await setConfigValue(ctx, "outreachEnabled", normalized.outreachEnabled ? "true" : "false");
    await setConfigValue(ctx, "outreachCadenceHours", String(normalized.outreachCadenceHours));
    await setConfigValue(ctx, "outreachMaxContactsPerRun", String(normalized.outreachMaxContactsPerRun));
    await setConfigValue(ctx, "outreachContactJids", normalized.outreachContactJids.join("\n"));
    await setConfigValue(ctx, "outreachStarterTemplate", normalized.outreachStarterTemplate);
    await setConfigValue(ctx, "statusBuilderEnabled", normalized.statusBuilderEnabled ? "true" : "false");
    await setConfigValue(ctx, "statusBuilderCadenceHours", String(normalized.statusBuilderCadenceHours));
    await setConfigValue(ctx, "statusBuilderDailyMaxPosts", String(normalized.statusBuilderDailyMaxPosts));
    await setConfigValue(ctx, "statusBuilderTextPostRatio", String(normalized.statusBuilderTextPostRatio));
    await setConfigValue(ctx, "statusBuilderReviewRatio", String(normalized.statusBuilderReviewRatio));
    await setConfigValue(ctx, "statusBuilderAudienceJids", normalized.statusBuilderAudienceJids.join("\n"));
    await setConfigValue(ctx, "statusBuilderAudienceSampleSize", String(normalized.statusBuilderAudienceSampleSize));

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
