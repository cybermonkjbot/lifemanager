import type { MutationCtx, QueryCtx } from "./types";
import { DEFAULT_AUTONOMY_PAUSED, DEFAULT_IGNORE_GROUPS } from "./constants";
import { type QualityGateMode } from "./personaPacks";

export type AppConfig = {
  autonomyPaused: boolean;
  ignoreGroupsByDefault: boolean;
  reactionsEnabled: boolean;
  stickersEnabled: boolean;
  memesEnabled: boolean;
  generatedMemesEnabled: boolean;
  generatedMemesAutoSendEnabled: boolean;
  memeThreadCooldownMs: number;
  memeSendProbability: number;
  soulModeEnabled: boolean;
  humorLearningEnabled: boolean;
  statusAutoReplyEnabled: boolean;
  statusReplyRequireFunny: boolean;
  captureGroupMediaEnabled: boolean;
  funnyStatusKeywords: string[];
  funnyStatusEmojis: string[];
  aiFallbackMode: "all" | "azure_only";
  aiTemperature: number;
  aiMaxOutputTokens: number;
  aiMaxReplyChars: number;
  aiHistoryLineLimit: number;
  aiPrimaryConfidence: number;
  aiFallbackConfidence: number;
  aiReplyPolicy: string;
  aiSystemInstruction: string;
  activePersonaPackId: string;
  qualityGateMode: QualityGateMode;
  qualityGateThreshold: number;
  humanDelayMinMs: number;
  humanDelayMaxMs: number;
  humanTypingMinMs: number;
  humanTypingMaxMs: number;
  outboxClaimLimit: number;
  outboxPollMs: number;
  inboundMergeWindowMs: number;
  manualInterventionCooldownMs: number;
  inboundConcurrency: number;
  outboxSendConcurrency: number;
  statusRetentionMs: number;
  statusCleanupIntervalMs: number;
  statusCleanupBatchLimit: number;
  statusContextKeepPerThread: number;
  groupContextKeepPerThread: number;
  contextCompactionIntervalMs: number;
  contextCompactionMaxThreads: number;
  contextCompactionMaxDeletes: number;
  compactContextGroupJids: string[];
  quietHoursEnabled: boolean;
  quietHoursStartHour: number;
  quietHoursEndHour: number;
  sendRateWindowMinutes: number;
  sendMaxPerThreadInWindow: number;
  sendMaxGlobalInWindow: number;
  outreachEnabled: boolean;
  outreachCadenceHours: number;
  outreachMaxContactsPerRun: number;
  outreachContactJids: string[];
  outreachStarterTemplate: string;
  statusBuilderEnabled: boolean;
  statusBuilderCadenceHours: number;
  statusBuilderDailyMaxPosts: number;
  statusBuilderTextPostRatio: number;
  statusBuilderAudienceJids: string[];
  statusBuilderAudienceSampleSize: number;
};

export const DEFAULT_APP_CONFIG: AppConfig = {
  autonomyPaused: DEFAULT_AUTONOMY_PAUSED,
  ignoreGroupsByDefault: DEFAULT_IGNORE_GROUPS,
  reactionsEnabled: true,
  stickersEnabled: true,
  memesEnabled: true,
  generatedMemesEnabled: true,
  generatedMemesAutoSendEnabled: false,
  memeThreadCooldownMs: 3 * 60 * 60 * 1000,
  memeSendProbability: 0.3,
  soulModeEnabled: true,
  humorLearningEnabled: true,
  statusAutoReplyEnabled: true,
  statusReplyRequireFunny: true,
  captureGroupMediaEnabled: false,
  funnyStatusKeywords: ["lol", "lmao", "haha", "funny", "joke", "banter", "meme", "roast"],
  funnyStatusEmojis: ["😂", "🤣", "😹", "😆", "😅", "😄", "😁", "😜", "🤪", "🙃"],
  aiFallbackMode: "all",
  aiTemperature: 0.7,
  aiMaxOutputTokens: 140,
  aiMaxReplyChars: 320,
  aiHistoryLineLimit: 12,
  aiPrimaryConfidence: 0.78,
  aiFallbackConfidence: 0.58,
  aiReplyPolicy: "",
  aiSystemInstruction: "",
  activePersonaPackId: "",
  qualityGateMode: "auto_rewrite_once",
  qualityGateThreshold: 0.72,
  humanDelayMinMs: 12_000,
  humanDelayMaxMs: 65_000,
  humanTypingMinMs: 2_500,
  humanTypingMaxMs: 9_000,
  outboxClaimLimit: 8,
  outboxPollMs: 3_000,
  inboundMergeWindowMs: 45_000,
  manualInterventionCooldownMs: 2 * 60 * 1000,
  inboundConcurrency: 4,
  outboxSendConcurrency: 4,
  statusRetentionMs: 40 * 60 * 1000,
  statusCleanupIntervalMs: 40 * 60 * 1000,
  statusCleanupBatchLimit: 160,
  statusContextKeepPerThread: 24,
  groupContextKeepPerThread: 24,
  contextCompactionIntervalMs: 12 * 60 * 1000,
  contextCompactionMaxThreads: 24,
  contextCompactionMaxDeletes: 260,
  compactContextGroupJids: [],
  quietHoursEnabled: false,
  quietHoursStartHour: 23,
  quietHoursEndHour: 7,
  sendRateWindowMinutes: 60,
  sendMaxPerThreadInWindow: 4,
  sendMaxGlobalInWindow: 40,
  outreachEnabled: false,
  outreachCadenceHours: 36,
  outreachMaxContactsPerRun: 3,
  outreachContactJids: [],
  outreachStarterTemplate: "Hey {{name}}, checking in on you today.",
  statusBuilderEnabled: false,
  statusBuilderCadenceHours: 8,
  statusBuilderDailyMaxPosts: 3,
  statusBuilderTextPostRatio: 0.4,
  statusBuilderAudienceJids: [],
  statusBuilderAudienceSampleSize: 80,
};

function parseBoolean(value: string | undefined, fallback: boolean) {
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  return fallback;
}

function parseNumber(value: string | undefined, fallback: number) {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max));
}

function parseList(value: string | undefined) {
  if (!value) {
    return [];
  }

  const deduped = new Set(
    value
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean),
  );

  return [...deduped];
}

function parseFallbackMode(value: string | undefined, fallback: AppConfig["aiFallbackMode"]): AppConfig["aiFallbackMode"] {
  if (value === "all" || value === "azure_only") {
    return value;
  }
  return fallback;
}

function parseQualityGateMode(value: string | undefined, fallback: QualityGateMode): QualityGateMode {
  if (value === "auto_rewrite_once" || value === "manual_review" || value === "log_only") {
    return value;
  }
  return fallback;
}

export async function getConfig(ctx: QueryCtx | MutationCtx): Promise<AppConfig> {
  const rows = await ctx.db.query("appConfig").take(120);
  const map = new Map(rows.map((row) => [row.key, row.value]));

  return {
    autonomyPaused: parseBoolean(map.get("autonomyPaused"), DEFAULT_APP_CONFIG.autonomyPaused),
    ignoreGroupsByDefault: parseBoolean(map.get("ignoreGroupsByDefault"), DEFAULT_APP_CONFIG.ignoreGroupsByDefault),
    reactionsEnabled: parseBoolean(map.get("reactionsEnabled"), DEFAULT_APP_CONFIG.reactionsEnabled),
    stickersEnabled: parseBoolean(map.get("stickersEnabled"), DEFAULT_APP_CONFIG.stickersEnabled),
    memesEnabled: parseBoolean(map.get("memesEnabled"), DEFAULT_APP_CONFIG.memesEnabled),
    generatedMemesEnabled: parseBoolean(map.get("generatedMemesEnabled"), DEFAULT_APP_CONFIG.generatedMemesEnabled),
    generatedMemesAutoSendEnabled: parseBoolean(
      map.get("generatedMemesAutoSendEnabled"),
      DEFAULT_APP_CONFIG.generatedMemesAutoSendEnabled,
    ),
    memeThreadCooldownMs: Math.round(
      clamp(parseNumber(map.get("memeThreadCooldownMs"), DEFAULT_APP_CONFIG.memeThreadCooldownMs), 5 * 60 * 1000, 7 * 24 * 60 * 60 * 1000),
    ),
    memeSendProbability: clamp(
      parseNumber(map.get("memeSendProbability"), DEFAULT_APP_CONFIG.memeSendProbability),
      0,
      1,
    ),
    soulModeEnabled: parseBoolean(map.get("soulModeEnabled"), DEFAULT_APP_CONFIG.soulModeEnabled),
    humorLearningEnabled: parseBoolean(map.get("humorLearningEnabled"), DEFAULT_APP_CONFIG.humorLearningEnabled),
    statusAutoReplyEnabled: parseBoolean(map.get("statusAutoReplyEnabled"), DEFAULT_APP_CONFIG.statusAutoReplyEnabled),
    statusReplyRequireFunny: parseBoolean(map.get("statusReplyRequireFunny"), DEFAULT_APP_CONFIG.statusReplyRequireFunny),
    captureGroupMediaEnabled: parseBoolean(map.get("captureGroupMediaEnabled"), DEFAULT_APP_CONFIG.captureGroupMediaEnabled),
    funnyStatusKeywords: parseList(map.get("funnyStatusKeywords")).length
      ? parseList(map.get("funnyStatusKeywords"))
      : DEFAULT_APP_CONFIG.funnyStatusKeywords,
    funnyStatusEmojis: parseList(map.get("funnyStatusEmojis")).length
      ? parseList(map.get("funnyStatusEmojis"))
      : DEFAULT_APP_CONFIG.funnyStatusEmojis,
    aiFallbackMode: parseFallbackMode(map.get("aiFallbackMode"), DEFAULT_APP_CONFIG.aiFallbackMode),
    aiTemperature: clamp(parseNumber(map.get("aiTemperature"), DEFAULT_APP_CONFIG.aiTemperature), 0, 1.3),
    aiMaxOutputTokens: Math.round(clamp(parseNumber(map.get("aiMaxOutputTokens"), DEFAULT_APP_CONFIG.aiMaxOutputTokens), 40, 1000)),
    aiMaxReplyChars: Math.round(clamp(parseNumber(map.get("aiMaxReplyChars"), DEFAULT_APP_CONFIG.aiMaxReplyChars), 60, 1200)),
    aiHistoryLineLimit: Math.round(clamp(parseNumber(map.get("aiHistoryLineLimit"), DEFAULT_APP_CONFIG.aiHistoryLineLimit), 4, 40)),
    aiPrimaryConfidence: clamp(parseNumber(map.get("aiPrimaryConfidence"), DEFAULT_APP_CONFIG.aiPrimaryConfidence), 0.01, 1),
    aiFallbackConfidence: clamp(parseNumber(map.get("aiFallbackConfidence"), DEFAULT_APP_CONFIG.aiFallbackConfidence), 0.01, 1),
    aiReplyPolicy: map.get("aiReplyPolicy") ?? DEFAULT_APP_CONFIG.aiReplyPolicy,
    aiSystemInstruction: map.get("aiSystemInstruction") ?? DEFAULT_APP_CONFIG.aiSystemInstruction,
    activePersonaPackId: (map.get("activePersonaPackId") ?? DEFAULT_APP_CONFIG.activePersonaPackId).trim(),
    qualityGateMode: parseQualityGateMode(map.get("qualityGateMode"), DEFAULT_APP_CONFIG.qualityGateMode),
    qualityGateThreshold: clamp(
      parseNumber(map.get("qualityGateThreshold"), DEFAULT_APP_CONFIG.qualityGateThreshold),
      0.4,
      0.95,
    ),
    humanDelayMinMs: Math.round(clamp(parseNumber(map.get("humanDelayMinMs"), DEFAULT_APP_CONFIG.humanDelayMinMs), 500, 180_000)),
    humanDelayMaxMs: Math.round(clamp(parseNumber(map.get("humanDelayMaxMs"), DEFAULT_APP_CONFIG.humanDelayMaxMs), 500, 240_000)),
    humanTypingMinMs: Math.round(clamp(parseNumber(map.get("humanTypingMinMs"), DEFAULT_APP_CONFIG.humanTypingMinMs), 200, 60_000)),
    humanTypingMaxMs: Math.round(clamp(parseNumber(map.get("humanTypingMaxMs"), DEFAULT_APP_CONFIG.humanTypingMaxMs), 200, 120_000)),
    outboxClaimLimit: Math.round(clamp(parseNumber(map.get("outboxClaimLimit"), DEFAULT_APP_CONFIG.outboxClaimLimit), 1, 20)),
    outboxPollMs: Math.round(clamp(parseNumber(map.get("outboxPollMs"), DEFAULT_APP_CONFIG.outboxPollMs), 500, 60_000)),
    inboundMergeWindowMs: Math.round(
      clamp(parseNumber(map.get("inboundMergeWindowMs"), DEFAULT_APP_CONFIG.inboundMergeWindowMs), 2_000, 180_000),
    ),
    manualInterventionCooldownMs: Math.round(
      clamp(
        parseNumber(map.get("manualInterventionCooldownMs"), DEFAULT_APP_CONFIG.manualInterventionCooldownMs),
        0,
        7_200_000,
      ),
    ),
    inboundConcurrency: Math.round(clamp(parseNumber(map.get("inboundConcurrency"), DEFAULT_APP_CONFIG.inboundConcurrency), 1, 16)),
    outboxSendConcurrency: Math.round(
      clamp(parseNumber(map.get("outboxSendConcurrency"), DEFAULT_APP_CONFIG.outboxSendConcurrency), 1, 16),
    ),
    statusRetentionMs: Math.round(
      clamp(parseNumber(map.get("statusRetentionMs"), DEFAULT_APP_CONFIG.statusRetentionMs), 5 * 60 * 1000, 24 * 60 * 60 * 1000),
    ),
    statusCleanupIntervalMs: Math.round(
      clamp(
        parseNumber(map.get("statusCleanupIntervalMs"), DEFAULT_APP_CONFIG.statusCleanupIntervalMs),
        5 * 60 * 1000,
        24 * 60 * 60 * 1000,
      ),
    ),
    statusCleanupBatchLimit: Math.round(
      clamp(parseNumber(map.get("statusCleanupBatchLimit"), DEFAULT_APP_CONFIG.statusCleanupBatchLimit), 20, 800),
    ),
    statusContextKeepPerThread: Math.round(
      clamp(parseNumber(map.get("statusContextKeepPerThread"), DEFAULT_APP_CONFIG.statusContextKeepPerThread), 8, 120),
    ),
    groupContextKeepPerThread: Math.round(
      clamp(parseNumber(map.get("groupContextKeepPerThread"), DEFAULT_APP_CONFIG.groupContextKeepPerThread), 8, 120),
    ),
    contextCompactionIntervalMs: Math.round(
      clamp(
        parseNumber(map.get("contextCompactionIntervalMs"), DEFAULT_APP_CONFIG.contextCompactionIntervalMs),
        2 * 60 * 1000,
        24 * 60 * 60 * 1000,
      ),
    ),
    contextCompactionMaxThreads: Math.round(
      clamp(parseNumber(map.get("contextCompactionMaxThreads"), DEFAULT_APP_CONFIG.contextCompactionMaxThreads), 2, 80),
    ),
    contextCompactionMaxDeletes: Math.round(
      clamp(parseNumber(map.get("contextCompactionMaxDeletes"), DEFAULT_APP_CONFIG.contextCompactionMaxDeletes), 20, 800),
    ),
    compactContextGroupJids: parseList(map.get("compactContextGroupJids")),
    quietHoursEnabled: parseBoolean(map.get("quietHoursEnabled"), DEFAULT_APP_CONFIG.quietHoursEnabled),
    quietHoursStartHour: Math.round(
      clamp(parseNumber(map.get("quietHoursStartHour"), DEFAULT_APP_CONFIG.quietHoursStartHour), 0, 23),
    ),
    quietHoursEndHour: Math.round(
      clamp(parseNumber(map.get("quietHoursEndHour"), DEFAULT_APP_CONFIG.quietHoursEndHour), 0, 23),
    ),
    sendRateWindowMinutes: Math.round(
      clamp(parseNumber(map.get("sendRateWindowMinutes"), DEFAULT_APP_CONFIG.sendRateWindowMinutes), 5, 24 * 60),
    ),
    sendMaxPerThreadInWindow: Math.round(
      clamp(
        parseNumber(map.get("sendMaxPerThreadInWindow"), DEFAULT_APP_CONFIG.sendMaxPerThreadInWindow),
        1,
        100,
      ),
    ),
    sendMaxGlobalInWindow: Math.round(
      clamp(parseNumber(map.get("sendMaxGlobalInWindow"), DEFAULT_APP_CONFIG.sendMaxGlobalInWindow), 1, 1000),
    ),
    outreachEnabled: parseBoolean(map.get("outreachEnabled"), DEFAULT_APP_CONFIG.outreachEnabled),
    outreachCadenceHours: Math.round(
      clamp(parseNumber(map.get("outreachCadenceHours"), DEFAULT_APP_CONFIG.outreachCadenceHours), 6, 24 * 14),
    ),
    outreachMaxContactsPerRun: Math.round(
      clamp(parseNumber(map.get("outreachMaxContactsPerRun"), DEFAULT_APP_CONFIG.outreachMaxContactsPerRun), 1, 25),
    ),
    outreachContactJids: parseList(map.get("outreachContactJids")),
    outreachStarterTemplate: map.get("outreachStarterTemplate") ?? DEFAULT_APP_CONFIG.outreachStarterTemplate,
    statusBuilderEnabled: parseBoolean(map.get("statusBuilderEnabled"), DEFAULT_APP_CONFIG.statusBuilderEnabled),
    statusBuilderCadenceHours: Math.round(
      clamp(parseNumber(map.get("statusBuilderCadenceHours"), DEFAULT_APP_CONFIG.statusBuilderCadenceHours), 1, 24 * 7),
    ),
    statusBuilderDailyMaxPosts: Math.round(
      clamp(parseNumber(map.get("statusBuilderDailyMaxPosts"), DEFAULT_APP_CONFIG.statusBuilderDailyMaxPosts), 1, 24),
    ),
    statusBuilderTextPostRatio: clamp(
      parseNumber(map.get("statusBuilderTextPostRatio"), DEFAULT_APP_CONFIG.statusBuilderTextPostRatio),
      0,
      1,
    ),
    statusBuilderAudienceJids: parseList(map.get("statusBuilderAudienceJids")),
    statusBuilderAudienceSampleSize: Math.round(
      clamp(
        parseNumber(map.get("statusBuilderAudienceSampleSize"), DEFAULT_APP_CONFIG.statusBuilderAudienceSampleSize),
        10,
        256,
      ),
    ),
  };
}

export async function setConfigValue(ctx: MutationCtx, key: string, value: string) {
  const existing = await ctx.db
    .query("appConfig")
    .withIndex("by_key", (q) => q.eq("key", key))
    .first();

  const updatedAt = Date.now();
  if (existing) {
    await ctx.db.patch(existing._id, { value, updatedAt });
    return existing._id;
  }

  return await ctx.db.insert("appConfig", {
    key,
    value,
    updatedAt,
  });
}
