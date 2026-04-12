import type { MutationCtx, QueryCtx } from "./types";
import { DEFAULT_AUTONOMY_PAUSED, DEFAULT_IGNORE_GROUPS } from "./constants";
import { type QualityGateMode } from "./personaPacks";

export type AiDeterministicMode =
  | "hard_stop"
  | "anti_beggi_beggi"
  | "anti_sales_pitch"
  | "pause"
  | "loop"
  | "wrap_up";

const DEFAULT_AI_DETERMINISTIC_MODES: AiDeterministicMode[] = ["hard_stop", "anti_beggi_beggi", "anti_sales_pitch"];
const STATUS_BUILDER_MAX_TEXT_POST_RATIO = 0.45;
const ALLOWED_AI_DETERMINISTIC_MODE_SET = new Set<AiDeterministicMode>([
  "hard_stop",
  "anti_beggi_beggi",
  "anti_sales_pitch",
  "pause",
  "loop",
  "wrap_up",
]);

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
  selfRoastModeEnabled: boolean;
  statusAutoReplyEnabled: boolean;
  statusReplyRequireFunny: boolean;
  captureGroupMediaEnabled: boolean;
  funnyStatusKeywords: string[];
  funnyStatusEmojis: string[];
  aiFallbackMode: "all" | "azure_only";
  aiModelFirstEnabled: boolean;
  aiDeterministicModes: AiDeterministicMode[];
  aiAckRoutingEnabled: boolean;
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
  autoMarkReadEnabled: boolean;
  autoMarkReadGroups: boolean;
  autoMarkReadStatus: boolean;
  presenceSubscribeEnabled: boolean;
  chatModifyQuietHoursEnabled: boolean;
  aboutAutomationEnabled: boolean;
  aboutAutomationIntervalMinutes: number;
  aboutAutomationTemplate: string;
  sendRateWindowMinutes: number;
  sendMaxPerThreadInWindow: number;
  sendMaxGlobalInWindow: number;
  romanticPartnerJids: string[];
  romanticMorningEnabled: boolean;
  romanticMorningStartHour: number;
  romanticMorningEndHour: number;
  romanticMorningLeadRatio: number;
  romanticMorningCollisionCooldownHours: number;
  romanticMorningMaxPerThreadPerDay: number;
  outreachEnabled: boolean;
  outreachCadenceHours: number;
  outreachMaxContactsPerRun: number;
  outreachContactJids: string[];
  outreachStarterTemplate: string;
  statusBuilderEnabled: boolean;
  statusBuilderCadenceHours: number;
  statusBuilderDailyMaxPosts: number;
  statusBuilderTextPostRatio: number;
  statusBuilderReviewRatio: number;
  statusBuilderAudienceJids: string[];
  statusBuilderAudienceSampleSize: number;
  instagramDmDelayMinMs: number;
  instagramDmDelayMaxMs: number;
  instagramTypingMinMs: number;
  instagramTypingMaxMs: number;
  instagramSendRateWindowMinutes: number;
  instagramSendMaxPerThreadInWindow: number;
  instagramSendMaxGlobalInWindow: number;
  instagramStoryCadenceHours: number;
  instagramStoryDailyMaxPosts: number;
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
  selfRoastModeEnabled: false,
  statusAutoReplyEnabled: true,
  statusReplyRequireFunny: true,
  captureGroupMediaEnabled: false,
  funnyStatusKeywords: ["lol", "lmao", "haha", "funny", "joke", "banter", "meme", "roast"],
  funnyStatusEmojis: ["😂", "🤣", "😹", "😆", "😅", "😄", "😁", "😜", "🤪", "🙃"],
  aiFallbackMode: "all",
  aiModelFirstEnabled: false,
  aiDeterministicModes: DEFAULT_AI_DETERMINISTIC_MODES,
  aiAckRoutingEnabled: false,
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
  humanDelayMinMs: 22_000,
  humanDelayMaxMs: 95_000,
  humanTypingMinMs: 4_000,
  humanTypingMaxMs: 14_000,
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
  autoMarkReadEnabled: true,
  autoMarkReadGroups: false,
  autoMarkReadStatus: false,
  presenceSubscribeEnabled: true,
  chatModifyQuietHoursEnabled: false,
  aboutAutomationEnabled: false,
  aboutAutomationIntervalMinutes: 360,
  aboutAutomationTemplate: "",
  sendRateWindowMinutes: 60,
  sendMaxPerThreadInWindow: 4,
  sendMaxGlobalInWindow: 40,
  romanticPartnerJids: [],
  romanticMorningEnabled: true,
  romanticMorningStartHour: 6,
  romanticMorningEndHour: 10,
  romanticMorningLeadRatio: 0.7,
  romanticMorningCollisionCooldownHours: 8,
  romanticMorningMaxPerThreadPerDay: 1,
  outreachEnabled: false,
  outreachCadenceHours: 36,
  outreachMaxContactsPerRun: 3,
  outreachContactJids: [],
  outreachStarterTemplate: "Hey {{name}}, checking in on you today.",
  statusBuilderEnabled: true,
  statusBuilderCadenceHours: 2,
  statusBuilderDailyMaxPosts: 10,
  statusBuilderTextPostRatio: 0.25,
  statusBuilderReviewRatio: 0.35,
  statusBuilderAudienceJids: [],
  statusBuilderAudienceSampleSize: 80,
  instagramDmDelayMinMs: 16_000,
  instagramDmDelayMaxMs: 75_000,
  instagramTypingMinMs: 3_000,
  instagramTypingMaxMs: 11_000,
  instagramSendRateWindowMinutes: 60,
  instagramSendMaxPerThreadInWindow: 4,
  instagramSendMaxGlobalInWindow: 40,
  instagramStoryCadenceHours: 3,
  instagramStoryDailyMaxPosts: 6,
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

function parseAiDeterministicModes(value: string | undefined, fallback: AiDeterministicMode[]) {
  const parsed = parseList(value)
    .map((item) => item.trim().toLowerCase())
    .filter((item): item is AiDeterministicMode => ALLOWED_AI_DETERMINISTIC_MODE_SET.has(item as AiDeterministicMode));
  const deduped = [...new Set(parsed)];
  if (deduped.length === 0) {
    return [...fallback];
  }
  return deduped;
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
    selfRoastModeEnabled: parseBoolean(map.get("selfRoastModeEnabled"), DEFAULT_APP_CONFIG.selfRoastModeEnabled),
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
    aiModelFirstEnabled: parseBoolean(map.get("aiModelFirstEnabled"), DEFAULT_APP_CONFIG.aiModelFirstEnabled),
    aiDeterministicModes: parseAiDeterministicModes(map.get("aiDeterministicModes"), DEFAULT_APP_CONFIG.aiDeterministicModes),
    aiAckRoutingEnabled: parseBoolean(map.get("aiAckRoutingEnabled"), DEFAULT_APP_CONFIG.aiAckRoutingEnabled),
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
    autoMarkReadEnabled: parseBoolean(map.get("autoMarkReadEnabled"), DEFAULT_APP_CONFIG.autoMarkReadEnabled),
    autoMarkReadGroups: parseBoolean(map.get("autoMarkReadGroups"), DEFAULT_APP_CONFIG.autoMarkReadGroups),
    autoMarkReadStatus: parseBoolean(map.get("autoMarkReadStatus"), DEFAULT_APP_CONFIG.autoMarkReadStatus),
    presenceSubscribeEnabled: parseBoolean(
      map.get("presenceSubscribeEnabled"),
      DEFAULT_APP_CONFIG.presenceSubscribeEnabled,
    ),
    chatModifyQuietHoursEnabled: parseBoolean(
      map.get("chatModifyQuietHoursEnabled"),
      DEFAULT_APP_CONFIG.chatModifyQuietHoursEnabled,
    ),
    aboutAutomationEnabled: parseBoolean(map.get("aboutAutomationEnabled"), DEFAULT_APP_CONFIG.aboutAutomationEnabled),
    aboutAutomationIntervalMinutes: Math.round(
      clamp(
        parseNumber(map.get("aboutAutomationIntervalMinutes"), DEFAULT_APP_CONFIG.aboutAutomationIntervalMinutes),
        15,
        7 * 24 * 60,
      ),
    ),
    aboutAutomationTemplate: (map.get("aboutAutomationTemplate") ?? DEFAULT_APP_CONFIG.aboutAutomationTemplate).trim(),
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
    romanticPartnerJids: parseList(map.get("romanticPartnerJids")).slice(0, 300),
    romanticMorningEnabled: parseBoolean(map.get("romanticMorningEnabled"), DEFAULT_APP_CONFIG.romanticMorningEnabled),
    romanticMorningStartHour: Math.round(
      clamp(parseNumber(map.get("romanticMorningStartHour"), DEFAULT_APP_CONFIG.romanticMorningStartHour), 0, 23),
    ),
    romanticMorningEndHour: Math.round(
      clamp(parseNumber(map.get("romanticMorningEndHour"), DEFAULT_APP_CONFIG.romanticMorningEndHour), 0, 23),
    ),
    romanticMorningLeadRatio: clamp(
      parseNumber(map.get("romanticMorningLeadRatio"), DEFAULT_APP_CONFIG.romanticMorningLeadRatio),
      0,
      1,
    ),
    romanticMorningCollisionCooldownHours: Math.round(
      clamp(
        parseNumber(
          map.get("romanticMorningCollisionCooldownHours"),
          DEFAULT_APP_CONFIG.romanticMorningCollisionCooldownHours,
        ),
        1,
        72,
      ),
    ),
    romanticMorningMaxPerThreadPerDay: Math.round(
      clamp(
        parseNumber(
          map.get("romanticMorningMaxPerThreadPerDay"),
          DEFAULT_APP_CONFIG.romanticMorningMaxPerThreadPerDay,
        ),
        1,
        3,
      ),
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
      STATUS_BUILDER_MAX_TEXT_POST_RATIO,
    ),
    statusBuilderReviewRatio: clamp(
      parseNumber(map.get("statusBuilderReviewRatio"), DEFAULT_APP_CONFIG.statusBuilderReviewRatio),
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
    instagramDmDelayMinMs: Math.round(
      clamp(parseNumber(map.get("instagramDmDelayMinMs"), DEFAULT_APP_CONFIG.instagramDmDelayMinMs), 500, 180_000),
    ),
    instagramDmDelayMaxMs: Math.round(
      clamp(parseNumber(map.get("instagramDmDelayMaxMs"), DEFAULT_APP_CONFIG.instagramDmDelayMaxMs), 500, 240_000),
    ),
    instagramTypingMinMs: Math.round(
      clamp(parseNumber(map.get("instagramTypingMinMs"), DEFAULT_APP_CONFIG.instagramTypingMinMs), 200, 60_000),
    ),
    instagramTypingMaxMs: Math.round(
      clamp(parseNumber(map.get("instagramTypingMaxMs"), DEFAULT_APP_CONFIG.instagramTypingMaxMs), 200, 120_000),
    ),
    instagramSendRateWindowMinutes: Math.round(
      clamp(
        parseNumber(map.get("instagramSendRateWindowMinutes"), DEFAULT_APP_CONFIG.instagramSendRateWindowMinutes),
        5,
        24 * 60,
      ),
    ),
    instagramSendMaxPerThreadInWindow: Math.round(
      clamp(
        parseNumber(map.get("instagramSendMaxPerThreadInWindow"), DEFAULT_APP_CONFIG.instagramSendMaxPerThreadInWindow),
        1,
        100,
      ),
    ),
    instagramSendMaxGlobalInWindow: Math.round(
      clamp(
        parseNumber(map.get("instagramSendMaxGlobalInWindow"), DEFAULT_APP_CONFIG.instagramSendMaxGlobalInWindow),
        1,
        1000,
      ),
    ),
    instagramStoryCadenceHours: Math.round(
      clamp(parseNumber(map.get("instagramStoryCadenceHours"), DEFAULT_APP_CONFIG.instagramStoryCadenceHours), 1, 24 * 7),
    ),
    instagramStoryDailyMaxPosts: Math.round(
      clamp(parseNumber(map.get("instagramStoryDailyMaxPosts"), DEFAULT_APP_CONFIG.instagramStoryDailyMaxPosts), 1, 24),
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
