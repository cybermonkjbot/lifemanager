import makeWASocket, {
  Browsers,
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestWaWebVersion,
  useMultiFileAuthState,
  type WAMessage,
  type UserFacingSocketConfig,
} from "baileys";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import pino from "pino";
import { ConvexHttpClient } from "convex/browser";
import type { Id } from "../../convex/_generated/dataModel";
import {
  resolveGhostingSeverity,
  resolveLongSilenceReopenMs,
  resolveLongSilenceReopenWeeks,
} from "../../convex/lib/outboundGuard";
import { hasPidginCasualSignal, hasPidginSignal } from "../../shared/pidgin-lexicon";
import { convexRefs } from "../lib/convex-refs";
import { acquireWorkerLock, releaseWorkerLockSync } from "../lib/runtime/worker-lock";
import {
  getAppRuntimeStatus,
  pauseAppRuntime,
  restartAppRuntime,
  resumeAppRuntime,
  startAppRuntime,
} from "../lib/runtime/app-runtime";
import {
  describeInboundImageWithFallback,
  generateMemeImageWithAzure,
  generateReplyWithFallback,
  estimateDelayAndTyping,
  normalizeOutboundText,
  routeAckResponseChannel,
  type AiAttempt,
  type ConversationSteeringMode,
  type ModelToolContext,
} from "./ai";
import {
  EMOJI_COOLDOWN_MS,
  applyEmojiCooldownPolicy,
  containsAnyEmoji,
} from "./emoji-policy";
import {
  buildHistorySearchOverride,
  maybeFetchOlderHistoryForThread,
  readHistoryFetchConfigFromEnv,
} from "./history-context";
import { decideOlderContextUsage } from "./context-recall-policy";
import {
  isBroadcastOrSystemJid,
  classifyThreadKindFromJid,
  getSenderJid,
  getThreadJid,
  isGroupJid,
  parseInboundMessage,
  type ParsedInboundMessage,
} from "./whatsapp";
import {
  decideInboundVisionAnalysis,
  readVisionFilterModeFromEnv,
  readVisionFilterUncaptionedCooldownMsFromEnv,
} from "./vision-filter";
import { transcribeWithWhisperCpp, type WhisperTranscriptionResult } from "./stt";
import {
  buildStatusInterestSearchQueries,
  evaluateStatusOutreachLimit,
  forceDeclarativeStatusText,
  isLikelyMarketingStatus,
  pickLaughReactionEmoji,
  shouldUseLaughReactionOnly,
} from "./status-policy";
import {
  buildPdfAwareInboundText,
  buildPdfReplyPolicyInstruction,
  describePdfContextForLog,
  enforcePdfReplyShape,
  extractPdfTextContext,
  isPdfInboundDocument,
  type PdfTextContext,
} from "./pdf";
import {
  evaluateMemeTimingGate,
  evaluateProfessionalMemeGuard,
  resolveMemeAssetWithFallback,
  type MemeAssetSource,
} from "./meme-policy";
import { parseRuntimeCommand, type RuntimeCommand, type RuntimeCommandTarget } from "./runtime-commands";
import { parseSelfImproveCommand, type SelfImproveCommand } from "./self-improve-command";
import { isSelfControlHelpCommand } from "./control-help-command";
import { shouldAttemptSelfControlOnUpsert } from "./self-control-routing";
import { isStrictSelfControlScope } from "./self-control-scope";
import { parseSelfControlCommandText } from "./self-control-command-text";
import { parseOpenClawCommand, type OpenClawCommand } from "./openclaw-command";

const logger = pino({
  name: "slm-worker",
  level: process.env.LOG_LEVEL || "info",
});

type RuntimeSettings = {
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
  funnyStatusKeywords: string[];
  funnyStatusEmojis: string[];
  aiTemperature: number;
  aiMaxOutputTokens: number;
  aiMaxReplyChars: number;
  aiHistoryLineLimit: number;
  aiFallbackMode: "all" | "azure_only";
  aiModelFirstEnabled: boolean;
  aiDeterministicModes: string[];
  aiAckRoutingEnabled: boolean;
  aiPrimaryConfidence: number;
  aiFallbackConfidence: number;
  aiReplyPolicy: string;
  aiSystemInstruction: string;
  activePersonaPackId: string;
  qualityGateMode: "auto_rewrite_once" | "manual_review" | "log_only";
  qualityGateThreshold: number;
  humanDelayMinMs: number;
  humanDelayMaxMs: number;
  humanTypingMinMs: number;
  humanTypingMaxMs: number;
  outboxClaimLimit: number;
  outboxPollMs: number;
  inboundConcurrency: number;
  outboxSendConcurrency: number;
  captureGroupMediaEnabled: boolean;
  statusRetentionMs: number;
  statusCleanupIntervalMs: number;
  statusCleanupBatchLimit: number;
  statusContextKeepPerThread: number;
  groupContextKeepPerThread: number;
  contextCompactionIntervalMs: number;
  contextCompactionMaxThreads: number;
  contextCompactionMaxDeletes: number;
  compactContextGroupJids: string[];
  statusBuilderEnabled: boolean;
  statusBuilderCadenceHours: number;
  statusBuilderDailyMaxPosts: number;
  statusBuilderTextPostRatio: number;
  statusBuilderReviewRatio: number;
  statusBuilderAudienceJids: string[];
  statusBuilderAudienceSampleSize: number;
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
};

type StyleProfileSnapshot = {
  mimicryLevel?: number;
  commonPhrases?: string[];
  punctuationStyle?: string[];
  humorNotes?: string[];
  spellingNotes?: string[];
  learnedEmojiAllowlist?: string[];
  learnedEmojiCategoryHints?: string[];
} | null;

type ContactMemoryFactSnapshot = {
  factKey: string;
  factValue: string;
  factType: "preference" | "profile" | "schedule" | "relationship" | "promise" | "other";
  confidence: number;
};

type ContactFactsSnapshot = {
  facts?: ContactMemoryFactSnapshot[];
} | null;

type HistorySearchOverrideSnapshot = {
  lines: string[];
  candidateCount: number;
  semanticRerankCount: number;
  confidence: number;
  retrievalStage?: "lexical" | "semantic" | "semantic_fallback";
};

type OutboxClaimedItem = {
  outboxId: string;
  threadId: string;
  toolRunId?: string;
  jid: string;
  messageProvider: "whatsapp" | "instagram";
  messageText: string;
  typingMs: number;
  provider: "azure" | "codex" | "heuristic";
  sendKind: "text" | "reaction" | "sticker" | "meme";
  isStatusPost?: boolean;
  statusAudienceJids?: string[];
  statusTrendTheme?: string;
  statusDemographicHint?: string;
  statusFormat?: "text" | "meme";
  statusReviewRequired?: boolean;
  reactionEmoji?: string;
  reactionTargetProviderMessageId?: string;
  reactionTargetWhatsAppMessageId?: string;
  preReactionEmoji?: string;
  mediaAssetId?: string;
  mediaCaption?: string;
  replyTargetProviderMessageId?: string;
  replyTargetWhatsAppMessageId?: string;
  replyTargetSenderJid?: string;
  replyTargetText?: string;
  replyTargetMessageAt?: number;
};

type ExternalWebTrendSearchPayload = {
  tool?: "external_search.web";
  query?: string;
  provider?: string;
  results?: Array<{
    title?: string;
    snippet?: string;
    url?: string;
    source?: string;
    confidence?: number;
  }>;
  warnings?: string[];
};

type StatusVoiceHintsPayload = {
  tool?: "style.status_voice";
  totalSamples?: number;
  recurringPhrases?: string[];
  toneNotes?: string[];
  sampleLines?: string[];
  avgWords?: number;
  emojiRate?: number;
  questionRate?: number;
};

type StickerAssetSnapshot = {
  _id: string;
  label: string;
  tags?: string[];
  contextSummary?: string;
  contextTags?: string[];
  contextTriggers?: string[];
  contextAvoid?: string[];
  contextConfidence?: number;
  contextUpdatedAt?: number;
};

type PersonalityThreadSetting = {
  profileSlug?: string;
  intensity?: number;
  customPrompt?: string;
  memePolicyMode?: "auto" | "always_allow" | "always_block";
  threadPromptProfile?: string;
  threadPromptProfileSource?: "manual" | "auto";
  profile?: {
    slug?: string;
    name?: string;
    description?: string;
    prompt?: string;
  } | null;
} | null;

type ThreadContextSnapshot = {
  messages: Array<{
    _id: string;
    direction: "inbound" | "outbound";
    isStatus?: boolean;
    text: string;
    messageType?: string;
    whatsappMessageId?: string;
    senderJid?: string;
    messageAt?: number;
    origin?: "live" | "history_sync" | "history_fetch";
  }>;
  grounding?: { myName?: string; theirName?: string; autoAliases?: string[]; vibeNotes?: string } | null;
  memory?: { styleNotes?: string[] } | null;
} | null;

type SystemHealthSnapshot = {
  config?: { autonomyPaused?: boolean };
} | null;

const AI_OUTREACH_PLACEHOLDER = "__SLM_AI_OUTREACH__";
const AI_STATUS_PLACEHOLDER = "__SLM_AI_STATUS__";
const DEFAULT_NIGHT_WIND_DOWN_START_HOUR = 23;
const DEFAULT_NIGHT_WIND_DOWN_END_HOUR = 7;
const TEXT_EMOJI_ALLOWLIST = ["🌚", "🙂‍↔️", "🥲", "😒"];
const TEXT_EMOJI_MAX_PER_WINDOW = 2;
const TEXT_EMOJI_NON_ALLOWLIST_WARMUP_MAX_PER_WINDOW = 2;
const TEXT_EMOJI_WINDOW_MS = 6 * 60 * 60 * 1000;
const STICKER_COMPANION_COOLDOWN_MS = 45 * 60 * 1000;
const CALL_FALLBACK_COOLDOWN_MS = 20 * 60 * 1000;
const CALL_AUTO_DECLINE_FALLBACK_TEXT =
  process.env.SLM_CALL_FALLBACK_TEXT?.trim() ||
  "I can't take WhatsApp calls here right now. Please send a message and I'll reply here.";
const STATUS_RETENTION_MS = 40 * 60 * 1000;
const STATUS_CLEANUP_INTERVAL_MS = 40 * 60 * 1000;
const STATUS_CLEANUP_BATCH_LIMIT = 160;
const CONTEXT_COMPACTION_INTERVAL_MS = 12 * 60 * 1000;
const CONTEXT_COMPACTION_MAX_THREADS = 24;
const CONTEXT_COMPACTION_MAX_DELETES = 260;
const BLOCKLIST_CACHE_TTL_MS = 90 * 1000;
const BLOCKLIST_FORCE_REFRESH_INTERVAL_MS = 8 * 60 * 1000;
const PRIVACY_PREFLIGHT_MIN_INTERVAL_MS = 30 * 60 * 1000;
const DEFAULT_AUTO_MARK_READ_ENABLED = readEnvBoolean("SLM_AUTO_MARK_READ_ENABLED", true);
const DEFAULT_AUTO_MARK_READ_GROUPS_ENABLED = readEnvBoolean("SLM_AUTO_MARK_READ_GROUPS", false);
const DEFAULT_AUTO_MARK_READ_STATUS_ENABLED = readEnvBoolean("SLM_AUTO_MARK_READ_STATUS", false);
const READ_RECEIPT_DEDUPE_TTL_MS = 12 * 60 * 1000;
const DEFAULT_PRESENCE_SUBSCRIBE_ENABLED = readEnvBoolean("SLM_PRESENCE_SUBSCRIBE_ENABLED", true);
const PRESENCE_SUBSCRIBE_COOLDOWN_MS = 4 * 60 * 1000;
const DEFAULT_CHAT_MODIFY_QUIET_HOURS_ENABLED = readEnvBoolean("SLM_CHAT_MODIFY_QUIET_HOURS_ENABLED", false);
const CHAT_MODIFY_QUIET_HOURS_MIN_INTERVAL_MS = 3 * 60 * 1000;
const DEFAULT_ABOUT_AUTOMATION_ENABLED = readEnvBoolean("SLM_ABOUT_AUTOMATION_ENABLED", false);
const DEFAULT_ABOUT_AUTOMATION_INTERVAL_MINUTES = Math.max(
  15,
  Math.min(Number(process.env.SLM_ABOUT_AUTOMATION_INTERVAL_MINUTES || 360), 7 * 24 * 60),
);
const DEFAULT_ABOUT_AUTOMATION_TEMPLATE = (process.env.SLM_ABOUT_AUTOMATION_TEMPLATE || "").trim();
const CORE_HUMOR_PATTERN_GLOBAL = /\b(lol|lmao|lmfao|rofl|haha|hehe|funny|joke|banter|meme|roast|hilarious)\b/gi;
const CORE_HUMOR_EMOJI_PATTERN = /[😂🤣😹😆😄😁😅😜🤪🙃]/u;
const CORE_HUMOR_EMOJI_PATTERN_GLOBAL = /[😂🤣😹😆😄😁😅😜🤪🙃]/gu;
const LOW_SIGNAL_HUMOR_KEYWORDS = new Set(["status", "story", "update", "wild", "dead"]);
const HUMOR_SINGLE_TOKEN_ONLY_PATTERN = /^\s*(?:lol|lmao|lmfao|rofl|haha|hehe|😂|🤣|😹|😆|😄|😁|😅|😜|🤪|🙃)\s*[.!?]*\s*$/i;
const HUMOR_CONTEXT_BLOCK_PATTERNS = [
  /\b(death|died|funeral|burial|rip|hospital|surgery|diagnosis|cancer|emergency|accident|abuse|assault|suicid|depress(?:ed|ion)?)\b/i,
  /\b(password|otp|pin|social security|bank account|wire transfer|routing number|sort code|scam|fraud)\b/i,
  /\b(court|lawyer|legal|lawsuit|arrestd?|police report)\b/i,
  /\b(rent|salary|debt|loan|invoice overdue|payment issue)\b/i,
];
const VISION_FILTER_MODE = readVisionFilterModeFromEnv();
const VISION_FILTER_UNCAPTIONED_COOLDOWN_MS = readVisionFilterUncaptionedCooldownMsFromEnv();

type OutboundPolicy =
  | {
      mode: "reaction_only";
      emoji: string;
    }
  | {
      mode: "reaction_plus_text";
      emoji: string;
    }
  | {
      mode: "sticker";
      mediaAssetId: string;
    }
  | {
      mode: "meme";
      mediaAssetId: string;
      assetSource: "generated" | "uploaded";
    }
  | {
      mode: "text";
    };

const ALLOWED_RUNTIME_DETERMINISTIC_MODE_SET = new Set<ConversationSteeringMode>([
  "hard_stop",
  "anti_beggi_beggi",
  "anti_sales_pitch",
  "pause",
  "loop",
  "wrap_up",
]);

function readEnvBoolean(name: string, defaultValue: boolean) {
  const raw = (process.env[name] || "").trim().toLowerCase();
  if (!raw) {
    return defaultValue;
  }
  return raw !== "false" && raw !== "0" && raw !== "off" && raw !== "no";
}

function resolveAutoMarkReadEnabled(runtimeSettings: RuntimeSettings | null) {
  return runtimeSettings?.autoMarkReadEnabled ?? DEFAULT_AUTO_MARK_READ_ENABLED;
}

function resolveAutoMarkReadGroupsEnabled(runtimeSettings: RuntimeSettings | null) {
  return runtimeSettings?.autoMarkReadGroups ?? DEFAULT_AUTO_MARK_READ_GROUPS_ENABLED;
}

function resolveAutoMarkReadStatusEnabled(runtimeSettings: RuntimeSettings | null) {
  return runtimeSettings?.autoMarkReadStatus ?? DEFAULT_AUTO_MARK_READ_STATUS_ENABLED;
}

function resolvePresenceSubscribeEnabled(runtimeSettings: RuntimeSettings | null) {
  return runtimeSettings?.presenceSubscribeEnabled ?? DEFAULT_PRESENCE_SUBSCRIBE_ENABLED;
}

function resolveChatModifyQuietHoursEnabled(runtimeSettings: RuntimeSettings | null) {
  return runtimeSettings?.chatModifyQuietHoursEnabled ?? DEFAULT_CHAT_MODIFY_QUIET_HOURS_ENABLED;
}

function resolveAboutAutomationEnabled(runtimeSettings: RuntimeSettings | null) {
  return runtimeSettings?.aboutAutomationEnabled ?? DEFAULT_ABOUT_AUTOMATION_ENABLED;
}

function resolveAboutAutomationIntervalMs(runtimeSettings: RuntimeSettings | null) {
  const minutes = Math.round(
    clamp(runtimeSettings?.aboutAutomationIntervalMinutes ?? DEFAULT_ABOUT_AUTOMATION_INTERVAL_MINUTES, 15, 7 * 24 * 60),
  );
  return minutes * 60 * 1000;
}

function resolveAboutAutomationTemplate(runtimeSettings: RuntimeSettings | null) {
  const template = runtimeSettings?.aboutAutomationTemplate?.trim();
  return template || DEFAULT_ABOUT_AUTOMATION_TEMPLATE;
}

function resolveRuntimeDeterministicModes(modes: string[] | undefined) {
  const parsed = (modes || [])
    .map((mode) => mode.trim().toLowerCase())
    .filter(
      (mode): mode is ConversationSteeringMode =>
        mode !== "none" && ALLOWED_RUNTIME_DETERMINISTIC_MODE_SET.has(mode as ConversationSteeringMode),
    );
  return parsed.length ? [...new Set(parsed)] : undefined;
}

function chooseReactionEmoji(text: string) {
  if (/\b(thanks|thank you|thx)\b/i.test(text)) {
    return "🙏";
  }
  if (/\b(love|great|awesome|perfect)\b/i.test(text)) {
    return "❤️";
  }
  if (/\b(ok|okay|sure|alright|cool|noted|done)\b/i.test(text)) {
    return "👍";
  }
  return "👍";
}

function escapeRegex(input: string) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function countConfiguredHumorKeywordHits(text: string, keywords: string[]) {
  let hits = 0;
  for (const keyword of keywords) {
    const normalized = keyword.trim().toLowerCase();
    if (!normalized || LOW_SIGNAL_HUMOR_KEYWORDS.has(normalized)) {
      continue;
    }
    const pattern = new RegExp(`\\b${escapeRegex(normalized)}\\b`, "i");
    if (pattern.test(text)) {
      hits += 1;
    }
  }
  return hits;
}

function hasConfiguredHumorEmojiHit(text: string, emojis: string[]) {
  return emojis.some((emoji) => emoji && CORE_HUMOR_EMOJI_PATTERN.test(emoji) && text.includes(emoji));
}

function countCoreHumorKeywordHits(text: string) {
  return text.match(CORE_HUMOR_PATTERN_GLOBAL)?.length ?? 0;
}

function countCoreHumorEmojiHits(text: string) {
  return text.match(CORE_HUMOR_EMOJI_PATTERN_GLOBAL)?.length ?? 0;
}

function hasHumorContextBlock(text: string) {
  return HUMOR_CONTEXT_BLOCK_PATTERNS.some((pattern) => pattern.test(text));
}

function hasHumorSignal(text: string, funnyKeywords: string[], funnyEmojis: string[]) {
  const normalized = text.trim();
  if (normalized.length < 10) {
    return false;
  }
  if (HUMOR_SINGLE_TOKEN_ONLY_PATTERN.test(normalized)) {
    return false;
  }
  if (hasHumorContextBlock(normalized)) {
    return false;
  }

  const coreKeywordHits = countCoreHumorKeywordHits(normalized);
  const coreEmojiHits = countCoreHumorEmojiHits(normalized);
  const configuredKeywordHits = countConfiguredHumorKeywordHits(normalized, funnyKeywords);
  const configuredEmojiHit = hasConfiguredHumorEmojiHit(normalized, funnyEmojis);
  const hasPlayfulCue = /\b(joke|banter|roast|meme|tease|playful|hilarious|comic|funny)\b/i.test(normalized);

  if (coreKeywordHits >= 2 || configuredKeywordHits >= 2) {
    return true;
  }
  if ((coreEmojiHits >= 1 || configuredEmojiHit) && (coreKeywordHits >= 1 || configuredKeywordHits >= 1 || hasPlayfulCue)) {
    return true;
  }
  if ((coreKeywordHits >= 1 || configuredKeywordHits >= 1) && hasPlayfulCue) {
    return true;
  }
  if ((coreKeywordHits >= 1 || configuredKeywordHits >= 1) && normalized.length >= 28 && !/\b(status|story)\b/i.test(normalized)) {
    return true;
  }
  return false;
}

function looksLikeAckOnly(text: string) {
  const trimmed = text.trim();
  if (trimmed.length > 40) {
    return false;
  }
  return /\b(ok|okay|sure|cool|great|thanks|thank you|noted|done|alright)\b/i.test(trimmed);
}

function shouldUseMeme(text: string, funnyKeywords: string[], funnyEmojis: string[]) {
  return /\b(meme|reaction image|template)\b/i.test(text) || hasHumorSignal(text, funnyKeywords, funnyEmojis);
}

function positiveTone(text: string, funnyKeywords: string[], funnyEmojis: string[]) {
  return hasHumorSignal(text, funnyKeywords, funnyEmojis);
}

function looksLikeFunnyStatus(text: string, funnyKeywords: string[], funnyEmojis: string[]) {
  const hasStatusWord = /\b(status|story|update)\b/i.test(text);
  const hasPlayfulSignal = hasHumorSignal(text, funnyKeywords, funnyEmojis);
  return hasStatusWord && hasPlayfulSignal;
}

function isSeriousConversation(text: string) {
  return /\b(death|died|funeral|burial|rip|hospital|surgery|diagnosis|cancer|emergency|accident|police|court|lawyer|legal|lawsuit|contract|salary|rent|debt|loan|bank|wire|transfer|fraud|otp|password|security|refund|chargeback|abuse|assault|suicid|depress(ed|ion)?)\b/i.test(
    text,
  );
}

function hasGenZCasualSignal(text: string) {
  return (
    /\b(bro|sis|bestie|babe|baby|shawty|fr|ngl|tbh|idk|ikr|vibe|vibes|vibing|soft life|lmao|lol|banter)\b/i.test(text) ||
    hasPidginCasualSignal(text)
  );
}

function hasStickerCue(text: string) {
  return /\b(sticker|stickerify|drop (a|that) sticker|send (a|that) sticker|sticker me)\b/i.test(text);
}

type StoredMessageType = "text" | "reaction" | "sticker" | "meme" | "image" | "video" | "audio" | "document";
type CapturableMediaKind = "sticker" | "image" | "video" | "audio" | "document";

function resolveMessageTypeFromParsed(parsed: ParsedInboundMessage): StoredMessageType {
  if (parsed.kind === "reaction") {
    return "reaction";
  }
  if (parsed.kind === "sticker") {
    return "sticker";
  }
  if (parsed.kind === "image") {
    return "image";
  }
  if (parsed.kind === "video") {
    return "video";
  }
  if (parsed.kind === "audio") {
    return "audio";
  }
  if (parsed.kind === "document") {
    return "document";
  }
  return "text";
}

function resolveCapturableMediaKind(parsed: ParsedInboundMessage): CapturableMediaKind | null {
  if (parsed.kind === "sticker") {
    return "sticker";
  }
  if (parsed.kind === "image") {
    return "image";
  }
  if (parsed.kind === "video") {
    return "video";
  }
  if (parsed.kind === "audio") {
    return "audio";
  }
  if (parsed.kind === "document") {
    return "document";
  }
  return null;
}

function resolveMediaCaptionFromParsed(parsed: ParsedInboundMessage) {
  if (parsed.kind === "sticker" || parsed.kind === "image" || parsed.kind === "video" || parsed.kind === "document") {
    return parsed.caption;
  }
  return undefined;
}

function hasStatusInterestSignal(text: string) {
  return /\b(science|scientific|technology|tech|ai|a\.i\.|artificial intelligence|machine learning|robotics|research|breakthrough|innovation|nigerian stock market|nigerian stocks|nigerian equities|nse|ngx|nigeria exchange|crypto|cryptocurrency|bitcoin|btc|ethereum|eth|forex|fx|usdngn|usd\/ngn|naira|goldusd|gold\/usd|xauusd|xau\/usd)\b/i.test(
    text,
  );
}

function hasLinkOrEmail(text: string) {
  const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
  const urlPattern =
    /\b(?:https?:\/\/|www\.)\S+|\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|net|org|io|co|ng|edu|gov|info|ai|app|dev|xyz|me|tv|ly|biz|us|uk|ca|au|de|fr|jp|in|za)\b(?:\/\S*)?/i;
  return emailPattern.test(text) || urlPattern.test(text);
}

function countUnansweredOutboundTail(
  messages: Array<{
    direction: "inbound" | "outbound";
  }>,
) {
  let count = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.direction !== "outbound") {
      break;
    }
    count += 1;
  }
  return count;
}

function latestInboundAt(
  messages: Array<{
    direction: "inbound" | "outbound";
    messageAt?: number;
  }>,
) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.direction === "inbound" && Number.isFinite(message.messageAt) && (message.messageAt || 0) > 0) {
      return Number(message.messageAt);
    }
  }
  return undefined;
}

function inferGhostReopenTone(
  messages: Array<{
    direction: "inbound" | "outbound";
    text: string;
  }>,
) {
  const recent = messages.slice(-60);
  const hardBanterPattern = /\b(mf|mfs|motherf\w*|f\*+k|fuck)\b/i;
  const playfulPattern = /\b(lol|lmao|lmfao|haha|bro|banter|roast)\b|[😂🤣😅😹]/i;

  let hasNaijaSignal = false;
  let hasPlayfulSignal = false;
  let inboundHardBanter = false;
  let outboundHardBanter = false;

  for (const message of recent) {
    const text = (message.text || "").toLowerCase();
    if (!text) {
      continue;
    }
    if (hasPidginSignal({ inboundText: text, threshold: 1.0 })) {
      hasNaijaSignal = true;
    }
    if (playfulPattern.test(text)) {
      hasPlayfulSignal = true;
    }
    if (hardBanterPattern.test(text)) {
      if (message.direction === "inbound") {
        inboundHardBanter = true;
      } else {
        outboundHardBanter = true;
      }
    }
  }

  if (hasNaijaSignal) {
    return "naija_tease" as const;
  }
  if (inboundHardBanter && outboundHardBanter) {
    return "hard_banter" as const;
  }
  if (hasPlayfulSignal) {
    return "playful" as const;
  }
  return "warm" as const;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(value, max));
}

function normalizeHour(raw: number | undefined, fallback: number) {
  if (!Number.isFinite(raw)) {
    return fallback;
  }
  const hour = Math.round(raw as number);
  return Math.max(0, Math.min(hour, 23));
}

function isWithinHourWindow(hour: number, startHour: number, endHour: number) {
  if (startHour === endHour) {
    return false;
  }
  if (startHour < endHour) {
    return hour >= startHour && hour < endHour;
  }
  return hour >= startHour || hour < endHour;
}

function computeNextWindowEnd(nowMs: number, startHour: number, endHour: number) {
  const next = new Date(nowMs);
  const hour = next.getHours();

  if (startHour === endHour) {
    return nowMs;
  }
  if (startHour < endHour) {
    if (hour >= startHour && hour < endHour) {
      next.setHours(endHour, 0, 0, 0);
      return next.getTime();
    }
    return nowMs;
  }
  if (hour >= startHour) {
    next.setDate(next.getDate() + 1);
    next.setHours(endHour, 0, 0, 0);
    return next.getTime();
  }
  if (hour < endHour) {
    next.setHours(endHour, 0, 0, 0);
    return next.getTime();
  }
  return nowMs;
}

function buildNightWindDownInstruction(resumeAtMs: number) {
  const resumeLabel = new Date(resumeAtMs).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `It's late night. Gently close this chat in 1 short line and do not start new topics. Prefer phrasing like "I'll get back to you tomorrow", "I'm famished and need some rest", or "Let's continue after ${resumeLabel}". Do not ask follow-up questions.`;
}

function historySyncEnabled() {
  const raw = (process.env.SLM_HISTORY_SYNC_ENABLED || "true").trim().toLowerCase();
  return raw !== "false" && raw !== "0" && raw !== "off";
}

function createDynamicLimiter(getMax: () => number) {
  let active = 0;
  const queue: Array<() => void> = [];

  const release = () => {
    active = Math.max(0, active - 1);
    while (queue.length > 0 && active < Math.max(1, getMax())) {
      const next = queue.shift();
      if (!next) {
        break;
      }
      active += 1;
      next();
    }
  };

  return async <T>(task: () => Promise<T>) => {
    if (active >= Math.max(1, getMax())) {
      await new Promise<void>((resolve) => {
        queue.push(resolve);
      });
    } else {
      active += 1;
    }

    try {
      return await task();
    } finally {
      release();
    }
  };
}

function normalizeIncomingMessageTimestamp(rawTimestamp: unknown, fallbackMs: number) {
  const parsed = Number(rawTimestamp);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallbackMs;
  }
  if (parsed < 10_000_000_000) {
    return parsed * 1000;
  }
  return parsed;
}

function attemptStageLabel(stage: AiAttempt["stage"]) {
  switch (stage) {
    case "azure_responses":
      return "Azure Responses";
    case "azure_sdk":
      return "Azure SDK";
    case "azure_http":
      return "Azure HTTP fallback";
    case "codex_cli":
      return "Codex CLI fallback";
    case "ack_router_azure":
      return "Ack router (Azure)";
    case "ack_router_codex":
      return "Ack router (Codex)";
    case "humor_judge_azure":
      return "Humor judge (Azure)";
    case "humor_judge_codex":
      return "Humor judge (Codex)";
    case "heuristic_guardrail":
      return "Heuristic guardrail";
    case "heuristic_fallback":
      return "Heuristic fallback";
    default:
      return stage;
  }
}

function attemptEventType(attempt: AiAttempt) {
  if (attempt.stage === "heuristic_guardrail") {
    return "ai.guardrail.blocked";
  }
  if (attempt.stage === "heuristic_fallback") {
    return "ai.fallback.heuristic.used";
  }
  if (attempt.stage === "codex_cli") {
    return attempt.status === "success" ? "ai.fallback.codex.success" : "ai.fallback.codex.error";
  }
  if (attempt.stage === "ack_router_azure" || attempt.stage === "ack_router_codex") {
    return attempt.status === "success"
      ? `ai.ack_router.attempt.${attempt.provider}.success`
      : `ai.ack_router.attempt.${attempt.provider}.error`;
  }
  return attempt.status === "success" ? `ai.attempt.${attempt.stage}.success` : `ai.attempt.${attempt.stage}.error`;
}

function compactLogText(value: string, maxChars: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxChars - 3))}...`;
}

function formatAttemptUsage(attempt: AiAttempt) {
  const parts: string[] = [];
  if (attempt.inputTokens !== undefined || attempt.outputTokens !== undefined || attempt.totalTokens !== undefined) {
    const input = attempt.inputTokens ?? 0;
    const output = attempt.outputTokens ?? 0;
    const total = attempt.totalTokens ?? input + output;
    parts.push(`tokens in/out/total ${input}/${output}/${total}`);
  }
  if (attempt.estimatedCostUsd !== undefined) {
    parts.push(`est. cost $${attempt.estimatedCostUsd.toFixed(6)}`);
  }
  if (attempt.usageSource) {
    parts.push(`usage ${attempt.usageSource}`);
  }
  return parts.join(" · ");
}

function summarizeAiPipelineMetrics(args: {
  attempts: AiAttempt[];
  latencyMs: number;
  manualReview: boolean;
}) {
  const hasModelSuccess = args.attempts.some(
    (attempt) => attempt.status === "success" && (attempt.provider === "azure" || attempt.provider === "codex"),
  );
  const deterministicBypass = args.attempts.some(
    (attempt) =>
      attempt.status === "success" &&
      attempt.stage === "heuristic_fallback" &&
      attempt.model.startsWith("heuristic-local-"),
  );
  const fallbackUsed = args.attempts.some(
    (attempt) =>
      attempt.status === "success" &&
      (attempt.stage === "codex_cli" || (attempt.stage === "heuristic_fallback" && attempt.model === "heuristic-fallback")),
  );
  return {
    modelUtilized: hasModelSuccess,
    deterministicBypass,
    fallbackUsed,
    manualReview: args.manualReview,
    latencyMs: Math.max(0, Math.round(args.latencyMs)),
  };
}

function stableHash(input: string) {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function createToolRunId(scope: "reply" | "outreach" | "status", threadId: string, sourceMessageId?: string) {
  const randomToken = Math.random().toString(36).slice(2, 10);
  const sourceToken = sourceMessageId ? sourceMessageId.slice(-8) : "none";
  return `${scope}_${threadId.slice(-8)}_${sourceToken}_${Date.now()}_${randomToken}`;
}

type WorkerContextToolName = "history_search" | "contact_facts_extract" | "contact_facts_list";
type WorkerContextToolStatus = "success" | "error" | "timeout" | "skipped";
type WorkerContextToolStep = {
  id: string;
  tool: WorkerContextToolName;
  reason: string;
  readOnly: boolean;
  requiresTool?: WorkerContextToolName;
};
type WorkerContextToolRunResult = {
  stepId: string;
  tool: WorkerContextToolName;
  status: WorkerContextToolStatus;
  latencyMs: number;
  errorCode?: string;
  errorMessage?: string;
  outputSummary: string;
};
type WorkerContextOrchestrationResult = {
  plannerSource: "deterministic" | "hybrid";
  plannerConfidence: number;
  hintApplied: boolean;
  historySearchOverride?: HistorySearchOverrideSnapshot;
  contactFacts: ContactMemoryFactSnapshot[];
  runs: WorkerContextToolRunResult[];
};

const WORKER_CONTEXT_READ_ONLY_TOOLS = new Set<WorkerContextToolName>(["history_search", "contact_facts_list"]);
const WORKER_CONTEXT_HINT_ALLOWLIST = new Set<WorkerContextToolName>(["history_search", "contact_facts_list"]);

function parseBoundedInt(raw: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.round(Math.max(min, Math.min(parsed, max)));
}

function classifyToolError(error: unknown): { code: string; message: string } {
  const message = error instanceof Error ? error.message : String(error || "Unknown error");
  const lower = message.toLowerCase();
  if (lower.includes("timeout") || lower.includes("timed out") || lower.includes("deadline")) {
    return { code: "timeout", message };
  }
  if (/http\s+5\d{2}/i.test(message) || /(502|503|504)/.test(message)) {
    return { code: "upstream_5xx", message };
  }
  if (/(invalid|required|cannot|must|threadid|contactjid)/i.test(message)) {
    return { code: "validation", message };
  }
  if (/(empty|no results|no clear|no strong evidence)/i.test(message)) {
    return { code: "empty_result", message };
  }
  return { code: "error", message };
}

function inferWorkerContextHints(inboundText: string): WorkerContextToolName[] {
  const normalized = inboundText.toLowerCase();
  const hints: WorkerContextToolName[] = [];
  if (/(before|earlier|previous|remember|recall|mentioned|as discussed)/i.test(normalized)) {
    hints.push("history_search");
  }
  if (
    /(birthday|anniversary|prefer|likes|profile|fact|call me|remember about|my mom|my dad|my family|we planned|schedule|tomorrow|weekend|trip)/i.test(
      normalized,
    )
  ) {
    hints.push("contact_facts_list");
  }
  return [...new Set(hints)];
}

function mergeWorkerContextPlan(args: {
  deterministic: WorkerContextToolStep[];
  hints: WorkerContextToolName[];
  maxToolsPerRun: number;
}): { steps: WorkerContextToolStep[]; hintApplied: boolean; plannerSource: "deterministic" | "hybrid" } {
  const merged = [...args.deterministic];
  for (const hint of args.hints) {
    if (!WORKER_CONTEXT_HINT_ALLOWLIST.has(hint)) {
      continue;
    }
    if (merged.some((step) => step.tool === hint) || merged.length >= args.maxToolsPerRun) {
      continue;
    }
    merged.push({
      id: `hint_${hint}`,
      tool: hint,
      reason: "Hybrid hint suggested this read tool.",
      readOnly: WORKER_CONTEXT_READ_ONLY_TOOLS.has(hint),
    });
  }
  const hintPriority = new Map(args.hints.map((tool, index) => [tool, index]));
  const sorted = merged
    .map((step, index) => ({ step, index }))
    .sort((left, right) => {
      if (!left.step.readOnly || !right.step.readOnly) {
        return left.index - right.index;
      }
      const leftRank = hintPriority.get(left.step.tool);
      const rightRank = hintPriority.get(right.step.tool);
      if (leftRank === undefined && rightRank === undefined) {
        return left.index - right.index;
      }
      if (leftRank === undefined) {
        return 1;
      }
      if (rightRank === undefined) {
        return -1;
      }
      if (leftRank !== rightRank) {
        return leftRank - rightRank;
      }
      return left.index - right.index;
    })
    .map((item) => item.step)
    .slice(0, args.maxToolsPerRun);
  const hintApplied =
    args.hints.length > 0 && sorted.some((step, index) => args.deterministic[index]?.tool !== step.tool);
  return {
    steps: sorted,
    hintApplied,
    plannerSource: hintApplied ? "hybrid" : "deterministic",
  };
}

async function runWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await new Promise<T>((resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs);
      promise
        .then((value) => resolve(value))
        .catch((error) => reject(error));
    });
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function buildModelToolContext(args: {
  convex: ConvexHttpClient;
  threadId?: string;
  contactJid?: string;
}): ModelToolContext {
  return {
    threadId: args.threadId,
    contactJid: args.contactJid,
    executeToolRouterPlan: async (toolArgs) => {
      const maxResults = Number(toolArgs.maxResults);
      const maxToolsPerRun = Number(toolArgs.maxToolsPerRun);
      if (!Number.isFinite(maxResults) || maxResults > 20) {
        return {
          status: "error",
          errorCode: "max_results_exceeded",
          errorMessage: "maxResults exceeds server cap (20).",
          latencyMs: 0,
        };
      }
      if (!Number.isFinite(maxToolsPerRun) || maxToolsPerRun > 8) {
        return {
          status: "error",
          errorCode: "max_tools_per_run_exceeded",
          errorMessage: "maxToolsPerRun exceeds server cap (8).",
          latencyMs: 0,
        };
      }
      if (!args.threadId && toolArgs.includeExtraction) {
        return {
          status: "error",
          errorCode: "thread_scope_required",
          errorMessage: "includeExtraction requires a scoped threadId.",
          latencyMs: 0,
        };
      }

      const startedAt = Date.now();
      try {
        const output = await args.convex.action(convexRefs.chatToolRouterPlan, {
          task: toolArgs.task,
          candidateReply: toolArgs.candidateReply || "",
          ...(args.threadId ? { threadId: args.threadId as Id<"threads"> } : {}),
          ...(args.contactJid ? { contactJid: args.contactJid } : {}),
          execute: true,
          plannerMode: "hybrid",
          allowSideEffects: true,
          includeExtraction: Boolean(toolArgs.includeExtraction),
          timeoutMs: Math.round(Math.max(500, Math.min(toolArgs.toolTimeoutMs, 30_000))),
          maxResults: Math.round(Math.max(1, Math.min(maxResults, 20))),
          maxToolsPerRun: Math.round(Math.max(1, Math.min(maxToolsPerRun, 8))),
        });
        return {
          status: "success",
          output,
          latencyMs: Date.now() - startedAt,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const lower = message.toLowerCase();
        return {
          status: lower.includes("timeout") ? "timeout" : "error",
          errorCode: lower.includes("timeout") ? "timeout" : "tool_router_error",
          errorMessage: compactLogText(message, 260),
          latencyMs: Date.now() - startedAt,
        };
      }
    },
  };
}

async function recordContextToolRunTelemetry(args: {
  convex: ConvexHttpClient;
  threadId: string;
  toolRunId: string;
  plannerSource: "deterministic" | "hybrid";
  plannerConfidence: number;
  hintApplied: boolean;
  stepId: string;
  toolName: string;
  status: "success" | "error" | "timeout" | "skipped";
  latencyMs: number;
  errorCode?: string;
  errorMessage?: string;
  input: unknown;
  outputSummary: string;
  output?: unknown;
}) {
  const inputJson = JSON.stringify(args.input ?? null);
  const outputJson = JSON.stringify(args.output ?? null);
  await args.convex
    .mutation(convexRefs.systemRecordToolRun, {
      threadId: args.threadId as Id<"threads">,
      toolRunId: args.toolRunId,
      plannerSource: args.plannerSource,
      plannerConfidence: args.plannerConfidence,
      hintApplied: args.hintApplied,
      stepId: args.stepId,
      toolName: args.toolName,
      status: args.status,
      latencyMs: args.latencyMs,
      errorCode: args.errorCode,
      errorMessage: args.errorMessage ? compactLogText(args.errorMessage, 260) : undefined,
      inputHash: createHash("sha256").update(inputJson).digest("hex"),
      inputSize: inputJson.length,
      outputSize: outputJson.length,
      outputSummary: compactLogText(args.outputSummary, 260),
    })
    .catch(() => undefined);
}

function fallbackHistoryOverride(args: { historyLines: string[]; limit: number }): HistorySearchOverrideSnapshot {
  const lines = args.historyLines
    .slice(-Math.max(1, args.limit))
    .map((line) => line.replace(/\s+/g, " ").trim().slice(0, 320))
    .filter(Boolean);
  return {
    lines,
    candidateCount: lines.length,
    semanticRerankCount: 0,
    confidence: lines.length > 0 ? 0.18 : 0,
    retrievalStage: "semantic_fallback",
  };
}

async function runWorkerContextToolOrchestration(args: {
  convex: ConvexHttpClient;
  threadId: string;
  toolRunId: string;
  inboundText: string;
  historyLines: string[];
  allowHistorySearch: boolean;
  includeContactFacts: boolean;
  allowFactExtraction: boolean;
  historySearchLimit: number;
  factsLimit: number;
}) : Promise<WorkerContextOrchestrationResult> {
  const timeoutMs = parseBoundedInt(process.env.SLM_TOOL_TIMEOUT_MS, 8_000, 500, 30_000);
  const maxToolsPerRun = parseBoundedInt(process.env.SLM_TOOL_MAX_TOOLS_PER_RUN, 4, 1, 8);
  const globalDeadlineMs = parseBoundedInt(process.env.SLM_TOOL_GLOBAL_DEADLINE_MS, 20_000, 2_000, 120_000);
  const deadlineAt = Date.now() + globalDeadlineMs;
  const deterministic: WorkerContextToolStep[] = [];
  if (args.allowHistorySearch) {
    deterministic.push({
      id: "history_search",
      tool: "history_search",
      reason: "Retrieve relevant historical snippets for current inbound message.",
      readOnly: true,
    });
  }
  if (args.includeContactFacts) {
    if (args.allowFactExtraction) {
      deterministic.push({
        id: "contact_facts_extract",
        tool: "contact_facts_extract",
        reason: "Refresh contact memory facts from recent inbound messages.",
        readOnly: false,
      });
    }
    deterministic.push({
      id: "contact_facts_list",
      tool: "contact_facts_list",
      reason: "Load contact memory facts for style/context hints.",
      readOnly: true,
      requiresTool: args.allowFactExtraction ? "contact_facts_extract" : undefined,
    });
  }
  if (deterministic.length === 0) {
    return {
      plannerSource: "deterministic",
      plannerConfidence: 0.5,
      hintApplied: false,
      historySearchOverride: undefined,
      contactFacts: [],
      runs: [],
    };
  }
  const hints = inferWorkerContextHints(args.inboundText);
  const merged = mergeWorkerContextPlan({
    deterministic,
    hints,
    maxToolsPerRun,
  });
  const plannerConfidence = clamp(0.56 + deterministic.length * 0.08 + (merged.hintApplied ? 0.04 : 0), 0.5, 0.95);
  let historySearchOverride: HistorySearchOverrideSnapshot | undefined;
  let contactFacts: ContactMemoryFactSnapshot[] = [];
  const runs: WorkerContextToolRunResult[] = [];
  const completedTools = new Set<WorkerContextToolName>();
  const pending = [...merged.steps];

  const executeOne = async (step: WorkerContextToolStep): Promise<WorkerContextToolRunResult> => {
    const startedAt = Date.now();
    if (step.requiresTool && !completedTools.has(step.requiresTool)) {
      const skipped: WorkerContextToolRunResult = {
        stepId: step.id,
        tool: step.tool,
        status: "skipped",
        latencyMs: Date.now() - startedAt,
        errorCode: "dependency_missing",
        outputSummary: `Skipped: requires ${step.requiresTool}`,
      };
      await recordContextToolRunTelemetry({
        convex: args.convex,
        threadId: args.threadId,
        toolRunId: args.toolRunId,
        plannerSource: merged.plannerSource,
        plannerConfidence,
        hintApplied: merged.hintApplied,
        stepId: skipped.stepId,
        toolName: skipped.tool,
        status: skipped.status,
        latencyMs: skipped.latencyMs,
        errorCode: skipped.errorCode,
        input: {},
        outputSummary: skipped.outputSummary,
      });
      return skipped;
    }
    if (Date.now() >= deadlineAt) {
      const timedOut: WorkerContextToolRunResult = {
        stepId: step.id,
        tool: step.tool,
        status: "timeout",
        latencyMs: Date.now() - startedAt,
        errorCode: "timeout",
        outputSummary: "Skipped: global deadline exceeded.",
      };
      await recordContextToolRunTelemetry({
        convex: args.convex,
        threadId: args.threadId,
        toolRunId: args.toolRunId,
        plannerSource: merged.plannerSource,
        plannerConfidence,
        hintApplied: merged.hintApplied,
        stepId: timedOut.stepId,
        toolName: timedOut.tool,
        status: timedOut.status,
        latencyMs: timedOut.latencyMs,
        errorCode: timedOut.errorCode,
        input: {},
        outputSummary: timedOut.outputSummary,
      });
      return timedOut;
    }

    try {
      const stepTimeoutMs = Math.max(250, Math.min(timeoutMs, deadlineAt - Date.now()));
      let output: unknown = null;
      let input: unknown = {};
      if (step.tool === "history_search") {
        input = {
          threadId: args.threadId,
          query: args.inboundText,
          limit: args.historySearchLimit,
        };
        output = await runWithTimeout(
          buildHistorySearchOverride({
            convex: args.convex,
            threadId: args.threadId,
            query: args.inboundText,
            limit: args.historySearchLimit,
            fallbackHistoryLines: args.historyLines,
          }),
          stepTimeoutMs,
        );
        const override = (output as { override?: HistorySearchOverrideSnapshot }).override;
        if (override) {
          historySearchOverride = {
            ...override,
            lines: (override.lines || []).map((line) => line.replace(/\s+/g, " ").trim().slice(0, 320)).slice(0, args.historySearchLimit),
          };
        }
      } else if (step.tool === "contact_facts_extract") {
        input = {
          threadId: args.threadId,
          lookbackMessages: 120,
        };
        output = await runWithTimeout(
          args.convex.mutation(convexRefs.chatExtractContactMemoryFacts, {
            threadId: args.threadId as Id<"threads">,
            lookbackMessages: 120,
          }),
          stepTimeoutMs,
        );
      } else if (step.tool === "contact_facts_list") {
        input = {
          threadId: args.threadId,
          limit: args.factsLimit,
        };
        output = await runWithTimeout(
          args.convex.query(convexRefs.chatContactMemoryFactsList, {
            threadId: args.threadId as Id<"threads">,
            limit: args.factsLimit,
          }),
          stepTimeoutMs,
        );
        const facts = (output as ContactFactsSnapshot)?.facts || [];
        contactFacts = facts.slice(0, args.factsLimit);
      }
      const outputSummary = compactLogText(JSON.stringify(output ?? null), 260);
      const success: WorkerContextToolRunResult = {
        stepId: step.id,
        tool: step.tool,
        status: "success",
        latencyMs: Date.now() - startedAt,
        outputSummary,
      };
      await recordContextToolRunTelemetry({
        convex: args.convex,
        threadId: args.threadId,
        toolRunId: args.toolRunId,
        plannerSource: merged.plannerSource,
        plannerConfidence,
        hintApplied: merged.hintApplied,
        stepId: success.stepId,
        toolName: success.tool,
        status: success.status,
        latencyMs: success.latencyMs,
        input,
        outputSummary,
        output,
      });
      return success;
    } catch (error) {
      const classified = classifyToolError(error);
      const failed: WorkerContextToolRunResult = {
        stepId: step.id,
        tool: step.tool,
        status: classified.code === "timeout" ? "timeout" : "error",
        latencyMs: Date.now() - startedAt,
        errorCode: classified.code,
        errorMessage: compactLogText(classified.message, 260),
        outputSummary: `error:${classified.code}`,
      };
      await recordContextToolRunTelemetry({
        convex: args.convex,
        threadId: args.threadId,
        toolRunId: args.toolRunId,
        plannerSource: merged.plannerSource,
        plannerConfidence,
        hintApplied: merged.hintApplied,
        stepId: failed.stepId,
        toolName: failed.tool,
        status: failed.status,
        latencyMs: failed.latencyMs,
        errorCode: failed.errorCode,
        errorMessage: failed.errorMessage,
        input: {},
        outputSummary: failed.outputSummary,
      });
      return failed;
    }
  };

  while (pending.length > 0) {
    const runnableRead = pending.filter((step) => step.readOnly && (!step.requiresTool || completedTools.has(step.requiresTool)));
    if (runnableRead.length > 0) {
      for (const step of runnableRead) {
        const index = pending.indexOf(step);
        if (index >= 0) {
          pending.splice(index, 1);
        }
      }
      const settled = await Promise.all(runnableRead.map((step) => executeOne(step)));
      for (const result of settled) {
        runs.push(result);
        if (result.status === "success") {
          completedTools.add(result.tool);
        }
      }
      continue;
    }

    const step = pending.shift();
    if (!step) {
      break;
    }
    const result = await executeOne(step);
    runs.push(result);
    if (result.status === "success") {
      completedTools.add(step.tool);
    }
  }

  if (args.allowHistorySearch && !historySearchOverride) {
    historySearchOverride = fallbackHistoryOverride({
      historyLines: args.historyLines,
      limit: args.historySearchLimit,
    });
  }

  return {
    plannerSource: merged.plannerSource,
    plannerConfidence,
    hintApplied: merged.hintApplied,
    historySearchOverride,
    contactFacts,
    runs,
  };
}

function createConvexClient() {
  const url = process.env.CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) {
    throw new Error("Missing CONVEX_URL or NEXT_PUBLIC_CONVEX_URL for worker");
  }
  return new ConvexHttpClient(url);
}

async function createSocket(auth: Awaited<ReturnType<typeof useMultiFileAuthState>>["state"]) {
  let version: [number, number, number] | undefined;
  try {
    version = (await fetchLatestWaWebVersion()).version;
  } catch {
    // ignore version fetch failures and let Baileys defaults apply
  }
  const syncHistory = historySyncEnabled();

  const config: UserFacingSocketConfig = {
    auth,
    printQRInTerminal: true,
    browser: Browsers.macOS("Desktop"),
    markOnlineOnConnect: false,
    // Keep socket processing direct-chat only:
    // - ignore groups (`@g.us`)
    // - ignore broadcast/system/status/newsletter threads
    shouldIgnoreJid: (jid) => {
      const normalized = (jid || "").trim().toLowerCase();
      return isGroupJid(normalized) || isBroadcastOrSystemJid(normalized);
    },
    syncFullHistory: syncHistory,
    fireInitQueries: false,
    shouldSyncHistoryMessage: () => syncHistory,
    emitOwnEvents: false,
    connectTimeoutMs: 60_000,
    defaultQueryTimeoutMs: 60_000,
    keepAliveIntervalMs: 20_000,
  };

  if (version) {
    config.version = version;
  }

  return makeWASocket(config);
}

async function run() {
  await acquireWorkerLock("whatsapp");
  const convex = createConvexClient();
  const workerId = process.env.SLM_WORKER_ID || `worker-${process.pid}`;
  const authPath = process.env.WHATSAPP_AUTH_PATH || ".wa_auth";
  let isShuttingDown = false;
  let reconnectAttempts = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  // `useMultiFileAuthState` is a Baileys API, not a React hook.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const { state, saveCreds } = await useMultiFileAuthState(authPath);

  const isAuthLinked = () => {
    const creds = (state as { creds?: { registered?: boolean; pairingCode?: string; me?: { id?: string } } }).creds;
    if (creds?.registered) {
      return true;
    }
    const meId = creds?.me?.id || "";
    const hasDeviceSuffix = meId.includes(":") && meId.includes("@s.whatsapp.net");
    const hasPendingPairingCode = Boolean(creds?.pairingCode);
    return hasDeviceSuffix && !hasPendingPairingCode;
  };

  const reportListener = async (listenerActive: boolean, listenerMessage: string) => {
    try {
      await convex.mutation(convexRefs.systemReportSetupListener, {
        provider: "whatsapp",
        listenerActive,
        listenerWorkerId: workerId,
        listenerMessage,
        listenerLastSeenAt: Date.now(),
        hasAuth: isAuthLinked(),
      });
    } catch {
      // best effort status sync for setup UI
    }
  };

  const invalidateCredentials = async () => {
    try {
      await rm(authPath, { recursive: true, force: true });
      return true;
    } catch {
      return false;
    }
  };

  const clearReconnectTimer = () => {
    if (!reconnectTimer) {
      return;
    }
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  };

  const getStatusCode = (errorLike: unknown) => {
    if (!errorLike || typeof errorLike !== "object") {
      return undefined;
    }
    const parsed = errorLike as {
      output?: { statusCode?: number };
      data?: { statusCode?: number };
      statusCode?: number;
    };
    return parsed.output?.statusCode ?? parsed.data?.statusCode ?? parsed.statusCode;
  };

  let processingOutbox = false;
  let sock: Awaited<ReturnType<typeof createSocket>>;
  let workerRuntimePaused = false;
  let lastBlocklistForceRefreshAt = 0;
  let lastPrivacyPreflightAt = 0;
  let lastAboutAutomationAt = 0;
  let lastAutomatedAboutText = "";

  const normalizeAccountJid = (jid: string | null | undefined) => {
    if (!jid) {
      return "";
    }
    const [left = ""] = jid.trim().toLowerCase().split("@");
    const [bare = ""] = left.split(":");
    return bare;
  };

  const getSelfJid = () => {
    const [primary = ""] = getSelfIdentityJids();
    return primary;
  };

  const normalizeJidForLookup = (jid: string | null | undefined) => {
    return (jid || "").trim().toLowerCase();
  };

  const getSelfIdentityJids = () => {
    const raw = new Set<string>();
    const push = (jid: string | null | undefined) => {
      const trimmed = (jid || "").trim();
      if (!trimmed) {
        return;
      }
      raw.add(trimmed);
    };

    push(sock?.user?.id || "");
    const creds = (state as { creds?: { me?: { id?: string; lid?: string } } }).creds;
    push(creds?.me?.id || "");
    push(creds?.me?.lid || "");

    return [...raw];
  };

  const getSelfAccountIds = () => {
    const ids = new Set<string>();
    for (const jid of getSelfIdentityJids()) {
      const accountId = normalizeAccountJid(jid);
      if (accountId) {
        ids.add(accountId);
      }
    }
    return [...ids];
  };

  const buildStatusSendOptions = (audienceJids: string[] | undefined) => {
    const statusAudience = new Set<string>();

    for (const rawJid of audienceJids || []) {
      const trimmed = rawJid.trim().toLowerCase();
      if (!trimmed) {
        continue;
      }
      const [userAndDevice = "", domain = ""] = trimmed.split("@");
      const [bareUser = ""] = userAndDevice.split(":");
      if (!bareUser) {
        continue;
      }

      if (domain === "s.whatsapp.net" || domain === "lid") {
        statusAudience.add(`${bareUser}@${domain}`);
      } else if (!domain) {
        statusAudience.add(`${bareUser}@s.whatsapp.net`);
      }
    }

    const statusJidList = [...statusAudience];
    if (statusJidList.length === 0) {
      return { broadcast: true } as Parameters<typeof sock.sendMessage>[2];
    }

    const selfAccount = normalizeAccountJid(getSelfJid());
    if (selfAccount) {
      statusAudience.add(`${selfAccount}@s.whatsapp.net`);
    }

    const statusJidListWithSelf = [...statusAudience];
    return { broadcast: true, statusJidList: statusJidListWithSelf } as Parameters<typeof sock.sendMessage>[2];
  };

  const reconnectDelay = (attempt: number) => {
    const base = Math.min(1000 * 2 ** Math.max(0, attempt - 1), 15_000);
    const jitter = Math.floor(Math.random() * 350);
    return base + jitter;
  };

  const scheduleReconnect = async (statusCode: number | undefined) => {
    if (isShuttingDown || reconnectTimer) {
      return;
    }

    reconnectAttempts += 1;
    const delayMs = reconnectDelay(reconnectAttempts);
    const codeText = statusCode ? `code ${statusCode}` : "unknown code";
    await reportListener(
      false,
      `Connection closed (${codeText}). Reconnecting in ${Math.ceil(delayMs / 1000)}s (attempt ${reconnectAttempts}).`,
    );

    reconnectTimer = setTimeout(async () => {
      reconnectTimer = null;
      if (isShuttingDown) {
        return;
      }

      try {
        const next = await createSocket(state);
        sock = next;
        attachListeners(next);
      } catch (error) {
        const err = error instanceof Error ? error.message : String(error);
        logger.error({ err }, "Failed to recreate WhatsApp socket");
        await scheduleReconnect(undefined);
      }
    }, delayMs);
  };

  const shutdown = async (code = 0, message = "Worker stopped.") => {
    isShuttingDown = true;
    clearReconnectTimer();
    await reportListener(false, message);
    releaseWorkerLockSync("whatsapp");
    process.exit(code);
  };

  process.once("SIGINT", () => {
    void shutdown(0, "Worker stopped.");
  });
  process.once("SIGTERM", () => {
    void shutdown(0, "Worker stopped.");
  });
  process.on("uncaughtException", (error) => {
    logger.error({ err: error instanceof Error ? error.message : String(error) }, "Worker uncaught exception");
    void shutdown(1, "Worker stopped after uncaught exception.");
  });
  process.on("unhandledRejection", (reason) => {
    logger.error({ err: reason instanceof Error ? reason.message : String(reason) }, "Worker unhandled rejection");
    void shutdown(1, "Worker stopped after unhandled rejection.");
  });

  type CacheState<T> = {
    value: T;
    hasValue: boolean;
    expiresAt: number;
    inFlight: Promise<T> | null;
  };

  const resolveTtlCache = async <T>(cache: CacheState<T>, ttlMs: number, loader: () => Promise<T>): Promise<T> => {
    const now = Date.now();
    if (cache.hasValue && cache.expiresAt > now) {
      return cache.value;
    }
    if (cache.inFlight) {
      return cache.inFlight;
    }
    cache.inFlight = (async () => {
      try {
        const value = await loader();
        cache.value = value;
        cache.hasValue = true;
        cache.expiresAt = Date.now() + ttlMs;
        return value;
      } finally {
        cache.inFlight = null;
      }
    })();
    return cache.inFlight;
  };

  const runtimeSettingsCache: CacheState<RuntimeSettings | null> = {
    value: null,
    hasValue: false,
    expiresAt: 0,
    inFlight: null,
  };
  const blocklistCache: CacheState<Set<string>> = {
    value: new Set<string>(),
    hasValue: false,
    expiresAt: 0,
    inFlight: null,
  };
  const styleProfileCache: CacheState<StyleProfileSnapshot> = {
    value: null,
    hasValue: false,
    expiresAt: 0,
    inFlight: null,
  };
  const threadStyleProfileCache = new Map<string, CacheState<StyleProfileSnapshot>>();
  const systemHealthCache: CacheState<SystemHealthSnapshot> = {
    value: null,
    hasValue: false,
    expiresAt: 0,
    inFlight: null,
  };
  const uploadedMemeFallbackCache: CacheState<string | undefined> = {
    value: undefined,
    hasValue: false,
    expiresAt: 0,
    inFlight: null,
  };
  const enabledStickerCache: CacheState<StickerAssetSnapshot[]> = {
    value: [],
    hasValue: false,
    expiresAt: 0,
    inFlight: null,
  };
  const mediaAssetBufferCache = new Map<string, { buffer: Buffer; cachedAt: number; expiresAt: number }>();
  const mediaAssetBufferInFlight = new Map<string, Promise<Buffer>>();
  const historyFetchConfig = readHistoryFetchConfigFromEnv();
  const historyFetchStateByThread = new Map<string, { roundsUsed: number; lastFetchedAt: number; blockedUntil: number }>();
  const stickerContextPassInFlightByAsset = new Set<string>();
  const stickerContextSkipUntilByAsset = new Map<string, number>();
  const memePrewarmInFlightByThread = new Set<string>();
  const memePrewarmSkipUntilByThread = new Map<string, number>();
  const memeGenerationSkipUntilByThread = new Map<string, number>();

  const SETTINGS_CACHE_TTL_MS = 1500;
  const STYLE_PROFILE_CACHE_TTL_MS = 20_000;
const HEALTH_CACHE_TTL_MS = 1500;
const ENABLED_ASSET_CACHE_TTL_MS = 12_000;
const STICKER_CONTEXT_STALE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;
const STICKER_CONTEXT_PASS_INTERVAL_MS = 60_000;
const STICKER_CONTEXT_FAILURE_RETRY_MS = 10 * 60 * 1000;
const MEME_PREWARM_COOLDOWN_MS = 25 * 60 * 1000;
const MEME_GENERATION_FAILURE_RETRY_MS = 10 * 60 * 1000;
const MEDIA_ASSET_BUFFER_CACHE_TTL_MS = 5 * 60 * 1000;
const MEDIA_ASSET_BUFFER_CACHE_MAX_ITEMS = 24;

function resolveTextEmojiAllowlist() {
  return TEXT_EMOJI_ALLOWLIST;
}

  const getRuntimeSettings = async () => {
    const settings = await resolveTtlCache(runtimeSettingsCache, SETTINGS_CACHE_TTL_MS, async () => {
      return (await convex.query(convexRefs.settingsGet, {})) as RuntimeSettings | null;
    });
    applyRuntimeConcurrency(settings);
    return settings;
  };

  const buildJidLookupCandidates = (jid: string | null | undefined) => {
    const normalized = normalizeJidForLookup(jid);
    if (!normalized) {
      return [] as string[];
    }
    const account = normalizeAccountJid(normalized);
    const keys = new Set<string>([normalized]);
    if (account) {
      keys.add(account);
      keys.add(`${account}@s.whatsapp.net`);
      keys.add(`${account}@lid`);
    }
    return [...keys];
  };

  const loadBlocklist = async () => {
    try {
      const rows = await sock.fetchBlocklist();
      const blocked = new Set<string>();
      for (const row of rows || []) {
        for (const key of buildJidLookupCandidates(typeof row === "string" ? row : "")) {
          blocked.add(key);
        }
      }
      return blocked;
    } catch (error) {
      const err = error instanceof Error ? error.message : String(error);
      logger.warn({ err }, "Failed to load WhatsApp blocklist");
      if (blocklistCache.hasValue) {
        return new Set(blocklistCache.value);
      }
      return new Set<string>();
    }
  };

  const getBlocklist = async (force = false) => {
    if (force) {
      blocklistCache.hasValue = false;
      blocklistCache.expiresAt = 0;
    }
    return resolveTtlCache(blocklistCache, BLOCKLIST_CACHE_TTL_MS, loadBlocklist);
  };

  const refreshBlocklist = async (reason: string, force = false) => {
    const blocked = await getBlocklist(force);
    if (force) {
      await convex
        .mutation(convexRefs.systemRecordEvent, {
          source: "worker",
          eventType: "whatsapp.blocklist.refreshed",
          detail: compactLogText(`reason=${reason} count=${blocked.size} force=${force ? 1 : 0}`, 220),
        })
        .catch(() => undefined);
    }
    return blocked;
  };

  const isJidBlocked = async (jid: string | null | undefined) => {
    const lookup = buildJidLookupCandidates(jid);
    if (lookup.length === 0) {
      return false;
    }

    const blocked = await getBlocklist(false);
    if (lookup.some((key) => blocked.has(key))) {
      return true;
    }

    const now = Date.now();
    if (now - lastBlocklistForceRefreshAt < BLOCKLIST_FORCE_REFRESH_INTERVAL_MS) {
      return false;
    }
    lastBlocklistForceRefreshAt = now;

    const refreshed = await getBlocklist(true);
    return lookup.some((key) => refreshed.has(key));
  };

  const pickPrivacySetting = (settings: Record<string, string>, key: string) => {
    if (typeof settings[key] === "string") {
      return settings[key];
    }
    const normalizedKey = key.replace(/[_\s-]+/g, "").toLowerCase();
    for (const [rawKey, rawValue] of Object.entries(settings)) {
      if (rawKey.replace(/[_\s-]+/g, "").toLowerCase() === normalizedKey) {
        return rawValue;
      }
    }
    return "";
  };

  const runPrivacyPreflight = async (reason: string, force = false) => {
    const now = Date.now();
    if (!force && now - lastPrivacyPreflightAt < PRIVACY_PREFLIGHT_MIN_INTERVAL_MS) {
      return;
    }
    lastPrivacyPreflightAt = now;

    try {
      const settings = (await sock.fetchPrivacySettings(force)) || {};
      const readReceipts = pickPrivacySetting(settings, "readreceipts");
      const lastSeen = pickPrivacySetting(settings, "last");
      const online = pickPrivacySetting(settings, "online");
      const statusPrivacy = pickPrivacySetting(settings, "status");
      const groupsAdd = pickPrivacySetting(settings, "groupadd");

      await convex
        .mutation(convexRefs.systemRecordEvent, {
          source: "worker",
          eventType: "whatsapp.privacy.preflight.loaded",
          detail: compactLogText(
            `reason=${reason} readreceipts=${readReceipts || "unknown"} last_seen=${lastSeen || "unknown"} online=${online || "unknown"} status=${statusPrivacy || "unknown"} groups_add=${groupsAdd || "unknown"}`,
            280,
          ),
        })
        .catch(() => undefined);

      const warnings: string[] = [];
      if (readReceipts === "none") {
        warnings.push("Read receipts are disabled; automated read markers may not appear to contacts.");
      }
      if (statusPrivacy === "none") {
        warnings.push("Status privacy is set to none; status-based workflows may have limited effect.");
      }
      if (warnings.length > 0) {
        await convex
          .mutation(convexRefs.systemRecordEvent, {
            source: "worker",
            eventType: "whatsapp.privacy.preflight.warning",
            detail: compactLogText(`reason=${reason} ${warnings.join(" | ")}`, 280),
          })
          .catch(() => undefined);
      }
    } catch (error) {
      const err = error instanceof Error ? error.message : String(error);
      await convex
        .mutation(convexRefs.systemRecordEvent, {
          source: "worker",
          eventType: "whatsapp.privacy.preflight.error",
          detail: compactLogText(`reason=${reason} ${err}`, 280),
        })
        .catch(() => undefined);
    }
  };

  const emitAiPipelineMetrics = async (args: {
    pipeline: "reply" | "outreach" | "status_builder" | "ack_router";
    attempts: AiAttempt[];
    latencyMs: number;
    manualReview: boolean;
    threadId?: Id<"threads">;
    toolRunId?: string;
    detailSuffix?: string;
  }) => {
    const metrics = summarizeAiPipelineMetrics({
      attempts: args.attempts,
      latencyMs: args.latencyMs,
      manualReview: args.manualReview,
    });
    const detail = compactLogText(
      `pipeline=${args.pipeline} model_utilized=${metrics.modelUtilized ? 1 : 0} deterministic_bypass=${metrics.deterministicBypass ? 1 : 0} fallback=${metrics.fallbackUsed ? 1 : 0} manual_review=${metrics.manualReview ? 1 : 0} latency_ms=${metrics.latencyMs}${args.detailSuffix ? ` ${args.detailSuffix}` : ""}`,
      300,
    );
    await convex
      .mutation(convexRefs.systemRecordEvent, {
        source: "ai",
        eventType: `ai.metrics.${args.pipeline}.sample`,
        ...(args.threadId ? { threadId: args.threadId } : {}),
        ...(args.toolRunId ? { toolRunId: args.toolRunId } : {}),
        detail,
      })
      .catch(() => undefined);

    if (metrics.modelUtilized) {
      await convex
        .mutation(convexRefs.systemRecordEvent, {
          source: "ai",
          eventType: `ai.metrics.${args.pipeline}.model_utilized`,
          ...(args.threadId ? { threadId: args.threadId } : {}),
          ...(args.toolRunId ? { toolRunId: args.toolRunId } : {}),
          detail: `pipeline=${args.pipeline} value=1`,
        })
        .catch(() => undefined);
    }
    if (metrics.deterministicBypass) {
      await convex
        .mutation(convexRefs.systemRecordEvent, {
          source: "ai",
          eventType: `ai.metrics.${args.pipeline}.deterministic_bypass`,
          ...(args.threadId ? { threadId: args.threadId } : {}),
          ...(args.toolRunId ? { toolRunId: args.toolRunId } : {}),
          detail: `pipeline=${args.pipeline} value=1`,
        })
        .catch(() => undefined);
    }
    if (metrics.fallbackUsed) {
      await convex
        .mutation(convexRefs.systemRecordEvent, {
          source: "ai",
          eventType: `ai.metrics.${args.pipeline}.fallback`,
          ...(args.threadId ? { threadId: args.threadId } : {}),
          ...(args.toolRunId ? { toolRunId: args.toolRunId } : {}),
          detail: `pipeline=${args.pipeline} value=1`,
        })
        .catch(() => undefined);
    }
    if (metrics.manualReview) {
      await convex
        .mutation(convexRefs.systemRecordEvent, {
          source: "ai",
          eventType: `ai.metrics.${args.pipeline}.manual_review`,
          ...(args.threadId ? { threadId: args.threadId } : {}),
          ...(args.toolRunId ? { toolRunId: args.toolRunId } : {}),
          detail: `pipeline=${args.pipeline} value=1`,
        })
        .catch(() => undefined);
    }
    await convex
      .mutation(convexRefs.systemRecordEvent, {
        source: "ai",
        eventType: `ai.metrics.${args.pipeline}.latency`,
        ...(args.threadId ? { threadId: args.threadId } : {}),
        ...(args.toolRunId ? { toolRunId: args.toolRunId } : {}),
        detail: `pipeline=${args.pipeline} latency_ms=${metrics.latencyMs}`,
      })
      .catch(() => undefined);
  };

  const getStyleProfile = async () => {
    return await resolveTtlCache(styleProfileCache, STYLE_PROFILE_CACHE_TTL_MS, async () => {
      return (await convex.query(convexRefs.styleGetProfile, {})) as StyleProfileSnapshot;
    });
  };

  const getStyleProfileForThread = async (threadId?: string) => {
    if (!threadId) {
      return await getStyleProfile();
    }

    const cache =
      threadStyleProfileCache.get(threadId) ||
      (() => {
        const next: CacheState<StyleProfileSnapshot> = {
          value: null,
          hasValue: false,
          expiresAt: 0,
          inFlight: null,
        };
        threadStyleProfileCache.set(threadId, next);
        return next;
      })();

    return await resolveTtlCache(cache, STYLE_PROFILE_CACHE_TTL_MS, async () => {
      const bundle = (await convex
        .query(convexRefs.chatGetThreadStyleProfile, {
          threadId,
          fallbackToGlobal: true,
        })
        .catch(() => null)) as { profile?: StyleProfileSnapshot } | null;

      if (bundle?.profile) {
        return bundle.profile;
      }
      return await getStyleProfile();
    });
  };

  const getSystemHealth = async () => {
    return await resolveTtlCache(systemHealthCache, HEALTH_CACHE_TTL_MS, async () => {
      return (await convex.query(convexRefs.systemHealth, {})) as SystemHealthSnapshot;
    });
  };

  const pickUploadedMemeFallbackAsset = async () => {
    return await resolveTtlCache(uploadedMemeFallbackCache, ENABLED_ASSET_CACHE_TTL_MS, async () => {
      const row = (await convex.query(convexRefs.mediaGetBestUploadedMemeFallback, {}).catch(() => null)) as
        | { assetId: string }
        | null;
      return row?.assetId;
    });
  };

  const pickGeneratedMemeForThread = async (threadId: string, cooldownMs: number) => {
    const row = (await convex
      .query(convexRefs.mediaGetBestGeneratedMemeForThread, {
        threadId,
        cooldownMs,
        limit: 40,
      })
      .catch(() => null)) as { assetId: string } | null;
    return row?.assetId;
  };

  const markMediaAssetUsed = async (assetId?: string) => {
    if (!assetId) {
      return;
    }
    await convex
      .mutation(convexRefs.mediaMarkAssetUsed, {
        assetId: assetId as Id<"mediaAssets">,
      })
      .catch(() => undefined);
  };

  const buildThreadMemeContextSnippet = (args: {
    inboundText: string;
    recentHistoryLines: string[];
    styleHints?: string[];
  }) => {
    const snippet = [
      `Inbound: ${args.inboundText.trim()}`,
      args.recentHistoryLines.length ? `History: ${args.recentHistoryLines.slice(-4).join(" | ")}` : "",
      args.styleHints?.length ? `Hints: ${args.styleHints.slice(0, 3).join(" | ")}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    return snippet.slice(0, 380);
  };

  const generateAndStoreThreadMeme = async (args: {
    threadId: string;
    threadJid: string;
    inboundText: string;
    recentHistoryLines: string[];
    styleHints?: string[];
    runtimeSettings: RuntimeSettings | null;
    threadTitle?: string;
    reason: "on_demand" | "prewarm";
  }) => {
    const blockedUntil = memeGenerationSkipUntilByThread.get(args.threadId) || 0;
    if (blockedUntil > Date.now()) {
      return undefined;
    }

    const generation = await generateMemeImageWithAzure({
      inboundText: args.inboundText,
      recentHistoryLines: args.recentHistoryLines,
      styleHints: args.styleHints,
      threadTitle: args.threadTitle,
    });

    if (!generation.imageBytes || generation.error) {
      memeGenerationSkipUntilByThread.set(args.threadId, Date.now() + MEME_GENERATION_FAILURE_RETRY_MS);
      await convex
        .mutation(convexRefs.systemRecordEvent, {
          source: "worker",
          eventType: "media.meme.generate.error",
          threadId: args.threadId as Id<"threads">,
          detail: compactLogText(
            `reason=${args.reason} model=${generation.model} error=${generation.error || "empty_payload"}`,
            300,
          ),
        })
        .catch(() => undefined);
      return undefined;
    }

    const contentHash = createHash("sha256").update(generation.imageBytes).digest("hex");
    const uploadUrl = (await convex.mutation(convexRefs.mediaGenerateUploadUrl, {})) as string;
    const upload = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        "Content-Type": generation.mimeType || "image/png",
      },
      body: new Uint8Array(generation.imageBytes),
    });
    if (!upload.ok) {
      throw new Error(`Generated meme upload failed (${upload.status}).`);
    }
    const payload = (await upload.json()) as { storageId?: string };
    if (!payload.storageId) {
      throw new Error("Generated meme upload response missing storageId.");
    }

    const nowIso = new Date().toISOString().slice(0, 10);
    const labelSuffix = args.threadJid.slice(0, 18);
    const contextSnippet = buildThreadMemeContextSnippet({
      inboundText: args.inboundText,
      recentHistoryLines: args.recentHistoryLines,
      styleHints: args.styleHints,
    });

    const assetId = (await convex.mutation(convexRefs.mediaRegisterAssetIfMissing, {
      kind: "meme",
      label: `Thread meme ${nowIso} ${labelSuffix}`,
      tags: [
        "generated",
        "thread",
        "meme",
        args.reason === "prewarm" ? "prewarm" : "on_demand",
      ],
      fileId: payload.storageId as Id<"_storage">,
      mimeType: generation.mimeType || "image/png",
      enabled: true,
      contentHash,
      source: "generated",
      threadId: args.threadId as Id<"threads">,
      generationPromptHash: generation.promptHash,
      generationContextSnippet: contextSnippet,
    })) as Id<"mediaAssets">;

    uploadedMemeFallbackCache.hasValue = false;
    uploadedMemeFallbackCache.expiresAt = 0;
    memeGenerationSkipUntilByThread.delete(args.threadId);

    await convex
      .mutation(convexRefs.systemRecordEvent, {
        source: "worker",
        eventType: "media.meme.generated",
        threadId: args.threadId as Id<"threads">,
        detail: compactLogText(`reason=${args.reason} asset=${assetId} model=${generation.model}`, 280),
      })
      .catch(() => undefined);

    return assetId;
  };

  const maybePrewarmThreadMeme = async (args: {
    threadId: string;
    threadJid: string;
    inboundText: string;
    recentHistoryLines: string[];
    styleHints?: string[];
    runtimeSettings: RuntimeSettings | null;
    threadTitle?: string;
  }) => {
    if ((args.runtimeSettings?.generatedMemesEnabled ?? true) === false) {
      return;
    }
    if (memePrewarmInFlightByThread.has(args.threadId)) {
      return;
    }
    const blockedUntil = memePrewarmSkipUntilByThread.get(args.threadId) || 0;
    if (blockedUntil > Date.now()) {
      return;
    }

    memePrewarmInFlightByThread.add(args.threadId);
    try {
      const existing = await pickGeneratedMemeForThread(args.threadId, 0);
      if (existing) {
        memePrewarmSkipUntilByThread.set(args.threadId, Date.now() + MEME_PREWARM_COOLDOWN_MS);
        return;
      }
      await generateAndStoreThreadMeme({
        ...args,
        reason: "prewarm",
      });
      memePrewarmSkipUntilByThread.set(args.threadId, Date.now() + MEME_PREWARM_COOLDOWN_MS);
    } catch {
      memePrewarmSkipUntilByThread.set(args.threadId, Date.now() + MEME_GENERATION_FAILURE_RETRY_MS);
    } finally {
      memePrewarmInFlightByThread.delete(args.threadId);
    }
  };

  const tokenizeForMatch = (input: string) => {
    const stopwords = new Set([
      "a",
      "an",
      "and",
      "are",
      "as",
      "at",
      "be",
      "but",
      "for",
      "from",
      "i",
      "if",
      "in",
      "is",
      "it",
      "its",
      "me",
      "my",
      "of",
      "on",
      "or",
      "so",
      "the",
      "to",
      "we",
      "you",
      "your",
    ]);
    return input
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .map((word) => word.trim())
      .filter((word) => word.length >= 3 && !stopwords.has(word));
  };

  const uniqueTrimmed = (values: string[], limit = 20) => {
    const deduped = new Set(
      values
        .map((value) => value.trim())
        .filter(Boolean),
    );
    return [...deduped].slice(0, limit);
  };

  const buildStickerContextFromDescription = (description: string, label?: string, tags?: string[]) => {
    const merged = [description, label || "", ...(tags || [])].filter(Boolean).join(" ").toLowerCase();
    const words = tokenizeForMatch(merged);
    const toneTags: string[] = [];
    if (/\b(funny|laugh|lol|joke|meme|goofy|cartoon|silly)\b/.test(merged)) {
      toneTags.push("playful");
    }
    if (/\b(celebrat|party|dance|congrats|win|victory|success)\b/.test(merged)) {
      toneTags.push("celebratory");
    }
    if (/\b(heart|love|hug|kiss|cute|sweet)\b/.test(merged)) {
      toneTags.push("affectionate");
    }
    if (/\b(sad|cry|comfort|sorry|support|there for you)\b/.test(merged)) {
      toneTags.push("supportive");
    }
    if (/\b(angry|annoy|eyeroll|frustrat|wtf)\b/.test(merged)) {
      toneTags.push("frustrated");
    }
    if (toneTags.length === 0) {
      toneTags.push("neutral_reaction");
    }

    const triggers = uniqueTrimmed([
      ...words,
      ...toneTags,
      ...(tags || []).map((tag) => tag.toLowerCase()),
    ], 16);

    const avoid = uniqueTrimmed([
      ...(toneTags.includes("playful") ? ["bereavement", "emergency", "serious"] : []),
      ...(toneTags.includes("celebratory") ? ["bad news", "loss", "apology"] : []),
      ...(toneTags.includes("frustrated") ? ["congrats", "good news"] : []),
    ], 8);

    const summary =
      toneTags.includes("playful")
        ? "Use for light, funny moments, banter, and casual reactions."
        : toneTags.includes("celebratory")
          ? "Use when celebrating wins, milestones, or good news."
          : toneTags.includes("supportive")
            ? "Use to show empathy, comfort, or gentle reassurance."
            : toneTags.includes("affectionate")
              ? "Use for warm, affectionate, or sweet interactions."
              : toneTags.includes("frustrated")
                ? "Use for mild frustration, disbelief, or eye-roll moments."
                : "Use as a neutral visual reaction in casual conversation.";

    const confidence = description ? 0.66 : 0.45;
    return {
      summary,
      toneTags,
      triggers,
      avoid,
      confidence,
    };
  };

  const ensureStickerContextForAsset = async (assetId: string) => {
    if (!assetId || stickerContextPassInFlightByAsset.has(assetId)) {
      return;
    }
    const blockedUntil = stickerContextSkipUntilByAsset.get(assetId) || 0;
    if (blockedUntil > Date.now()) {
      return;
    }

    stickerContextPassInFlightByAsset.add(assetId);
    try {
      const asset = (await convex.query(convexRefs.mediaGetAssetDownloadUrl, {
        assetId,
      })) as
        | null
        | {
            assetId: string;
            kind: "sticker" | "meme";
            mimeType: string;
            label: string;
            url: string;
            contextSummary?: string;
            contextTags?: string[];
            contextTriggers?: string[];
            contextAvoid?: string[];
            contextConfidence?: number;
            contextUpdatedAt?: number;
          };
      if (!asset || asset.kind !== "sticker" || !asset.url) {
        return;
      }
      if ((asset.contextUpdatedAt || 0) > Date.now() - STICKER_CONTEXT_STALE_AFTER_MS) {
        return;
      }

      const response = await fetch(asset.url);
      if (!response.ok) {
        throw new Error(`Failed to download sticker asset ${assetId}: ${response.status}`);
      }
      const stickerBytes = Buffer.from(await response.arrayBuffer());
      if (stickerBytes.length === 0) {
        throw new Error(`Sticker asset ${assetId} is empty.`);
      }

      const runtimeSettings = await getRuntimeSettings();
      const visual = await describeInboundImageWithFallback({
        imageBytes: stickerBytes,
        mimeType: asset.mimeType,
        caption: asset.label,
        runtime: {
          temperature: runtimeSettings?.aiTemperature,
          maxOutputTokens: runtimeSettings?.aiMaxOutputTokens,
          maxReplyChars: runtimeSettings?.aiMaxReplyChars,
          fallbackMode: runtimeSettings?.aiFallbackMode,
        },
      });

      const context = buildStickerContextFromDescription(visual.description, asset.label);
      await convex
        .mutation(convexRefs.mediaUpsertAssetContext, {
          assetId: asset.assetId as Id<"mediaAssets">,
          contextSummary: context.summary,
          contextTags: context.toneTags,
          contextTriggers: context.triggers,
          contextAvoid: context.avoid,
          contextConfidence: context.confidence,
          contextSource: visual.provider === "azure" ? "vision_ai" : "heuristic",
        })
        .catch(() => undefined);
      await convex
        .mutation(convexRefs.systemRecordEvent, {
          source: "worker",
          eventType: "media.sticker.context_passed",
          detail: compactLogText(`asset=${assetId} source=${visual.provider} summary=${context.summary}`, 280),
        })
        .catch(() => undefined);

      enabledStickerCache.hasValue = false;
      enabledStickerCache.expiresAt = 0;
      stickerContextSkipUntilByAsset.delete(assetId);
    } catch (error) {
      const err = error instanceof Error ? error.message : String(error);
      stickerContextSkipUntilByAsset.set(assetId, Date.now() + STICKER_CONTEXT_FAILURE_RETRY_MS);
      await convex
        .mutation(convexRefs.systemRecordEvent, {
          source: "worker",
          eventType: "media.sticker.context_pass_error",
          detail: compactLogText(`asset=${assetId} ${err}`, 280),
        })
        .catch(() => undefined);
    } finally {
      stickerContextPassInFlightByAsset.delete(assetId);
    }
  };

  const runStickerContextBackfillPass = async () => {
    const candidates = (await convex
      .query(convexRefs.mediaListStickerAssetsNeedingContext, {
        limit: 8,
        staleAfterMs: STICKER_CONTEXT_STALE_AFTER_MS,
      })
      .catch(() => [])) as Array<{ _id: string }>;
    for (const item of candidates) {
      await ensureStickerContextForAsset(item._id);
    }
  };

  const getEnabledStickerAssets = async () => {
    return await resolveTtlCache(enabledStickerCache, ENABLED_ASSET_CACHE_TTL_MS, async () => {
      return (await convex.query(convexRefs.mediaGetEnabledByKind, { kind: "sticker" }).catch(() => [])) as StickerAssetSnapshot[];
    });
  };

  const pickBestStickerAsset = async (inboundText: string) => {
    const stickers = await getEnabledStickerAssets();
    if (!stickers.length) {
      return undefined;
    }

    const keywords = new Set(tokenizeForMatch(inboundText));
    const scored = stickers.map((asset) => {
      const triggers = [
        ...(asset.contextTriggers || []),
        ...(asset.contextTags || []),
        ...(asset.tags || []),
      ].map((value) => value.toLowerCase());
      const avoid = (asset.contextAvoid || []).map((value) => value.toLowerCase());
      let score = 0;
      for (const token of keywords) {
        if (triggers.some((entry) => entry.includes(token) || token.includes(entry))) {
          score += 2;
        }
        if (avoid.some((entry) => entry.includes(token) || token.includes(entry))) {
          score -= 3;
        }
      }
      score += (asset.contextConfidence ?? 0.35) * 0.6;
      if (!asset.contextUpdatedAt) {
        score -= 0.4;
      }
      return { asset, score };
    });

    scored.sort((a, b) => b.score - a.score);
    const chosen = scored[0]?.asset || stickers[0];
    if (chosen && (!chosen.contextUpdatedAt || !chosen.contextSummary)) {
      void ensureStickerContextForAsset(chosen._id);
    }
    return chosen?._id;
  };

  const decideStickerCompanionPlan = async (args: {
    jid: string;
    threadId: string;
    inboundText: string;
    outboundText: string;
    runtimeSettings: RuntimeSettings | null;
    preReactionActive: boolean;
  }) => {
    if (classifyThreadKindFromJid(args.jid) !== "direct") {
      return null;
    }
    if (args.preReactionActive) {
      return null;
    }
    if ((args.runtimeSettings?.stickersEnabled ?? true) === false) {
      return null;
    }
    if ((getRecentStickerCompanionAt(args.jid) || 0) > Date.now() - STICKER_COMPANION_COOLDOWN_MS) {
      return null;
    }

    const inbound = (args.inboundText || "").trim();
    const outbound = (args.outboundText || "").trim();
    const combined = `${inbound}\n${outbound}`.trim();
    if (!combined) {
      return null;
    }
    if (isSeriousConversation(combined)) {
      return null;
    }

    const funnyKeywords = args.runtimeSettings?.funnyStatusKeywords || [];
    const funnyEmojis = args.runtimeSettings?.funnyStatusEmojis || [];
    const playfulSignal =
      positiveTone(combined, funnyKeywords, funnyEmojis) ||
      looksLikeFunnyStatus(combined, funnyKeywords, funnyEmojis) ||
      hasGenZCasualSignal(combined);
    if (!playfulSignal) {
      return null;
    }

    const stickerAssetId = await pickBestStickerAsset(`${inbound}\n${outbound}`.trim());
    if (!stickerAssetId) {
      return null;
    }

    const seed = createHash("sha1").update(`${args.threadId}|${inbound}|${outbound}`).digest("hex");
    const questionLike = /\?$/.test(outbound) || /\b(can|could|should|when|where|what|why|how)\b/i.test(outbound);
    const position: "before" | "after" = questionLike || parseInt(seed.slice(0, 2), 16) % 2 === 0 ? "before" : "after";
    return {
      assetId: stickerAssetId,
      position,
    };
  };

  const sendStickerCompanion = async (args: { jid: string; assetId: string }) => {
    await ensureStickerContextForAsset(args.assetId);
    const stickerBuffer = await fetchMediaAssetBuffer(args.assetId);
    rememberAutomatedThreadSend(args.jid);
    const sent = await sock.sendMessage(args.jid, {
      sticker: stickerBuffer,
    });
    const sentId = sent?.key?.id || undefined;
    rememberAutomatedOutboundId(sentId);
    rememberStickerCompanionAt(args.jid, Date.now());
    return sentId;
  };

  const pruneMediaAssetBufferCache = () => {
    const now = Date.now();
    for (const [assetId, entry] of mediaAssetBufferCache.entries()) {
      if (entry.expiresAt <= now) {
        mediaAssetBufferCache.delete(assetId);
      }
    }
    if (mediaAssetBufferCache.size <= MEDIA_ASSET_BUFFER_CACHE_MAX_ITEMS) {
      return;
    }
    const byOldest = [...mediaAssetBufferCache.entries()].sort((a, b) => a[1].cachedAt - b[1].cachedAt);
    const removeCount = mediaAssetBufferCache.size - MEDIA_ASSET_BUFFER_CACHE_MAX_ITEMS;
    for (let index = 0; index < removeCount; index += 1) {
      const entry = byOldest[index];
      if (!entry) {
        break;
      }
      mediaAssetBufferCache.delete(entry[0]);
    }
  };

  const decideOutboundPolicy = async (args: {
    inbound: ParsedInboundMessage;
    runtimeSettings: RuntimeSettings | null;
    personalityIntensity?: number;
    threadKind: "direct" | "group" | "broadcast_or_system";
    threadId: string;
    threadJid: string;
    threadTitle?: string;
    threadMessages: Array<{
      direction: "inbound" | "outbound";
      text: string;
      messageType?: string;
      messageAt?: number;
    }>;
    memePolicyMode?: "auto" | "always_allow" | "always_block";
    styleHints?: string[];
  }): Promise<OutboundPolicy> => {
    const text = args.inbound.text || "";
    const funnyKeywords = args.runtimeSettings?.funnyStatusKeywords || [];
    const funnyEmojis = args.runtimeSettings?.funnyStatusEmojis || [];
    const lowRisk = !/\b(password|otp|bank|wire|social security|medical|lawsuit|refund|contract)\b/i.test(text);
    const personalityPositive = (args.personalityIntensity ?? 0.6) >= 0.55;
    const soulModeEnabled = args.runtimeSettings?.soulModeEnabled ?? true;
    const humorAllowed =
      soulModeEnabled &&
      lowRisk &&
      personalityPositive &&
      (positiveTone(text, funnyKeywords, funnyEmojis) || looksLikeFunnyStatus(text, funnyKeywords, funnyEmojis));
    const stickerOnlyEligible =
      args.threadKind === "direct" &&
      (args.runtimeSettings?.stickersEnabled ?? true) &&
      !isSeriousConversation(text) &&
      (hasStickerCue(text) ||
        (humorAllowed &&
          ((args.inbound.kind === "sticker" && text.trim().length <= 180) ||
            (hasGenZCasualSignal(text) && text.trim().length <= 140) ||
            /\b(lol|lmao|haha|banter|meme|funny|dead)\b/i.test(text))));

    if (stickerOnlyEligible) {
      const stickerId = await pickBestStickerAsset(text);
      if (stickerId) {
        return {
          mode: "sticker",
          mediaAssetId: stickerId,
        };
      }
    }

    if (
      args.threadKind === "direct" &&
      (args.runtimeSettings?.stickersEnabled ?? true) &&
      args.inbound.kind === "sticker" &&
      humorAllowed
    ) {
      const stickerId = await pickBestStickerAsset(text);
      if (stickerId) {
        return {
          mode: "sticker",
          mediaAssetId: stickerId,
        };
      }
    }

    const memeCue = shouldUseMeme(text, funnyKeywords, funnyEmojis);
    const memeEligibleBase =
      args.threadKind === "direct" &&
      (args.runtimeSettings?.memesEnabled ?? true) &&
      memeCue &&
      humorAllowed &&
      !isSeriousConversation(text);

    if (memeEligibleBase) {
      const professionalGuard = evaluateProfessionalMemeGuard({
        memePolicyMode: args.memePolicyMode,
        historyMessages: args.threadMessages.map((message) => ({
          text: message.text,
          direction: message.direction,
          messageType: message.messageType,
        })),
        latestInboundText: text,
      });

      if (!professionalGuard.blocked) {
        void maybePrewarmThreadMeme({
          threadId: args.threadId,
          threadJid: args.threadJid,
          inboundText: text,
          recentHistoryLines: args.threadMessages.map((message) => `${message.direction === "inbound" ? "Them" : "Me"}: ${message.text}`),
          styleHints: args.styleHints,
          runtimeSettings: args.runtimeSettings,
          threadTitle: args.threadTitle,
        });
      }

      const lastMemeSentAt = args.threadMessages
        .filter((message) => message.direction === "outbound" && message.messageType === "meme")
        .map((message) => Number(message.messageAt || 0))
        .sort((a, b) => b - a)[0];
      const timingGate = evaluateMemeTimingGate({
        nowMs: Date.now(),
        lastMemeSentAtMs: lastMemeSentAt,
        cooldownMs: Math.max(5 * 60 * 1000, Math.min(args.runtimeSettings?.memeThreadCooldownMs ?? 3 * 60 * 60 * 1000, 7 * 24 * 60 * 60 * 1000)),
        probability: Math.max(0, Math.min(args.runtimeSettings?.memeSendProbability ?? 0.3, 1)),
        randomValue: Math.random(),
      });

      if (!professionalGuard.blocked && timingGate.pass) {
        const asset = await resolveMemeAssetWithFallback({
          pickGeneratedCached: async () => {
            const generatedEnabled = args.runtimeSettings?.generatedMemesEnabled ?? true;
            if (!generatedEnabled) {
              return undefined;
            }
            return await pickGeneratedMemeForThread(args.threadId, args.runtimeSettings?.memeThreadCooldownMs ?? 3 * 60 * 60 * 1000);
          },
          generateFresh: async () => {
            const generatedEnabled = args.runtimeSettings?.generatedMemesEnabled ?? true;
            if (!generatedEnabled) {
              return undefined;
            }
            return await generateAndStoreThreadMeme({
              threadId: args.threadId,
              threadJid: args.threadJid,
              inboundText: text,
              recentHistoryLines: args.threadMessages.map(
                (message) => `${message.direction === "inbound" ? "Them" : "Me"}: ${message.text}`,
              ),
              styleHints: args.styleHints,
              runtimeSettings: args.runtimeSettings,
              threadTitle: args.threadTitle,
              reason: "on_demand",
            });
          },
          pickUploadedFallback: async () => {
            return await pickUploadedMemeFallbackAsset();
          },
        });

        if (asset.assetId) {
          const assetSource: MemeAssetSource = asset.source;
          return {
            mode: "meme",
            mediaAssetId: asset.assetId,
            assetSource: assetSource === "generated_cache" || assetSource === "generated_fresh" ? "generated" : "uploaded",
          };
        }
      }
    }

    if ((args.runtimeSettings?.reactionsEnabled ?? true) && /\b(thanks|great|love|awesome)\b/i.test(text)) {
      return {
        mode: "reaction_plus_text",
        emoji: chooseReactionEmoji(text),
      };
    }

    return {
      mode: "text",
    };
  };

  const chatArchiveState = new Map<string, { isArchived: boolean; archivedAt: number }>();
  const threadTitleByJid = new Map<string, string>();
  const contactNameByJid = new Map<
    string,
    {
      savedName?: string;
      whatsappName?: string;
      verifiedName?: string;
    }
  >();
  const inboundThreadLanes = new Map<string, Promise<void>>();
  const outboxThreadLanes = new Map<string, Promise<void>>();
  const automatedOutboundIds = new Map<string, number>();
  const automatedOutboundThreadSends = new Map<string, number>();
  const recentEmojiOutboundByThread = new Map<string, number>();
  const recentStickerCompanionByThread = new Map<string, number>();
  const recentCallFallbackByThread = new Map<string, number>();
  const recentMarkedReadByMessage = new Map<string, number>();
  const recentPresenceSubscribeByThread = new Map<string, number>();
  const quietHoursMutedByThread = new Map<string, number>();
  const quietHoursMuteTouchedAtByThread = new Map<string, number>();
  const mediaAssetIdByKey = new Map<string, Id<"mediaAssets">>();
  const inboundImageVisionLastSentAtByThread = new Map<string, number>();
  let inboundConcurrency = Math.round(clamp(Number(process.env.SLM_INBOUND_CONCURRENCY || 4), 1, 16));
  let outboxSendConcurrency = Math.round(clamp(Number(process.env.SLM_OUTBOX_CONCURRENCY || 4), 1, 16));
  const runInboundWithLimit = createDynamicLimiter(() => inboundConcurrency);
  const runOutboxWithLimit = createDynamicLimiter(() => outboxSendConcurrency);
  const pruneRecentEmojiOutboundByThread = () => {
    const cutoff = Date.now() - EMOJI_COOLDOWN_MS;
    for (const [threadJid, lastEmojiAt] of recentEmojiOutboundByThread.entries()) {
      if (lastEmojiAt < cutoff) {
        recentEmojiOutboundByThread.delete(threadJid);
      }
    }
  };
  const rememberEmojiOutboundAt = (threadJid: string, messageAt: number) => {
    if (!threadJid || !Number.isFinite(messageAt)) {
      return;
    }
    pruneRecentEmojiOutboundByThread();
    const nextAt = Number(messageAt);
    const existing = recentEmojiOutboundByThread.get(threadJid);
    if (existing === undefined || nextAt > existing) {
      recentEmojiOutboundByThread.set(threadJid, nextAt);
    }
  };
  const pruneRecentStickerCompanionByThread = () => {
    const cutoff = Date.now() - STICKER_COMPANION_COOLDOWN_MS;
    for (const [threadJid, sentAt] of recentStickerCompanionByThread.entries()) {
      if (sentAt < cutoff) {
        recentStickerCompanionByThread.delete(threadJid);
      }
    }
  };
  const rememberStickerCompanionAt = (threadJid: string, sentAtMs: number) => {
    if (!threadJid || !Number.isFinite(sentAtMs)) {
      return;
    }
    pruneRecentStickerCompanionByThread();
    const nextAt = Number(sentAtMs);
    const existing = recentStickerCompanionByThread.get(threadJid);
    if (existing === undefined || nextAt > existing) {
      recentStickerCompanionByThread.set(threadJid, nextAt);
    }
  };
  const getRecentStickerCompanionAt = (threadJid: string) => {
    if (!threadJid) {
      return undefined;
    }
    pruneRecentStickerCompanionByThread();
    return recentStickerCompanionByThread.get(threadJid);
  };
  const pruneRecentCallFallbackByThread = () => {
    const cutoff = Date.now() - CALL_FALLBACK_COOLDOWN_MS;
    for (const [threadJid, sentAt] of recentCallFallbackByThread.entries()) {
      if (sentAt < cutoff) {
        recentCallFallbackByThread.delete(threadJid);
      }
    }
  };
  const rememberCallFallbackAt = (threadJid: string, sentAtMs: number) => {
    if (!threadJid || !Number.isFinite(sentAtMs)) {
      return;
    }
    pruneRecentCallFallbackByThread();
    const nextAt = Number(sentAtMs);
    const existing = recentCallFallbackByThread.get(threadJid);
    if (existing === undefined || nextAt > existing) {
      recentCallFallbackByThread.set(threadJid, nextAt);
    }
  };
  const hasRecentCallFallback = (threadJid: string) => {
    if (!threadJid) {
      return false;
    }
    pruneRecentCallFallbackByThread();
    const sentAt = recentCallFallbackByThread.get(threadJid);
    return typeof sentAt === "number" && sentAt > 0;
  };
  const pruneRecentMarkedReadByMessage = () => {
    const cutoff = Date.now() - READ_RECEIPT_DEDUPE_TTL_MS;
    for (const [messageKey, seenAt] of recentMarkedReadByMessage.entries()) {
      if (seenAt < cutoff) {
        recentMarkedReadByMessage.delete(messageKey);
      }
    }
  };
  const maybeMarkInboundAsRead = async (args: {
    message: {
      key: { id?: string | null; fromMe?: boolean | null; remoteJid?: string | null; participant?: string | null };
    };
    runtimeSettings: RuntimeSettings | null;
    threadJid: string;
    threadKind: "direct" | "group" | "broadcast_or_system";
    isStatusBroadcast: boolean;
  }) => {
    if (!resolveAutoMarkReadEnabled(args.runtimeSettings)) {
      return;
    }
    if (args.threadKind === "group" && !resolveAutoMarkReadGroupsEnabled(args.runtimeSettings)) {
      return;
    }
    if (args.isStatusBroadcast && !resolveAutoMarkReadStatusEnabled(args.runtimeSettings)) {
      return;
    }
    if (args.message.key.fromMe) {
      return;
    }
    const messageId = (args.message.key.id || "").trim();
    if (!messageId) {
      return;
    }
    const remoteJid = (args.message.key.remoteJid || args.threadJid || "").trim();
    if (!remoteJid) {
      return;
    }

    const dedupeKey = `${remoteJid}:${messageId}`;
    pruneRecentMarkedReadByMessage();
    if (recentMarkedReadByMessage.has(dedupeKey)) {
      return;
    }

    try {
      await sock.readMessages([
        {
          remoteJid,
          fromMe: false,
          id: messageId,
          participant: args.message.key.participant || undefined,
        },
      ]);
      recentMarkedReadByMessage.set(dedupeKey, Date.now());
    } catch (error) {
      const err = error instanceof Error ? error.message : String(error);
      await convex
        .mutation(convexRefs.systemRecordEvent, {
          source: "worker",
          eventType: "inbound.read_receipt.error",
          detail: compactLogText(`jid=${remoteJid} message=${messageId} err=${err}`, 280),
        })
        .catch(() => undefined);
    }
  };
  const pruneRecentPresenceSubscribeByThread = () => {
    const cutoff = Date.now() - PRESENCE_SUBSCRIBE_COOLDOWN_MS;
    for (const [threadKey, subscribedAt] of recentPresenceSubscribeByThread.entries()) {
      if (subscribedAt < cutoff) {
        recentPresenceSubscribeByThread.delete(threadKey);
      }
    }
  };
  const maybeSubscribePresence = async (jid: string, runtimeSettings?: RuntimeSettings | null) => {
    const effectiveRuntimeSettings = runtimeSettings ?? (await getRuntimeSettings());
    if (!resolvePresenceSubscribeEnabled(effectiveRuntimeSettings)) {
      return;
    }
    const threadKey = normalizeAccountJid(jid) || normalizeJidForLookup(jid);
    if (!threadKey) {
      return;
    }
    pruneRecentPresenceSubscribeByThread();
    const subscribedAt = recentPresenceSubscribeByThread.get(threadKey) || 0;
    if (Date.now() - subscribedAt < PRESENCE_SUBSCRIBE_COOLDOWN_MS) {
      return;
    }
    try {
      await sock.presenceSubscribe(jid);
      recentPresenceSubscribeByThread.set(threadKey, Date.now());
    } catch (error) {
      const err = error instanceof Error ? error.message : String(error);
      await convex
        .mutation(convexRefs.systemRecordEvent, {
          source: "worker",
          eventType: "presence.subscribe.error",
          detail: compactLogText(`jid=${jid} err=${err}`, 260),
        })
        .catch(() => undefined);
    }
  };
  const resolveQuietHoursWindow = (runtimeSettings: RuntimeSettings | null, nowMs: number) => {
    const startHour = normalizeHour(runtimeSettings?.quietHoursStartHour, DEFAULT_NIGHT_WIND_DOWN_START_HOUR);
    const endHour = normalizeHour(runtimeSettings?.quietHoursEndHour, DEFAULT_NIGHT_WIND_DOWN_END_HOUR);
    const hour = new Date(nowMs).getHours();
    const active = isWithinHourWindow(hour, startHour, endHour);
    const muteUntilMs = active ? computeNextWindowEnd(nowMs, startHour, endHour) : undefined;
    return { active, muteUntilMs };
  };
  const maybeApplyQuietHoursMute = async (args: {
    jid: string;
    runtimeSettings: RuntimeSettings | null;
    threadId?: Id<"threads">;
    reason: string;
  }) => {
    if (!resolveChatModifyQuietHoursEnabled(args.runtimeSettings)) {
      return;
    }
    if (isGroupJid(args.jid) || args.jid === "status@broadcast") {
      return;
    }
    const now = Date.now();
    const quietHours = resolveQuietHoursWindow(args.runtimeSettings, now);
    if (!quietHours.active || !quietHours.muteUntilMs) {
      return;
    }
    const threadKey = normalizeAccountJid(args.jid) || normalizeJidForLookup(args.jid);
    if (!threadKey) {
      return;
    }
    const previousMuteUntil = quietHoursMutedByThread.get(threadKey) || 0;
    const lastTouchedAt = quietHoursMuteTouchedAtByThread.get(threadKey) || 0;
    if (
      previousMuteUntil >= quietHours.muteUntilMs &&
      now - lastTouchedAt < CHAT_MODIFY_QUIET_HOURS_MIN_INTERVAL_MS
    ) {
      return;
    }
    try {
      await sock.chatModify({ mute: Math.floor(quietHours.muteUntilMs / 1000) }, args.jid);
      quietHoursMutedByThread.set(threadKey, quietHours.muteUntilMs);
      quietHoursMuteTouchedAtByThread.set(threadKey, now);
      await convex
        .mutation(convexRefs.systemRecordEvent, {
          source: "worker",
          eventType: "whatsapp.chat_quiet_hours.muted",
          ...(args.threadId ? { threadId: args.threadId } : {}),
          detail: compactLogText(
            `jid=${args.jid} mute_until=${new Date(quietHours.muteUntilMs).toISOString()} reason=${args.reason}`,
            280,
          ),
        })
        .catch(() => undefined);
    } catch (error) {
      const err = error instanceof Error ? error.message : String(error);
      await convex
        .mutation(convexRefs.systemRecordEvent, {
          source: "worker",
          eventType: "whatsapp.chat_quiet_hours.mute_error",
          ...(args.threadId ? { threadId: args.threadId } : {}),
          detail: compactLogText(`jid=${args.jid} reason=${args.reason} err=${err}`, 280),
        })
        .catch(() => undefined);
    }
  };
  const maybeClearQuietHoursMute = async (args: {
    jid: string;
    runtimeSettings: RuntimeSettings | null;
    threadId?: Id<"threads">;
    reason: string;
  }) => {
    if (!resolveChatModifyQuietHoursEnabled(args.runtimeSettings)) {
      return;
    }
    if (isGroupJid(args.jid) || args.jid === "status@broadcast") {
      return;
    }
    const threadKey = normalizeAccountJid(args.jid) || normalizeJidForLookup(args.jid);
    if (!threadKey || !quietHoursMutedByThread.has(threadKey)) {
      return;
    }
    const now = Date.now();
    const quietHours = resolveQuietHoursWindow(args.runtimeSettings, now);
    if (quietHours.active) {
      return;
    }
    const lastTouchedAt = quietHoursMuteTouchedAtByThread.get(threadKey) || 0;
    if (now - lastTouchedAt < CHAT_MODIFY_QUIET_HOURS_MIN_INTERVAL_MS) {
      return;
    }
    try {
      await sock.chatModify({ mute: null }, args.jid);
      quietHoursMutedByThread.delete(threadKey);
      quietHoursMuteTouchedAtByThread.set(threadKey, now);
      await convex
        .mutation(convexRefs.systemRecordEvent, {
          source: "worker",
          eventType: "whatsapp.chat_quiet_hours.unmuted",
          ...(args.threadId ? { threadId: args.threadId } : {}),
          detail: compactLogText(`jid=${args.jid} reason=${args.reason}`, 240),
        })
        .catch(() => undefined);
    } catch (error) {
      const err = error instanceof Error ? error.message : String(error);
      await convex
        .mutation(convexRefs.systemRecordEvent, {
          source: "worker",
          eventType: "whatsapp.chat_quiet_hours.unmute_error",
          ...(args.threadId ? { threadId: args.threadId } : {}),
          detail: compactLogText(`jid=${args.jid} reason=${args.reason} err=${err}`, 280),
        })
        .catch(() => undefined);
    }
  };
  const buildAutomatedAboutText = (nowMs: number, runtimeSettings: RuntimeSettings | null) => {
    const now = new Date(nowMs);
    const baseText =
      resolveAboutAutomationTemplate(runtimeSettings) ||
      `Social Life Manager active • ${now.toLocaleDateString()} ${now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
    const rendered = baseText
      .replace(/\{date\}/gi, now.toLocaleDateString())
      .replace(/\{time\}/gi, now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }))
      .replace(/\{datetime\}/gi, now.toLocaleString())
      .trim();
    return rendered.slice(0, 139).trim();
  };
  const maybeRunAboutAutomation = async (reason: string, runtimeSettings: RuntimeSettings | null, force = false) => {
    if (!resolveAboutAutomationEnabled(runtimeSettings)) {
      return;
    }
    const now = Date.now();
    const intervalMs = resolveAboutAutomationIntervalMs(runtimeSettings);
    if (!force && now - lastAboutAutomationAt < intervalMs) {
      return;
    }
    lastAboutAutomationAt = now;
    const nextAbout = buildAutomatedAboutText(now, runtimeSettings);
    if (!nextAbout) {
      return;
    }
    if (!force && nextAbout === lastAutomatedAboutText) {
      return;
    }
    try {
      await sock.updateProfileStatus(nextAbout);
      lastAutomatedAboutText = nextAbout;
      await convex
        .mutation(convexRefs.systemRecordEvent, {
          source: "worker",
          eventType: "whatsapp.about.updated",
          detail: compactLogText(`reason=${reason} text="${nextAbout}"`, 280),
        })
        .catch(() => undefined);
    } catch (error) {
      const err = error instanceof Error ? error.message : String(error);
      await convex
        .mutation(convexRefs.systemRecordEvent, {
          source: "worker",
          eventType: "whatsapp.about.update_error",
          detail: compactLogText(`reason=${reason} err=${err}`, 280),
        })
        .catch(() => undefined);
    }
  };

  const mediaCacheKey = (kind: CapturableMediaKind, contentHash: string) => `${kind}:${contentHash}`;
  const pruneInboundImageVisionByThread = () => {
    const ttl = Math.max(VISION_FILTER_UNCAPTIONED_COOLDOWN_MS * 3, 6 * 60 * 60 * 1000);
    const cutoff = Date.now() - ttl;
    for (const [threadJid, lastAt] of inboundImageVisionLastSentAtByThread.entries()) {
      if (lastAt < cutoff) {
        inboundImageVisionLastSentAtByThread.delete(threadJid);
      }
    }
  };
  const rememberInboundImageVisionAt = (threadJid: string, atMs: number) => {
    if (!threadJid || !Number.isFinite(atMs)) {
      return;
    }
    pruneInboundImageVisionByThread();
    const nextAt = Number(atMs);
    const existing = inboundImageVisionLastSentAtByThread.get(threadJid);
    if (existing === undefined || nextAt > existing) {
      inboundImageVisionLastSentAtByThread.set(threadJid, nextAt);
    }
  };
  const getRecentEmojiOutboundAt = (threadJid: string) => {
    if (!threadJid) {
      return undefined;
    }
    pruneRecentEmojiOutboundByThread();
    return recentEmojiOutboundByThread.get(threadJid);
  };
  const pruneAutomatedOutboundIds = () => {
    const cutoff = Date.now() - 5 * 60 * 1000;
    for (const [id, seenAt] of automatedOutboundIds.entries()) {
      if (seenAt < cutoff) {
        automatedOutboundIds.delete(id);
      }
    }
    for (const [threadJid, seenAt] of automatedOutboundThreadSends.entries()) {
      if (seenAt < cutoff) {
        automatedOutboundThreadSends.delete(threadJid);
      }
    }
  };
  const rememberAutomatedOutboundId = (messageId: string | undefined) => {
    if (!messageId) {
      return;
    }
    pruneAutomatedOutboundIds();
    automatedOutboundIds.set(messageId, Date.now());
  };
  const consumeAutomatedOutboundId = (messageId: string | undefined) => {
    if (!messageId) {
      return false;
    }
    pruneAutomatedOutboundIds();
    const seen = automatedOutboundIds.has(messageId);
    if (seen) {
      automatedOutboundIds.delete(messageId);
    }
    return seen;
  };
  const rememberAutomatedThreadSend = (threadJid: string) => {
    if (!threadJid) {
      return;
    }
    pruneAutomatedOutboundIds();
    automatedOutboundThreadSends.set(threadJid, Date.now());
  };
  const isLikelyAutomatedThreadSend = (threadJid: string, messageAt: number) => {
    if (!threadJid) {
      return false;
    }
    pruneAutomatedOutboundIds();
    const lastSentAt = automatedOutboundThreadSends.get(threadJid);
    if (!lastSentAt) {
      return false;
    }
    return Math.abs(lastSentAt - messageAt) <= 15_000;
  };

  const applyRuntimeConcurrency = (runtimeSettings: RuntimeSettings | null) => {
    if (!runtimeSettings) {
      return;
    }
    inboundConcurrency = Math.round(clamp(runtimeSettings.inboundConcurrency ?? inboundConcurrency, 1, 16));
    outboxSendConcurrency = Math.round(clamp(runtimeSettings.outboxSendConcurrency ?? outboxSendConcurrency, 1, 16));
  };

  const enqueueByThreadLane = (
    lanes: Map<string, Promise<void>>,
    threadKey: string,
    task: () => Promise<void>,
  ) => {
    const previous = lanes.get(threadKey) || Promise.resolve();
    const queued = previous.catch(() => undefined).then(task);
    const tracked = queued.finally(() => {
      if (lanes.get(threadKey) === tracked) {
        lanes.delete(threadKey);
      }
    });
    lanes.set(threadKey, tracked);
    return tracked;
  };

  const extractArchivedFlag = (chatLike: unknown): boolean | undefined => {
    if (!chatLike || typeof chatLike !== "object") {
      return undefined;
    }
    const value = chatLike as { archived?: unknown; archive?: unknown };
    if (typeof value.archived === "boolean") {
      return value.archived;
    }
    if (typeof value.archive === "boolean") {
      return value.archive;
    }
    return undefined;
  };

  const extractChatTimestamp = (chatLike: unknown): number | undefined => {
    if (!chatLike || typeof chatLike !== "object") {
      return undefined;
    }
    const value = chatLike as { conversationTimestamp?: unknown; pin?: unknown };
    const raw = value.conversationTimestamp ?? value.pin;
    if (raw === undefined || raw === null) {
      return undefined;
    }
    return normalizeIncomingMessageTimestamp(raw, Date.now());
  };

  const normalizeDisplayName = (value: unknown): string | undefined => {
    if (typeof value !== "string") {
      return undefined;
    }
    const trimmed = value.trim();
    return trimmed || undefined;
  };

  const normalizeJidKey = (jid: string | null | undefined): string | undefined => {
    const trimmed = (jid || "").trim().toLowerCase();
    return trimmed || undefined;
  };

  const jidLookupKeys = (jid: string | null | undefined): string[] => {
    const normalized = normalizeJidKey(jid);
    if (!normalized) {
      return [];
    }
    const accountKey = normalizeAccountJid(normalized);
    if (accountKey && accountKey !== normalized) {
      return [normalized, accountKey];
    }
    return [normalized];
  };

  const rememberThreadTitle = (threadJid: string | null | undefined, title: unknown) => {
    const normalizedTitle = normalizeDisplayName(title);
    if (!normalizedTitle) {
      return;
    }
    for (const key of jidLookupKeys(threadJid)) {
      threadTitleByJid.set(key, normalizedTitle);
    }
  };

  const rememberContactName = (contactLike: {
    id?: string;
    lid?: string;
    phoneNumber?: string;
    name?: string;
    notify?: string;
    verifiedName?: string;
  }) => {
    const keys = new Set<string>();
    for (const candidate of [contactLike.id, contactLike.lid, contactLike.phoneNumber]) {
      for (const key of jidLookupKeys(candidate)) {
        keys.add(key);
      }
    }
    if (keys.size === 0) {
      return;
    }

    const savedName = normalizeDisplayName(contactLike.name);
    const whatsappName = normalizeDisplayName(contactLike.notify);
    const verifiedName = normalizeDisplayName(contactLike.verifiedName);

    if (!savedName && !whatsappName && !verifiedName) {
      return;
    }

    for (const key of keys) {
      const existing = contactNameByJid.get(key);
      contactNameByJid.set(key, {
        savedName: savedName ?? existing?.savedName,
        whatsappName: whatsappName ?? existing?.whatsappName,
        verifiedName: verifiedName ?? existing?.verifiedName,
      });
    }
  };

  const syncContactMetadata = (contactLike: unknown) => {
    if (!contactLike || typeof contactLike !== "object") {
      return;
    }
    const row = contactLike as {
      id?: string;
      lid?: string;
      phoneNumber?: string;
      name?: string;
      notify?: string;
      verifiedName?: string;
    };
    rememberContactName(row);
  };

  const resolveSenderTitle = (args: {
    threadJid: string;
    threadKind: "direct" | "group" | "broadcast_or_system";
    pushName?: string | null;
  }): string | undefined => {
    let savedName: string | undefined;
    let whatsappName: string | undefined;
    let verifiedName: string | undefined;
    let chatTitle: string | undefined;
    for (const key of jidLookupKeys(args.threadJid)) {
      const contact = contactNameByJid.get(key);
      if (contact) {
        savedName = savedName || contact.savedName;
        whatsappName = whatsappName || contact.whatsappName;
        verifiedName = verifiedName || contact.verifiedName;
      }
      chatTitle = chatTitle || threadTitleByJid.get(key);
    }

    if (args.threadKind === "group") {
      return chatTitle;
    }

    return savedName || chatTitle || whatsappName || normalizeDisplayName(args.pushName) || verifiedName;
  };

  const syncThreadMetadata = async (chatLike: unknown) => {
    if (!chatLike || typeof chatLike !== "object") {
      return;
    }
    const row = chatLike as {
      id?: string;
      jid?: string;
      name?: string;
      conversationName?: string;
      subject?: string;
    };
    const threadJid = row.id || row.jid || "";
    if (!threadJid) {
      return;
    }
    const threadTitle = normalizeDisplayName(row.subject || row.name || row.conversationName);
    rememberThreadTitle(threadJid, threadTitle);

    const isArchived = extractArchivedFlag(chatLike);
    const archivedAt = isArchived ? Date.now() : undefined;
    if (isArchived !== undefined) {
      chatArchiveState.set(threadJid, {
        isArchived,
        archivedAt: archivedAt || Date.now(),
      });
    }

    const threadKind = classifyThreadKindFromJid(threadJid);
    await convex
      .mutation(convexRefs.threadsUpsertMetadata, {
        provider: "whatsapp",
        threadJid,
        title: threadTitle,
        isGroup: isGroupJid(threadJid),
        threadKind,
        isArchived,
        archivedAt,
        lastMessageAt: extractChatTimestamp(chatLike),
      })
      .catch(() => undefined);
  };

  const maybeCaptureMediaAsset = async (args: {
    message: Parameters<typeof downloadMediaMessage>[0];
    messageId: string;
    kind: CapturableMediaKind;
    threadId?: string;
    whatsappMessageId?: string;
    mimeType?: string;
    direction: "inbound" | "outbound";
    ingestMode: "live" | "history_sync" | "history_fetch";
  }) => {
    try {
      const mediaBytes = await downloadMediaMessage(
        args.message,
        "buffer",
        {},
        {
          reuploadRequest: (msg) => sock.updateMediaMessage(msg),
          logger,
        },
      );
      const buffer = Buffer.from(mediaBytes);
      if (buffer.length === 0) {
        return;
      }

      const contentHash = createHash("sha256").update(buffer).digest("hex");
      const cacheKey = mediaCacheKey(args.kind, contentHash);
      const cachedAssetId = mediaAssetIdByKey.get(cacheKey);
      if (cachedAssetId) {
        await convex
          .mutation(convexRefs.inboundAttachMediaAsset, {
            messageId: args.messageId as Id<"messages">,
            mediaAssetId: cachedAssetId,
          })
          .catch(() => undefined);
        if (args.kind === "sticker") {
          void ensureStickerContextForAsset(cachedAssetId);
        }
        return;
      }

      const existing = (await convex
        .query(convexRefs.mediaFindAssetByContentHash, {
          kind: args.kind,
          contentHash,
        })
        .catch(() => null)) as { _id: Id<"mediaAssets"> } | null;

      if (existing?._id) {
        mediaAssetIdByKey.set(cacheKey, existing._id);
        await convex
          .mutation(convexRefs.inboundAttachMediaAsset, {
            messageId: args.messageId as Id<"messages">,
            mediaAssetId: existing._id,
          })
          .catch(() => undefined);
        if (args.kind === "sticker") {
          void ensureStickerContextForAsset(existing._id);
        }
        return;
      }

      const fallbackMimeType =
        args.kind === "sticker"
          ? "image/webp"
          : args.kind === "image"
            ? "image/jpeg"
            : args.kind === "video"
              ? "video/mp4"
              : args.kind === "audio"
                ? "audio/ogg"
                : "application/octet-stream";
      const uploadUrl = (await convex.mutation(convexRefs.mediaGenerateUploadUrl, {})) as string;
      const upload = await fetch(uploadUrl, {
        method: "POST",
        headers: {
          "Content-Type": args.mimeType || fallbackMimeType,
        },
        body: buffer,
      });
      if (!upload.ok) {
        throw new Error(`Media upload failed (${upload.status}).`);
      }
      const uploadPayload = (await upload.json()) as { storageId?: string };
      if (!uploadPayload.storageId) {
        throw new Error("Media upload response missing storageId.");
      }

      const nowIso = new Date().toISOString().slice(0, 10);
      const labelSuffix = (args.whatsappMessageId || contentHash).slice(-8);
      const kindLabel = args.kind === "audio" ? "voice/audio" : args.kind;
      const assetId = (await convex.mutation(convexRefs.mediaRegisterAssetIfMissing, {
        kind: args.kind,
        label: `Auto ${kindLabel} ${nowIso} ${labelSuffix}`,
        tags: [
          "autocaptured",
          "whatsapp",
          args.kind,
          args.direction === "outbound" ? "outbound" : "inbound",
          args.ingestMode === "live" ? "live" : "history",
        ],
        fileId: uploadPayload.storageId as Id<"_storage">,
        mimeType: args.mimeType || fallbackMimeType,
        source: "captured",
        threadId: args.threadId as Id<"threads"> | undefined,
        enabled: true,
        contentHash,
      })) as Id<"mediaAssets">;

      mediaAssetIdByKey.set(cacheKey, assetId);
      await convex
        .mutation(convexRefs.inboundAttachMediaAsset, {
          messageId: args.messageId as Id<"messages">,
          mediaAssetId: assetId,
        })
        .catch(() => undefined);
      if (args.kind === "sticker") {
        void ensureStickerContextForAsset(assetId);
      }
    } catch (error) {
      const err = error instanceof Error ? error.message : String(error);
      await convex
        .mutation(convexRefs.systemRecordEvent, {
          source: "worker",
          eventType: "media.capture_error",
          threadId: args.threadId as Id<"threads"> | undefined,
          detail: compactLogText(`${args.kind}: ${err}`, 280),
        })
        .catch(() => undefined);
    }
  };

  const scheduleWorkerSelfRestart = async () => {
    const bunBin = process.env.BUN_BIN || "bun";
    const shell = process.env.SHELL || "sh";
    const startCmd = `sleep 1; cd "${process.cwd().replace(/"/g, '\\"')}" && ${bunBin} run worker >/dev/null 2>&1`;
    const child = spawn(shell, ["-lc", startCmd], {
      cwd: ".",
      env: process.env,
      detached: true,
      stdio: "ignore",
    });
    child.unref();
  };

  const describeWorkerRuntime = () => {
    return workerRuntimePaused ? "worker paused (listener still active)" : "worker active";
  };

  type SelfControlMessageKey = {
    id?: string | null;
    fromMe?: boolean | null;
    remoteJid?: string | null;
    participant?: string | null;
  };

  type ResolvedSelfControlThread = {
    threadJid: string;
    replyJids: string[];
  };

  const SELF_IMPROVE_MAX_PROMPT_CHARS = 1200;
  const SELF_IMPROVE_MAX_REPLY_CHARS = 3_500;
  const SELF_IMPROVE_MAX_SINGLE_LINE_CHARS = 1_600;
  const SELF_IMPROVE_ROOT = resolve(process.cwd(), ".slm", "self-improvement");
  const SELF_IMPROVE_LOCK_PATH = join(SELF_IMPROVE_ROOT, "runner.lock");
  const SELF_IMPROVE_LATEST_META_PATH = join(SELF_IMPROVE_ROOT, "latest-meta.json");
  const SELF_IMPROVE_LATEST_REPORT_PATH = join(SELF_IMPROVE_ROOT, "latest.md");
  const SELF_CONTROL_MESSAGE_PREFIX = (process.env.SLM_SELF_CONTROL_MESSAGE_PREFIX || "").trim();
  const OPENCLAW_CLI_PATH = (process.env.SLM_OPENCLAW_CLI_PATH || "openclaw").trim() || "openclaw";
  const OPENCLAW_AGENT_ID = (process.env.SLM_OPENCLAW_AGENT_ID || "main").trim() || "main";
  const OPENCLAW_AGENT_TIMEOUT_MS = (() => {
    const raw = Number(process.env.SLM_OPENCLAW_AGENT_TIMEOUT_MS || 6 * 60 * 60 * 1000);
    if (!Number.isFinite(raw)) {
      return 6 * 60 * 60 * 1000;
    }
    return Math.max(1_000, Math.min(Math.round(raw), 24 * 60 * 60 * 1000));
  })();
  const OPENCLAW_PROBE_TIMEOUT_MS = Math.max(1_000, Math.min(OPENCLAW_AGENT_TIMEOUT_MS, 8_000));
  const OPENCLAW_MAX_COMMAND_CHARS = 2_000;
  const OPENCLAW_MAX_STDIO_CHARS = 1_024 * 1_024;

  const resolveSelfControlThread = (messageKey: SelfControlMessageKey): ResolvedSelfControlThread | null => {
    const rawThreadJid = getThreadJid(messageKey as Parameters<typeof getThreadJid>[0]);
    const senderJid = getSenderJid(messageKey as Parameters<typeof getSenderJid>[0]);
    const threadJid = rawThreadJid === "status@broadcast" ? senderJid : rawThreadJid;
    if (!threadJid && !senderJid) {
      return null;
    }

    const selfAccounts = getSelfAccountIds();
    if (selfAccounts.length === 0) {
      return null;
    }

    const threadAccount = normalizeAccountJid(threadJid);
    const senderAccount = normalizeAccountJid(senderJid);
    const selfScoped = isStrictSelfControlScope({
      selfAccounts,
      threadAccount,
      senderAccount,
      fromMe: Boolean(messageKey.fromMe),
    });
    if (!selfScoped) {
      return null;
    }

    const replyJids: string[] = [];
    const seen = new Set<string>();
    const pushReplyJid = (jid: string | null | undefined) => {
      const trimmed = (jid || "").trim();
      if (!trimmed) {
        return;
      }
      const lowered = trimmed.toLowerCase();
      if (seen.has(lowered)) {
        return;
      }
      seen.add(lowered);
      replyJids.push(trimmed);
    };

    pushReplyJid(threadJid);
    pushReplyJid(senderJid);
    for (const selfJid of getSelfIdentityJids()) {
      pushReplyJid(selfJid);
    }
    for (const selfAccount of selfAccounts) {
      pushReplyJid(`${selfAccount}@s.whatsapp.net`);
      pushReplyJid(`${selfAccount}@lid`);
    }

    return {
      threadJid: threadJid || senderJid || `${selfAccounts[0]}@s.whatsapp.net`,
      replyJids,
    };
  };

  const sendSelfControlText = async (args: { selfControl: ResolvedSelfControlThread; text: string }) => {
    let lastError: unknown = null;

    for (const jid of args.selfControl.replyJids) {
      try {
        rememberAutomatedThreadSend(jid);
        const sent = await sock.sendMessage(jid, { text: args.text });
        rememberAutomatedOutboundId(sent?.key?.id || undefined);
        return;
      } catch (error) {
        lastError = error;
      }
    }

    const fallbackError =
      lastError instanceof Error ? lastError.message : lastError ? String(lastError) : "no reply JID available";
    throw new Error(`self-control reply send failed: ${fallbackError}`);
  };

  const formatAssistantReply = (speaker: "openclaw" | "codex", text: string) => {
    const trimmed = (text || "").trim();
    if (!trimmed) {
      return `${speaker}: ...`;
    }
    return `${speaker}: ${trimmed}`;
  };

  const monitorSelfImproveRunStream = (args: {
    child: ChildProcessWithoutNullStreams;
    selfControl: ResolvedSelfControlThread;
  }) => {
    const startedAt = Date.now();
    let stdoutTail = "";
    let stderrTail = "";
    const appendTail = (current: string, chunk: string, limit = 12_000) => {
      const next = `${current}${chunk}`;
      if (next.length <= limit) {
        return next;
      }
      return next.slice(next.length - limit);
    };

    args.child.stdout.setEncoding("utf8");
    args.child.stderr.setEncoding("utf8");
    args.child.stdout.on("data", (chunk: string) => {
      stdoutTail = appendTail(stdoutTail, chunk);
    });
    args.child.stderr.on("data", (chunk: string) => {
      stderrTail = appendTail(stderrTail, chunk);
    });

    args.child.once("close", (code) => {
      void (async () => {
        const elapsedSeconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
        const success = typeof code === "number" && code === 0;
        const briefDetail = compactLogText(
          [stderrTail, stdoutTail]
            .map((part) => part.trim())
            .filter(Boolean)
            .join(" | "),
          220,
        );

        let text = "";
        if (success) {
          const latestReport = await readLatestSelfImproveReport();
          const reportReply = buildSelfImproveReportReply(latestReport);
          text = reportReply
            ? formatAssistantReply("codex", reportReply)
            : formatAssistantReply("codex", `done. finished in ${elapsedSeconds}s.`);
        } else {
          text = formatAssistantReply(
            "codex",
            `I hit an issue${briefDetail ? ` (${briefDetail})` : ""}.`,
          );
        }

        await sendSelfControlText({ selfControl: args.selfControl, text }).catch(() => undefined);
      })();
    });
  };

  const isSelfImproveRunActive = async () => {
    try {
      await stat(SELF_IMPROVE_LOCK_PATH);
      return true;
    } catch {
      return false;
    }
  };

  const readLatestSelfImproveMeta = async () => {
    try {
      const text = await readFile(SELF_IMPROVE_LATEST_META_PATH, "utf8");
      const parsed = JSON.parse(text) as {
        runId?: string;
        finishedAt?: string;
        durationMs?: number;
        codexExitCode?: number | null;
        codexErrorMessage?: string | null;
      };
      return parsed;
    } catch {
      return null;
    }
  };

  const readLatestSelfImproveReport = async () => {
    try {
      const text = await readFile(SELF_IMPROVE_LATEST_REPORT_PATH, "utf8");
      return text;
    } catch {
      return "";
    }
  };

  const truncateForReply = (text: string, maxChars: number) => {
    const trimmed = text.trim();
    if (!trimmed) {
      return "";
    }
    if (trimmed.length <= maxChars) {
      return trimmed;
    }
    return `${trimmed.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
  };

  const buildSelfImproveReportReply = (report: string) => {
    const trimmed = report.trim();
    if (!trimmed) {
      return "";
    }

    const singleLine = compactLogText(trimmed.replace(/\s+/g, " "), SELF_IMPROVE_MAX_SINGLE_LINE_CHARS);
    if (singleLine && singleLine.length >= Math.min(180, Math.round(trimmed.length * 0.7))) {
      return singleLine;
    }

    return truncateForReply(trimmed, SELF_IMPROVE_MAX_REPLY_CHARS);
  };

  const launchSelfImproveRun = async (args: {
    command: Extract<SelfImproveCommand, { action: "run" }>;
    selfControl: ResolvedSelfControlThread;
  }) => {
    const command = args.command;
    const prompt = command.prompt.trim();
    if (!prompt) {
      return {
        hasError: true,
        responseText: formatAssistantReply("codex", 'tell me what to improve, e.g. "improve tighten retries".'),
      };
    }

    if (prompt.length > SELF_IMPROVE_MAX_PROMPT_CHARS) {
      return {
        hasError: true,
        responseText: formatAssistantReply(
          "codex",
          `that prompt is too long (${prompt.length} chars, max ${SELF_IMPROVE_MAX_PROMPT_CHARS}).`,
        ),
      };
    }

    if (await isSelfImproveRunActive()) {
      return {
        hasError: true,
        responseText: formatAssistantReply("codex", 'I am already running an improve task. send "improve status".'),
      };
    }

    const bunBin = process.env.BUN_BIN || "bun";
    const child = spawn(bunBin, ["run", "self-improve", "--", "--prompt", prompt], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    monitorSelfImproveRunStream({
      child,
      selfControl: args.selfControl,
    });

    return {
      hasError: false,
      responseText: formatAssistantReply("codex", "on it. I will reply here when I am done."),
    };
  };

  const buildSelfImproveStatusText = async () => {
    const active = await isSelfImproveRunActive();
    const latest = await readLatestSelfImproveMeta();
    if (active) {
      return formatAssistantReply("codex", "still working on your improve task.");
    }
    if (!latest?.runId) {
      return formatAssistantReply("codex", "idle. no completed improve tasks yet.");
    }

    if (latest.codexErrorMessage || (typeof latest.codexExitCode === "number" && latest.codexExitCode !== 0)) {
      return formatAssistantReply("codex", "idle. last improve task ended with an issue.");
    }

    const durationText =
      typeof latest.durationMs === "number" && Number.isFinite(latest.durationMs)
        ? ` last run took ${Math.round(latest.durationMs / 1000)}s.`
        : "";
    return formatAssistantReply("codex", `idle. last improve task finished successfully.${durationText}`);
  };

  const buildSelfImproveLatestText = async () => {
    const [latest, latestReport] = await Promise.all([readLatestSelfImproveMeta(), readLatestSelfImproveReport()]);
    if (!latest?.runId && !latestReport.trim()) {
      return formatAssistantReply("codex", "no completed improve tasks yet.");
    }

    const reportReply = buildSelfImproveReportReply(latestReport);
    if (reportReply) {
      return formatAssistantReply("codex", reportReply);
    }

    const hasError =
      Boolean(latest?.codexErrorMessage) || (typeof latest?.codexExitCode === "number" && latest.codexExitCode !== 0);
    if (hasError) {
      return formatAssistantReply("codex", "last improve task hit an issue.");
    }
    return formatAssistantReply("codex", "last improve task completed successfully.");
  };

  const buildSelfControlHelpText = () => {
    return [
      "Self-chat command help",
      "",
      "Runtime controls:",
      "- pause | resume | restart | status (defaults to worker)",
      "- pause worker|app|both",
      "- resume worker|app|both",
      "- restart worker|app|both",
      "- status worker|app|both",
      "",
      "Local Codex improve:",
      "- improve <prompt>",
      "- improve status",
      "- improve latest",
      "",
      "OpenClaw CLI:",
      "- openclaw <instruction>",
      "- @openclaw <instruction>",
      "- openclaw status",
      "- openclaw help",
      "",
      "Help:",
      "- help",
      "- /slm help",
      "- improve help",
      ...(SELF_CONTROL_MESSAGE_PREFIX
        ? [
            "",
            `Prefix mode active: start commands with "${SELF_CONTROL_MESSAGE_PREFIX}"`,
            `Example: ${SELF_CONTROL_MESSAGE_PREFIX} help`,
          ]
        : []),
    ].join("\n");
  };

  const maybeHandleSelfControlHelpCommand = async (message: {
    key: SelfControlMessageKey;
    message?: unknown;
  }) => {
    const parsed = parseInboundMessage(message.message as Parameters<typeof parseInboundMessage>[0]);
    if (parsed.kind !== "text") {
      return false;
    }

    const selfControl = resolveSelfControlThread(message.key);
    if (!selfControl) {
      return false;
    }

    const commandText = parseSelfControlCommandText({
      rawText: parsed.text,
      prefix: SELF_CONTROL_MESSAGE_PREFIX,
    });
    if (!commandText || !isSelfControlHelpCommand(commandText)) {
      return false;
    }

    const responseText = buildSelfControlHelpText();
    await sendSelfControlText({ selfControl, text: responseText });
    await convex
      .mutation(convexRefs.systemRecordEvent, {
        source: "worker",
        eventType: "self_control.help.sent",
        detail: "help command response sent",
      })
      .catch(() => undefined);

    return true;
  };

  const runRuntimeCommandForTarget = async (
    command: RuntimeCommand,
    target: RuntimeCommandTarget,
  ): Promise<{ lines: string[]; restartWorker: boolean; hasError: boolean }> => {
    const lines: string[] = [];
    let restartWorker = false;
    let hasError = false;

    if (target === "worker") {
      if (command.action === "status") {
        lines.push(describeWorkerRuntime());
      } else if (command.action === "pause") {
        if (workerRuntimePaused) {
          lines.push("worker already paused (listener still active)");
        } else {
          workerRuntimePaused = true;
          lines.push("worker paused (listener still active)");
        }
      } else if (command.action === "resume") {
        if (!workerRuntimePaused) {
          lines.push("worker already active");
        } else {
          workerRuntimePaused = false;
          lines.push("worker resumed");
        }
      } else if (command.action === "restart") {
        workerRuntimePaused = false;
        restartWorker = true;
        lines.push("worker restart requested");
      }
      return { lines, restartWorker, hasError };
    }

    if (target === "app") {
      if (command.action === "status") {
        const appStatus = await getAppRuntimeStatus();
        lines.push(appStatus.running ? `app running (pid ${appStatus.pid})` : "app not running");
        return { lines, restartWorker, hasError };
      }

      if (command.action === "pause") {
        const result = await pauseAppRuntime();
        if (result.action === "paused") {
          lines.push(`app paused (pid ${result.pid})`);
        } else if (result.action === "none" || result.action === "stale") {
          lines.push("app not running");
        } else {
          lines.push("app pause failed");
          hasError = true;
        }
        return { lines, restartWorker, hasError };
      }

      if (command.action === "resume") {
        const result = await resumeAppRuntime();
        if (result.action === "resumed") {
          lines.push(`app resumed (pid ${result.pid})`);
          return { lines, restartWorker, hasError };
        }
        if (result.action === "none" || result.action === "stale") {
          const started = await startAppRuntime();
          if (started.action === "started") {
            lines.push(`app started (pid ${started.pid})`);
          } else if (started.action === "none") {
            lines.push(`app running (pid ${started.pid})`);
          } else {
            lines.push("app start failed");
            hasError = true;
          }
          return { lines, restartWorker, hasError };
        }

        lines.push("app resume failed");
        hasError = true;
        return { lines, restartWorker, hasError };
      }

      const restarted = await restartAppRuntime();
      if (restarted.action === "started") {
        lines.push(`app restarted (pid ${restarted.pid})`);
      } else if (restarted.action === "none") {
        lines.push(`app running (pid ${restarted.pid})`);
      } else {
        lines.push("app restart failed");
        hasError = true;
      }
      return { lines, restartWorker, hasError };
    }

    return { lines, restartWorker, hasError };
  };

  const runRuntimeCommand = async (command: RuntimeCommand) => {
    const targets: RuntimeCommandTarget[] = command.target === "both" ? ["worker", "app"] : [command.target];
    let shouldRestartWorker = false;
    const detailLines: string[] = [];
    let hasError = false;

    for (const target of targets) {
      const result = await runRuntimeCommandForTarget(command, target);
      if (result.lines.length > 0) {
        detailLines.push(...result.lines);
      }
      shouldRestartWorker = shouldRestartWorker || result.restartWorker;
      hasError = hasError || result.hasError;
    }

    if (detailLines.length === 0) {
      detailLines.push("no changes applied");
    }

    const statusLine = hasError
      ? "status: completed with errors"
      : shouldRestartWorker
        ? "status: confirmed (worker restart scheduled)"
        : "status: confirmed";

    return {
      shouldRestartWorker,
      hasError,
      responseText: [
        "Runtime command confirmation",
        `requested: ${command.raw}`,
        `interpreted: ${command.action} ${command.target}`,
        statusLine,
        ...detailLines.map((line) => `- ${line}`),
      ].join("\n"),
    };
  };

  const parseOpenClawReplyText = (payload: unknown): string => {
    if (!payload || typeof payload !== "object") {
      return "";
    }

    const record = payload as Record<string, unknown>;
    const directCandidates = [record.reply, record.message, record.text, record.output, record.result];
    for (const candidate of directCandidates) {
      if (typeof candidate === "string" && candidate.trim()) {
        return compactLogText(candidate.trim(), 520);
      }
    }

    if (Array.isArray(record.payloads)) {
      for (const item of record.payloads) {
        if (!item || typeof item !== "object") {
          continue;
        }
        const text = (item as Record<string, unknown>).text;
        if (typeof text === "string" && text.trim()) {
          return compactLogText(text.trim(), 520);
        }
      }
    }

    if (record.data && typeof record.data === "object") {
      const nested = parseOpenClawReplyText(record.data);
      if (nested) {
        return nested;
      }
    }

    if (record.result && typeof record.result === "object") {
      const nested = parseOpenClawReplyText(record.result);
      if (nested) {
        return nested;
      }
    }

    return "";
  };

  const parseOpenClawJsonObject = (raw: string): Record<string, unknown> | null => {
    const trimmed = raw.trim();
    if (!trimmed) {
      return null;
    }
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  };

  const parseOpenClawJsonFromStdout = (stdout: string) => {
    const full = parseOpenClawJsonObject(stdout);
    if (full) {
      return full;
    }

    const lines = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .reverse();
    for (const line of lines) {
      const parsed = parseOpenClawJsonObject(line);
      if (parsed) {
        return parsed;
      }
    }
    return null;
  };

  const appendWithLimit = (current: string, chunk: string) => {
    const next = current + chunk;
    if (next.length <= OPENCLAW_MAX_STDIO_CHARS) {
      return next;
    }
    return next.slice(next.length - OPENCLAW_MAX_STDIO_CHARS);
  };

  const runOpenClawCli = async (cliArgs: string[], timeoutMs: number) => {
    return await new Promise<{
      stdout: string;
      stderr: string;
      exitCode: number | null;
      signal: NodeJS.Signals | null;
      timedOut: boolean;
      spawnError: string;
    }>((resolve) => {
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let spawnError = "";

      const child = spawn(OPENCLAW_CLI_PATH, cliArgs, {
        cwd: process.cwd(),
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });

      if (child.stdout) {
        child.stdout.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) => {
          stdout = appendWithLimit(stdout, chunk);
        });
      }
      if (child.stderr) {
        child.stderr.setEncoding("utf8");
        child.stderr.on("data", (chunk: string) => {
          stderr = appendWithLimit(stderr, chunk);
        });
      }

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
        setTimeout(() => {
          child.kill("SIGKILL");
        }, 1_500).unref();
      }, timeoutMs);

      child.once("error", (error) => {
        spawnError = error instanceof Error ? error.message : String(error);
      });

      child.once("close", (exitCode, signal) => {
        clearTimeout(timer);
        resolve({
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          exitCode,
          signal,
          timedOut,
          spawnError: spawnError.trim(),
        });
      });
    });
  };

  const buildOpenClawHelpText = () => {
    return formatAssistantReply(
      "openclaw",
      'say "openclaw <task>" or "@openclaw <task>". send "openclaw status" anytime.',
    );
  };

  const buildOpenClawStatusText = async () => {
    const probe = await runOpenClawCli(["--version"], OPENCLAW_PROBE_TIMEOUT_MS);
    const probeDetail = compactLogText(
      [probe.spawnError, probe.stderr, probe.stdout]
        .map((part) => (part || "").trim())
        .filter(Boolean)
        .join(" | "),
      180,
    );

    if (probe.timedOut) {
      return formatAssistantReply("openclaw", "not ready right now (status probe timed out).");
    }
    if (probe.spawnError) {
      return formatAssistantReply("openclaw", "not ready right now (could not launch CLI).");
    }
    if (probe.exitCode !== 0) {
      return formatAssistantReply(
        "openclaw",
        `not ready right now (status check failed${probeDetail ? `: ${probeDetail}` : ""}).`,
      );
    }
    return formatAssistantReply("openclaw", "ready.");
  };

  const runOpenClawCommand = async (args: {
    command: OpenClawCommand;
  }): Promise<{ responseText: string; hasError: boolean }> => {
    if (args.command.action === "help") {
      return {
        responseText: buildOpenClawHelpText(),
        hasError: false,
      };
    }

    if (args.command.action === "status") {
      return {
        responseText: await buildOpenClawStatusText(),
        hasError: false,
      };
    }

    const input = args.command.input.trim();
    if (!input) {
      return {
        responseText: formatAssistantReply("openclaw", "tell me what to do."),
        hasError: true,
      };
    }
    if (input.length > OPENCLAW_MAX_COMMAND_CHARS) {
      return {
        responseText: formatAssistantReply(
          "openclaw",
          `that request is too long (${input.length} chars, max ${OPENCLAW_MAX_COMMAND_CHARS}).`,
        ),
        hasError: true,
      };
    }

    const cli = await runOpenClawCli(
      ["agent", "--agent", OPENCLAW_AGENT_ID, "--message", input, "--json"],
      OPENCLAW_AGENT_TIMEOUT_MS,
    );
    const parsed = parseOpenClawJsonFromStdout(cli.stdout);
    const replyText =
      parseOpenClawReplyText(parsed) ||
      compactLogText([cli.stdout, cli.stderr].filter(Boolean).join(" | "), 420) ||
      "no output";

    if (cli.timedOut) {
      return {
        responseText: formatAssistantReply("openclaw", "sorry, that took too long to finish."),
        hasError: true,
      };
    }
    if (cli.spawnError) {
      return {
        responseText: formatAssistantReply("openclaw", "sorry, I could not start that task."),
        hasError: true,
      };
    }
    if (cli.exitCode !== 0) {
      return {
        responseText: formatAssistantReply("openclaw", "sorry, that task failed."),
        hasError: true,
      };
    }

    return {
      responseText: formatAssistantReply("openclaw", replyText),
      hasError: false,
    };
  };

  let openClawRunCounter = 0;
  const nextOpenClawLocalRunId = () => {
    openClawRunCounter += 1;
    return `oc-${Date.now().toString(36)}-${openClawRunCounter.toString(36)}`;
  };

  const launchOpenClawForwardCommand = (args: {
    command: Extract<OpenClawCommand, { action: "forward" }>;
    selfControl: ResolvedSelfControlThread;
  }) => {
    const localRunId = nextOpenClawLocalRunId();

    void (async () => {
      await convex
        .mutation(convexRefs.systemRecordEvent, {
          source: "worker",
          eventType: "openclaw.command.started",
          detail: compactLogText(`${localRunId}: ${args.command.raw}`, 280),
        })
        .catch(() => undefined);

      const cli = await runOpenClawCli(
        ["agent", "--agent", OPENCLAW_AGENT_ID, "--message", args.command.input.trim(), "--json"],
        OPENCLAW_AGENT_TIMEOUT_MS,
      );
      const parsed = parseOpenClawJsonFromStdout(cli.stdout);
      const replyText =
        parseOpenClawReplyText(parsed) ||
        compactLogText([cli.stdout, cli.stderr].filter(Boolean).join(" | "), 420) ||
        "no output";

      let responseText = "";
      let hasError = false;
      if (cli.timedOut) {
        responseText = formatAssistantReply("openclaw", "sorry, that took too long to finish.");
        hasError = true;
      } else if (cli.spawnError) {
        responseText = formatAssistantReply("openclaw", "sorry, I could not start that task.");
        hasError = true;
      } else if (cli.exitCode !== 0) {
        responseText = formatAssistantReply("openclaw", "sorry, that task failed.");
        hasError = true;
      } else {
        responseText = formatAssistantReply("openclaw", replyText);
      }

      await sendSelfControlText({ selfControl: args.selfControl, text: responseText }).catch(async (error) => {
        const err = error instanceof Error ? error.message : String(error);
        await convex
          .mutation(convexRefs.systemRecordEvent, {
            source: "worker",
            eventType: "openclaw.command.delivery_failed",
            detail: compactLogText(`${localRunId}: ${err}`, 280),
          })
          .catch(() => undefined);
      });

      await convex
        .mutation(convexRefs.systemRecordEvent, {
          source: "worker",
          eventType: hasError ? "openclaw.command.failed" : "openclaw.command.executed",
          detail: compactLogText(`${localRunId}: ${responseText}`, 280),
        })
        .catch(() => undefined);
    })();

    return localRunId;
  };

  const maybeHandleOpenClawCommand = async (message: {
    key: SelfControlMessageKey;
    message?: unknown;
  }) => {
    const parsed = parseInboundMessage(message.message as Parameters<typeof parseInboundMessage>[0]);
    if (parsed.kind !== "text") {
      return false;
    }

    const selfControl = resolveSelfControlThread(message.key);
    if (!selfControl) {
      return false;
    }

    const commandText = parseSelfControlCommandText({
      rawText: parsed.text,
      prefix: SELF_CONTROL_MESSAGE_PREFIX,
    });
    if (!commandText) {
      return false;
    }

    const command = parseOpenClawCommand(commandText);
    if (!command) {
      return false;
    }

    await convex
      .mutation(convexRefs.systemRecordEvent, {
        source: "worker",
        eventType: "openclaw.command.received",
        detail: compactLogText(command.raw, 260),
      })
      .catch(() => undefined);

    if (command.action === "forward") {
      const localRunId = launchOpenClawForwardCommand({ command, selfControl });
      const queuedText = formatAssistantReply("openclaw", "on it. I will reply here when it is done.");
      await sendSelfControlText({ selfControl, text: queuedText });
      await convex
        .mutation(convexRefs.systemRecordEvent, {
          source: "worker",
          eventType: "openclaw.command.queued",
          detail: compactLogText(`${localRunId}: ${command.raw}`, 280),
        })
        .catch(() => undefined);
      return true;
    }

    const outcome = await runOpenClawCommand({ command });
    await sendSelfControlText({ selfControl, text: outcome.responseText });
    await convex
      .mutation(convexRefs.systemRecordEvent, {
        source: "worker",
        eventType: outcome.hasError ? "openclaw.command.failed" : "openclaw.command.executed",
        detail: compactLogText(outcome.responseText, 280),
      })
      .catch(() => undefined);

    return true;
  };

  const maybeHandleSelfImproveCommand = async (message: {
    key: SelfControlMessageKey;
    message?: unknown;
  }) => {
    const parsed = parseInboundMessage(message.message as Parameters<typeof parseInboundMessage>[0]);
    if (parsed.kind !== "text") {
      return false;
    }

    const selfControl = resolveSelfControlThread(message.key);
    if (!selfControl) {
      return false;
    }

    const commandText = parseSelfControlCommandText({
      rawText: parsed.text,
      prefix: SELF_CONTROL_MESSAGE_PREFIX,
    });
    if (!commandText) {
      return false;
    }

    const command = parseSelfImproveCommand(commandText);
    if (!command) {
      return false;
    }

    await convex
      .mutation(convexRefs.systemRecordEvent, {
        source: "worker",
        eventType: "self_improve.command.received",
        detail: compactLogText(command.raw, 260),
      })
      .catch(() => undefined);

    let responseText = "";
    let hasError = false;
    try {
      if (command.action === "run") {
        const started = await launchSelfImproveRun({
          command,
          selfControl,
        });
        responseText = started.responseText;
        hasError = started.hasError;
      } else if (command.action === "status") {
        responseText = await buildSelfImproveStatusText();
      } else {
        responseText = await buildSelfImproveLatestText();
      }
    } catch (error) {
      const err = error instanceof Error ? error.message : String(error);
      responseText = `Local Codex improvement command failed\nreason: ${compactLogText(err, 240)}`;
      hasError = true;
    }

    await sendSelfControlText({ selfControl, text: responseText });
    await convex
      .mutation(convexRefs.systemRecordEvent, {
        source: "worker",
        eventType: hasError ? "self_improve.command.failed" : "self_improve.command.executed",
        detail: compactLogText(responseText, 280),
      })
      .catch(() => undefined);

    return true;
  };

  const maybeHandleRuntimeControlCommand = async (message: {
    key: { id?: string | null; fromMe?: boolean | null; remoteJid?: string | null; participant?: string | null };
    message?: unknown;
  }) => {
    const parsed = parseInboundMessage(message.message as Parameters<typeof parseInboundMessage>[0]);
    if (parsed.kind !== "text") {
      return false;
    }

    const selfControl = resolveSelfControlThread(message.key);
    if (!selfControl) {
      return false;
    }

    const commandText = parseSelfControlCommandText({
      rawText: parsed.text,
      prefix: SELF_CONTROL_MESSAGE_PREFIX,
    });
    if (!commandText) {
      return false;
    }

    const command = parseRuntimeCommand(commandText);
    if (!command) {
      return false;
    }

    await convex
      .mutation(convexRefs.systemRecordEvent, {
        source: "worker",
        eventType: "runtime.command.received",
        detail: compactLogText(`${command.action} ${command.target} (${command.raw})`, 260),
      })
      .catch(() => undefined);

    try {
      const outcome = await runRuntimeCommand(command);
      await sendSelfControlText({ selfControl, text: outcome.responseText });
      await convex
        .mutation(convexRefs.systemRecordEvent, {
          source: "worker",
          eventType: outcome.hasError ? "runtime.command.failed" : "runtime.command.executed",
          detail: compactLogText(outcome.responseText, 280),
        })
        .catch(() => undefined);

      if (outcome.shouldRestartWorker) {
        await scheduleWorkerSelfRestart();
        await shutdown(0, "Worker restarting after WhatsApp runtime command.");
      }
    } catch (error) {
      const err = error instanceof Error ? error.message : String(error);
      await sendSelfControlText({
        selfControl,
        text: `Runtime command failed: ${compactLogText(err, 260)}`,
      });
      await convex
        .mutation(convexRefs.systemRecordEvent, {
          source: "worker",
          eventType: "runtime.command.failed",
          detail: compactLogText(err, 280),
        })
        .catch(() => undefined);
    }

    return true;
  };

  const processOwnMessage = async (message: {
    key: { id?: string | null; remoteJid?: string | null; participant?: string | null };
    message?: unknown;
    messageTimestamp?: unknown;
  }) => {
    try {
      const outboundMessageId = message.key.id || undefined;
      const rawThreadJid = getThreadJid(message.key as Parameters<typeof getThreadJid>[0]);
      const senderJid = getSenderJid(message.key as Parameters<typeof getSenderJid>[0]);
      const isStatusBroadcast = rawThreadJid === "status@broadcast";
      const threadJid = isStatusBroadcast ? senderJid : rawThreadJid;
      if (!threadJid) {
        return;
      }
      const messageAt = normalizeIncomingMessageTimestamp(message.messageTimestamp, Date.now());
      if (consumeAutomatedOutboundId(outboundMessageId) || isLikelyAutomatedThreadSend(threadJid, messageAt)) {
        return;
      }

      const parsed = parseInboundMessage(message.message as Parameters<typeof parseInboundMessage>[0]);
      if (parsed.kind === "unsupported") {
        return;
      }

      const messageType = resolveMessageTypeFromParsed(parsed);
      const mediaKind = resolveCapturableMediaKind(parsed);

      if (parsed.kind !== "reaction" && containsAnyEmoji(parsed.text)) {
        rememberEmojiOutboundAt(threadJid, messageAt);
      }

      const ownSync = (await convex.mutation(convexRefs.outboxSuppressForManualIntervention, {
        messageProvider: "whatsapp",
        threadJid,
        providerMessageId: outboundMessageId,
        whatsappMessageId: outboundMessageId,
        text: parsed.text,
        messageType,
        reactionEmoji: parsed.kind === "reaction" ? parsed.emoji : undefined,
        reactionTargetWhatsAppMessageId: parsed.kind === "reaction" ? parsed.targetWhatsAppMessageId : undefined,
        mediaCaption: resolveMediaCaptionFromParsed(parsed),
        isStatus: isStatusBroadcast,
        messageAt,
      })) as { recordedMessageId?: string; threadId?: string };

      const runtimeSettings = await getRuntimeSettings();
      const shouldCaptureGroupMedia = runtimeSettings?.captureGroupMediaEnabled ?? false;
      if (mediaKind && ownSync.recordedMessageId && (shouldCaptureGroupMedia || !isGroupJid(rawThreadJid || ""))) {
        await maybeCaptureMediaAsset({
          message: message as Parameters<typeof downloadMediaMessage>[0],
          messageId: ownSync.recordedMessageId,
          kind: mediaKind,
          threadId: ownSync.threadId,
          whatsappMessageId: outboundMessageId,
          mimeType: "mimeType" in parsed ? parsed.mimeType : undefined,
          direction: "outbound",
          ingestMode: "live",
        });
      }
    } catch (error) {
      const err = error instanceof Error ? error.message : String(error);
      logger.warn({ err, messageKey: message.key?.id }, "Own outbound processing error");
      await convex
        .mutation(convexRefs.systemRecordEvent, {
          source: "worker",
          eventType: "outbound.manual.sync_error",
          detail: err.slice(0, 320),
        })
        .catch(() => undefined);
    }
  };

  const processHistoricalMessage = async (
    message: {
      key: { id?: string | null; fromMe?: boolean | null; remoteJid?: string | null; participant?: string | null };
      pushName?: string | null;
      message?: unknown;
      messageTimestamp?: unknown;
    },
    ingestMode: "history_sync" | "history_fetch",
  ) => {
    try {
      const parsed = parseInboundMessage(message.message as Parameters<typeof parseInboundMessage>[0]);
      if (parsed.kind === "unsupported") {
        return;
      }

      const rawThreadJid = getThreadJid(message.key as Parameters<typeof getThreadJid>[0]);
      const senderJidFromKey = getSenderJid(message.key as Parameters<typeof getSenderJid>[0]);
      const isStatusBroadcast = rawThreadJid === "status@broadcast";
      const threadJid = isStatusBroadcast ? senderJidFromKey : rawThreadJid;
      if (!threadJid) {
        return;
      }

      const direction = message.key.fromMe ? "outbound" : "inbound";
      const senderJid = direction === "outbound" ? "me" : senderJidFromKey;
      const threadKind = classifyThreadKindFromJid(threadJid);
      const messageType = resolveMessageTypeFromParsed(parsed);
      const mediaKind = resolveCapturableMediaKind(parsed);
      const messageAt = normalizeIncomingMessageTimestamp(message.messageTimestamp, Date.now());

      if (direction === "outbound" && parsed.kind !== "reaction" && containsAnyEmoji(parsed.text)) {
        rememberEmojiOutboundAt(threadJid, messageAt);
      }

      const ingested = (await convex.mutation(convexRefs.inboundIngestHistorical, {
        provider: "whatsapp",
        ingestMode,
        direction,
        threadJid,
        senderJid,
        senderTitle: resolveSenderTitle({
          threadJid,
          threadKind,
          pushName: message.pushName,
        }),
        text: parsed.text,
        messageType,
        reactionEmoji: parsed.kind === "reaction" ? parsed.emoji : undefined,
        reactionTargetWhatsAppMessageId: parsed.kind === "reaction" ? parsed.targetWhatsAppMessageId : undefined,
        mediaCaption: resolveMediaCaptionFromParsed(parsed),
        isStatus: isStatusBroadcast,
        isGroup: isGroupJid(threadJid),
        threadKind,
        providerMessageId: message.key.id || undefined,
        whatsappMessageId: message.key.id || undefined,
        messageAt,
      })) as {
        threadId: string;
        messageId: string;
        duplicate: boolean;
      };

      const runtimeSettings = await getRuntimeSettings();
      const shouldCaptureGroupMedia = runtimeSettings?.captureGroupMediaEnabled ?? false;
      if (mediaKind && ingested.messageId && (shouldCaptureGroupMedia || !isGroupJid(rawThreadJid || ""))) {
        await maybeCaptureMediaAsset({
          message: message as Parameters<typeof downloadMediaMessage>[0],
          messageId: ingested.messageId,
          kind: mediaKind,
          threadId: ingested.threadId,
          whatsappMessageId: message.key.id || undefined,
          mimeType: "mimeType" in parsed ? parsed.mimeType : undefined,
          direction,
          ingestMode,
        });
      }
    } catch (error) {
      const err = error instanceof Error ? error.message : String(error);
      await convex
        .mutation(convexRefs.systemRecordEvent, {
          source: "worker",
          eventType: "inbound.history.ingest_error",
          detail: compactLogText(err, 280),
        })
        .catch(() => undefined);
    }
  };

  const processInboundCallEvent = async (callEvent: {
    id?: string;
    from?: string;
    chatId?: string;
    groupJid?: string;
    isGroup?: boolean;
    status?: string;
  }) => {
    try {
      const callStatus = callEvent.status || "";
      if (callStatus !== "offer") {
        return;
      }

      const callId = (callEvent.id || "").trim();
      const callFrom = (callEvent.from || "").trim();
      const threadJid = (callEvent.chatId || callEvent.groupJid || callFrom || "").trim();
      if (!callId || !callFrom || !threadJid) {
        return;
      }

      const threadKind = classifyThreadKindFromJid(threadJid);
      const isGroupThread = threadKind === "group";
      const fallbackKey = isGroupThread ? threadJid : normalizeAccountJid(threadJid) || threadJid;

      const eligibility = (await convex
        .query(convexRefs.threadsGetEligibilityByJid, {
          provider: "whatsapp",
          threadJid,
          isGroup: isGroupThread,
          threadKind,
        })
        .catch(() => null)) as
        | {
            allowed: boolean;
            reason?: "group_ignored" | "archived" | "broadcast_or_system" | "explicit_ignore" | "temporary_ghost";
            detail?: string;
          }
        | null;

      if (!eligibility) {
        await convex
          .mutation(convexRefs.systemRecordEvent, {
            source: "worker",
            eventType: "inbound.call.rejected_missing_eligibility",
            detail: compactLogText(`jid=${threadJid}`, 200),
          })
          .catch(() => undefined);
        return;
      }

      if (!eligibility.allowed && eligibility.reason === "explicit_ignore") {
        await convex
          .mutation(convexRefs.systemRecordEvent, {
            source: "worker",
            eventType: "inbound.call.ignored_no_reject",
            detail: compactLogText(`jid=${threadJid} reason=explicit_ignore`, 220),
          })
          .catch(() => undefined);
        return;
      }

      await sock.rejectCall(callId, callFrom);
      logger.info({ callId, callFrom, threadJid, threadKind }, "Inbound call rejected");

      if (!eligibility.allowed) {
        await convex
          .mutation(convexRefs.systemRecordEvent, {
            source: "worker",
            eventType: "inbound.call.rejected_ignored",
            detail: compactLogText(
              `jid=${threadJid} reason=${eligibility.reason || "blocked"} detail=${eligibility.detail || "none"}`,
              280,
            ),
          })
          .catch(() => undefined);
        return;
      }

      if (threadKind !== "direct") {
        return;
      }

      if (!CALL_AUTO_DECLINE_FALLBACK_TEXT || hasRecentCallFallback(fallbackKey)) {
        return;
      }

      rememberAutomatedThreadSend(threadJid);
      const sent = await sock.sendMessage(threadJid, {
        text: CALL_AUTO_DECLINE_FALLBACK_TEXT,
      });
      rememberAutomatedOutboundId(sent?.key?.id || undefined);
      rememberCallFallbackAt(fallbackKey, Date.now());
      await convex
        .mutation(convexRefs.systemRecordEvent, {
          source: "worker",
          eventType: "inbound.call.rejected_with_fallback",
          detail: compactLogText(`jid=${threadJid} status=offer`, 220),
        })
        .catch(() => undefined);
    } catch (error) {
      const err = error instanceof Error ? error.message : String(error);
      logger.warn({ err, callId: callEvent.id, callFrom: callEvent.from }, "Inbound call handling error");
      await convex
        .mutation(convexRefs.systemRecordEvent, {
          source: "worker",
          eventType: "inbound.call.error",
          detail: compactLogText(err, 280),
        })
        .catch(() => undefined);
    }
  };

  const processInboundMessage = async (message: {
    key: { id?: string | null; fromMe?: boolean | null; remoteJid?: string | null; participant?: string | null };
    pushName?: string | null;
    message?: unknown;
    messageTimestamp?: unknown;
  }) => {
    try {
      if (message.key.fromMe) {
        return;
      }

      const parsed = parseInboundMessage(message.message as Parameters<typeof parseInboundMessage>[0]);
      let effectiveParsed: ParsedInboundMessage = parsed;
      let audioTranscription: WhisperTranscriptionResult | null = null;
      let pdfContext: PdfTextContext | null = null;
      const rawThreadJid = getThreadJid(message.key as Parameters<typeof getThreadJid>[0]);
      const senderJid = getSenderJid(message.key as Parameters<typeof getSenderJid>[0]);
      const isStatusBroadcast = rawThreadJid === "status@broadcast";
      const threadJid = isStatusBroadcast ? senderJid : rawThreadJid;

      if (!threadJid || !senderJid || parsed.kind === "unsupported") {
        await convex
          .mutation(convexRefs.systemRecordEvent, {
            source: "worker",
            eventType: "inbound.unsupported",
            detail: `Skipped unsupported inbound payload for jid=${threadJid || "unknown"}.`,
          })
          .catch(() => undefined);
        return;
      }

      if (parsed.kind === "audio") {
        try {
          const mediaBytes = await downloadMediaMessage(
            message as Parameters<typeof downloadMediaMessage>[0],
            "buffer",
            {},
            {
              reuploadRequest: (msg) => sock.updateMediaMessage(msg),
              logger,
            },
          );
          audioTranscription = await transcribeWithWhisperCpp({
            audioBytes: Buffer.from(mediaBytes),
            mimeType: parsed.mimeType,
          });

          if (audioTranscription.status === "success") {
            effectiveParsed = {
              ...parsed,
              text: audioTranscription.text,
            };
          } else {
            effectiveParsed = {
              ...parsed,
              text: parsed.isVoiceNote ? "[Voice note] (transcription unavailable)" : "[Audio] (transcription unavailable)",
            };
          }
        } catch (error) {
          const err = error instanceof Error ? error.message : String(error);
          audioTranscription = {
            status: "error",
            error: err,
            latencyMs: 0,
          };
          effectiveParsed = {
            ...parsed,
            text: parsed.isVoiceNote ? "[Voice note] (transcription unavailable)" : "[Audio] (transcription unavailable)",
          };
        }
      }

      const messageAt = normalizeIncomingMessageTimestamp(message.messageTimestamp, Date.now());
      const threadKind = classifyThreadKindFromJid(threadJid);
      if (threadKind === "direct" && (await isJidBlocked(senderJid))) {
        await convex
          .mutation(convexRefs.systemRecordEvent, {
            source: "worker",
            eventType: "inbound.blocked_contact.skipped",
            detail: compactLogText(`thread=${threadJid} sender=${senderJid}`, 220),
          })
          .catch(() => undefined);
        return;
      }
      const archivedState = chatArchiveState.get(threadJid);
      const mediaKind = resolveCapturableMediaKind(effectiveParsed);
      const runtimeSettings = await getRuntimeSettings();

      const ingest = (await convex.mutation(convexRefs.inboundIngest, {
        provider: "whatsapp",
        threadJid,
        senderJid,
        senderTitle: resolveSenderTitle({
          threadJid,
          threadKind,
          pushName: message.pushName,
        }),
        text: effectiveParsed.text,
        messageType: resolveMessageTypeFromParsed(effectiveParsed),
        reactionEmoji: effectiveParsed.kind === "reaction" ? effectiveParsed.emoji : undefined,
        reactionTargetWhatsAppMessageId: effectiveParsed.kind === "reaction" ? effectiveParsed.targetWhatsAppMessageId : undefined,
        mediaCaption: resolveMediaCaptionFromParsed(effectiveParsed),
        isStatus: isStatusBroadcast,
        isGroup: isGroupJid(threadJid),
        threadKind,
        isArchived: archivedState?.isArchived,
        archivedAt: archivedState?.archivedAt,
        providerMessageId: message.key.id || undefined,
        whatsappMessageId: message.key.id || undefined,
        messageAt,
        skipDraftGeneration: true,
      })) as {
        threadId: string;
        messageId: string;
        ignored: boolean;
        blockedReason?: "group_ignored" | "archived" | "broadcast_or_system" | "explicit_ignore" | "temporary_ghost";
        duplicate?: boolean;
        stale?: boolean;
        reactionTargetMessageId?: string;
        nightPausedUntil?: number;
      };

      const shouldCaptureGroupMedia = runtimeSettings?.captureGroupMediaEnabled ?? false;
      if (mediaKind && ingest.messageId && (shouldCaptureGroupMedia || !isGroupJid(rawThreadJid || ""))) {
        await maybeCaptureMediaAsset({
          message: message as Parameters<typeof downloadMediaMessage>[0],
          messageId: ingest.messageId,
          kind: mediaKind,
          threadId: ingest.threadId,
          whatsappMessageId: message.key.id || undefined,
          mimeType: "mimeType" in effectiveParsed ? effectiveParsed.mimeType : undefined,
          direction: "inbound",
          ingestMode: "live",
        });
      }

      if (ingest.duplicate) {
        logger.info({ threadJid, whatsappMessageId: message.key.id }, "Inbound duplicate ignored");
        return;
      }

      if (ingest.stale) {
        logger.info(
          { threadJid, whatsappMessageId: message.key.id, messageAt },
          "Inbound stale message ignored for auto-reply",
        );
        return;
      }

      if (ingest.ignored) {
        logger.info({ threadJid, blockedReason: ingest.blockedReason }, "Inbound ignored by rules");
        return;
      }

      if (workerRuntimePaused) {
        await convex
          .mutation(convexRefs.systemRecordEvent, {
            source: "worker",
            eventType: "inbound.runtime_paused.skipped",
            threadId: ingest.threadId as Id<"threads">,
            detail: "Inbound message stored but automation is paused by runtime command.",
          })
          .catch(() => undefined);
        return;
      }

      if (parsed.kind === "audio" && audioTranscription) {
        const audioKind = parsed.isVoiceNote ? "voice_note" : "audio";
        const duration = parsed.durationSeconds ? `${parsed.durationSeconds}s` : "unknown";
        if (audioTranscription.status === "success") {
          const transcriptPreview = compactLogText(audioTranscription.text, 280);
          await convex
            .mutation(convexRefs.systemRecordEvent, {
              source: "worker",
              eventType: "inbound.audio.transcribed",
              threadId: ingest.threadId as Id<"threads">,
              detail: `${audioKind} · ${duration} · ${audioTranscription.latencyMs}ms · ${audioTranscription.modelPath} · source=${audioTranscription.usedSource} · transcript="${transcriptPreview}"`,
            })
            .catch(() => undefined);
        } else if (audioTranscription.status === "not_configured") {
          await convex
            .mutation(convexRefs.systemRecordEvent, {
              source: "worker",
              eventType: "inbound.audio.transcription_unavailable",
              threadId: ingest.threadId as Id<"threads">,
              detail: `${audioKind} · ${duration} · ${compactLogText(audioTranscription.reason, 260)}`,
            })
            .catch(() => undefined);
        } else {
          await convex
            .mutation(convexRefs.systemRecordEvent, {
              source: "worker",
              eventType: "inbound.audio.transcription_error",
              threadId: ingest.threadId as Id<"threads">,
              detail: `${audioKind} · ${duration} · ${compactLogText(audioTranscription.error, 260)}`,
          })
          .catch(() => undefined);
        }
      }

      if (isPdfInboundDocument(parsed)) {
        try {
          const mediaBytes = await downloadMediaMessage(
            message as Parameters<typeof downloadMediaMessage>[0],
            "buffer",
            {},
            {
              reuploadRequest: (msg) => sock.updateMediaMessage(msg),
              logger,
            },
          );
          pdfContext = await extractPdfTextContext({
            pdfBytes: Buffer.from(mediaBytes),
            fileName: parsed.fileName,
            mimeType: parsed.mimeType,
          });
          await convex
            .mutation(convexRefs.systemRecordEvent, {
              source: "worker",
              eventType: "inbound.pdf.processed",
              threadId: ingest.threadId as Id<"threads">,
              detail: describePdfContextForLog(pdfContext),
            })
            .catch(() => undefined);
        } catch (error) {
          const err = error instanceof Error ? error.message : String(error);
          pdfContext = {
            status: "error",
            error: err,
            text: "",
            excerpt: "",
            wordCount: 0,
            isShort: false,
            fileName: parsed.fileName,
            mimeType: parsed.mimeType,
          };
          await convex
            .mutation(convexRefs.systemRecordEvent, {
              source: "worker",
              eventType: "inbound.pdf.processed",
              threadId: ingest.threadId as Id<"threads">,
              detail: describePdfContextForLog(pdfContext),
            })
            .catch(() => undefined);
        }
      }

      const now = Date.now();
      const nightStartHour = normalizeHour(runtimeSettings?.quietHoursStartHour, DEFAULT_NIGHT_WIND_DOWN_START_HOUR);
      const nightEndHour = normalizeHour(runtimeSettings?.quietHoursEndHour, DEFAULT_NIGHT_WIND_DOWN_END_HOUR);
      const nightWindDownActive =
        !isStatusBroadcast &&
        threadKind === "direct" &&
        isWithinHourWindow(new Date(now).getHours(), nightStartHour, nightEndHour);
      const nightWindDownUntil = nightWindDownActive
        ? computeNextWindowEnd(now, nightStartHour, nightEndHour)
        : undefined;
      if (!nightWindDownUntil && !isStatusBroadcast && threadKind === "direct") {
        await maybeClearQuietHoursMute({
          jid: threadJid,
          runtimeSettings,
          threadId: ingest.threadId as Id<"threads">,
          reason: "outside_quiet_hours_inbound",
        });
      }
      const activeNightPauseUntil =
        !isStatusBroadcast && (ingest.nightPausedUntil || 0) > now ? ingest.nightPausedUntil : undefined;

      if (activeNightPauseUntil) {
        await convex
          .mutation(convexRefs.systemRecordEvent, {
            source: "worker",
            eventType: "inbound.night_pause.skipped",
            threadId: ingest.threadId as Id<"threads">,
            detail: `Night pause active until ${new Date(activeNightPauseUntil).toISOString()}.`,
          })
          .catch(() => undefined);
        return;
      }

      const funnyKeywords = runtimeSettings?.funnyStatusKeywords || [];
      const funnyEmojis = runtimeSettings?.funnyStatusEmojis || [];
      const effectiveReplyPolicyInstruction = nightWindDownUntil
        ? [runtimeSettings?.aiReplyPolicy || "", buildNightWindDownInstruction(nightWindDownUntil)].filter(Boolean).join("\n")
        : runtimeSettings?.aiReplyPolicy || "";
      const runtimeAiConfig = {
        temperature: runtimeSettings?.aiTemperature,
        maxOutputTokens: runtimeSettings?.aiMaxOutputTokens,
        maxReplyChars: runtimeSettings?.aiMaxReplyChars,
        historyLineLimit: runtimeSettings?.aiHistoryLineLimit,
        fallbackMode: runtimeSettings?.aiFallbackMode,
        modelFirstEnabled: runtimeSettings?.aiModelFirstEnabled,
        deterministicModes: resolveRuntimeDeterministicModes(runtimeSettings?.aiDeterministicModes),
        ackRoutingEnabled: runtimeSettings?.aiAckRoutingEnabled,
        replyPolicyInstruction: effectiveReplyPolicyInstruction,
        systemInstruction: runtimeSettings?.aiSystemInstruction || "",
        activePersonaPackId: runtimeSettings?.activePersonaPackId || "",
        qualityGateMode: runtimeSettings?.qualityGateMode,
        qualityGateThreshold: runtimeSettings?.qualityGateThreshold,
        soulModeEnabled: runtimeSettings?.soulModeEnabled,
        funnyStatusKeywords: runtimeSettings?.funnyStatusKeywords,
        funnyStatusEmojis: runtimeSettings?.funnyStatusEmojis,
        delayMinMs: runtimeSettings?.humanDelayMinMs,
        delayMaxMs: runtimeSettings?.humanDelayMaxMs,
        typingMinMs: runtimeSettings?.humanTypingMinMs,
        typingMaxMs: runtimeSettings?.humanTypingMaxMs,
      };
      const pdfReplyPolicyInstruction = pdfContext ? buildPdfReplyPolicyInstruction(pdfContext) : "";
      const runtimeAiConfigForReply = pdfReplyPolicyInstruction
        ? {
            ...runtimeAiConfig,
            replyPolicyInstruction: [runtimeAiConfig.replyPolicyInstruction || "", pdfReplyPolicyInstruction]
              .filter(Boolean)
              .join("\n"),
          }
        : runtimeAiConfig;
      let visualAnalysisPromise: Promise<Awaited<ReturnType<typeof describeInboundImageWithFallback>> | null> | null = null;
      const getVisualAnalysis = async () => {
        if (effectiveParsed.kind !== "image" && effectiveParsed.kind !== "sticker") {
          return null;
        }
        if (!visualAnalysisPromise) {
          visualAnalysisPromise = (async () => {
            const visionDecision = decideInboundVisionAnalysis({
              parsed: effectiveParsed,
              mode: VISION_FILTER_MODE,
              nowMs: Date.now(),
              lastAllowedAtMs: inboundImageVisionLastSentAtByThread.get(threadJid),
              uncaptionedCooldownMs: VISION_FILTER_UNCAPTIONED_COOLDOWN_MS,
            });
            if (!visionDecision.allow) {
              await convex
                .mutation(convexRefs.systemRecordEvent, {
                  source: "ai",
                  eventType: "ai.vision.filtered",
                  threadId: ingest.threadId,
                  detail: compactLogText(
                    `mode=${visionDecision.mode} reason=${visionDecision.reason} score=${visionDecision.score} signals=${visionDecision.signals.join("|") || "none"}`,
                    260,
                  ),
                })
                .catch(() => undefined);
              return null;
            }

            try {
              if (effectiveParsed.kind === "image") {
                rememberInboundImageVisionAt(threadJid, Date.now());
              }
              const mediaBytes = await downloadMediaMessage(
                message as Parameters<typeof downloadMediaMessage>[0],
                "buffer",
                {},
                {
                  reuploadRequest: (msg) => sock.updateMediaMessage(msg),
                  logger,
                },
              );
              const visualAnalysis = await describeInboundImageWithFallback({
                imageBytes: mediaBytes,
                mimeType: effectiveParsed.mimeType,
                caption: effectiveParsed.caption,
                runtime: runtimeAiConfig,
              });
              await convex
                .mutation(convexRefs.systemRecordEvent, {
                  source: "ai",
                  eventType: visualAnalysis.provider === "azure" ? "ai.vision.success" : "ai.vision.fallback",
                  threadId: ingest.threadId,
                  detail: visualAnalysis.error
                    ? `${visualAnalysis.model} · ${visualAnalysis.latencyMs}ms · ${visualAnalysis.error}`
                    : `${visualAnalysis.model} · ${visualAnalysis.latencyMs}ms`,
                })
                .catch(() => undefined);
              return visualAnalysis;
            } catch (error) {
              const err = error instanceof Error ? error.message : String(error);
              await convex
                .mutation(convexRefs.systemRecordEvent, {
                  source: "ai",
                  eventType: "ai.vision.error",
                  threadId: ingest.threadId,
                  detail: err.slice(0, 260),
                })
                .catch(() => undefined);
              return null;
            }
          })();
        }
        return visualAnalysisPromise;
      };

      if (isStatusBroadcast && !(runtimeSettings?.statusAutoReplyEnabled ?? true)) {
        await convex
          .mutation(convexRefs.systemRecordEvent, {
            source: "worker",
            eventType: "inbound.status.skipped",
            threadId: ingest.threadId as Id<"threads">,
            detail: "Status update skipped because status auto-replies are disabled.",
          })
          .catch(() => undefined);
        return;
      }

      let statusSignalText = "";
      let statusHasFunnySignal = false;
      let statusHasInterestSignal = false;

      if (isStatusBroadcast) {
        const threadSnapshot = (await convex
          .query(convexRefs.threadGet, {
            threadId: ingest.threadId,
            includeStatusMessages: isStatusBroadcast,
          })
          .catch(() => null)) as ThreadContextSnapshot;
        const statusLimit = evaluateStatusOutreachLimit({
          nowMs: now,
          messages: threadSnapshot?.messages || [],
        });
        if (!statusLimit.allowed) {
          const waitMinutes = Math.max(1, Math.ceil((statusLimit.waitMs || 0) / 60_000));
          await convex
            .mutation(convexRefs.systemRecordEvent, {
              source: "worker",
              eventType: "inbound.status.skipped",
              threadId: ingest.threadId as Id<"threads">,
              detail:
                statusLimit.reason === "daily_limit"
                  ? "Status update skipped to keep outreach paced: already sent 2 replies in the last 24 hours."
                  : `Status update skipped to avoid back-to-back outreach. Try again in about ${waitMinutes} minute${waitMinutes === 1 ? "" : "s"}.`,
            })
            .catch(() => undefined);
          return;
        }

        const statusScreeningTextParts = [effectiveParsed.text];
        if (effectiveParsed.kind === "image" || effectiveParsed.kind === "sticker") {
          const visualAnalysis = await getVisualAnalysis();
          if (visualAnalysis?.description) {
            statusScreeningTextParts.push(visualAnalysis.description);
          }
        }
        statusSignalText = statusScreeningTextParts.filter(Boolean).join("\n");
        if (hasLinkOrEmail(statusSignalText)) {
          await convex
            .mutation(convexRefs.systemRecordEvent, {
              source: "worker",
              eventType: "inbound.status.skipped",
              threadId: ingest.threadId as Id<"threads">,
              detail: "Status update skipped because it contains a link or email address.",
            })
            .catch(() => undefined);
          return;
        }
        if (isLikelyMarketingStatus(statusSignalText)) {
          await convex
            .mutation(convexRefs.systemRecordEvent, {
              source: "worker",
              eventType: "inbound.status.skipped",
              threadId: ingest.threadId as Id<"threads">,
              detail: "Status update skipped because it looks promotional/marketing.",
            })
            .catch(() => undefined);
          return;
        }

        statusHasFunnySignal =
          positiveTone(statusSignalText, funnyKeywords, funnyEmojis) ||
          shouldUseMeme(statusSignalText, funnyKeywords, funnyEmojis);
        statusHasInterestSignal = hasStatusInterestSignal(statusSignalText);
      }

      if (
        isStatusBroadcast &&
        (runtimeSettings?.statusReplyRequireFunny ?? true) &&
        !statusHasFunnySignal &&
        !statusHasInterestSignal
      ) {
        await convex
          .mutation(convexRefs.systemRecordEvent, {
            source: "worker",
            eventType: "inbound.status.skipped",
            threadId: ingest.threadId as Id<"threads">,
            detail: "Status update skipped because it did not match funny/playful or priority-news-interest signals.",
          })
          .catch(() => undefined);
        return;
      }

      const preferLaughReactionOnly =
        isStatusBroadcast &&
        (runtimeSettings?.reactionsEnabled ?? true) &&
        shouldUseLaughReactionOnly({
          text: statusSignalText || effectiveParsed.text,
          hasFunnySignal: statusHasFunnySignal,
          hasInterestSignal: statusHasInterestSignal,
          messageAt,
        });

      if (preferLaughReactionOnly) {
        await convex
          .mutation(convexRefs.systemRecordEvent, {
            source: "worker",
            eventType: "inbound.status.reaction_only",
            threadId: ingest.threadId as Id<"threads">,
            detail: "Funny status handled with reaction-only response to avoid over-messaging.",
          })
          .catch(() => undefined);
      }

      if (
        (runtimeSettings?.humorLearningEnabled ?? true) &&
        (effectiveParsed.kind === "text" || effectiveParsed.kind === "reaction")
      ) {
        const humorContextText = [
          isStatusBroadcast && statusSignalText ? `status_signal: ${statusSignalText}` : "",
          "caption" in effectiveParsed && effectiveParsed.caption ? `caption: ${effectiveParsed.caption}` : "",
          effectiveParsed.kind === "reaction" && effectiveParsed.targetWhatsAppMessageId
            ? `reaction_target_id: ${effectiveParsed.targetWhatsAppMessageId}`
            : "",
        ]
          .filter(Boolean)
          .join("\n")
          .slice(0, 600);
        await convex
          .mutation(convexRefs.styleLearnFromHumorSignal, {
            threadId: ingest.threadId as Id<"threads">,
            inboundText: effectiveParsed.text,
            signalKind: effectiveParsed.kind === "reaction" ? "reaction" : "text",
            reactionEmoji: effectiveParsed.kind === "reaction" ? effectiveParsed.emoji : undefined,
            contextText: humorContextText || undefined,
          })
          .catch(() => undefined);
      }

      await maybeMarkInboundAsRead({
        message,
        runtimeSettings,
        threadJid: rawThreadJid || threadJid,
        threadKind,
        isStatusBroadcast,
      });

      if (effectiveParsed.kind === "reaction") {
        return;
      }

      if (effectiveParsed.kind === "sticker") {
        const visualAnalysis = await getVisualAnalysis();
        const stickerUnderstood = Boolean(
          visualAnalysis?.description && visualAnalysis.provider === "azure" && !visualAnalysis.error,
        );
        if (!stickerUnderstood) {
          await convex
            .mutation(convexRefs.systemRecordEvent, {
              source: "worker",
              eventType: "inbound.sticker.skipped",
              threadId: ingest.threadId as Id<"threads">,
              detail: "Sticker reply skipped until visual understanding succeeds.",
            })
            .catch(() => undefined);
          return;
        }
      }

      let inboundForPolicy: ParsedInboundMessage = effectiveParsed;
      if (effectiveParsed.kind === "image" || effectiveParsed.kind === "sticker") {
        const visualAnalysis = await getVisualAnalysis();
        if (visualAnalysis?.description) {
          inboundForPolicy = {
            ...effectiveParsed,
            text: `${effectiveParsed.text}\n${visualAnalysis.description}`,
          };
        }
      }

      const toolRunId = createToolRunId("reply", String(ingest.threadId), String(ingest.messageId));
      const forceNightWindDownReply = Boolean(nightWindDownUntil);
      const forcePdfTextReply = Boolean(pdfContext);
      let personalitySetting: PersonalityThreadSetting = null;
      let threadContextForPolicy: ThreadContextSnapshot = null;
      let outboundPolicy: OutboundPolicy;
      if (forceNightWindDownReply || forcePdfTextReply) {
        personalitySetting = (await convex.query(convexRefs.personalityGetThreadSetting, {
          threadId: ingest.threadId,
        })) as PersonalityThreadSetting;
        outboundPolicy = {
          mode: "text",
        };
      } else if (preferLaughReactionOnly) {
        outboundPolicy = {
          mode: "reaction_only",
          emoji: pickLaughReactionEmoji(statusSignalText || inboundForPolicy.text || "", funnyEmojis),
        };
      } else if ((runtimeSettings?.reactionsEnabled ?? true) && looksLikeAckOnly(inboundForPolicy.text || "")) {
        const modelAckRoutingEnabled =
          (runtimeSettings?.aiModelFirstEnabled ?? false) && (runtimeSettings?.aiAckRoutingEnabled ?? false);
        if (modelAckRoutingEnabled) {
          threadContextForPolicy = (await convex
            .query(convexRefs.threadGet, {
              threadId: ingest.threadId,
              includeStatusMessages: isStatusBroadcast,
            })
            .catch(() => null)) as ThreadContextSnapshot;
          const ackHistoryLines = (threadContextForPolicy?.messages || []).map((m) => {
            return `${m.direction === "inbound" ? "Them" : "Me"}: ${m.text}`;
          });
          const ackRoute = await routeAckResponseChannel({
            inboundText: inboundForPolicy.text || "",
            historyLines: ackHistoryLines,
            runtime: {
              fallbackMode: runtimeSettings?.aiFallbackMode,
              modelFirstEnabled: runtimeSettings?.aiModelFirstEnabled,
              deterministicModes: resolveRuntimeDeterministicModes(runtimeSettings?.aiDeterministicModes),
              ackRoutingEnabled: runtimeSettings?.aiAckRoutingEnabled,
              systemInstruction: runtimeSettings?.aiSystemInstruction || "",
            },
          });

          for (let index = 0; index < ackRoute.attempts.length; index += 1) {
            const attempt = ackRoute.attempts[index];
            const label = attemptStageLabel(attempt.stage);
            const usageSuffix = formatAttemptUsage(attempt);
            const detail = attempt.error
              ? `Ack route attempt ${index + 1}/${ackRoute.attempts.length} · ${label} · ${attempt.model} · ${attempt.latencyMs}ms${usageSuffix ? ` · ${usageSuffix}` : ""} · ${attempt.error.slice(0, 220)}`
              : `Ack route attempt ${index + 1}/${ackRoute.attempts.length} · ${label} · ${attempt.model} · ${attempt.latencyMs}ms${usageSuffix ? ` · ${usageSuffix}` : ""}`;

            await convex
              .mutation(convexRefs.systemRecordProviderRun, {
                threadId: ingest.threadId,
                provider: attempt.provider,
                model: attempt.model,
                latencyMs: attempt.latencyMs,
                status: attempt.status,
                ...(attempt.error ? { error: attempt.error.slice(0, 300) } : {}),
                ...(attempt.inputTokens === undefined ? {} : { inputTokens: attempt.inputTokens }),
                ...(attempt.outputTokens === undefined ? {} : { outputTokens: attempt.outputTokens }),
                ...(attempt.totalTokens === undefined ? {} : { totalTokens: attempt.totalTokens }),
                ...(attempt.usageSource ? { usageSource: attempt.usageSource } : {}),
                ...(attempt.estimatedCostUsd === undefined ? {} : { estimatedCostUsd: attempt.estimatedCostUsd }),
                ...(attempt.costCurrency ? { costCurrency: attempt.costCurrency } : {}),
                ...(attempt.pricingVersion ? { pricingVersion: attempt.pricingVersion } : {}),
              })
              .catch(() => undefined);

            await convex
              .mutation(convexRefs.systemRecordEvent, {
                source: "ai",
                eventType: attemptEventType(attempt),
                threadId: ingest.threadId,
                toolRunId,
                detail,
              })
              .catch(() => undefined);
          }

          await emitAiPipelineMetrics({
            pipeline: "ack_router",
            attempts: ackRoute.attempts,
            latencyMs: ackRoute.latencyMs,
            manualReview: false,
            threadId: ingest.threadId as Id<"threads">,
            toolRunId,
            detailSuffix: `route=${ackRoute.channel || "fallback_reaction_only"}`,
          });

          if (ackRoute.channel === "text" || ackRoute.channel === "reaction_plus_text") {
            personalitySetting = (await convex.query(convexRefs.personalityGetThreadSetting, {
              threadId: ingest.threadId,
            })) as PersonalityThreadSetting;
          }

          if (ackRoute.channel === "text") {
            outboundPolicy = {
              mode: "text",
            };
          } else if (ackRoute.channel === "reaction_plus_text") {
            outboundPolicy = {
              mode: "reaction_plus_text",
              emoji: chooseReactionEmoji(inboundForPolicy.text || ""),
            };
          } else {
            outboundPolicy = {
              mode: "reaction_only",
              emoji: chooseReactionEmoji(inboundForPolicy.text || ""),
            };
          }

          await convex
            .mutation(convexRefs.systemRecordEvent, {
              source: "ai",
              eventType: "ai.ack_router.routed",
              threadId: ingest.threadId,
              toolRunId,
              detail: compactLogText(
                `channel=${outboundPolicy.mode} provider=${ackRoute.provider || "none"} model=${ackRoute.model || "none"} reason=${ackRoute.reason || "n/a"}`,
                280,
              ),
            })
            .catch(() => undefined);
        } else {
          outboundPolicy = {
            mode: "reaction_only",
            emoji: chooseReactionEmoji(inboundForPolicy.text || ""),
          };
        }
      } else {
        personalitySetting = (await convex.query(convexRefs.personalityGetThreadSetting, {
          threadId: ingest.threadId,
        })) as PersonalityThreadSetting;
        threadContextForPolicy = (await convex
          .query(convexRefs.threadGet, {
            threadId: ingest.threadId,
            includeStatusMessages: isStatusBroadcast,
          })
          .catch(() => null)) as ThreadContextSnapshot;
        outboundPolicy = await decideOutboundPolicy({
          inbound: inboundForPolicy,
          runtimeSettings,
          personalityIntensity: personalitySetting?.intensity,
          threadKind,
          threadId: String(ingest.threadId),
          threadJid,
          threadTitle: threadContextForPolicy?.grounding?.theirName || threadJid,
          threadMessages: threadContextForPolicy?.messages || [],
          memePolicyMode: personalitySetting?.memePolicyMode,
          styleHints: threadContextForPolicy?.memory?.styleNotes || [],
        });
      }

      const shouldGenerateAiText = outboundPolicy.mode === "text" || outboundPolicy.mode === "reaction_plus_text" || outboundPolicy.mode === "meme";
      let threadContext: ThreadContextSnapshot = null;
      let historyLines: string[] = [];
      let styleHints: string[] = [];
      let styleProfile: StyleProfileSnapshot = null;
      let contactFacts: ContactMemoryFactSnapshot[] = [];
      if (shouldGenerateAiText) {
        threadContext =
          threadContextForPolicy ||
          ((await convex.query(convexRefs.threadGet, {
            threadId: ingest.threadId,
            includeStatusMessages: isStatusBroadcast,
          })) as ThreadContextSnapshot);
        historyLines = (threadContext?.messages || []).map((m) => {
          return `${m.direction === "inbound" ? "Them" : "Me"}: ${m.text}`;
        });
        styleHints = threadContext?.memory?.styleNotes || [];
        styleProfile = await getStyleProfileForThread(ingest.threadId);
      }
      let historySearchOverride: HistorySearchOverrideSnapshot | undefined;

      let inboundTextForAi =
        effectiveParsed.kind === "sticker"
          ? `${effectiveParsed.text}${effectiveParsed.caption ? ` (${effectiveParsed.caption})` : ""}`
          : effectiveParsed.text;

      if ((effectiveParsed.kind === "image" || effectiveParsed.kind === "sticker") && shouldGenerateAiText) {
        const visualAnalysis = await getVisualAnalysis();
        if (visualAnalysis?.description) {
          inboundTextForAi = `${effectiveParsed.text}\n\nVisual analysis: ${visualAnalysis.description}`;
        } else {
          inboundTextForAi = effectiveParsed.caption
            ? `${effectiveParsed.text} ${effectiveParsed.caption}\n\nVisual analysis: Media received, but visual details could not be analyzed.`
            : `${effectiveParsed.text}\n\nVisual analysis: Media received, but visual details could not be analyzed.`;
        }
      }
      if (pdfContext && shouldGenerateAiText) {
        inboundTextForAi = buildPdfAwareInboundText({
          fallbackInboundText: inboundTextForAi,
          pdfContext,
          caption: effectiveParsed.kind === "document" ? effectiveParsed.caption : undefined,
        });
      }

      if (shouldGenerateAiText && threadContext) {
        const olderContextDecision = decideOlderContextUsage({
          inboundText: inboundTextForAi,
          messages: threadContext.messages || [],
        });
        await convex
          .mutation(convexRefs.systemRecordEvent, {
            source: "ai",
            eventType: "ai.context.recall_policy",
            threadId: ingest.threadId,
            toolRunId,
            detail: compactLogText(
              `allowOlder=${olderContextDecision.allowOlderContext} reason=${olderContextDecision.reason} cue=${olderContextDecision.explicitRecallCue} stale=${olderContextDecision.staleThread} gapMs=${olderContextDecision.gapMs ?? -1}`,
              280,
            ),
          })
          .catch(() => undefined);

        if (!olderContextDecision.allowOlderContext) {
          // Chat was resumed without an explicit callback cue: keep only the latest line as context.
          historyLines = historyLines.slice(-1);
        }

        const historySearchLimit = Math.max(8, Math.min(runtimeSettings?.aiHistoryLineLimit ?? 12, 20));
        const shouldRefreshFacts =
          olderContextDecision.explicitRecallCue ||
          /(birthday|anniversary|prefer|likes|profile|fact|call me|remember|my mom|my dad|my family|plan|schedule|trip|weekend|tomorrow)/i.test(
            inboundTextForAi,
          );
        const orchestration = await runWorkerContextToolOrchestration({
          convex,
          threadId: ingest.threadId,
          toolRunId,
          inboundText: inboundTextForAi,
          historyLines,
          allowHistorySearch: olderContextDecision.allowOlderContext,
          includeContactFacts: true,
          allowFactExtraction: shouldRefreshFacts,
          historySearchLimit,
          factsLimit: 8,
        });
        historySearchOverride = orchestration.historySearchOverride;
        contactFacts = orchestration.contactFacts;
        if (contactFacts.length > 0) {
          styleHints = [
            ...styleHints,
            ...contactFacts.map((fact) => `Known contact fact (${fact.factType}): ${fact.factValue}`),
          ];
        }
        await convex
          .mutation(convexRefs.systemRecordEvent, {
            source: "ai",
            eventType: "ai.context.tool_orchestration",
            threadId: ingest.threadId,
            toolRunId,
            detail: compactLogText(
              `planner=${orchestration.plannerSource} confidence=${orchestration.plannerConfidence.toFixed(2)} hintApplied=${orchestration.hintApplied} runs=${orchestration.runs.length}`,
              280,
            ),
          })
          .catch(() => undefined);

        const needsHistoryFetch =
          olderContextDecision.allowOlderContext &&
          historyFetchConfig.enabled &&
          Boolean(historySearchOverride) &&
          ((historySearchOverride?.lines.length || 0) < 3 || (historySearchOverride?.confidence || 0) < 0.38);
        if (needsHistoryFetch) {
          const fetchResult = await maybeFetchOlderHistoryForThread({
            socket: sock,
            convex,
            threadId: ingest.threadId,
            threadJid,
            threadMessages: threadContext.messages,
            stateByThread: historyFetchStateByThread,
            config: historyFetchConfig,
          });
          await convex
            .mutation(convexRefs.systemRecordEvent, {
              source: "ai",
              eventType: fetchResult.requested ? "ai.context.history_fetch.requested" : "ai.context.history_fetch.skipped",
              threadId: ingest.threadId,
              toolRunId,
              detail: compactLogText(JSON.stringify(fetchResult), 280),
            })
            .catch(() => undefined);

          if (fetchResult.requested) {
            threadContext = (await convex.query(convexRefs.threadGet, {
              threadId: ingest.threadId,
              includeStatusMessages: isStatusBroadcast,
            })) as ThreadContextSnapshot;
            historyLines = (threadContext?.messages || []).map((m) => {
              return `${m.direction === "inbound" ? "Them" : "Me"}: ${m.text}`;
            });

            const refreshedOrchestration = await runWorkerContextToolOrchestration({
              convex,
              threadId: ingest.threadId,
              toolRunId,
              inboundText: inboundTextForAi,
              historyLines,
              allowHistorySearch: true,
              includeContactFacts: false,
              allowFactExtraction: false,
              historySearchLimit,
              factsLimit: 8,
            });
            historySearchOverride = refreshedOrchestration.historySearchOverride || historySearchOverride;
          }
        }
      }

      let ai = shouldGenerateAiText
        ? await generateReplyWithFallback({
            inboundText: inboundTextForAi,
            historyLines,
            historySearchOverride,
            contactFacts,
            styleHints,
            styleProfile: styleProfile || undefined,
            personality: personalitySetting
              ? {
                  profileSlug: personalitySetting.profileSlug || personalitySetting.profile?.slug,
                  profileName: personalitySetting.profile?.name,
                  profileDescription: personalitySetting.profile?.description,
                  profilePrompt: personalitySetting.profile?.prompt,
                  intensity: personalitySetting.intensity,
                  customPrompt: personalitySetting.customPrompt || "",
                  threadPromptProfile: personalitySetting.threadPromptProfile || "",
                  threadPromptProfileSource: personalitySetting.threadPromptProfileSource,
                }
              : undefined,
            grounding: threadContext?.grounding
              ? {
                  myName: threadContext.grounding.myName,
                  theirName: threadContext.grounding.theirName,
                  autoAliases: threadContext.grounding.autoAliases || [],
                  vibeNotes: threadContext.grounding.vibeNotes || "",
                }
              : undefined,
            runtime: runtimeAiConfigForReply,
            modelToolContext: buildModelToolContext({
              convex,
              threadId: String(ingest.threadId),
              contactJid: threadJid,
            }),
          })
        : null;

      if (ai && shouldGenerateAiText && !ai.guardrailBlocked) {
        const styleGuardrail = (await convex
          .query(convexRefs.chatReplyStyleGuardrailCheck, {
            threadId: ingest.threadId,
            candidateReply: ai.text,
            inboundText: inboundTextForAi,
            strictness: "balanced",
          })
          .catch(() => null)) as
          | {
              passed?: boolean;
              score?: number;
              threshold?: number;
              rewriteHints?: string[];
            }
          | null;

        if (styleGuardrail) {
          await convex
            .mutation(convexRefs.systemRecordEvent, {
              source: "ai",
              eventType: styleGuardrail.passed ? "ai.style_guardrail.passed" : "ai.style_guardrail.failed",
              threadId: ingest.threadId,
              toolRunId,
              detail: compactLogText(
                `score=${Number(styleGuardrail.score || 0).toFixed(2)} threshold=${Number(styleGuardrail.threshold || 0).toFixed(2)} hints=${(styleGuardrail.rewriteHints || []).join(" | ")}`,
                280,
              ),
            })
            .catch(() => undefined);
        }

        if (styleGuardrail && !styleGuardrail.passed && Array.isArray(styleGuardrail.rewriteHints) && styleGuardrail.rewriteHints.length > 0) {
          const guardrailHints = styleGuardrail.rewriteHints.slice(0, 4);
          const rewritten = await generateReplyWithFallback({
            inboundText: inboundTextForAi,
            historyLines,
            historySearchOverride,
            contactFacts,
            styleHints: [...styleHints, ...guardrailHints],
            styleProfile: styleProfile || undefined,
            personality: personalitySetting
              ? {
                  profileSlug: personalitySetting.profileSlug || personalitySetting.profile?.slug,
                  profileName: personalitySetting.profile?.name,
                  profileDescription: personalitySetting.profile?.description,
                  profilePrompt: personalitySetting.profile?.prompt,
                  intensity: personalitySetting.intensity,
                  customPrompt: personalitySetting.customPrompt || "",
                  threadPromptProfile: personalitySetting.threadPromptProfile || "",
                  threadPromptProfileSource: personalitySetting.threadPromptProfileSource,
                }
              : undefined,
            grounding: threadContext?.grounding
              ? {
                  myName: threadContext.grounding.myName,
                  theirName: threadContext.grounding.theirName,
                  autoAliases: threadContext.grounding.autoAliases || [],
                  vibeNotes: threadContext.grounding.vibeNotes || "",
                }
              : undefined,
            runtime: runtimeAiConfigForReply,
            modelToolContext: buildModelToolContext({
              convex,
              threadId: String(ingest.threadId),
              contactJid: threadJid,
            }),
          });

          if (!rewritten.guardrailBlocked) {
            ai = rewritten;
          }
        }
      }

      if (ai) {
        await convex
          .mutation(convexRefs.systemRecordEvent, {
            source: "ai",
            eventType: "ai.reply.pipeline",
            threadId: ingest.threadId,
            toolRunId,
            detail: `Generated ${ai.attempts.length} AI pipeline attempt(s) for inbound message.`,
          })
          .catch(() => undefined);
        for (let index = 0; index < ai.attempts.length; index += 1) {
          const attempt = ai.attempts[index];
          const label = attemptStageLabel(attempt.stage);
          const usageSuffix = formatAttemptUsage(attempt);
          const detail = attempt.error
            ? `Attempt ${index + 1}/${ai.attempts.length} · ${label} · ${attempt.model} · ${attempt.latencyMs}ms${usageSuffix ? ` · ${usageSuffix}` : ""} · ${attempt.error.slice(0, 220)}`
            : `Attempt ${index + 1}/${ai.attempts.length} · ${label} · ${attempt.model} · ${attempt.latencyMs}ms${usageSuffix ? ` · ${usageSuffix}` : ""}`;

          await convex
            .mutation(convexRefs.systemRecordProviderRun, {
              threadId: ingest.threadId,
              provider: attempt.provider,
              model: attempt.model,
              latencyMs: attempt.latencyMs,
              status: attempt.status,
              ...(attempt.error ? { error: attempt.error.slice(0, 300) } : {}),
              ...(attempt.inputTokens === undefined ? {} : { inputTokens: attempt.inputTokens }),
              ...(attempt.outputTokens === undefined ? {} : { outputTokens: attempt.outputTokens }),
              ...(attempt.totalTokens === undefined ? {} : { totalTokens: attempt.totalTokens }),
              ...(attempt.usageSource ? { usageSource: attempt.usageSource } : {}),
              ...(attempt.estimatedCostUsd === undefined ? {} : { estimatedCostUsd: attempt.estimatedCostUsd }),
              ...(attempt.costCurrency ? { costCurrency: attempt.costCurrency } : {}),
              ...(attempt.pricingVersion ? { pricingVersion: attempt.pricingVersion } : {}),
            })
            .catch(() => undefined);

          await convex
            .mutation(convexRefs.systemRecordEvent, {
              source: "ai",
              eventType: attemptEventType(attempt),
              threadId: ingest.threadId,
              toolRunId,
              detail,
            })
              .catch(() => undefined);
        }

        await emitAiPipelineMetrics({
          pipeline: "reply",
          attempts: ai.attempts,
          latencyMs: ai.latencyMs,
          manualReview: ai.guardrailBlocked,
          threadId: ingest.threadId as Id<"threads">,
          toolRunId,
        });

        if (ai.contextWindow) {
          await convex
            .mutation(convexRefs.systemRecordEvent, {
              source: "ai",
              eventType: "ai.context.window",
              threadId: ingest.threadId,
              toolRunId,
              detail: `Prompt tokens ${ai.contextWindow.estimatedPromptTokens}/${Math.max(128, ai.contextWindow.maxContextTokens - ai.contextWindow.reserveOutputTokens)}; overflow ${ai.contextWindow.overflowTokens}; history ${ai.contextWindow.usedHistoryLines}; relevant ${ai.contextWindow.relevantHistoryLines}.`,
            })
            .catch(() => undefined);
        }

        if (Array.isArray(ai.contextToolCalls) && ai.contextToolCalls.length > 0) {
          for (const toolCall of ai.contextToolCalls) {
            await convex
              .mutation(convexRefs.systemRecordEvent, {
                source: "ai",
                eventType: `ai.context.tool.${toolCall.name}`,
                threadId: ingest.threadId,
                toolRunId,
                detail: compactLogText(
                  `${toolCall.name} ${toolCall.latencyMs}ms input=${JSON.stringify(toolCall.input)} output=${JSON.stringify(toolCall.output)}`,
                  300,
                ),
              })
              .catch(() => undefined);
          }
        }

        if (ai.guardrailBlocked) {
          await convex
            .mutation(convexRefs.systemRecordEvent, {
              source: "ai",
              eventType: "ai.reply.blocked",
              threadId: ingest.threadId,
              toolRunId,
              detail: ai.guardrailReason || "Blocked by guardrail",
            })
            .catch(() => undefined);
          await convex.mutation(convexRefs.draftCreateGuardrailHold, {
            threadId: ingest.threadId,
            sourceMessageId: ingest.messageId,
            reason: ai.guardrailReason || "Blocked by guardrail",
          });
          return;
        }
      }
      if (ai && pdfContext) {
        const shapedReplyText = enforcePdfReplyShape(ai.text, pdfContext);
        if (shapedReplyText !== ai.text) {
          await convex
            .mutation(convexRefs.systemRecordEvent, {
              source: "ai",
              eventType: "ai.reply.pdf_shape_enforced",
              threadId: ingest.threadId,
              toolRunId,
              detail: compactLogText(`Adjusted PDF reply shape to: ${shapedReplyText}`, 240),
            })
            .catch(() => undefined);
        }
        ai = {
          ...ai,
          text: shapedReplyText,
        };
      }

      const rawTextForDraft =
        outboundPolicy.mode === "reaction_only"
          ? `React with ${outboundPolicy.emoji}`
          : outboundPolicy.mode === "sticker"
            ? "Send sticker response"
            : normalizeOutboundText(ai?.text || "All good.");
      const emojiAdjustedDraft =
        outboundPolicy.mode === "text" || outboundPolicy.mode === "reaction_plus_text" || outboundPolicy.mode === "meme"
          ? applyEmojiCooldownPolicy({
              text: rawTextForDraft,
              nowMs: Date.now(),
              recentMessages: threadContext?.messages,
              lastEmojiSentAtMs: getRecentEmojiOutboundAt(threadJid),
              fallbackText: "All good.",
              allowEmojiInText: true,
              allowedEmojiInText: resolveTextEmojiAllowlist(),
              maxAllowedEmojiMessagesInWindow: TEXT_EMOJI_MAX_PER_WINDOW,
              maxAnyEmojiMessagesInWindowBeforeAllowlist: TEXT_EMOJI_NON_ALLOWLIST_WARMUP_MAX_PER_WINDOW,
              allowedEmojiWindowMs: TEXT_EMOJI_WINDOW_MS,
            })
          : null;
      const textForDraft = emojiAdjustedDraft?.text || rawTextForDraft;
      const timing = estimateDelayAndTyping(textForDraft, {
        delayMinMs: runtimeSettings?.humanDelayMinMs,
        delayMaxMs: runtimeSettings?.humanDelayMaxMs,
        typingMinMs: runtimeSettings?.humanTypingMinMs,
        typingMaxMs: runtimeSettings?.humanTypingMaxMs,
      });
      const primaryConfidence = clamp(runtimeSettings?.aiPrimaryConfidence ?? 0.78, 0.01, 1);
      const fallbackConfidence = clamp(runtimeSettings?.aiFallbackConfidence ?? 0.58, 0.01, 1);
      const sendKind =
        outboundPolicy.mode === "reaction_only"
          ? "reaction"
          : outboundPolicy.mode === "sticker"
            ? "sticker"
            : outboundPolicy.mode === "meme"
              ? "meme"
              : "text";

      const draftPayload = {
        threadId: ingest.threadId,
        sourceMessageId: ingest.messageId,
        toolRunId,
        text: textForDraft,
        provider: ai?.provider || "heuristic",
        confidence: ai ? (ai.provider === "heuristic" ? fallbackConfidence : primaryConfidence) : fallbackConfidence,
        delayMs: timing.delayMs,
        typingMs: timing.typingMs,
        reason: "Generated by worker AI pipeline",
        sendKind,
        reactionEmoji:
          outboundPolicy.mode === "reaction_only" || outboundPolicy.mode === "reaction_plus_text" ? outboundPolicy.emoji : undefined,
        reactionTargetMessageId:
          outboundPolicy.mode === "reaction_only" || outboundPolicy.mode === "reaction_plus_text"
            ? (ingest.messageId as Id<"messages">)
            : undefined,
        mediaAssetId:
          outboundPolicy.mode === "sticker" || outboundPolicy.mode === "meme"
            ? (outboundPolicy.mediaAssetId as Id<"mediaAssets">)
            : undefined,
        mediaCaption: outboundPolicy.mode === "meme" ? textForDraft : undefined,
      };

      await convex
        .mutation(convexRefs.systemRecordEvent, {
          source: "ai",
          eventType: "ai.reply.generated",
          threadId: ingest.threadId,
          toolRunId,
          detail: ai
            ? `Reply generated via ${ai.provider}/${ai.model} in ${ai.latencyMs}ms.`
            : `Reply generated via policy mode ${outboundPolicy.mode}.`,
        })
        .catch(() => undefined);

      if (emojiAdjustedDraft?.emojiSuppressed) {
        await convex
          .mutation(convexRefs.systemRecordEvent, {
            source: "ai",
            eventType: "ai.reply.emoji_cooldown_applied",
            threadId: ingest.threadId,
            toolRunId,
            detail: emojiAdjustedDraft.cooldownActive
              ? "Emoji removed from draft due to active cooldown policy."
              : "Emoji removed from draft due to no-emoji text policy.",
          })
          .catch(() => undefined);
      }

      const health = await getSystemHealth();
      const stageGeneratedMemeForManualReview =
        outboundPolicy.mode === "meme" &&
        outboundPolicy.assetSource === "generated" &&
        !(runtimeSettings?.generatedMemesAutoSendEnabled ?? false);

      if (stageGeneratedMemeForManualReview) {
        await convex
          .mutation(convexRefs.systemRecordEvent, {
            source: "ai",
            eventType: "ai.meme.generated.staged_manual_review",
            threadId: ingest.threadId,
            toolRunId,
            detail: "Generated meme draft staged for manual approval (auto-send disabled).",
          })
          .catch(() => undefined);
        await convex.mutation(convexRefs.draftSaveGenerated, draftPayload);
      } else if (health?.config?.autonomyPaused) {
        await convex.mutation(convexRefs.draftSaveGenerated, draftPayload);
      } else {
        await convex.mutation(convexRefs.draftSaveOrReplacePending, draftPayload);
      }

      if (nightWindDownUntil) {
        await convex
          .mutation(convexRefs.threadsSetNightPause, {
            threadId: ingest.threadId as Id<"threads">,
            pauseUntil: nightWindDownUntil,
          })
          .catch(() => undefined);
        await maybeApplyQuietHoursMute({
          jid: threadJid,
          runtimeSettings,
          threadId: ingest.threadId as Id<"threads">,
          reason: "night_wind_down",
        });
      }
    } catch (error) {
      const err = error instanceof Error ? error.message : String(error);
      logger.error({ err, messageKey: message.key?.id }, "Inbound processing error");
      await convex
        .mutation(convexRefs.systemRecordEvent, {
          source: "worker",
          eventType: "inbound.processing.error",
          detail: err.slice(0, 320),
        })
        .catch(() => undefined);
    }
  };

  const attachListeners = (socket: typeof sock) => {
    const runSocketTask = (eventType: string, task: () => Promise<void>) => {
      void task().catch((error) => {
        const err = error instanceof Error ? error.message : String(error);
        logger.error({ err, eventType }, "WhatsApp socket handler failed");
        void convex
          .mutation(convexRefs.systemRecordEvent, {
            source: "worker",
            eventType: "whatsapp.socket.handler_error",
            detail: compactLogText(`${eventType}: ${err}`, 300),
          })
          .catch(() => undefined);
      });
    };

    socket.ev.on("creds.update", () => {
      runSocketTask("creds.update", async () => {
        await saveCreds();
      });
    });

    socket.ev.on("connection.update", (update) => {
      runSocketTask("connection.update", async () => {
        if (socket !== sock || isShuttingDown) {
          return;
        }

        if (update.connection === "close") {
          const statusCode = getStatusCode(update.lastDisconnect?.error);
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
          logger.warn({ statusCode, shouldReconnect }, "WhatsApp connection closed");

          if (!shouldReconnect) {
            clearReconnectTimer();
            reconnectAttempts = 0;
            const invalidated = await invalidateCredentials();
            await shutdown(
              1,
              invalidated
                ? "WhatsApp logged out this device. Credentials cleared. Re-link in setup."
                : "WhatsApp logged out this device. Failed to clear credentials automatically; reset credentials in setup, then re-link.",
            );
            return;
          }

          await scheduleReconnect(statusCode);
        }

        if (update.connection === "open") {
          clearReconnectTimer();
          reconnectAttempts = 0;
          logger.info("WhatsApp connection established");
          await reportListener(true, "Worker listener is active. AI reply automation is running.");
          const runtimeSettings = await getRuntimeSettings();
          await refreshBlocklist("connection_open", true);
          await runPrivacyPreflight("connection_open", true);
          await maybeRunAboutAutomation("connection_open", runtimeSettings, true);
        }
      });
    });

    socket.ev.on("chats.upsert", (chats) => {
      runSocketTask("chats.upsert", async () => {
        if (socket !== sock || !Array.isArray(chats)) {
          return;
        }
        for (const chat of chats) {
          await syncThreadMetadata(chat);
        }
      });
    });

    socket.ev.on("chats.update", (updates) => {
      runSocketTask("chats.update", async () => {
        if (socket !== sock || !Array.isArray(updates)) {
          return;
        }
        for (const chat of updates) {
          await syncThreadMetadata(chat);
        }
      });
    });

    socket.ev.on("contacts.upsert", (contacts) => {
      runSocketTask("contacts.upsert", async () => {
        if (socket !== sock || !Array.isArray(contacts)) {
          return;
        }
        for (const contact of contacts) {
          syncContactMetadata(contact);
        }
      });
    });

    socket.ev.on("contacts.update", (updates) => {
      runSocketTask("contacts.update", async () => {
        if (socket !== sock || !Array.isArray(updates)) {
          return;
        }
        for (const update of updates) {
          syncContactMetadata(update);
        }
      });
    });

    socket.ev.on("messaging-history.set", (event) => {
      runSocketTask("messaging-history.set", async () => {
        if (socket !== sock || !event) {
          return;
        }
        const ingestMode: "history_sync" | "history_fetch" = event.peerDataRequestSessionId
          ? "history_fetch"
          : "history_sync";
        if (Array.isArray(event.chats)) {
          for (const chat of event.chats) {
            await syncThreadMetadata(chat);
          }
        }
        if (Array.isArray(event.contacts)) {
          for (const contact of event.contacts) {
            syncContactMetadata(contact);
          }
        }
        if (!Array.isArray(event.messages)) {
          return;
        }
        for (const message of event.messages) {
          const laneKey = getThreadJid(message.key) || `unknown:${message.key?.id || Date.now()}`;
          void enqueueByThreadLane(inboundThreadLanes, laneKey, () =>
            runInboundWithLimit(async () => {
              await processHistoricalMessage(message, ingestMode);
            }),
          );
        }
      });
    });

    socket.ev.on("call", (events) => {
      runSocketTask("call", async () => {
        if (socket !== sock || !Array.isArray(events)) {
          return;
        }

        for (const event of events) {
          const laneKey = event.chatId || event.groupJid || event.from || `call:${event.id || Date.now()}`;
          void enqueueByThreadLane(inboundThreadLanes, laneKey, () =>
            runInboundWithLimit(async () => {
              await processInboundCallEvent(event);
            }),
          );
        }
      });
    });

    socket.ev.on("messages.upsert", (event) => {
      runSocketTask("messages.upsert", async () => {
        if (socket !== sock || !event || !Array.isArray(event.messages)) {
          return;
        }

        const ingestMode: "history_sync" | "history_fetch" | null =
          event.type === "notify" ? null : event.requestId ? "history_fetch" : "history_sync";

        for (const message of event.messages) {
          const laneKey = getThreadJid(message.key) || `unknown:${message.key.id || Date.now()}`;
          const messageAt = normalizeIncomingMessageTimestamp(message.messageTimestamp, Date.now());
          const allowSelfControlHandling = shouldAttemptSelfControlOnUpsert({
            ingestMode,
            upsertType: event.type,
            fromMe: Boolean(message.key?.fromMe),
            messageAt,
          });

          if (!allowSelfControlHandling && ingestMode) {
            void enqueueByThreadLane(inboundThreadLanes, laneKey, () =>
              runInboundWithLimit(async () => {
                await processHistoricalMessage(message, ingestMode);
              }),
            );
            continue;
          }
          const helpCommandHandled = await maybeHandleSelfControlHelpCommand(message);
          if (helpCommandHandled) {
            continue;
          }
          const selfImproveCommandHandled = await maybeHandleSelfImproveCommand(message);
          if (selfImproveCommandHandled) {
            continue;
          }
          const openClawCommandHandled = await maybeHandleOpenClawCommand(message);
          if (openClawCommandHandled) {
            continue;
          }
          const runtimeCommandHandled = await maybeHandleRuntimeControlCommand(message);
          if (runtimeCommandHandled) {
            continue;
          }
          if (message.key.fromMe) {
            void enqueueByThreadLane(inboundThreadLanes, laneKey, () =>
              runInboundWithLimit(async () => {
                await processOwnMessage(message);
              }),
            );
            continue;
          }
          void enqueueByThreadLane(inboundThreadLanes, laneKey, () =>
            runInboundWithLimit(async () => {
              await processInboundMessage(message);
            }),
          );
        }
      });
    });
  };

  await reportListener(false, "Worker starting WhatsApp listener...");
  sock = await createSocket(state);
  attachListeners(sock);

  const hydrateAiOutreach = async (
    item: OutboxClaimedItem,
    runtimeSettings: RuntimeSettings | null,
  ) => {
    if (item.messageText !== AI_OUTREACH_PLACEHOLDER) {
      return {
        ...item,
        messageText: item.messageText,
        typingMs: item.typingMs,
      };
    }
    const toolRunId = createToolRunId("outreach", item.threadId, item.outboxId);

    const threadContext = (await convex.query(convexRefs.threadGet, {
      threadId: item.threadId,
    })) as
      | {
          thread: { title?: string; jid: string };
          messages: Array<{ direction: "inbound" | "outbound"; text: string; messageAt?: number }>;
          grounding?: { myName?: string; theirName?: string; autoAliases?: string[]; vibeNotes?: string } | null;
          memory?: { summary?: string; styleNotes?: string[] } | null;
        }
      | null;

    const historyLines = (threadContext?.messages || []).map((m) => {
      return `${m.direction === "inbound" ? "Them" : "Me"}: ${m.text}`;
    });

    const styleHints = threadContext?.memory?.styleNotes || [];
    const styleProfile = await getStyleProfileForThread(item.threadId);

    const personalitySetting = (await convex.query(convexRefs.personalityGetThreadSetting, {
      threadId: item.threadId,
    })) as PersonalityThreadSetting;

    const unansweredOutboundTail = countUnansweredOutboundTail(threadContext?.messages || []);
    const lastInboundAtMs = latestInboundAt(threadContext?.messages || []);
    const elapsedGhostSilenceMs = lastInboundAtMs ? Math.max(0, Date.now() - lastInboundAtMs) : 0;
    const requiredGhostReopenMs = resolveLongSilenceReopenMs(unansweredOutboundTail);
    const requiredGhostReopenWeeks = resolveLongSilenceReopenWeeks(unansweredOutboundTail);
    const longSilenceGhostReopen = Boolean(
      unansweredOutboundTail >= 2 &&
        lastInboundAtMs &&
        Date.now() - lastInboundAtMs >= requiredGhostReopenMs,
    );
    const ghostReopenWeeks = longSilenceGhostReopen
      ? Math.max(1, Math.round((Date.now() - (lastInboundAtMs || Date.now())) / (7 * 24 * 60 * 60 * 1000)))
      : 0;
    const ghostReopenTone = longSilenceGhostReopen ? inferGhostReopenTone(threadContext?.messages || []) : "warm";
    const ghostSeverity = longSilenceGhostReopen
      ? resolveGhostingSeverity({
          unansweredStreak: unansweredOutboundTail,
          elapsedSilenceMs: elapsedGhostSilenceMs,
        })
      : "mild";

    const ghostReopenInstruction =
      !longSilenceGhostReopen
        ? ""
        : ghostReopenTone === "naija_tease"
          ? ghostSeverity === "severe"
            ? `This is a long-silence re-open (${ghostReopenWeeks} weeks unanswered; threshold ${requiredGhostReopenWeeks} week(s)). Use a stronger but playful Naija ghosting tease (example vibe: "Shey you ghost me finish abi 😭"), then warm check-in.`
            : `This is a long-silence re-open (${ghostReopenWeeks} weeks unanswered; threshold ${requiredGhostReopenWeeks} week(s)). Start with a light Naija tease about ghosting (example vibe: "Shey you ghost me abi 😄"), then warm check-in.`
          : ghostReopenTone === "hard_banter"
            ? ghostSeverity === "severe"
              ? `This is a long-silence re-open (${ghostReopenWeeks} weeks unanswered; threshold ${requiredGhostReopenWeeks} week(s)). Use playful roast energy about ghosting (example vibe: "You sly mf, you ghosted me 😭"), but keep it affectionate, brief, and not hostile.`
              : `This is a long-silence re-open (${ghostReopenWeeks} weeks unanswered; threshold ${requiredGhostReopenWeeks} week(s)). Use mild playful roast energy (example vibe: "You sly one, you ghosted me small 😅"), then warm check-in.`
            : ghostReopenTone === "playful"
              ? ghostSeverity === "severe"
                ? `This is a long-silence re-open (${ghostReopenWeeks} weeks unanswered; threshold ${requiredGhostReopenWeeks} week(s)). Use a stronger playful ghosting callout (example vibe: "Omo, you ghosted me hard 😭"), then warm check-in.`
                : `This is a long-silence re-open (${ghostReopenWeeks} weeks unanswered; threshold ${requiredGhostReopenWeeks} week(s)). Use a playful ghosting callout (example vibe: "You ghosted me small 😅"), then warm check-in.`
              : ghostSeverity === "severe"
                ? `This is a long-silence re-open (${ghostReopenWeeks} weeks unanswered; threshold ${requiredGhostReopenWeeks} week(s)). Use a clear but calm ghosting callout (example vibe: "You really disappeared on me 😅"), then warm check-in.`
                : `This is a long-silence re-open (${ghostReopenWeeks} weeks unanswered; threshold ${requiredGhostReopenWeeks} week(s)). Use a gentle ghosting callout (example vibe: "You ghosted me a bit 😅"), then warm check-in.`;

    const memorySummary = threadContext?.memory?.summary ? `Memory summary: ${threadContext.memory.summary}` : "";
    const contactName = threadContext?.thread?.title?.split(/\s+/)[0] || "there";
    const promptSeed = [
      "Proactively start a fresh check-in conversation with this contact now.",
      "Use previous chat context so the opener feels natural, specific, and warm.",
      "Keep it to 1-2 short sentences, avoid sounding robotic, and include exactly one gentle question.",
      "Do not sound needy, accusatory, or passive-aggressive.",
      ghostReopenInstruction,
      memorySummary,
      `Contact first name: ${contactName}`,
    ]
      .filter(Boolean)
      .join("\n");

    const outreachContextTools = await runWorkerContextToolOrchestration({
      convex,
      threadId: item.threadId,
      toolRunId,
      inboundText: promptSeed,
      historyLines,
      allowHistorySearch: true,
      includeContactFacts: true,
      allowFactExtraction: false,
      historySearchLimit: Math.max(8, Math.min(runtimeSettings?.aiHistoryLineLimit ?? 12, 20)),
      factsLimit: 8,
    });
    const outreachHistoryOverride = outreachContextTools.historySearchOverride;
    const outreachContactFacts = outreachContextTools.contactFacts;
    const outreachStyleHints =
      outreachContactFacts.length > 0
        ? [
            ...styleHints,
            ...outreachContactFacts.map((fact) => `Known contact fact (${fact.factType}): ${fact.factValue}`),
          ]
        : styleHints;

    const ai = await generateReplyWithFallback({
      inboundText: promptSeed,
      historyLines,
      historySearchOverride: outreachHistoryOverride,
      contactFacts: outreachContactFacts,
      styleHints: outreachStyleHints,
      styleProfile: styleProfile || undefined,
      personality: personalitySetting
        ? {
            profileSlug: personalitySetting.profileSlug || personalitySetting.profile?.slug,
            profileName: personalitySetting.profile?.name,
            profileDescription: personalitySetting.profile?.description,
            profilePrompt: personalitySetting.profile?.prompt,
            intensity: personalitySetting.intensity,
            customPrompt: personalitySetting.customPrompt || "",
            threadPromptProfile: personalitySetting.threadPromptProfile || "",
            threadPromptProfileSource: personalitySetting.threadPromptProfileSource,
          }
        : undefined,
      grounding: threadContext?.grounding
        ? {
            myName: threadContext.grounding.myName,
            theirName: threadContext.grounding.theirName,
            autoAliases: threadContext.grounding.autoAliases || [],
            vibeNotes: threadContext.grounding.vibeNotes || "",
          }
        : undefined,
      runtime: {
        temperature: runtimeSettings?.aiTemperature,
        maxOutputTokens: runtimeSettings?.aiMaxOutputTokens,
        maxReplyChars: runtimeSettings?.aiMaxReplyChars,
        historyLineLimit: runtimeSettings?.aiHistoryLineLimit,
        fallbackMode: runtimeSettings?.aiFallbackMode,
        modelFirstEnabled: runtimeSettings?.aiModelFirstEnabled,
        deterministicModes: resolveRuntimeDeterministicModes(runtimeSettings?.aiDeterministicModes),
        ackRoutingEnabled: runtimeSettings?.aiAckRoutingEnabled,
        replyPolicyInstruction: runtimeSettings?.aiReplyPolicy || "",
        systemInstruction: runtimeSettings?.aiSystemInstruction || "",
        activePersonaPackId: runtimeSettings?.activePersonaPackId || "",
        qualityGateMode: runtimeSettings?.qualityGateMode,
        qualityGateThreshold: runtimeSettings?.qualityGateThreshold,
        soulModeEnabled: runtimeSettings?.soulModeEnabled,
        funnyStatusKeywords: runtimeSettings?.funnyStatusKeywords,
        funnyStatusEmojis: runtimeSettings?.funnyStatusEmojis,
        delayMinMs: runtimeSettings?.humanDelayMinMs,
        delayMaxMs: runtimeSettings?.humanDelayMaxMs,
        typingMinMs: runtimeSettings?.humanTypingMinMs,
        typingMaxMs: runtimeSettings?.humanTypingMaxMs,
      },
      modelToolContext: buildModelToolContext({
        convex,
        threadId: item.threadId,
        contactJid: threadContext?.thread?.jid,
      }),
    });

    for (let index = 0; index < ai.attempts.length; index += 1) {
      const attempt = ai.attempts[index];
      const label = attemptStageLabel(attempt.stage);
      const usageSuffix = formatAttemptUsage(attempt);
      const detail = attempt.error
        ? `Outreach attempt ${index + 1}/${ai.attempts.length} · ${label} · ${attempt.model} · ${attempt.latencyMs}ms${usageSuffix ? ` · ${usageSuffix}` : ""} · ${attempt.error.slice(0, 220)}`
        : `Outreach attempt ${index + 1}/${ai.attempts.length} · ${label} · ${attempt.model} · ${attempt.latencyMs}ms${usageSuffix ? ` · ${usageSuffix}` : ""}`;

      await convex
        .mutation(convexRefs.systemRecordProviderRun, {
          threadId: item.threadId,
          provider: attempt.provider,
          model: attempt.model,
          latencyMs: attempt.latencyMs,
          status: attempt.status,
          ...(attempt.error ? { error: attempt.error.slice(0, 300) } : {}),
          ...(attempt.inputTokens === undefined ? {} : { inputTokens: attempt.inputTokens }),
          ...(attempt.outputTokens === undefined ? {} : { outputTokens: attempt.outputTokens }),
          ...(attempt.totalTokens === undefined ? {} : { totalTokens: attempt.totalTokens }),
          ...(attempt.usageSource ? { usageSource: attempt.usageSource } : {}),
          ...(attempt.estimatedCostUsd === undefined ? {} : { estimatedCostUsd: attempt.estimatedCostUsd }),
          ...(attempt.costCurrency ? { costCurrency: attempt.costCurrency } : {}),
          ...(attempt.pricingVersion ? { pricingVersion: attempt.pricingVersion } : {}),
        })
        .catch(() => undefined);

      await convex
        .mutation(convexRefs.systemRecordEvent, {
          source: "ai",
          eventType: `outreach.${attemptEventType(attempt)}`,
          threadId: item.threadId,
          toolRunId,
          detail,
        })
        .catch(() => undefined);
    }

    await emitAiPipelineMetrics({
      pipeline: "outreach",
      attempts: ai.attempts,
      latencyMs: ai.latencyMs,
      manualReview: ai.guardrailBlocked,
      threadId: item.threadId as Id<"threads">,
      toolRunId,
    });

    if (ai.contextWindow) {
      await convex
        .mutation(convexRefs.systemRecordEvent, {
          source: "ai",
          eventType: "outreach.ai.context.window",
          threadId: item.threadId,
          toolRunId,
          detail: `Prompt tokens ${ai.contextWindow.estimatedPromptTokens}/${Math.max(128, ai.contextWindow.maxContextTokens - ai.contextWindow.reserveOutputTokens)}; overflow ${ai.contextWindow.overflowTokens}; history ${ai.contextWindow.usedHistoryLines}; relevant ${ai.contextWindow.relevantHistoryLines}.`,
        })
        .catch(() => undefined);
    }

    if (Array.isArray(ai.contextToolCalls) && ai.contextToolCalls.length > 0) {
      for (const toolCall of ai.contextToolCalls) {
        await convex
          .mutation(convexRefs.systemRecordEvent, {
            source: "ai",
            eventType: `outreach.ai.context.tool.${toolCall.name}`,
            threadId: item.threadId,
            toolRunId,
            detail: compactLogText(
              `${toolCall.name} ${toolCall.latencyMs}ms input=${JSON.stringify(toolCall.input)} output=${JSON.stringify(toolCall.output)}`,
              300,
            ),
          })
          .catch(() => undefined);
      }
    }

    if (ai.guardrailBlocked && runtimeSettings?.aiFallbackMode === "azure_only") {
      throw new Error(ai.guardrailReason || "Azure-only mode blocked outreach fallback.");
    }

    const fallbackText = !longSilenceGhostReopen
      ? "Hey, just checking in. How is your day going?"
      : ghostReopenTone === "naija_tease"
        ? ghostSeverity === "severe"
          ? "Shey you ghost me finish abi 😭. Hope you dey alright?"
          : "Shey you ghost me abi 😄. How have you been lately?"
        : ghostReopenTone === "hard_banter"
          ? ghostSeverity === "severe"
            ? "You sly mf, you ghosted me 😭. You good though?"
            : "You sly one, you ghosted me small 😅. You good?"
          : ghostReopenTone === "playful"
            ? ghostSeverity === "severe"
              ? "Omo, you ghosted me hard 😭. How have you been though?"
              : "You ghosted me small 😅. How have you been?"
            : ghostSeverity === "severe"
              ? "You really disappeared on me 😅. Hope you're doing well?"
              : "You ghosted me a little 😅. How have you been lately?";
    const rawSafeText = normalizeOutboundText(ai.guardrailBlocked ? fallbackText : ai.text);
    const emojiAdjusted = applyEmojiCooldownPolicy({
      text: rawSafeText,
      nowMs: Date.now(),
      recentMessages: threadContext?.messages,
      lastEmojiSentAtMs: getRecentEmojiOutboundAt(item.jid),
      fallbackText,
      allowEmojiInText: true,
      allowedEmojiInText: resolveTextEmojiAllowlist(),
      maxAllowedEmojiMessagesInWindow: TEXT_EMOJI_MAX_PER_WINDOW,
      maxAnyEmojiMessagesInWindowBeforeAllowlist: TEXT_EMOJI_NON_ALLOWLIST_WARMUP_MAX_PER_WINDOW,
      allowedEmojiWindowMs: TEXT_EMOJI_WINDOW_MS,
    });
    const safeText = emojiAdjusted.text;
    const timing = estimateDelayAndTyping(safeText, {
      delayMinMs: runtimeSettings?.humanDelayMinMs,
      delayMaxMs: runtimeSettings?.humanDelayMaxMs,
      typingMinMs: runtimeSettings?.humanTypingMinMs,
      typingMaxMs: runtimeSettings?.humanTypingMaxMs,
    });

    const primaryConfidence = clamp(runtimeSettings?.aiPrimaryConfidence ?? 0.78, 0.01, 1);
    const fallbackConfidence = clamp(runtimeSettings?.aiFallbackConfidence ?? 0.58, 0.01, 1);
    const provider = ai.guardrailBlocked ? "heuristic" : ai.provider;
    const confidence = provider === "heuristic" ? fallbackConfidence : primaryConfidence;

    await convex.mutation(convexRefs.outboxHydrateAiOutreach, {
      outboxId: item.outboxId,
      text: safeText,
      provider,
      confidence,
      typingMs: timing.typingMs,
      toolRunId,
    });

    if (emojiAdjusted.emojiSuppressed) {
      await convex
        .mutation(convexRefs.systemRecordEvent, {
          source: "ai",
          eventType: "outreach.ai.emoji_cooldown_applied",
          threadId: item.threadId,
          toolRunId,
          detail: emojiAdjusted.cooldownActive
            ? "Emoji removed from outreach draft due to active cooldown policy."
            : "Emoji removed from outreach draft due to no-emoji text policy.",
        })
        .catch(() => undefined);
    }

    return {
      ...item,
      toolRunId,
      messageText: safeText,
      typingMs: timing.typingMs,
    };
  };

  const hydrateAiStatus = async (
    item: OutboxClaimedItem,
    runtimeSettings: RuntimeSettings | null,
  ): Promise<OutboxClaimedItem> => {
    if (!item.isStatusPost || item.messageText !== AI_STATUS_PLACEHOLDER) {
      return {
        ...item,
        messageText: item.messageText,
      };
    }

    const toolRunId = createToolRunId("status", item.threadId, item.outboxId);
    const trendTheme = (item.statusTrendTheme || "daily life, motivation, fun").trim();
    const demographic = (item.statusDemographicHint || "mixed").trim();
    const audienceCount = Math.max(0, item.statusAudienceJids?.length || 0);
    const requestedFormat: "text" | "meme" = item.statusFormat === "meme" ? "meme" : "text";
    const statusVoice = (await convex
      .query(convexRefs.styleGetStatusVoice, {
        limit: 10,
      })
      .catch(() => null)) as StatusVoiceHintsPayload | null;
    const statusVoiceSamples = (statusVoice?.sampleLines || []).slice(0, 3);
    const statusVoicePhrases = (statusVoice?.recurringPhrases || []).slice(0, 3);
    const statusVoiceNotes = (statusVoice?.toneNotes || []).slice(0, 3);
    const trendSearchPlan = buildStatusInterestSearchQueries({
      trendTheme,
      demographicHint: demographic,
      nowMs: Date.now(),
      maxQueries: 3,
    });
    const trendQueries = trendSearchPlan.queries
      .map((query) => compactLogText(query, 220))
      .filter(Boolean)
      .slice(0, 3);
    let internetTrendLines: string[] = [];
    let internetTrendTheme = "";
    const mergedRowsByKey = new Map<
      string,
      {
        title: string;
        snippet: string;
        confidence: number;
        source: string;
        query: string;
      }
    >();

    if (trendQueries.length > 0) {
      await convex
        .mutation(convexRefs.systemRecordEvent, {
          source: "ai",
          eventType: "status_builder.internet_trends.plan",
          threadId: item.threadId as Id<"threads">,
          toolRunId,
          detail: compactLogText(
            `interests=${(trendSearchPlan.interests || []).join(", ") || "none"} queries=${trendQueries.join(" || ")}`,
            280,
          ),
        })
        .catch(() => undefined);
    }

    for (let index = 0; index < trendQueries.length; index += 1) {
      const query = trendQueries[index];
      const maxResults = index === 0 ? 5 : 3;
      try {
        const webSearch = (await convex.action(convexRefs.chatExternalWebSearch, {
          query,
          maxResults,
        })) as ExternalWebTrendSearchPayload;

        const internetRows = (webSearch.results || [])
          .map((row) => {
            const title = compactLogText((row.title || "").replace(/\s+/g, " ").trim(), 90);
            const snippet = compactLogText((row.snippet || "").replace(/\s+/g, " ").trim(), 120);
            const confidence = clamp(Number(row.confidence ?? 0), 0, 1);
            const url = (row.url || "").trim().toLowerCase();
            const source = (row.source || "unknown").trim().toLowerCase();
            const dedupeKey = url || `${source}:${title.toLowerCase()}`;
            return {
              title,
              snippet,
              confidence,
              dedupeKey,
              source,
            };
          })
          .filter((row) => row.title && (row.snippet || row.confidence >= 0.45))
          .slice(0, maxResults);

        for (const row of internetRows) {
          const existing = mergedRowsByKey.get(row.dedupeKey);
          if (!existing || row.confidence > existing.confidence) {
            mergedRowsByKey.set(row.dedupeKey, {
              title: row.title,
              snippet: row.snippet,
              confidence: row.confidence,
              source: row.source,
              query,
            });
          }
        }

        await convex
          .mutation(convexRefs.systemRecordEvent, {
            source: "ai",
            eventType: "status_builder.internet_trends.loaded",
            threadId: item.threadId as Id<"threads">,
            toolRunId,
            detail: compactLogText(
              `query="${query}" provider=${webSearch.provider || "unknown"} results=${internetRows.length} warnings=${(webSearch.warnings || []).length}`,
              260,
            ),
          })
          .catch(() => undefined);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        await convex
          .mutation(convexRefs.systemRecordEvent, {
            source: "ai",
            eventType: "status_builder.internet_trends.failed",
            threadId: item.threadId as Id<"threads">,
            toolRunId,
            detail: compactLogText(`query="${query}" error=${errorMessage}`, 260),
          })
          .catch(() => undefined);
      }
    }

    const mergedInternetRows = [...mergedRowsByKey.values()]
      .sort((a, b) => b.confidence - a.confidence || a.title.localeCompare(b.title))
      .slice(0, 4);

    internetTrendTheme = mergedInternetRows
      .map((row) => row.title)
      .filter((value): value is string => Boolean(value))
      .slice(0, 2)
      .join(", ");

    internetTrendLines = mergedInternetRows.map((row, index) =>
      compactLogText(
        `Web trend ${index + 1}: ${row.title}${row.snippet ? ` — ${row.snippet}` : ""}${row.query ? ` [${row.query}]` : ""}`,
        180,
      ),
    );

    const blendedTrendTheme = [trendTheme, internetTrendTheme].filter(Boolean).join(", ");
    const interestTheme = trendSearchPlan.interests.length > 0 ? trendSearchPlan.interests.join(", ") : trendTheme;

    const promptSeed = [
      "Generate one WhatsApp status update as a confident, relatable statement.",
      `Audience size: ${audienceCount}.`,
      `Audience mix: ${demographic}.`,
      `Trending topics from my chats: ${trendTheme}.`,
      `Interest themes from my chats: ${interestTheme}.`,
      ...(statusVoiceNotes.length > 0 ? [`My posting voice notes: ${statusVoiceNotes.join(" | ")}.`] : []),
      ...(statusVoicePhrases.length > 0 ? [`My recurring status phrases: ${statusVoicePhrases.join(" | ")}.`] : []),
      ...(internetTrendLines.length > 0 ? [`Internet trend pulse: ${internetTrendLines.join(" | ")}.`] : []),
      `Required format: ${requestedFormat === "meme" ? "short meme caption" : "text-only status"}.`,
      "Style: concise, playful, human, and natural.",
      "Do not sound like marketing, spam, or clickbait.",
      "Do not ask questions or invite answers.",
      "Keep under 140 characters. Use at most one emoji.",
    ].join("\n");

    const ai = await generateReplyWithFallback({
      inboundText: promptSeed,
      historyLines: [
        `Trend keywords: ${blendedTrendTheme || trendTheme}`,
        `Interest themes: ${interestTheme}`,
        `Demographic mix: ${demographic}`,
        `Audience count: ${audienceCount}`,
        ...(statusVoiceSamples.length > 0 ? [`Recent self-posted statuses: ${statusVoiceSamples.join(" | ")}`] : []),
        ...(statusVoicePhrases.length > 0 ? [`Recurring status phrases: ${statusVoicePhrases.join(" | ")}`] : []),
        ...(statusVoiceNotes.length > 0 ? [`Posting voice notes: ${statusVoiceNotes.join(" | ")}`] : []),
        ...internetTrendLines,
      ],
      styleHints: [
        "status",
        "engagement",
        `demographic:${demographic}`,
        ...trendSearchPlan.interests.slice(0, 3).map((interest) => `interest:${interest}`),
        ...statusVoicePhrases.map((phrase) => `status_phrase:${phrase}`),
        ...statusVoiceNotes.map((note) => `status_voice:${note}`),
        ...(internetTrendTheme ? [`internet:${internetTrendTheme}`] : []),
      ],
      runtime: {
        temperature: runtimeSettings?.aiTemperature,
        maxOutputTokens: Math.min(runtimeSettings?.aiMaxOutputTokens ?? 120, 120),
        maxReplyChars: Math.min(runtimeSettings?.aiMaxReplyChars ?? 220, 220),
        historyLineLimit: Math.min(runtimeSettings?.aiHistoryLineLimit ?? 8, 8),
        fallbackMode: runtimeSettings?.aiFallbackMode,
        modelFirstEnabled: runtimeSettings?.aiModelFirstEnabled,
        deterministicModes: resolveRuntimeDeterministicModes(runtimeSettings?.aiDeterministicModes),
        ackRoutingEnabled: runtimeSettings?.aiAckRoutingEnabled,
        replyPolicyInstruction: runtimeSettings?.aiReplyPolicy || "",
        systemInstruction: runtimeSettings?.aiSystemInstruction || "",
        activePersonaPackId: runtimeSettings?.activePersonaPackId || "",
        qualityGateMode: runtimeSettings?.qualityGateMode,
        qualityGateThreshold: runtimeSettings?.qualityGateThreshold,
        soulModeEnabled: runtimeSettings?.soulModeEnabled,
        funnyStatusKeywords: runtimeSettings?.funnyStatusKeywords,
        funnyStatusEmojis: runtimeSettings?.funnyStatusEmojis,
      },
      modelToolContext: buildModelToolContext({
        convex,
        threadId: item.threadId,
      }),
    });

    for (let index = 0; index < ai.attempts.length; index += 1) {
      const attempt = ai.attempts[index];
      const label = attemptStageLabel(attempt.stage);
      const usageSuffix = formatAttemptUsage(attempt);
      const detail = attempt.error
        ? `Status attempt ${index + 1}/${ai.attempts.length} · ${label} · ${attempt.model} · ${attempt.latencyMs}ms${usageSuffix ? ` · ${usageSuffix}` : ""} · ${attempt.error.slice(0, 220)}`
        : `Status attempt ${index + 1}/${ai.attempts.length} · ${label} · ${attempt.model} · ${attempt.latencyMs}ms${usageSuffix ? ` · ${usageSuffix}` : ""}`;

      await convex
        .mutation(convexRefs.systemRecordProviderRun, {
          threadId: item.threadId,
          provider: attempt.provider,
          model: attempt.model,
          latencyMs: attempt.latencyMs,
          status: attempt.status,
          ...(attempt.error ? { error: attempt.error.slice(0, 300) } : {}),
          ...(attempt.inputTokens === undefined ? {} : { inputTokens: attempt.inputTokens }),
          ...(attempt.outputTokens === undefined ? {} : { outputTokens: attempt.outputTokens }),
          ...(attempt.totalTokens === undefined ? {} : { totalTokens: attempt.totalTokens }),
          ...(attempt.usageSource ? { usageSource: attempt.usageSource } : {}),
          ...(attempt.estimatedCostUsd === undefined ? {} : { estimatedCostUsd: attempt.estimatedCostUsd }),
          ...(attempt.costCurrency ? { costCurrency: attempt.costCurrency } : {}),
          ...(attempt.pricingVersion ? { pricingVersion: attempt.pricingVersion } : {}),
        })
        .catch(() => undefined);

      await convex
        .mutation(convexRefs.systemRecordEvent, {
          source: "ai",
          eventType: `status_builder.${attemptEventType(attempt)}`,
          threadId: item.threadId,
          toolRunId,
          detail,
        })
        .catch(() => undefined);
    }

    await emitAiPipelineMetrics({
      pipeline: "status_builder",
      attempts: ai.attempts,
      latencyMs: ai.latencyMs,
      manualReview: ai.guardrailBlocked,
      threadId: item.threadId as Id<"threads">,
      toolRunId,
    });

    const fallbackText =
      requestedFormat === "meme"
        ? "Small chaos, big laughs all around. 😅"
        : "Small wins are stacking up nicely today.";
    const aiText = normalizeOutboundText(ai.guardrailBlocked ? fallbackText : ai.text);
    const normalizedTextBase = aiText.slice(0, 220).trim() || fallbackText;
    let resolvedFormat: "text" | "meme" = requestedFormat;
    let mediaAssetId: Id<"mediaAssets"> | undefined;
    let mediaCaption: string | undefined;

    if (requestedFormat === "meme") {
      mediaCaption = normalizedTextBase;
      mediaAssetId = await generateAndStoreThreadMeme({
        threadId: item.threadId,
        threadJid: "status@broadcast",
        inboundText: promptSeed,
        recentHistoryLines: [
          `Trend: ${blendedTrendTheme || trendTheme}`,
          `Demographic: ${demographic}`,
          `Audience: ${audienceCount}`,
          ...internetTrendLines,
        ],
        styleHints: [
          blendedTrendTheme || trendTheme,
          demographic,
          "status update",
        ],
        runtimeSettings,
        threadTitle: "My Status",
        reason: "on_demand",
      });

      if (!mediaAssetId) {
        resolvedFormat = "text";
        mediaCaption = undefined;
      }
    }
    const normalizedText = resolvedFormat === "text" ? forceDeclarativeStatusText(normalizedTextBase) : normalizedTextBase;

    const primaryConfidence = clamp(runtimeSettings?.aiPrimaryConfidence ?? 0.78, 0.01, 1);
    const fallbackConfidence = clamp(runtimeSettings?.aiFallbackConfidence ?? 0.58, 0.01, 1);
    const provider = ai.guardrailBlocked ? "heuristic" : ai.provider;
    const confidence = provider === "heuristic" ? fallbackConfidence : primaryConfidence;

    await convex.mutation(convexRefs.outboxHydrateAiStatus, {
      outboxId: item.outboxId as Id<"outbox">,
      text: normalizedText,
      provider,
      confidence,
      typingMs: 0,
      toolRunId,
      statusFormat: resolvedFormat,
      mediaAssetId,
      mediaCaption,
      statusTrendTheme: blendedTrendTheme || trendTheme,
      statusDemographicHint: demographic,
    });

    return {
      ...item,
      toolRunId,
      sendKind: (resolvedFormat === "meme" ? "meme" : "text") as OutboxClaimedItem["sendKind"],
      statusFormat: resolvedFormat,
      mediaAssetId,
      mediaCaption,
      messageText: normalizedText,
      typingMs: 0,
    };
  };

  const fetchMediaAssetBuffer = async (assetId: string) => {
    pruneMediaAssetBufferCache();
    const cached = mediaAssetBufferCache.get(assetId);
    const now = Date.now();
    if (cached && cached.expiresAt > now) {
      return Buffer.from(cached.buffer);
    }

    const inFlight = mediaAssetBufferInFlight.get(assetId);
    if (inFlight) {
      const shared = await inFlight;
      return Buffer.from(shared);
    }

    const loadPromise = (async () => {
      const asset = (await convex.query(convexRefs.mediaGetAssetDownloadUrl, {
        assetId,
      })) as null | { url: string };
      if (!asset?.url) {
        throw new Error(`Media asset unavailable: ${assetId}`);
      }
      const response = await fetch(asset.url);
      if (!response.ok) {
        throw new Error(`Failed to download media asset ${assetId}: ${response.status}`);
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length === 0) {
        throw new Error(`Media asset ${assetId} is empty.`);
      }
      mediaAssetBufferCache.set(assetId, {
        buffer,
        cachedAt: Date.now(),
        expiresAt: Date.now() + MEDIA_ASSET_BUFFER_CACHE_TTL_MS,
      });
      pruneMediaAssetBufferCache();
      return buffer;
    })();

    mediaAssetBufferInFlight.set(assetId, loadPromise);
    try {
      const loaded = await loadPromise;
      return Buffer.from(loaded);
    } finally {
      mediaAssetBufferInFlight.delete(assetId);
    }
  };

  const buildQuotedMessageOptions = (item: OutboxClaimedItem): { quoted: WAMessage } | undefined => {
    if (!item.replyTargetWhatsAppMessageId) {
      return undefined;
    }

    const text = (item.replyTargetText || "").trim() || " ";
    const quoted: WAMessage = {
      key: {
        remoteJid: item.jid,
        fromMe: false,
        id: item.replyTargetWhatsAppMessageId,
        participant: isGroupJid(item.jid) ? item.replyTargetSenderJid : undefined,
      },
      message: {
        conversation: text,
      },
      messageTimestamp: Math.floor((item.replyTargetMessageAt ?? Date.now()) / 1000),
    };
    return { quoted };
  };

  const pollOutbox = async () => {
    if (processingOutbox) {
      return;
    }
    if (workerRuntimePaused) {
      return;
    }

    processingOutbox = true;
    try {
      const runtimeSettings = await getRuntimeSettings();
      const claimLimit = Math.round(clamp(runtimeSettings?.outboxClaimLimit ?? 8, 1, 20));
      const claimed = (await convex.mutation(convexRefs.outboxClaimDue, {
        workerId,
        messageProvider: "whatsapp",
        limit: claimLimit,
      })) as OutboxClaimedItem[];
      const tasks = claimed.map((item) =>
        enqueueByThreadLane(outboxThreadLanes, item.threadId, () =>
          runOutboxWithLimit(async () => {
            try {
              const isStatusBroadcastSend = item.isStatusPost === true && item.jid === "status@broadcast";
              if (!isStatusBroadcastSend) {
                const eligibility = (await convex.query(convexRefs.threadsGetEligibility, {
                  threadId: item.threadId,
                })) as {
                  allowed: boolean;
                  reason?: "group_ignored" | "archived" | "broadcast_or_system" | "explicit_ignore" | "temporary_ghost";
                  detail?: string;
                };
                if (!eligibility.allowed) {
                  await convex.mutation(convexRefs.outboxMarkFailed, {
                    outboxId: item.outboxId,
                    error: `Blocked by eligibility: ${eligibility.reason || eligibility.detail || "unknown"}.`,
                    forceFinal: true,
                  });
                  return;
                }
              }

              if (!isStatusBroadcastSend && (await isJidBlocked(item.jid))) {
                await convex.mutation(convexRefs.outboxMarkFailed, {
                  outboxId: item.outboxId,
                  error: "Blocked by WhatsApp blocklist.",
                  forceFinal: true,
                });
                await convex
                  .mutation(convexRefs.systemRecordEvent, {
                    source: "worker",
                    eventType: "outbox.blocked.blocklist",
                    threadId: item.threadId as Id<"threads">,
                    outboxId: item.outboxId as Id<"outbox">,
                    detail: compactLogText(`jid=${item.jid}`, 180),
                  })
                  .catch(() => undefined);
                return;
              }

              if (!isStatusBroadcastSend) {
                await maybeClearQuietHoursMute({
                  jid: item.jid,
                  runtimeSettings,
                  threadId: item.threadId as Id<"threads">,
                  reason: "pre_send_outbox",
                });
              }

              if (
                runtimeSettings?.aiFallbackMode === "azure_only" &&
                item.provider !== "azure" &&
                (item.sendKind === "text" || item.sendKind === "meme") &&
                item.messageText !== AI_OUTREACH_PLACEHOLDER &&
                item.messageText !== AI_STATUS_PLACEHOLDER
              ) {
                await convex.mutation(convexRefs.outboxMarkFailed, {
                  outboxId: item.outboxId,
                  error: `Blocked by Azure-only mode: non-Azure outbox item (${item.provider}).`,
                  forceFinal: true,
                });
                return;
              }

              const preHydrationDisposition = (await convex.query(convexRefs.outboxGetSendDisposition, {
                outboxId: item.outboxId,
              })) as { canSend: boolean; reason?: string };
              if (!preHydrationDisposition.canSend) {
                return;
              }

              const outreachHydrated = await hydrateAiOutreach(item, runtimeSettings);
              const hydrated = await hydrateAiStatus(outreachHydrated, runtimeSettings);
              const postHydrationDisposition = (await convex.query(convexRefs.outboxGetSendDisposition, {
                outboxId: item.outboxId,
              })) as { canSend: boolean; reason?: string };
              if (!postHydrationDisposition.canSend) {
                return;
              }

              const reviewRatio = clamp(runtimeSettings?.statusBuilderReviewRatio ?? 0, 0, 1);
              const legacySampledForReview =
                item.statusReviewRequired === undefined &&
                item.isStatusPost === true &&
                item.messageText === AI_STATUS_PLACEHOLDER &&
                (stableHash(`${item.outboxId}|status-review`) % 1000) / 1000 < reviewRatio;
              const requiresStatusReview = Boolean(item.statusReviewRequired) || legacySampledForReview;
              if (requiresStatusReview && item.isStatusPost === true && item.messageText === AI_STATUS_PLACEHOLDER) {
                await convex.mutation(convexRefs.outboxStageStatusReview, {
                  outboxId: item.outboxId as Id<"outbox">,
                  reason: "Auto status sampled for manual review before send.",
                });
                return;
              }

              if (hydrated.reactionEmoji && hydrated.reactionTargetWhatsAppMessageId && hydrated.sendKind === "text") {
                rememberAutomatedThreadSend(item.jid);
                const preReactionSent = await sock.sendMessage(item.jid, {
                  react: {
                    text: hydrated.reactionEmoji,
                    key: {
                      remoteJid: item.jid,
                      id: hydrated.reactionTargetWhatsAppMessageId,
                      fromMe: false,
                    },
                  },
                });
                rememberAutomatedOutboundId(preReactionSent?.key?.id || undefined);
              }

              let effectiveMessageText = hydrated.messageText;
              let effectiveMediaCaption = hydrated.mediaCaption || hydrated.messageText;
              const quotedMessageOptions = buildQuotedMessageOptions(hydrated);
              let threadForEmojiPolicy: ThreadContextSnapshot = null;
              let emojiPolicyApplied = false;
              if (!isStatusBroadcastSend && (hydrated.sendKind === "text" || hydrated.sendKind === "meme")) {
                threadForEmojiPolicy = (await convex
                  .query(convexRefs.threadGet, {
                    threadId: item.threadId as Id<"threads">,
                  })
                  .catch(() => null)) as ThreadContextSnapshot | null;
                const baseText = hydrated.sendKind === "meme" ? effectiveMediaCaption : effectiveMessageText;
                const originalMediaCaption = hydrated.mediaCaption || hydrated.messageText;
                const emojiAdjusted = applyEmojiCooldownPolicy({
                  text: baseText,
                  nowMs: Date.now(),
                  recentMessages: threadForEmojiPolicy?.messages,
                  lastEmojiSentAtMs: getRecentEmojiOutboundAt(item.jid),
                  fallbackText: hydrated.sendKind === "meme" ? "Checking in with you." : "All good.",
                  allowEmojiInText: true,
                  allowedEmojiInText: resolveTextEmojiAllowlist(),
                  maxAllowedEmojiMessagesInWindow: TEXT_EMOJI_MAX_PER_WINDOW,
                  maxAnyEmojiMessagesInWindowBeforeAllowlist: TEXT_EMOJI_NON_ALLOWLIST_WARMUP_MAX_PER_WINDOW,
                  allowedEmojiWindowMs: TEXT_EMOJI_WINDOW_MS,
                });
                emojiPolicyApplied = emojiAdjusted.emojiSuppressed;
                if (hydrated.sendKind === "text") {
                  effectiveMessageText = emojiAdjusted.text;
                } else {
                  effectiveMediaCaption = emojiAdjusted.text;
                  effectiveMessageText = emojiAdjusted.text;
                }

                const captionChanged = hydrated.sendKind === "meme" && effectiveMediaCaption !== originalMediaCaption;
                if (effectiveMessageText !== hydrated.messageText || captionChanged) {
                  await convex
                    .mutation(convexRefs.outboxRewriteClaimedMessage, {
                      outboxId: item.outboxId as Id<"outbox">,
                      messageText: effectiveMessageText,
                      mediaCaption: hydrated.sendKind === "meme" ? effectiveMediaCaption : undefined,
                    })
                    .catch(() => undefined);
                }
              }

              if (emojiPolicyApplied) {
                await convex
                  .mutation(convexRefs.systemRecordEvent, {
                    source: "worker",
                    eventType: "outbox.emoji_cooldown_applied",
                    threadId: item.threadId as Id<"threads">,
                    outboxId: item.outboxId as Id<"outbox">,
                    detail: "Emoji removed from outbox message due to no-emoji text policy.",
                  })
                  .catch(() => undefined);
              }

              const latestInboundText =
                [...(threadForEmojiPolicy?.messages || [])]
                  .reverse()
                  .find((message) => message.direction === "inbound")?.text || "";
              const stickerCompanionPlan =
                hydrated.sendKind === "text" && !isStatusBroadcastSend
                  ? await decideStickerCompanionPlan({
                      jid: item.jid,
                      threadId: item.threadId,
                      inboundText: latestInboundText,
                      outboundText: effectiveMessageText,
                      runtimeSettings,
                      preReactionActive: Boolean(hydrated.reactionEmoji && hydrated.reactionTargetWhatsAppMessageId),
                    })
                  : null;

              const maybeSendStickerCompanion = async (phase: "before" | "after") => {
                if (!stickerCompanionPlan || stickerCompanionPlan.position !== phase) {
                  return;
                }
                try {
                  const stickerMessageId = await sendStickerCompanion({
                    jid: item.jid,
                    assetId: stickerCompanionPlan.assetId,
                  });
                  await convex
                    .mutation(convexRefs.systemRecordEvent, {
                      source: "worker",
                      eventType: `outbox.sticker_companion.${phase}`,
                      threadId: item.threadId as Id<"threads">,
                      outboxId: item.outboxId as Id<"outbox">,
                      detail: `Sent sticker companion (${phase}) asset=${stickerCompanionPlan.assetId} id=${stickerMessageId || "unknown"}.`,
                    })
                    .catch(() => undefined);
                } catch (error) {
                  const err = error instanceof Error ? error.message : String(error);
                  await convex
                    .mutation(convexRefs.systemRecordEvent, {
                      source: "worker",
                      eventType: "outbox.sticker_companion.error",
                      threadId: item.threadId as Id<"threads">,
                      outboxId: item.outboxId as Id<"outbox">,
                      detail: compactLogText(err, 260),
                    })
                    .catch(() => undefined);
                }
              };

              let sent: { key?: { id?: string | null } } | undefined;
              const destinationJid = isStatusBroadcastSend ? "status@broadcast" : item.jid;
              if (isStatusBroadcastSend) {
                const statusSendOptions = buildStatusSendOptions(undefined);
                if (hydrated.sendKind === "meme") {
                  if (!hydrated.mediaAssetId) {
                    throw new Error("Status meme outbox item missing media asset id.");
                  }
                  const memeBuffer = await fetchMediaAssetBuffer(hydrated.mediaAssetId);
                  rememberAutomatedThreadSend(destinationJid);
                  sent = await sock.sendMessage(
                    destinationJid,
                    {
                      image: memeBuffer,
                      caption: effectiveMediaCaption || effectiveMessageText,
                    },
                    statusSendOptions,
                  );
                } else {
                  rememberAutomatedThreadSend(destinationJid);
                  sent = await sock.sendMessage(destinationJid, { text: effectiveMessageText }, statusSendOptions);
                }
              } else if (hydrated.sendKind === "reaction") {
                if (!hydrated.reactionEmoji || !hydrated.reactionTargetWhatsAppMessageId) {
                  throw new Error("Reaction outbox item missing emoji or target message id.");
                }
                rememberAutomatedThreadSend(item.jid);
                sent = await sock.sendMessage(item.jid, {
                  react: {
                    text: hydrated.reactionEmoji,
                    key: {
                      remoteJid: item.jid,
                      id: hydrated.reactionTargetWhatsAppMessageId,
                      fromMe: false,
                    },
                  },
                });
              } else if (hydrated.sendKind === "sticker") {
                if (!hydrated.mediaAssetId) {
                  throw new Error("Sticker outbox item missing media asset id.");
                }
                await ensureStickerContextForAsset(hydrated.mediaAssetId);
                const stickerBuffer = await fetchMediaAssetBuffer(hydrated.mediaAssetId);
                rememberAutomatedThreadSend(item.jid);
                sent = await sock.sendMessage(item.jid, {
                  sticker: stickerBuffer,
                }, quotedMessageOptions);
              } else if (hydrated.sendKind === "meme") {
                if (!hydrated.mediaAssetId) {
                  throw new Error("Meme outbox item missing media asset id.");
                }
                await maybeSubscribePresence(item.jid, runtimeSettings);
                await sock.sendPresenceUpdate("composing", item.jid);
                await convex.mutation(convexRefs.outboxMarkTyping, { outboxId: item.outboxId });
                await sleep(hydrated.typingMs);
                const postTypingDisposition = (await convex.query(convexRefs.outboxGetSendDisposition, {
                  outboxId: item.outboxId,
                })) as { canSend: boolean; reason?: string };
                if (!postTypingDisposition.canSend) {
                  await sock.sendPresenceUpdate("paused", item.jid);
                  return;
                }
                const memeBuffer = await fetchMediaAssetBuffer(hydrated.mediaAssetId);
                rememberAutomatedThreadSend(item.jid);
                sent = await sock.sendMessage(item.jid, {
                  image: memeBuffer,
                  caption: effectiveMediaCaption || effectiveMessageText,
                }, quotedMessageOptions);
                await sock.sendPresenceUpdate("paused", item.jid);
              } else {
                await maybeSubscribePresence(item.jid, runtimeSettings);
                await sock.sendPresenceUpdate("composing", item.jid);
                await convex.mutation(convexRefs.outboxMarkTyping, { outboxId: item.outboxId });
                await sleep(hydrated.typingMs);
                const postTypingDisposition = (await convex.query(convexRefs.outboxGetSendDisposition, {
                  outboxId: item.outboxId,
                })) as { canSend: boolean; reason?: string };
                if (!postTypingDisposition.canSend) {
                  await sock.sendPresenceUpdate("paused", item.jid);
                  return;
                }
                await maybeSendStickerCompanion("before");
                rememberAutomatedThreadSend(item.jid);
                sent = await sock.sendMessage(item.jid, { text: effectiveMessageText }, quotedMessageOptions);
                await maybeSendStickerCompanion("after");
                await sock.sendPresenceUpdate("paused", item.jid);
              }

              if (!isStatusBroadcastSend && hydrated.sendKind === "text" && containsAnyEmoji(effectiveMessageText)) {
                rememberEmojiOutboundAt(item.jid, Date.now());
              } else if (!isStatusBroadcastSend && hydrated.sendKind === "meme" && containsAnyEmoji(effectiveMediaCaption || "")) {
                rememberEmojiOutboundAt(item.jid, Date.now());
              }

              rememberAutomatedOutboundId(sent?.key?.id || undefined);
              await convex.mutation(convexRefs.outboxMarkSent, {
                outboxId: item.outboxId,
                messageProvider: "whatsapp",
                providerMessageId: sent?.key?.id || undefined,
                whatsappMessageId: sent?.key?.id || undefined,
              });
              if (hydrated.sendKind === "meme" && hydrated.mediaAssetId) {
                await markMediaAssetUsed(hydrated.mediaAssetId);
              }
            } catch (error) {
              const err = error instanceof Error ? error.message : String(error);
              await convex.mutation(convexRefs.outboxMarkFailed, {
                outboxId: item.outboxId,
                error: err,
              });
            }
          }),
        ),
      );
      await Promise.allSettled(tasks);
    } catch (error) {
      const err = error instanceof Error ? error.message : String(error);
      logger.error({ err }, "WhatsApp outbox poll failed");
      await convex
        .mutation(convexRefs.systemRecordEvent, {
          source: "worker",
          eventType: "whatsapp.outbox.poll_error",
          detail: compactLogText(err, 300),
        })
        .catch(() => undefined);
    } finally {
      processingOutbox = false;
    }
  };

  const runStatusCleanupPass = async (runtimeSettings?: RuntimeSettings | null) => {
    try {
      const statusRetentionMs = Math.max(5 * 60 * 1000, Math.min(runtimeSettings?.statusRetentionMs ?? STATUS_RETENTION_MS, 24 * 60 * 60 * 1000));
      const statusCleanupBatchLimit = Math.max(
        20,
        Math.min(runtimeSettings?.statusCleanupBatchLimit ?? STATUS_CLEANUP_BATCH_LIMIT, 800),
      );
      const result = (await convex.mutation(convexRefs.mediaCleanupStatusRetention, {
        olderThanMs: statusRetentionMs,
        limit: statusCleanupBatchLimit,
      })) as {
        deletedMessages?: number;
        deletedAssets?: number;
        hasMore?: boolean;
      } | null;

      if (!result) {
        return;
      }

      const deletedMessages = Number(result.deletedMessages || 0);
      const deletedAssets = Number(result.deletedAssets || 0);
      if (deletedMessages <= 0 && deletedAssets <= 0) {
        return;
      }

      await convex
        .mutation(convexRefs.systemRecordEvent, {
          source: "worker",
          eventType: "retention.status.cleanup",
          detail: `Deleted ${deletedMessages} status message(s) and ${deletedAssets} status media asset(s) older than ${Math.round(statusRetentionMs / 60_000)}m.`,
        })
        .catch(() => undefined);

      if (result.hasMore) {
        setTimeout(() => {
          void runStatusCleanupPass(runtimeSettings);
        }, 1_500);
      }
    } catch (error) {
      const err = error instanceof Error ? error.message : String(error);
      await convex
        .mutation(convexRefs.systemRecordEvent, {
          source: "worker",
          eventType: "retention.status.cleanup_error",
          detail: compactLogText(err, 280),
        })
        .catch(() => undefined);
    }
  };

  const runContextCompactionPass = async (runtimeSettings?: RuntimeSettings | null) => {
    try {
      const statusKeepPerThread = Math.max(
        8,
        Math.min(runtimeSettings?.statusContextKeepPerThread ?? 24, 120),
      );
      const groupKeepPerThread = Math.max(
        8,
        Math.min(runtimeSettings?.groupContextKeepPerThread ?? 24, 120),
      );
      const maxThreads = Math.max(
        2,
        Math.min(runtimeSettings?.contextCompactionMaxThreads ?? CONTEXT_COMPACTION_MAX_THREADS, 80),
      );
      const maxDeletes = Math.max(
        20,
        Math.min(runtimeSettings?.contextCompactionMaxDeletes ?? CONTEXT_COMPACTION_MAX_DELETES, 800),
      );
      const compactContextGroupJids = (runtimeSettings?.compactContextGroupJids || [])
        .map((jid) => jid.trim())
        .filter(Boolean)
        .slice(0, 80);

      const result = (await convex.mutation(convexRefs.mediaCompactContextWindows, {
        statusKeepPerThread,
        groupKeepPerThread,
        groupThreadJids: compactContextGroupJids.length > 0 ? compactContextGroupJids : undefined,
        maxThreads,
        maxDeletes,
      })) as {
        deletedMessages?: number;
        deletedAssets?: number;
        hitDeleteLimit?: boolean;
      } | null;

      if (!result) {
        return;
      }
      const deletedMessages = Number(result.deletedMessages || 0);
      const deletedAssets = Number(result.deletedAssets || 0);
      if (deletedMessages <= 0 && deletedAssets <= 0) {
        return;
      }

      await convex
        .mutation(convexRefs.systemRecordEvent, {
          source: "worker",
          eventType: "retention.context.compacted",
          detail: `Compacted context: deleted ${deletedMessages} message(s), ${deletedAssets} media asset(s), statusKeep=${statusKeepPerThread}, groupKeep=${groupKeepPerThread}${result.hitDeleteLimit ? " (batch limited)" : ""}.`,
        })
        .catch(() => undefined);

      if (result.hitDeleteLimit) {
        setTimeout(() => {
          void runContextCompactionPass(runtimeSettings);
        }, 2_000);
      }
    } catch (error) {
      const err = error instanceof Error ? error.message : String(error);
      await convex
        .mutation(convexRefs.systemRecordEvent, {
          source: "worker",
          eventType: "retention.context.compaction_error",
          detail: compactLogText(err, 280),
        })
        .catch(() => undefined);
    }
  };

  let lastStatusCleanupAt = 0;
  let lastContextCompactionAt = 0;
  const MAINTENANCE_TICK_MS = 60_000;

  const maybeRunStatusCleanup = async (force = false) => {
    const runtimeSettings = await getRuntimeSettings();
    const intervalMs = Math.max(
      5 * 60 * 1000,
      Math.min(runtimeSettings?.statusCleanupIntervalMs ?? STATUS_CLEANUP_INTERVAL_MS, 24 * 60 * 60 * 1000),
    );
    const now = Date.now();
    if (!force && now - lastStatusCleanupAt < intervalMs) {
      return;
    }
    lastStatusCleanupAt = now;
    await runStatusCleanupPass(runtimeSettings);
  };

  const maybeRunContextCompaction = async (force = false) => {
    const runtimeSettings = await getRuntimeSettings();
    const intervalMs = Math.max(
      2 * 60 * 1000,
      Math.min(runtimeSettings?.contextCompactionIntervalMs ?? CONTEXT_COMPACTION_INTERVAL_MS, 24 * 60 * 60 * 1000),
    );
    const now = Date.now();
    if (!force && now - lastContextCompactionAt < intervalMs) {
      return;
    }
    lastContextCompactionAt = now;
    await runContextCompactionPass(runtimeSettings);
  };

  const runBackgroundTask = (taskName: string, task: () => Promise<void>) => {
    void task().catch((error) => {
      const err = error instanceof Error ? error.message : String(error);
      logger.error({ err, taskName }, "Worker background task failed");
      void convex
        .mutation(convexRefs.systemRecordEvent, {
          source: "worker",
          eventType: "worker.background_task_error",
          detail: compactLogText(`${taskName}: ${err}`, 300),
        })
        .catch(() => undefined);
    });
  };

  const startupSettings = await getRuntimeSettings();
  const intervalMs = Math.round(
    clamp(startupSettings?.outboxPollMs ?? Number(process.env.SLM_OUTBOX_POLL_MS || 3000), 500, 60_000),
  );
  setInterval(() => {
    runBackgroundTask("whatsapp.outbox.poll", pollOutbox);
  }, intervalMs);
  setInterval(() => {
    runBackgroundTask("whatsapp.sticker.context_backfill", runStickerContextBackfillPass);
  }, STICKER_CONTEXT_PASS_INTERVAL_MS);
  setInterval(() => {
    runBackgroundTask("whatsapp.maintenance.status_cleanup", maybeRunStatusCleanup);
  }, MAINTENANCE_TICK_MS);
  setInterval(() => {
    runBackgroundTask("whatsapp.maintenance.context_compaction", maybeRunContextCompaction);
  }, MAINTENANCE_TICK_MS);
  setInterval(() => {
    runBackgroundTask("whatsapp.maintenance.safety_sync", async () => {
      const runtimeSettings = await getRuntimeSettings();
      await refreshBlocklist("maintenance", false);
      await runPrivacyPreflight("maintenance", false);
      await maybeRunAboutAutomation("maintenance", runtimeSettings, false);
    });
  }, MAINTENANCE_TICK_MS);
  runBackgroundTask("whatsapp.sticker.context_backfill.startup", runStickerContextBackfillPass);
  runBackgroundTask("whatsapp.maintenance.status_cleanup.startup", () => maybeRunStatusCleanup(true));
  runBackgroundTask("whatsapp.maintenance.context_compaction.startup", () => maybeRunContextCompaction(true));
  runBackgroundTask("whatsapp.maintenance.safety_sync.startup", async () => {
    const runtimeSettings = await getRuntimeSettings();
    await refreshBlocklist("startup", true);
    await runPrivacyPreflight("startup", true);
    await maybeRunAboutAutomation("startup", runtimeSettings, true);
  });

  logger.info(
    {
      workerId,
      intervalMs,
      visionFilterMode: VISION_FILTER_MODE,
      visionUncaptionedCooldownMs: VISION_FILTER_UNCAPTIONED_COOLDOWN_MS,
      captureGroupMediaEnabled: startupSettings?.captureGroupMediaEnabled ?? false,
      statusRetentionMinutes: Math.round((startupSettings?.statusRetentionMs ?? STATUS_RETENTION_MS) / 60_000),
      statusCleanupIntervalMinutes: Math.round(
        (startupSettings?.statusCleanupIntervalMs ?? STATUS_CLEANUP_INTERVAL_MS) / 60_000,
      ),
      statusCleanupBatchLimit: startupSettings?.statusCleanupBatchLimit ?? STATUS_CLEANUP_BATCH_LIMIT,
      statusContextKeepPerThread: startupSettings?.statusContextKeepPerThread ?? 24,
      groupContextKeepPerThread: startupSettings?.groupContextKeepPerThread ?? 24,
      contextCompactionIntervalMinutes: Math.round(
        (startupSettings?.contextCompactionIntervalMs ?? CONTEXT_COMPACTION_INTERVAL_MS) / 60_000,
      ),
      contextCompactionMaxThreads: startupSettings?.contextCompactionMaxThreads ?? CONTEXT_COMPACTION_MAX_THREADS,
      contextCompactionMaxDeletes: startupSettings?.contextCompactionMaxDeletes ?? CONTEXT_COMPACTION_MAX_DELETES,
      compactContextGroupJidsConfigured: startupSettings?.compactContextGroupJids?.length || 0,
      autoMarkReadEnabled: resolveAutoMarkReadEnabled(startupSettings),
      autoMarkReadGroups: resolveAutoMarkReadGroupsEnabled(startupSettings),
      autoMarkReadStatus: resolveAutoMarkReadStatusEnabled(startupSettings),
      presenceSubscribeEnabled: resolvePresenceSubscribeEnabled(startupSettings),
      chatModifyQuietHoursEnabled: resolveChatModifyQuietHoursEnabled(startupSettings),
      aboutAutomationEnabled: resolveAboutAutomationEnabled(startupSettings),
      aboutAutomationIntervalMinutes: Math.round(resolveAboutAutomationIntervalMs(startupSettings) / 60_000),
    },
    "Social Life Manager worker started",
  );
}

void run().catch((error) => {
  releaseWorkerLockSync("whatsapp");
  logger.error({ err: error }, "Worker crashed");
  process.exit(1);
});
