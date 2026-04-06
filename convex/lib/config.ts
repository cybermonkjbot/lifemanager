import type { MutationCtx, QueryCtx } from "./types";
import { DEFAULT_AUTONOMY_PAUSED, DEFAULT_IGNORE_GROUPS } from "./constants";

export type AppConfig = {
  autonomyPaused: boolean;
  ignoreGroupsByDefault: boolean;
  reactionsEnabled: boolean;
  stickersEnabled: boolean;
  memesEnabled: boolean;
  soulModeEnabled: boolean;
  humorLearningEnabled: boolean;
  statusAutoReplyEnabled: boolean;
  statusReplyRequireFunny: boolean;
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
  humanDelayMinMs: number;
  humanDelayMaxMs: number;
  humanTypingMinMs: number;
  humanTypingMaxMs: number;
  outboxClaimLimit: number;
  outboxPollMs: number;
  inboundMergeWindowMs: number;
  inboundConcurrency: number;
  outboxSendConcurrency: number;
  outreachEnabled: boolean;
  outreachCadenceHours: number;
  outreachMaxContactsPerRun: number;
  outreachContactJids: string[];
  outreachStarterTemplate: string;
};

export const DEFAULT_APP_CONFIG: AppConfig = {
  autonomyPaused: DEFAULT_AUTONOMY_PAUSED,
  ignoreGroupsByDefault: DEFAULT_IGNORE_GROUPS,
  reactionsEnabled: true,
  stickersEnabled: true,
  memesEnabled: true,
  soulModeEnabled: true,
  humorLearningEnabled: true,
  statusAutoReplyEnabled: true,
  statusReplyRequireFunny: true,
  funnyStatusKeywords: ["lol", "lmao", "haha", "funny", "joke", "banter", "meme", "wild", "roast", "status", "story", "dead"],
  funnyStatusEmojis: ["😂", "🤣", "😹", "😆", "😅", "😄", "😁", "😜", "🤪", "🙃", "🔥", "💀"],
  aiFallbackMode: "all",
  aiTemperature: 0.7,
  aiMaxOutputTokens: 140,
  aiMaxReplyChars: 320,
  aiHistoryLineLimit: 12,
  aiPrimaryConfidence: 0.78,
  aiFallbackConfidence: 0.58,
  aiReplyPolicy: "",
  aiSystemInstruction: "",
  humanDelayMinMs: 12_000,
  humanDelayMaxMs: 65_000,
  humanTypingMinMs: 2_500,
  humanTypingMaxMs: 9_000,
  outboxClaimLimit: 8,
  outboxPollMs: 3_000,
  inboundMergeWindowMs: 45_000,
  inboundConcurrency: 4,
  outboxSendConcurrency: 4,
  outreachEnabled: false,
  outreachCadenceHours: 36,
  outreachMaxContactsPerRun: 3,
  outreachContactJids: [],
  outreachStarterTemplate: "Hey {{name}}, checking in on you today.",
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

export async function getConfig(ctx: QueryCtx | MutationCtx): Promise<AppConfig> {
  const rows = await ctx.db.query("appConfig").take(120);
  const map = new Map(rows.map((row) => [row.key, row.value]));

  return {
    autonomyPaused: parseBoolean(map.get("autonomyPaused"), DEFAULT_APP_CONFIG.autonomyPaused),
    ignoreGroupsByDefault: parseBoolean(map.get("ignoreGroupsByDefault"), DEFAULT_APP_CONFIG.ignoreGroupsByDefault),
    reactionsEnabled: parseBoolean(map.get("reactionsEnabled"), DEFAULT_APP_CONFIG.reactionsEnabled),
    stickersEnabled: parseBoolean(map.get("stickersEnabled"), DEFAULT_APP_CONFIG.stickersEnabled),
    memesEnabled: parseBoolean(map.get("memesEnabled"), DEFAULT_APP_CONFIG.memesEnabled),
    soulModeEnabled: parseBoolean(map.get("soulModeEnabled"), DEFAULT_APP_CONFIG.soulModeEnabled),
    humorLearningEnabled: parseBoolean(map.get("humorLearningEnabled"), DEFAULT_APP_CONFIG.humorLearningEnabled),
    statusAutoReplyEnabled: parseBoolean(map.get("statusAutoReplyEnabled"), DEFAULT_APP_CONFIG.statusAutoReplyEnabled),
    statusReplyRequireFunny: parseBoolean(map.get("statusReplyRequireFunny"), DEFAULT_APP_CONFIG.statusReplyRequireFunny),
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
    humanDelayMinMs: Math.round(clamp(parseNumber(map.get("humanDelayMinMs"), DEFAULT_APP_CONFIG.humanDelayMinMs), 500, 180_000)),
    humanDelayMaxMs: Math.round(clamp(parseNumber(map.get("humanDelayMaxMs"), DEFAULT_APP_CONFIG.humanDelayMaxMs), 500, 240_000)),
    humanTypingMinMs: Math.round(clamp(parseNumber(map.get("humanTypingMinMs"), DEFAULT_APP_CONFIG.humanTypingMinMs), 200, 60_000)),
    humanTypingMaxMs: Math.round(clamp(parseNumber(map.get("humanTypingMaxMs"), DEFAULT_APP_CONFIG.humanTypingMaxMs), 200, 120_000)),
    outboxClaimLimit: Math.round(clamp(parseNumber(map.get("outboxClaimLimit"), DEFAULT_APP_CONFIG.outboxClaimLimit), 1, 20)),
    outboxPollMs: Math.round(clamp(parseNumber(map.get("outboxPollMs"), DEFAULT_APP_CONFIG.outboxPollMs), 500, 60_000)),
    inboundMergeWindowMs: Math.round(
      clamp(parseNumber(map.get("inboundMergeWindowMs"), DEFAULT_APP_CONFIG.inboundMergeWindowMs), 2_000, 180_000),
    ),
    inboundConcurrency: Math.round(clamp(parseNumber(map.get("inboundConcurrency"), DEFAULT_APP_CONFIG.inboundConcurrency), 1, 16)),
    outboxSendConcurrency: Math.round(
      clamp(parseNumber(map.get("outboxSendConcurrency"), DEFAULT_APP_CONFIG.outboxSendConcurrency), 1, 16),
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
