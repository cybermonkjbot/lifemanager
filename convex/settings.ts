import { v } from "convex/values";
import { type MutationCtx, mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { type AiDeterministicMode, DEFAULT_APP_CONFIG, getConfig, setConfigValue } from "./lib/config";
import { classifyThreadKind } from "./lib/threadEligibility";
import { resolveTenantForMutation, resolveTenantForQuery } from "./lib/tenantSecurity";
import { assertTenantBillingActive } from "./lib/billingAccess";
import { syncStorefrontProfileFromConfig } from "./lib/storefrontProfile";

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max));
}

function clampInt(value: number, min: number, max: number) {
  return Math.round(clamp(value, min, max));
}

function resolveOnboardingReplyPacePreset(preset: "measured" | "deliberate" | "unhurried") {
  if (preset === "measured") {
    return {
      humanDelayMinMs: 12_000,
      humanDelayMaxMs: 45_000,
      humanTypingMinMs: 2_000,
      humanTypingMaxMs: 6_000,
    };
  }

  if (preset === "unhurried") {
    return {
      humanDelayMinMs: 45_000,
      humanDelayMaxMs: 150_000,
      humanTypingMinMs: 6_000,
      humanTypingMaxMs: 18_000,
    };
  }

  return {
    humanDelayMinMs: 22_000,
    humanDelayMaxMs: 95_000,
    humanTypingMinMs: 4_000,
    humanTypingMaxMs: 14_000,
  };
}

const ALLOWED_AI_DETERMINISTIC_MODE_SET = new Set<AiDeterministicMode>([
  "hard_stop",
  "anti_beggi_beggi",
  "anti_sales_pitch",
  "pause",
  "loop",
  "wrap_up",
]);
const ROMANTIC_PARTNER_PROFILE_SLUG = "relationship";
const ROMANTIC_PARTNER_DEFAULT_INTENSITY = 0.78;
const tenantScopeArgs = {
  tenantId: v.optional(v.id("tenantAccounts")),
  connectorTokenHash: v.optional(v.string()),
};

async function resolveTenantForOptionalMutation(
  ctx: MutationCtx,
  args: { tenantId?: Id<"tenantAccounts">; connectorTokenHash?: string },
) {
  if (args.connectorTokenHash) {
    return await resolveTenantForMutation(ctx, args);
  }
  await assertTenantBillingActive(ctx, args.tenantId);
  return args.tenantId;
}

async function setScopedConfigValue(ctx: MutationCtx, tenantId: Id<"tenantAccounts"> | undefined, key: string, value: string) {
  return await setConfigValue(ctx, key, value, tenantId);
}

function isAiDeterministicMode(value: string): value is AiDeterministicMode {
  return ALLOWED_AI_DETERMINISTIC_MODE_SET.has(value as AiDeterministicMode);
}

function isDirectMessageThread(thread: {
  provider?: "whatsapp" | "instagram" | "imessage" | "telegram";
  jid: string;
  isGroup: boolean;
  threadKind?: "direct" | "group" | "broadcast_or_system";
}) {
  const provider = thread.provider || "whatsapp";
  const kind = thread.threadKind || classifyThreadKind({ jid: thread.jid, isGroupHint: thread.isGroup, provider });
  return kind === "direct";
}

async function upsertRomanticPartnerMappings(
  ctx: MutationCtx,
  romanticPartnerJids: string[],
  tenantId?: Id<"tenantAccounts">,
) {
  if (romanticPartnerJids.length === 0) {
    return { matchedThreads: 0 };
  }

  const now = Date.now();
  let matchedThreads = 0;

  for (const jid of romanticPartnerJids) {
    const threadByJid = tenantId
      ? await ctx.db
          .query("threads")
          .withIndex("by_tenantId_and_jid", (q) => q.eq("tenantId", tenantId).eq("jid", jid))
          .first()
      : await ctx.db
          .query("threads")
          .withIndex("by_jid", (q) => q.eq("jid", jid))
          .first();

    if (!threadByJid || !isDirectMessageThread(threadByJid)) {
      continue;
    }

    const personalitySetting = await ctx.db
      .query("threadPersonalitySettings")
      .withIndex("by_thread", (q) => q.eq("threadId", threadByJid._id))
      .first();
    if (!personalitySetting) {
      await ctx.db.insert("threadPersonalitySettings", {
        tenantId: threadByJid.tenantId || tenantId,
        threadId: threadByJid._id,
        profileSlug: ROMANTIC_PARTNER_PROFILE_SLUG,
        intensity: ROMANTIC_PARTNER_DEFAULT_INTENSITY,
        memePolicyMode: "auto",
        createdAt: now,
        updatedAt: now,
      });
    } else if (personalitySetting.profileSlug !== ROMANTIC_PARTNER_PROFILE_SLUG) {
      await ctx.db.patch(personalitySetting._id, {
        profileSlug: ROMANTIC_PARTNER_PROFILE_SLUG,
        updatedAt: now,
      });
    }

    const backlogState = await ctx.db
      .query("backlogThreadState")
      .withIndex("by_threadId", (q) => q.eq("threadId", threadByJid._id))
      .first();
    if (!backlogState) {
      await ctx.db.insert("backlogThreadState", {
        threadId: threadByJid._id,
        importanceOverride: undefined,
        relationshipOverride: "relationship",
        snoozedUntil: undefined,
        snoozeReason: undefined,
        unresolvedCount: 0,
        pendingSince: undefined,
        latestUnresolvedAt: undefined,
        latestUnresolvedMessageId: undefined,
        latestUnresolvedText: undefined,
        lastInboundAt: undefined,
        lastOutboundAt: undefined,
        relationship: "relationship",
        importance: "low",
        recommendation: "answer",
        score: 0,
        lastActionAt: undefined,
        lastActionType: undefined,
        lastEvaluatedAt: now,
        createdAt: now,
        updatedAt: now,
      });
    } else if (
      backlogState.relationshipOverride !== "relationship" ||
      backlogState.relationship !== "relationship"
    ) {
      await ctx.db.patch(backlogState._id, {
        relationshipOverride: "relationship",
        relationship: "relationship",
        updatedAt: now,
      });
    }

    matchedThreads += 1;
  }

  return { matchedThreads };
}

export const get = query({
  args: tenantScopeArgs,
  handler: async (ctx, args) => {
    const tenantId = await resolveTenantForQuery(ctx, args);
    return await getConfig(ctx, tenantId);
  },
});

export const saveOnboardingPreset = mutation({
  args: {
    ...tenantScopeArgs,
    productUse: v.optional(v.union(v.literal("personal"), v.literal("business"))),
    autonomyMode: v.union(v.literal("review_first"), v.literal("autopilot")),
    replyPace: v.union(v.literal("measured"), v.literal("deliberate"), v.literal("unhurried")),
    quietHoursEnabled: v.boolean(),
    quietHoursStartHour: v.number(),
    quietHoursEndHour: v.number(),
    memesEnabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    const tenantId = await resolveTenantForOptionalMutation(ctx, args);
    const pace = resolveOnboardingReplyPacePreset(args.replyPace);
    const quietHoursStartHour = clampInt(args.quietHoursStartHour, 0, 23);
    const quietHoursEndHour = clampInt(args.quietHoursEndHour, 0, 23);

    await setScopedConfigValue(ctx, tenantId, "productUse", args.productUse || "personal");
    await setScopedConfigValue(ctx, tenantId, "autonomyPaused", args.autonomyMode === "review_first" ? "true" : "false");
    await setScopedConfigValue(ctx, tenantId, "humanDelayMinMs", String(pace.humanDelayMinMs));
    await setScopedConfigValue(ctx, tenantId, "humanDelayMaxMs", String(pace.humanDelayMaxMs));
    await setScopedConfigValue(ctx, tenantId, "humanTypingMinMs", String(pace.humanTypingMinMs));
    await setScopedConfigValue(ctx, tenantId, "humanTypingMaxMs", String(pace.humanTypingMaxMs));
    await setScopedConfigValue(ctx, tenantId, "quietHoursEnabled", args.quietHoursEnabled ? "true" : "false");
    await setScopedConfigValue(ctx, tenantId, "quietHoursStartHour", String(quietHoursStartHour));
    await setScopedConfigValue(ctx, tenantId, "quietHoursEndHour", String(quietHoursEndHour));
    await setScopedConfigValue(ctx, tenantId, "memesEnabled", args.memesEnabled ? "true" : "false");
    await ctx.db.insert("systemEvents", {
      tenantId,
      source: "dashboard",
      eventType: "setup.onboarding_preferences.saved",
      detail: `mode=${args.autonomyMode} pace=${args.replyPace} quiet_hours=${args.quietHoursEnabled ? `${quietHoursStartHour}-${quietHoursEndHour}` : "off"} memes=${args.memesEnabled ? "on" : "off"}`,
      createdAt: Date.now(),
    });

    return await getConfig(ctx, tenantId);
  },
});

export const setStatusBuilderEnabled = mutation({
  args: {
    ...tenantScopeArgs,
    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    const tenantId = await resolveTenantForOptionalMutation(ctx, args);
    await setScopedConfigValue(ctx, tenantId, "statusBuilderEnabled", args.enabled ? "true" : "false");
    await ctx.db.insert("systemEvents", {
      tenantId,
      source: "dashboard",
      eventType: args.enabled ? "status_builder.enabled" : "status_builder.disabled",
      detail: `Auto status posting ${args.enabled ? "enabled" : "disabled"} from Status page.`,
      createdAt: Date.now(),
    });
    return args.enabled;
  },
});

export const save = mutation({
  args: {
    ...tenantScopeArgs,
    productUse: v.optional(v.union(v.literal("personal"), v.literal("business"))),
    businessBrandName: v.optional(v.string()),
    businessBrandVoice: v.optional(v.string()),
    businessOfferSummary: v.optional(v.string()),
    storefrontEnabled: v.optional(v.boolean()),
    storefrontSlug: v.optional(v.string()),
    storefrontFeeBps: v.optional(v.number()),
    liveChatEnabled: v.optional(v.boolean()),
    liveChatWelcomeMessage: v.optional(v.string()),
    ignoreGroupsByDefault: v.boolean(),
    reactionsEnabled: v.boolean(),
    stickersEnabled: v.boolean(),
    memesEnabled: v.boolean(),
    generatedMemesEnabled: v.boolean(),
    generatedMemesAutoSendEnabled: v.boolean(),
    memeThreadCooldownMs: v.number(),
    memeSendProbability: v.number(),
    soulModeEnabled: v.boolean(),
    // Compatibility: some clients still send this key in save payloads.
    autonomyPaused: v.optional(v.boolean()),
    humorLearningEnabled: v.boolean(),
    selfRoastModeEnabled: v.boolean(),
    statusAutoReplyEnabled: v.boolean(),
    statusReplyRequireFunny: v.boolean(),
    captureGroupMediaEnabled: v.optional(v.boolean()),
    funnyStatusKeywords: v.optional(v.array(v.string())),
    funnyStatusEmojis: v.optional(v.array(v.string())),
    aiFallbackMode: v.union(v.literal("all"), v.literal("azure_only")),
    aiModelFirstEnabled: v.optional(v.boolean()),
    aiDeterministicModes: v.optional(v.array(v.string())),
    aiAckRoutingEnabled: v.optional(v.boolean()),
    aiTemperature: v.number(),
    aiMaxOutputTokens: v.number(),
    aiMaxReplyChars: v.number(),
    aiHistoryLineLimit: v.number(),
    aiPrimaryConfidence: v.number(),
    aiFallbackConfidence: v.number(),
    aiReplyPolicy: v.optional(v.string()),
    aiSystemInstruction: v.optional(v.string()),
    activePersonaPackId: v.optional(v.string()),
    activePersonaPackIdsByProfile: v.optional(v.record(v.string(), v.string())),
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
    autoMarkReadEnabled: v.optional(v.boolean()),
    autoMarkReadGroups: v.optional(v.boolean()),
    autoMarkReadStatus: v.optional(v.boolean()),
    presenceSubscribeEnabled: v.optional(v.boolean()),
    chatModifyQuietHoursEnabled: v.optional(v.boolean()),
    aboutAutomationEnabled: v.optional(v.boolean()),
    aboutAutomationIntervalMinutes: v.optional(v.number()),
    aboutAutomationTemplate: v.optional(v.string()),
    sendRateWindowMinutes: v.optional(v.number()),
    sendMaxPerThreadInWindow: v.optional(v.number()),
    sendMaxGlobalInWindow: v.optional(v.number()),
    voiceNotesAutoEnabled: v.optional(v.boolean()),
    voiceNotesAutoProbability: v.optional(v.number()),
    voiceNotesAutoMaxPerThreadPerDay: v.optional(v.number()),
    voiceNotesAutoNeedKeywords: v.optional(v.array(v.string())),
    romanticPartnerJids: v.optional(v.array(v.string())),
    romanticMorningEnabled: v.optional(v.boolean()),
    romanticMorningStartHour: v.optional(v.number()),
    romanticMorningEndHour: v.optional(v.number()),
    romanticMorningLeadRatio: v.optional(v.number()),
    romanticMorningCollisionCooldownHours: v.optional(v.number()),
    romanticMorningMaxPerThreadPerDay: v.optional(v.number()),
    outreachEnabled: v.boolean(),
    outreachCadenceHours: v.number(),
    outreachMaxContactsPerRun: v.number(),
    outreachContactJids: v.array(v.string()),
    outreachStarterTemplate: v.optional(v.string()),
    conversationIntelligenceEnabled: v.optional(v.boolean()),
    checkInRecencyTargetDays: v.optional(v.number()),
    topicDyingAckStreakThreshold: v.optional(v.number()),
    topicLaneMaxActive: v.optional(v.number()),
    pivotReplyEnabled: v.optional(v.boolean()),
    antiDwellingEnabled: v.optional(v.boolean()),
    antiDwellingEndgameCloseCooldownMinutes: v.optional(v.number()),
    antiDwellingTopicTurnSoftLimit: v.optional(v.number()),
    antiDwellingTopicTurnHardLimit: v.optional(v.number()),
    topicLeadPivotEnabled: v.optional(v.boolean()),
    topicLeadPivotMinVibeScore: v.optional(v.number()),
    topicLeadPivotCooldownMinutes: v.optional(v.number()),
    statusBuilderEnabled: v.boolean(),
    statusBuilderCadenceHours: v.number(),
    statusBuilderDailyMaxPosts: v.number(),
    statusBuilderTextPostRatio: v.number(),
    statusBuilderReviewRatio: v.optional(v.number()),
    statusPostAudienceMode: v.optional(v.union(v.literal("whatsapp_privacy"), v.literal("manual_allowlist"))),
    statusBuilderAudienceJids: v.optional(v.array(v.string())),
    statusBuilderAudienceSampleSize: v.optional(v.number()),
    instagramDmDelayMinMs: v.optional(v.number()),
    instagramDmDelayMaxMs: v.optional(v.number()),
    instagramTypingMinMs: v.optional(v.number()),
    instagramTypingMaxMs: v.optional(v.number()),
    instagramSendRateWindowMinutes: v.optional(v.number()),
    instagramSendMaxPerThreadInWindow: v.optional(v.number()),
    instagramSendMaxGlobalInWindow: v.optional(v.number()),
    instagramStoryCadenceHours: v.optional(v.number()),
    instagramStoryDailyMaxPosts: v.optional(v.number()),
    selfChatOpenClawEnabled: v.optional(v.boolean()),
    selfChatOpenClawCliPath: v.optional(v.string()),
    selfChatOpenClawAgentId: v.optional(v.string()),
    selfChatOpenClawTimeoutMs: v.optional(v.number()),
    selfChatCodexEnabled: v.optional(v.boolean()),
    selfChatCodexCliPath: v.optional(v.string()),
    selfChatCodexModel: v.optional(v.string()),
    selfChatCodexSandbox: v.optional(v.union(v.literal("read-only"), v.literal("workspace-write"), v.literal("danger-full-access"))),
  },
  handler: async (ctx, args) => {
    const tenantId = await resolveTenantForOptionalMutation(ctx, args);
    const romanticPartnerJids = [...new Set((args.romanticPartnerJids || []).map((item) => item.trim().toLowerCase()).filter(Boolean))].slice(
      0,
      300,
    );
    const outreachContactJids = [
      ...new Set(
        args.outreachContactJids
          .map((item) => item.trim().toLowerCase())
          .filter(Boolean),
      ),
    ];
    const statusBuilderAudienceJids = [
      ...new Set((args.statusBuilderAudienceJids || []).map((item) => item.trim()).filter(Boolean)),
    ];
    const funnyStatusKeywords = [...new Set((args.funnyStatusKeywords || []).map((item) => item.trim().toLowerCase()).filter(Boolean))].slice(
      0,
      40,
    );
    const funnyStatusEmojis = [...new Set((args.funnyStatusEmojis || []).map((item) => item.trim()).filter(Boolean))].slice(0, 40);
    const voiceNotesAutoNeedKeywords = [
      ...new Set((args.voiceNotesAutoNeedKeywords || []).map((item) => item.trim().toLowerCase()).filter(Boolean)),
    ].slice(0, 40);
    const aiDeterministicModes = [...new Set((args.aiDeterministicModes || []).map((item) => item.trim().toLowerCase()).filter(Boolean))]
      .filter((item): item is AiDeterministicMode => isAiDeterministicMode(item))
      .slice(0, 8);
    const normalized = {
      productUse: args.productUse ?? DEFAULT_APP_CONFIG.productUse,
      businessBrandName: args.businessBrandName?.trim().slice(0, 120) || "",
      businessBrandVoice: args.businessBrandVoice?.trim().slice(0, 2000) || "",
      businessOfferSummary: args.businessOfferSummary?.trim().slice(0, 4000) || "",
      storefrontEnabled: args.storefrontEnabled ?? DEFAULT_APP_CONFIG.storefrontEnabled,
      storefrontSlug: (args.storefrontSlug || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80),
      storefrontFeeBps: clampInt(args.storefrontFeeBps ?? DEFAULT_APP_CONFIG.storefrontFeeBps, 0, 2000),
      liveChatEnabled: args.liveChatEnabled ?? DEFAULT_APP_CONFIG.liveChatEnabled,
      liveChatWelcomeMessage:
        args.liveChatWelcomeMessage?.trim().slice(0, 600) || DEFAULT_APP_CONFIG.liveChatWelcomeMessage,
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
      selfRoastModeEnabled: args.selfRoastModeEnabled,
      statusAutoReplyEnabled: args.statusAutoReplyEnabled,
      statusReplyRequireFunny: args.statusReplyRequireFunny,
      captureGroupMediaEnabled: args.captureGroupMediaEnabled ?? DEFAULT_APP_CONFIG.captureGroupMediaEnabled,
      funnyStatusKeywords: funnyStatusKeywords.length ? funnyStatusKeywords : DEFAULT_APP_CONFIG.funnyStatusKeywords,
      funnyStatusEmojis: funnyStatusEmojis.length ? funnyStatusEmojis : DEFAULT_APP_CONFIG.funnyStatusEmojis,
      aiFallbackMode: args.aiFallbackMode,
      aiModelFirstEnabled: args.aiModelFirstEnabled ?? DEFAULT_APP_CONFIG.aiModelFirstEnabled,
      aiDeterministicModes: aiDeterministicModes.length ? aiDeterministicModes : DEFAULT_APP_CONFIG.aiDeterministicModes,
      aiAckRoutingEnabled: args.aiAckRoutingEnabled ?? DEFAULT_APP_CONFIG.aiAckRoutingEnabled,
      aiTemperature: clamp(args.aiTemperature, 0, 1.3),
      aiMaxOutputTokens: clampInt(args.aiMaxOutputTokens, 40, 2000),
      aiMaxReplyChars: clampInt(args.aiMaxReplyChars, 60, 2400),
      aiHistoryLineLimit: clampInt(args.aiHistoryLineLimit, 4, 120),
      aiPrimaryConfidence: clamp(args.aiPrimaryConfidence, 0.01, 1),
      aiFallbackConfidence: clamp(args.aiFallbackConfidence, 0.01, 1),
      aiReplyPolicy: args.aiReplyPolicy?.trim() || "",
      aiSystemInstruction: args.aiSystemInstruction?.trim() || "",
      activePersonaPackId: args.activePersonaPackId?.trim() || "",
      activePersonaPackIdsByProfile: Object.fromEntries(
        Object.entries(args.activePersonaPackIdsByProfile || {})
          .map(([key, value]) => [key.trim().toLowerCase(), value.trim()])
          .filter(([key, value]) => key && value),
      ),
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
      autoMarkReadEnabled: args.autoMarkReadEnabled ?? DEFAULT_APP_CONFIG.autoMarkReadEnabled,
      autoMarkReadGroups: args.autoMarkReadGroups ?? DEFAULT_APP_CONFIG.autoMarkReadGroups,
      autoMarkReadStatus: args.autoMarkReadStatus ?? DEFAULT_APP_CONFIG.autoMarkReadStatus,
      presenceSubscribeEnabled: args.presenceSubscribeEnabled ?? DEFAULT_APP_CONFIG.presenceSubscribeEnabled,
      chatModifyQuietHoursEnabled: args.chatModifyQuietHoursEnabled ?? DEFAULT_APP_CONFIG.chatModifyQuietHoursEnabled,
      aboutAutomationEnabled: args.aboutAutomationEnabled ?? DEFAULT_APP_CONFIG.aboutAutomationEnabled,
      aboutAutomationIntervalMinutes: clampInt(
        args.aboutAutomationIntervalMinutes ?? DEFAULT_APP_CONFIG.aboutAutomationIntervalMinutes,
        15,
        7 * 24 * 60,
      ),
      aboutAutomationTemplate: args.aboutAutomationTemplate?.trim() || "",
      sendRateWindowMinutes: clampInt(args.sendRateWindowMinutes ?? DEFAULT_APP_CONFIG.sendRateWindowMinutes, 5, 24 * 60),
      sendMaxPerThreadInWindow: clampInt(
        args.sendMaxPerThreadInWindow ?? DEFAULT_APP_CONFIG.sendMaxPerThreadInWindow,
        1,
        100,
      ),
      sendMaxGlobalInWindow: clampInt(args.sendMaxGlobalInWindow ?? DEFAULT_APP_CONFIG.sendMaxGlobalInWindow, 1, 1000),
      voiceNotesAutoEnabled: args.voiceNotesAutoEnabled ?? DEFAULT_APP_CONFIG.voiceNotesAutoEnabled,
      voiceNotesAutoProbability: clamp(
        args.voiceNotesAutoProbability ?? DEFAULT_APP_CONFIG.voiceNotesAutoProbability,
        0,
        1,
      ),
      voiceNotesAutoMaxPerThreadPerDay: clampInt(
        args.voiceNotesAutoMaxPerThreadPerDay ?? DEFAULT_APP_CONFIG.voiceNotesAutoMaxPerThreadPerDay,
        1,
        12,
      ),
      voiceNotesAutoNeedKeywords: voiceNotesAutoNeedKeywords.length
        ? voiceNotesAutoNeedKeywords
        : DEFAULT_APP_CONFIG.voiceNotesAutoNeedKeywords,
      romanticPartnerJids,
      romanticMorningEnabled: args.romanticMorningEnabled ?? DEFAULT_APP_CONFIG.romanticMorningEnabled,
      romanticMorningStartHour: clampInt(
        args.romanticMorningStartHour ?? DEFAULT_APP_CONFIG.romanticMorningStartHour,
        0,
        23,
      ),
      romanticMorningEndHour: clampInt(
        args.romanticMorningEndHour ?? DEFAULT_APP_CONFIG.romanticMorningEndHour,
        0,
        23,
      ),
      romanticMorningLeadRatio: clamp(
        args.romanticMorningLeadRatio ?? DEFAULT_APP_CONFIG.romanticMorningLeadRatio,
        0,
        1,
      ),
      romanticMorningCollisionCooldownHours: clampInt(
        args.romanticMorningCollisionCooldownHours ?? DEFAULT_APP_CONFIG.romanticMorningCollisionCooldownHours,
        1,
        72,
      ),
      romanticMorningMaxPerThreadPerDay: clampInt(
        args.romanticMorningMaxPerThreadPerDay ?? DEFAULT_APP_CONFIG.romanticMorningMaxPerThreadPerDay,
        1,
        3,
      ),
      outreachEnabled: args.outreachEnabled,
      outreachCadenceHours: clampInt(args.outreachCadenceHours, 6, 24 * 14),
      outreachMaxContactsPerRun: clampInt(args.outreachMaxContactsPerRun, 1, 25),
      outreachContactJids,
      outreachStarterTemplate: args.outreachStarterTemplate?.trim() || DEFAULT_APP_CONFIG.outreachStarterTemplate,
      conversationIntelligenceEnabled:
        args.conversationIntelligenceEnabled ?? DEFAULT_APP_CONFIG.conversationIntelligenceEnabled,
      checkInRecencyTargetDays: clampInt(
        args.checkInRecencyTargetDays ?? DEFAULT_APP_CONFIG.checkInRecencyTargetDays,
        1,
        60,
      ),
      topicDyingAckStreakThreshold: clampInt(
        args.topicDyingAckStreakThreshold ?? DEFAULT_APP_CONFIG.topicDyingAckStreakThreshold,
        1,
        12,
      ),
      topicLaneMaxActive: clampInt(args.topicLaneMaxActive ?? DEFAULT_APP_CONFIG.topicLaneMaxActive, 1, 12),
      pivotReplyEnabled: args.pivotReplyEnabled ?? DEFAULT_APP_CONFIG.pivotReplyEnabled,
      antiDwellingEnabled: args.antiDwellingEnabled ?? DEFAULT_APP_CONFIG.antiDwellingEnabled,
      antiDwellingEndgameCloseCooldownMinutes: clampInt(
        args.antiDwellingEndgameCloseCooldownMinutes ?? DEFAULT_APP_CONFIG.antiDwellingEndgameCloseCooldownMinutes,
        5,
        24 * 60,
      ),
      antiDwellingTopicTurnSoftLimit: clampInt(
        args.antiDwellingTopicTurnSoftLimit ?? DEFAULT_APP_CONFIG.antiDwellingTopicTurnSoftLimit,
        2,
        20,
      ),
      antiDwellingTopicTurnHardLimit: clampInt(
        args.antiDwellingTopicTurnHardLimit ?? DEFAULT_APP_CONFIG.antiDwellingTopicTurnHardLimit,
        3,
        30,
      ),
      topicLeadPivotEnabled: args.topicLeadPivotEnabled ?? DEFAULT_APP_CONFIG.topicLeadPivotEnabled,
      topicLeadPivotMinVibeScore: clamp(
        args.topicLeadPivotMinVibeScore ?? DEFAULT_APP_CONFIG.topicLeadPivotMinVibeScore,
        0,
        1,
      ),
      topicLeadPivotCooldownMinutes: clampInt(
        args.topicLeadPivotCooldownMinutes ?? DEFAULT_APP_CONFIG.topicLeadPivotCooldownMinutes,
        5,
        24 * 60,
      ),
      statusBuilderEnabled: args.statusBuilderEnabled,
      statusBuilderCadenceHours: clampInt(args.statusBuilderCadenceHours, 1, 24 * 7),
      statusBuilderDailyMaxPosts: clampInt(args.statusBuilderDailyMaxPosts, 1, 24),
      statusBuilderTextPostRatio: clamp(args.statusBuilderTextPostRatio, 0, 0.45),
      statusBuilderReviewRatio: clamp(
        args.statusBuilderReviewRatio ?? DEFAULT_APP_CONFIG.statusBuilderReviewRatio,
        0,
        1,
      ),
      statusPostAudienceMode: args.statusPostAudienceMode ?? DEFAULT_APP_CONFIG.statusPostAudienceMode,
      statusBuilderAudienceJids,
      statusBuilderAudienceSampleSize: clampInt(
        args.statusBuilderAudienceSampleSize ?? DEFAULT_APP_CONFIG.statusBuilderAudienceSampleSize,
        10,
        256,
      ),
      instagramDmDelayMinMs: clampInt(
        args.instagramDmDelayMinMs ?? DEFAULT_APP_CONFIG.instagramDmDelayMinMs,
        500,
        180_000,
      ),
      instagramDmDelayMaxMs: clampInt(
        args.instagramDmDelayMaxMs ?? DEFAULT_APP_CONFIG.instagramDmDelayMaxMs,
        500,
        240_000,
      ),
      instagramTypingMinMs: clampInt(
        args.instagramTypingMinMs ?? DEFAULT_APP_CONFIG.instagramTypingMinMs,
        200,
        60_000,
      ),
      instagramTypingMaxMs: clampInt(
        args.instagramTypingMaxMs ?? DEFAULT_APP_CONFIG.instagramTypingMaxMs,
        200,
        120_000,
      ),
      instagramSendRateWindowMinutes: clampInt(
        args.instagramSendRateWindowMinutes ?? DEFAULT_APP_CONFIG.instagramSendRateWindowMinutes,
        5,
        24 * 60,
      ),
      instagramSendMaxPerThreadInWindow: clampInt(
        args.instagramSendMaxPerThreadInWindow ?? DEFAULT_APP_CONFIG.instagramSendMaxPerThreadInWindow,
        1,
        100,
      ),
      instagramSendMaxGlobalInWindow: clampInt(
        args.instagramSendMaxGlobalInWindow ?? DEFAULT_APP_CONFIG.instagramSendMaxGlobalInWindow,
        1,
        1000,
      ),
      instagramStoryCadenceHours: clampInt(
        args.instagramStoryCadenceHours ?? DEFAULT_APP_CONFIG.instagramStoryCadenceHours,
        1,
        24 * 7,
      ),
      instagramStoryDailyMaxPosts: clampInt(
        args.instagramStoryDailyMaxPosts ?? DEFAULT_APP_CONFIG.instagramStoryDailyMaxPosts,
        1,
        24,
      ),
      selfChatOpenClawEnabled: args.selfChatOpenClawEnabled ?? DEFAULT_APP_CONFIG.selfChatOpenClawEnabled,
      selfChatOpenClawCliPath: args.selfChatOpenClawCliPath?.trim() || DEFAULT_APP_CONFIG.selfChatOpenClawCliPath,
      selfChatOpenClawAgentId: args.selfChatOpenClawAgentId?.trim() || DEFAULT_APP_CONFIG.selfChatOpenClawAgentId,
      selfChatOpenClawTimeoutMs: clampInt(
        args.selfChatOpenClawTimeoutMs ?? DEFAULT_APP_CONFIG.selfChatOpenClawTimeoutMs,
        1_000,
        24 * 60 * 60 * 1000,
      ),
      selfChatCodexEnabled: args.selfChatCodexEnabled ?? DEFAULT_APP_CONFIG.selfChatCodexEnabled,
      selfChatCodexCliPath: args.selfChatCodexCliPath?.trim() || DEFAULT_APP_CONFIG.selfChatCodexCliPath,
      selfChatCodexModel: args.selfChatCodexModel?.trim() || DEFAULT_APP_CONFIG.selfChatCodexModel,
      selfChatCodexSandbox: args.selfChatCodexSandbox ?? DEFAULT_APP_CONFIG.selfChatCodexSandbox,
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
    if (normalized.instagramDmDelayMinMs > normalized.instagramDmDelayMaxMs) {
      const swapped = normalized.instagramDmDelayMinMs;
      normalized.instagramDmDelayMinMs = normalized.instagramDmDelayMaxMs;
      normalized.instagramDmDelayMaxMs = swapped;
    }
    if (normalized.instagramTypingMinMs > normalized.instagramTypingMaxMs) {
      const swapped = normalized.instagramTypingMinMs;
      normalized.instagramTypingMinMs = normalized.instagramTypingMaxMs;
      normalized.instagramTypingMaxMs = swapped;
    }

    const romanticSyncResult = await upsertRomanticPartnerMappings(ctx, normalized.romanticPartnerJids, tenantId);

    await setScopedConfigValue(ctx, tenantId, "productUse", normalized.productUse);
    await setScopedConfigValue(ctx, tenantId, "businessBrandName", normalized.businessBrandName);
    await setScopedConfigValue(ctx, tenantId, "businessBrandVoice", normalized.businessBrandVoice);
    await setScopedConfigValue(ctx, tenantId, "businessOfferSummary", normalized.businessOfferSummary);
    await setScopedConfigValue(ctx, tenantId, "storefrontEnabled", normalized.storefrontEnabled ? "true" : "false");
    await setScopedConfigValue(ctx, tenantId, "storefrontSlug", normalized.storefrontSlug);
    await setScopedConfigValue(ctx, tenantId, "storefrontFeeBps", String(normalized.storefrontFeeBps));
    await setScopedConfigValue(ctx, tenantId, "liveChatEnabled", normalized.liveChatEnabled ? "true" : "false");
    await setScopedConfigValue(ctx, tenantId, "liveChatWelcomeMessage", normalized.liveChatWelcomeMessage);
    await syncStorefrontProfileFromConfig(ctx, tenantId, normalized);
    await setScopedConfigValue(ctx, tenantId, "ignoreGroupsByDefault", normalized.ignoreGroupsByDefault ? "true" : "false");
    await setScopedConfigValue(ctx, tenantId, "reactionsEnabled", normalized.reactionsEnabled ? "true" : "false");
    await setScopedConfigValue(ctx, tenantId, "stickersEnabled", normalized.stickersEnabled ? "true" : "false");
    await setScopedConfigValue(ctx, tenantId, "memesEnabled", normalized.memesEnabled ? "true" : "false");
    await setScopedConfigValue(ctx, tenantId, "generatedMemesEnabled", normalized.generatedMemesEnabled ? "true" : "false");
    await setScopedConfigValue(ctx, tenantId, "generatedMemesAutoSendEnabled", normalized.generatedMemesAutoSendEnabled ? "true" : "false");
    await setScopedConfigValue(ctx, tenantId, "memeThreadCooldownMs", String(normalized.memeThreadCooldownMs));
    await setScopedConfigValue(ctx, tenantId, "memeSendProbability", String(normalized.memeSendProbability));
    await setScopedConfigValue(ctx, tenantId, "soulModeEnabled", normalized.soulModeEnabled ? "true" : "false");
    await setScopedConfigValue(ctx, tenantId, "humorLearningEnabled", normalized.humorLearningEnabled ? "true" : "false");
    await setScopedConfigValue(ctx, tenantId, "selfRoastModeEnabled", normalized.selfRoastModeEnabled ? "true" : "false");
    await setScopedConfigValue(ctx, tenantId, "statusAutoReplyEnabled", normalized.statusAutoReplyEnabled ? "true" : "false");
    await setScopedConfigValue(ctx, tenantId, "statusReplyRequireFunny", normalized.statusReplyRequireFunny ? "true" : "false");
    await setScopedConfigValue(ctx, tenantId, "captureGroupMediaEnabled", normalized.captureGroupMediaEnabled ? "true" : "false");
    await setScopedConfigValue(ctx, tenantId, "funnyStatusKeywords", normalized.funnyStatusKeywords.join("\n"));
    await setScopedConfigValue(ctx, tenantId, "funnyStatusEmojis", normalized.funnyStatusEmojis.join("\n"));
    await setScopedConfigValue(ctx, tenantId, "aiFallbackMode", normalized.aiFallbackMode);
    await setScopedConfigValue(ctx, tenantId, "aiModelFirstEnabled", normalized.aiModelFirstEnabled ? "true" : "false");
    await setScopedConfigValue(ctx, tenantId, "aiDeterministicModes", normalized.aiDeterministicModes.join("\n"));
    await setScopedConfigValue(ctx, tenantId, "aiAckRoutingEnabled", normalized.aiAckRoutingEnabled ? "true" : "false");
    await setScopedConfigValue(ctx, tenantId, "aiTemperature", String(normalized.aiTemperature));
    await setScopedConfigValue(ctx, tenantId, "aiMaxOutputTokens", String(normalized.aiMaxOutputTokens));
    await setScopedConfigValue(ctx, tenantId, "aiMaxReplyChars", String(normalized.aiMaxReplyChars));
    await setScopedConfigValue(ctx, tenantId, "aiHistoryLineLimit", String(normalized.aiHistoryLineLimit));
    await setScopedConfigValue(ctx, tenantId, "aiPrimaryConfidence", String(normalized.aiPrimaryConfidence));
    await setScopedConfigValue(ctx, tenantId, "aiFallbackConfidence", String(normalized.aiFallbackConfidence));
    await setScopedConfigValue(ctx, tenantId, "aiReplyPolicy", normalized.aiReplyPolicy);
    await setScopedConfigValue(ctx, tenantId, "aiSystemInstruction", normalized.aiSystemInstruction);
    await setScopedConfigValue(ctx, tenantId, "activePersonaPackId", normalized.activePersonaPackId);
    await setScopedConfigValue(ctx, tenantId, "activePersonaPackIdsByProfile", JSON.stringify(normalized.activePersonaPackIdsByProfile));
    await setScopedConfigValue(ctx, tenantId, "qualityGateMode", normalized.qualityGateMode);
    await setScopedConfigValue(ctx, tenantId, "qualityGateThreshold", String(normalized.qualityGateThreshold));
    await setScopedConfigValue(ctx, tenantId, "humanDelayMinMs", String(normalized.humanDelayMinMs));
    await setScopedConfigValue(ctx, tenantId, "humanDelayMaxMs", String(normalized.humanDelayMaxMs));
    await setScopedConfigValue(ctx, tenantId, "humanTypingMinMs", String(normalized.humanTypingMinMs));
    await setScopedConfigValue(ctx, tenantId, "humanTypingMaxMs", String(normalized.humanTypingMaxMs));
    await setScopedConfigValue(ctx, tenantId, "outboxClaimLimit", String(normalized.outboxClaimLimit));
    await setScopedConfigValue(ctx, tenantId, "outboxPollMs", String(normalized.outboxPollMs));
    await setScopedConfigValue(ctx, tenantId, "inboundMergeWindowMs", String(normalized.inboundMergeWindowMs));
    await setScopedConfigValue(ctx, tenantId, "manualInterventionCooldownMs", String(normalized.manualInterventionCooldownMs));
    await setScopedConfigValue(ctx, tenantId, "inboundConcurrency", String(normalized.inboundConcurrency));
    await setScopedConfigValue(ctx, tenantId, "outboxSendConcurrency", String(normalized.outboxSendConcurrency));
    await setScopedConfigValue(ctx, tenantId, "statusRetentionMs", String(normalized.statusRetentionMs));
    await setScopedConfigValue(ctx, tenantId, "statusCleanupIntervalMs", String(normalized.statusCleanupIntervalMs));
    await setScopedConfigValue(ctx, tenantId, "statusCleanupBatchLimit", String(normalized.statusCleanupBatchLimit));
    await setScopedConfigValue(ctx, tenantId, "statusContextKeepPerThread", String(normalized.statusContextKeepPerThread));
    await setScopedConfigValue(ctx, tenantId, "groupContextKeepPerThread", String(normalized.groupContextKeepPerThread));
    await setScopedConfigValue(ctx, tenantId, "contextCompactionIntervalMs", String(normalized.contextCompactionIntervalMs));
    await setScopedConfigValue(ctx, tenantId, "contextCompactionMaxThreads", String(normalized.contextCompactionMaxThreads));
    await setScopedConfigValue(ctx, tenantId, "contextCompactionMaxDeletes", String(normalized.contextCompactionMaxDeletes));
    await setScopedConfigValue(ctx, tenantId, "compactContextGroupJids", normalized.compactContextGroupJids.join("\n"));
    await setScopedConfigValue(ctx, tenantId, "quietHoursEnabled", normalized.quietHoursEnabled ? "true" : "false");
    await setScopedConfigValue(ctx, tenantId, "quietHoursStartHour", String(normalized.quietHoursStartHour));
    await setScopedConfigValue(ctx, tenantId, "quietHoursEndHour", String(normalized.quietHoursEndHour));
    await setScopedConfigValue(ctx, tenantId, "autoMarkReadEnabled", normalized.autoMarkReadEnabled ? "true" : "false");
    await setScopedConfigValue(ctx, tenantId, "autoMarkReadGroups", normalized.autoMarkReadGroups ? "true" : "false");
    await setScopedConfigValue(ctx, tenantId, "autoMarkReadStatus", normalized.autoMarkReadStatus ? "true" : "false");
    await setScopedConfigValue(ctx, tenantId, "presenceSubscribeEnabled", normalized.presenceSubscribeEnabled ? "true" : "false");
    await setScopedConfigValue(ctx, tenantId, "chatModifyQuietHoursEnabled", normalized.chatModifyQuietHoursEnabled ? "true" : "false");
    await setScopedConfigValue(ctx, tenantId, "aboutAutomationEnabled", normalized.aboutAutomationEnabled ? "true" : "false");
    await setScopedConfigValue(ctx, tenantId, "aboutAutomationIntervalMinutes", String(normalized.aboutAutomationIntervalMinutes));
    await setScopedConfigValue(ctx, tenantId, "aboutAutomationTemplate", normalized.aboutAutomationTemplate);
    await setScopedConfigValue(ctx, tenantId, "sendRateWindowMinutes", String(normalized.sendRateWindowMinutes));
    await setScopedConfigValue(ctx, tenantId, "sendMaxPerThreadInWindow", String(normalized.sendMaxPerThreadInWindow));
    await setScopedConfigValue(ctx, tenantId, "sendMaxGlobalInWindow", String(normalized.sendMaxGlobalInWindow));
    await setScopedConfigValue(ctx, tenantId, "voiceNotesAutoEnabled", normalized.voiceNotesAutoEnabled ? "true" : "false");
    await setScopedConfigValue(ctx, tenantId, "voiceNotesAutoProbability", String(normalized.voiceNotesAutoProbability));
    await setScopedConfigValue(
      ctx,
      tenantId,
      "voiceNotesAutoMaxPerThreadPerDay",
      String(normalized.voiceNotesAutoMaxPerThreadPerDay),
    );
    await setScopedConfigValue(ctx, tenantId, "voiceNotesAutoNeedKeywords", normalized.voiceNotesAutoNeedKeywords.join("\n"));
    await setScopedConfigValue(ctx, tenantId, "romanticPartnerJids", normalized.romanticPartnerJids.join("\n"));
    await setScopedConfigValue(ctx, tenantId, "romanticMorningEnabled", normalized.romanticMorningEnabled ? "true" : "false");
    await setScopedConfigValue(ctx, tenantId, "romanticMorningStartHour", String(normalized.romanticMorningStartHour));
    await setScopedConfigValue(ctx, tenantId, "romanticMorningEndHour", String(normalized.romanticMorningEndHour));
    await setScopedConfigValue(ctx, tenantId, "romanticMorningLeadRatio", String(normalized.romanticMorningLeadRatio));
    await setScopedConfigValue(
      ctx,
      tenantId,
      "romanticMorningCollisionCooldownHours",
      String(normalized.romanticMorningCollisionCooldownHours),
    );
    await setScopedConfigValue(
      ctx,
      tenantId,
      "romanticMorningMaxPerThreadPerDay",
      String(normalized.romanticMorningMaxPerThreadPerDay),
    );
    await setScopedConfigValue(ctx, tenantId, "outreachEnabled", normalized.outreachEnabled ? "true" : "false");
    await setScopedConfigValue(ctx, tenantId, "outreachCadenceHours", String(normalized.outreachCadenceHours));
    await setScopedConfigValue(ctx, tenantId, "outreachMaxContactsPerRun", String(normalized.outreachMaxContactsPerRun));
    await setScopedConfigValue(ctx, tenantId, "outreachContactJids", normalized.outreachContactJids.join("\n"));
    await setScopedConfigValue(ctx, tenantId, "outreachStarterTemplate", normalized.outreachStarterTemplate);
    await setScopedConfigValue(
      ctx,
      tenantId,
      "conversationIntelligenceEnabled",
      normalized.conversationIntelligenceEnabled ? "true" : "false",
    );
    await setScopedConfigValue(ctx, tenantId, "checkInRecencyTargetDays", String(normalized.checkInRecencyTargetDays));
    await setScopedConfigValue(ctx, tenantId, "topicDyingAckStreakThreshold", String(normalized.topicDyingAckStreakThreshold));
    await setScopedConfigValue(ctx, tenantId, "topicLaneMaxActive", String(normalized.topicLaneMaxActive));
    await setScopedConfigValue(ctx, tenantId, "pivotReplyEnabled", normalized.pivotReplyEnabled ? "true" : "false");
    await setScopedConfigValue(ctx, tenantId, "antiDwellingEnabled", normalized.antiDwellingEnabled ? "true" : "false");
    await setScopedConfigValue(
      ctx,
      tenantId,
      "antiDwellingEndgameCloseCooldownMinutes",
      String(normalized.antiDwellingEndgameCloseCooldownMinutes),
    );
    await setScopedConfigValue(ctx, tenantId, "antiDwellingTopicTurnSoftLimit", String(normalized.antiDwellingTopicTurnSoftLimit));
    await setScopedConfigValue(ctx, tenantId, "antiDwellingTopicTurnHardLimit", String(normalized.antiDwellingTopicTurnHardLimit));
    await setScopedConfigValue(ctx, tenantId, "topicLeadPivotEnabled", normalized.topicLeadPivotEnabled ? "true" : "false");
    await setScopedConfigValue(ctx, tenantId, "topicLeadPivotMinVibeScore", String(normalized.topicLeadPivotMinVibeScore));
    await setScopedConfigValue(ctx, tenantId, "topicLeadPivotCooldownMinutes", String(normalized.topicLeadPivotCooldownMinutes));
    await setScopedConfigValue(ctx, tenantId, "statusBuilderEnabled", normalized.statusBuilderEnabled ? "true" : "false");
    await setScopedConfigValue(ctx, tenantId, "statusBuilderCadenceHours", String(normalized.statusBuilderCadenceHours));
    await setScopedConfigValue(ctx, tenantId, "statusBuilderDailyMaxPosts", String(normalized.statusBuilderDailyMaxPosts));
    await setScopedConfigValue(ctx, tenantId, "statusBuilderTextPostRatio", String(normalized.statusBuilderTextPostRatio));
    await setScopedConfigValue(ctx, tenantId, "statusBuilderReviewRatio", String(normalized.statusBuilderReviewRatio));
    await setScopedConfigValue(ctx, tenantId, "statusPostAudienceMode", normalized.statusPostAudienceMode);
    await setScopedConfigValue(ctx, tenantId, "statusBuilderAudienceJids", normalized.statusBuilderAudienceJids.join("\n"));
    await setScopedConfigValue(ctx, tenantId, "statusBuilderAudienceSampleSize", String(normalized.statusBuilderAudienceSampleSize));
    await setScopedConfigValue(ctx, tenantId, "instagramDmDelayMinMs", String(normalized.instagramDmDelayMinMs));
    await setScopedConfigValue(ctx, tenantId, "instagramDmDelayMaxMs", String(normalized.instagramDmDelayMaxMs));
    await setScopedConfigValue(ctx, tenantId, "instagramTypingMinMs", String(normalized.instagramTypingMinMs));
    await setScopedConfigValue(ctx, tenantId, "instagramTypingMaxMs", String(normalized.instagramTypingMaxMs));
    await setScopedConfigValue(ctx, tenantId, "instagramSendRateWindowMinutes", String(normalized.instagramSendRateWindowMinutes));
    await setScopedConfigValue(ctx, tenantId, "instagramSendMaxPerThreadInWindow", String(normalized.instagramSendMaxPerThreadInWindow));
    await setScopedConfigValue(ctx, tenantId, "instagramSendMaxGlobalInWindow", String(normalized.instagramSendMaxGlobalInWindow));
    await setScopedConfigValue(ctx, tenantId, "instagramStoryCadenceHours", String(normalized.instagramStoryCadenceHours));
    await setScopedConfigValue(ctx, tenantId, "instagramStoryDailyMaxPosts", String(normalized.instagramStoryDailyMaxPosts));
    await setScopedConfigValue(ctx, tenantId, "selfChatOpenClawEnabled", normalized.selfChatOpenClawEnabled ? "true" : "false");
    await setScopedConfigValue(ctx, tenantId, "selfChatOpenClawCliPath", normalized.selfChatOpenClawCliPath);
    await setScopedConfigValue(ctx, tenantId, "selfChatOpenClawAgentId", normalized.selfChatOpenClawAgentId);
    await setScopedConfigValue(ctx, tenantId, "selfChatOpenClawTimeoutMs", String(normalized.selfChatOpenClawTimeoutMs));
    await setScopedConfigValue(ctx, tenantId, "selfChatCodexEnabled", normalized.selfChatCodexEnabled ? "true" : "false");
    await setScopedConfigValue(ctx, tenantId, "selfChatCodexCliPath", normalized.selfChatCodexCliPath);
    await setScopedConfigValue(ctx, tenantId, "selfChatCodexModel", normalized.selfChatCodexModel);
    await setScopedConfigValue(ctx, tenantId, "selfChatCodexSandbox", normalized.selfChatCodexSandbox);

    await ctx.db.insert("systemEvents", {
      tenantId,
      source: "dashboard",
      eventType: "settings.updated",
      detail: `Runtime settings updated from Settings page. Romantic partner threads synced: ${romanticSyncResult.matchedThreads}.`,
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
