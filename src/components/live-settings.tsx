"use client";

import { ActionNotices } from "@/components/action-notices";
import { SearchableSelect } from "@/components/app-ui";
import { EmptyState } from "@/components/empty-state";
import { LiveRules } from "@/components/live-rules";
import { LiveStyleLab } from "@/components/live-style-lab";
import { LoadingBlock } from "@/components/loading-state";
import { SetupWizard } from "@/components/setup-wizard";
import { useTenantScopeArgs } from "@/components/tenant-scope-provider";
import { useActionStateRegistry } from "@/lib/ui/action-state";
import { formatDateTime } from "@/lib/format";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

type SettingsState = {
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
  aiDeterministicModes: string[];
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
  activePersonaPackIdsByProfile?: Record<string, string>;
  qualityGateMode: "auto_rewrite_once" | "manual_review" | "log_only";
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
  voiceNotesAutoEnabled: boolean;
  voiceNotesAutoProbability: number;
  voiceNotesAutoMaxPerThreadPerDay: number;
  voiceNotesAutoNeedKeywords: string[];
  romanticPartnerJids: string[];
  romanticMorningEnabled: boolean;
  romanticMorningStartHour: number;
  romanticMorningEndHour: number;
  romanticMorningLeadRatio: number;
  romanticMorningCollisionCooldownHours: number;
  romanticMorningMaxPerThreadPerDay: number;
  instagramDmDelayMinMs: number;
  instagramDmDelayMaxMs: number;
  instagramTypingMinMs: number;
  instagramTypingMaxMs: number;
  instagramSendRateWindowMinutes: number;
  instagramSendMaxPerThreadInWindow: number;
  instagramSendMaxGlobalInWindow: number;
  instagramStoryCadenceHours: number;
  instagramStoryDailyMaxPosts: number;
  outreachEnabled: boolean;
  outreachCadenceHours: number;
  outreachMaxContactsPerRun: number;
  outreachContactJids: string[];
  outreachStarterTemplate: string;
  conversationIntelligenceEnabled: boolean;
  checkInRecencyTargetDays: number;
  topicDyingAckStreakThreshold: number;
  topicLaneMaxActive: number;
  pivotReplyEnabled: boolean;
  antiDwellingEnabled: boolean;
  antiDwellingEndgameCloseCooldownMinutes: number;
  antiDwellingTopicTurnSoftLimit: number;
  antiDwellingTopicTurnHardLimit: number;
  topicLeadPivotEnabled: boolean;
  topicLeadPivotMinVibeScore: number;
  topicLeadPivotCooldownMinutes: number;
  statusBuilderEnabled: boolean;
  statusBuilderCadenceHours: number;
  statusBuilderDailyMaxPosts: number;
  statusBuilderTextPostRatio: number;
  statusBuilderReviewRatio: number;
  statusPostAudienceMode: "whatsapp_privacy" | "manual_allowlist";
  statusBuilderAudienceJids: string[];
  statusBuilderAudienceSampleSize: number;
};

type KnownContact = {
  _id: string;
  provider?: "whatsapp" | "instagram" | "imessage" | "telegram";
  jid: string;
  title?: string;
};

type PersonalityProfile = {
  slug: string;
  name: string;
  description: string;
  prompt: string;
  defaultIntensity: number;
  isDefault?: boolean;
  updatedAt?: number;
};

type PersonalityProfileVersion = {
  _id: string;
  profileSlug: string;
  versionNumber: number;
  name: string;
  description: string;
  prompt: string;
  defaultIntensity: number;
  reason?: string;
  createdAt: number;
};

type PersonaPacksPayload = {
  activePersonaPackId: string;
  activePersonaPackIdsByProfile?: Record<string, string>;
  qualityGateMode: "auto_rewrite_once" | "manual_review" | "log_only";
  qualityGateThreshold: number;
  packs: Array<{
    id: string;
    name: string;
    version: string;
    description: string;
    allowedProfileSlugs: string[];
    activeForProfileSlugs?: string[];
    isLegacyActive?: boolean;
    cohorts?: string[];
    scenarioCount?: number;
  }>;
};

type ProfileEditorFormProps = {
  profile: PersonalityProfile;
  pending: boolean;
  error?: string;
  onSave: (values: {
    slug: string;
    name: string;
    description: string;
    prompt: string;
    defaultIntensity: number;
  }) => void;
};

type MediaAsset = {
  _id: string;
  kind: "sticker" | "meme" | "image" | "video" | "audio" | "document";
  label: string;
  tags: string[];
  enabled: boolean;
  fileUrl?: string | null;
  contentHash?: string;
  createdAt?: number;
  contextSummary?: string;
  contextTags?: string[];
  contextTriggers?: string[];
  contextAvoid?: string[];
  contextConfidence?: number;
  contextUpdatedAt?: number;
};

type MergeSuggestion = {
  key: string;
  kind: "sticker" | "meme";
  sourceAssetId: string;
  sourceLabel: string;
  targetAssetId: string;
  targetLabel: string;
  score: number;
  similaritySource: "visual_hash" | "content_hash";
  distanceBits?: number;
  groupKey: string;
  groupLabel: string;
};

type SetupState = {
  status?:
    | "idle"
    | "starting"
    | "authenticating"
    | "qr_ready"
    | "code_ready"
    | "challenge_required"
    | "connecting"
    | "syncing"
    | "connected"
    | "error";
  hasAuth?: boolean;
  listenerActive?: boolean;
  message?: string;
  listenerMessage?: string;
  updatedAt?: number;
};

type SettingsTab = "runtime" | "automation" | "connections" | "voice" | "personality" | "media" | "style" | "rules";

const SETTINGS_TABS: Array<{ id: SettingsTab; label: string }> = [
  { id: "runtime", label: "AI Runtime" },
  { id: "automation", label: "Automation" },
  { id: "connections", label: "Connections" },
  { id: "voice", label: "Voice" },
  { id: "personality", label: "Personality" },
  { id: "media", label: "Media" },
  { id: "style", label: "Style" },
  { id: "rules", label: "Rules" },
];
const SETTINGS_TAB_SUMMARIES: Record<SettingsTab, string> = {
  runtime: "Model, reply limits, and quality checks.",
  automation: "Quiet hours, pacing, outreach, and posting.",
  connections: "Messaging account sessions and workers.",
  voice: "Voice sample and local Vox generation.",
  personality: "Tone profiles used across conversations.",
  media: "Stickers, memes, uploads, and cleanup.",
  style: "Voice matching, learned traits, and packs.",
  rules: "Ignored contacts, groups, and boundaries.",
};
const SETTINGS_TAB_KEYWORDS: Record<SettingsTab, string[]> = {
  runtime: ["ai", "temperature", "tokens", "confidence", "quality gate", "reply", "instruction", "runtime"],
  automation: [
    "quiet",
    "outreach",
    "status",
    "instagram",
    "romantic",
    "pacing",
    "rate",
    "automation",
    "check in",
    "conversation",
    "anti dwelling",
    "pivot",
    "topic",
    "voice note",
    "voice",
    "voxcpm",
  ],
  connections: [
    "connection",
    "connect",
    "disconnect",
    "whatsapp",
    "instagram",
    "imessage",
    "telegram",
    "pair",
    "pairing",
    "qr",
    "session",
    "credentials",
    "account",
  ],
  voice: ["voice", "voice note", "sample", "record", "microphone", "vox", "voxcpm", "local"],
  personality: ["profile", "persona", "intensity", "prompt", "tone", "personality"],
  media: ["media", "meme", "sticker", "asset", "merge", "context", "library"],
  style: ["style", "mimicry", "learned", "traits", "phrase", "persona pack", "rollback", "voice"],
  rules: ["rules", "ignore", "ignored", "contact", "group", "boundaries", "jid"],
};
const SETTINGS_TAB_FIELDS: Record<SettingsTab, Array<keyof SettingsState>> = {
  runtime: [
    "aiFallbackMode",
    "aiModelFirstEnabled",
    "aiDeterministicModes",
    "aiAckRoutingEnabled",
    "aiTemperature",
    "aiMaxOutputTokens",
    "aiMaxReplyChars",
    "aiHistoryLineLimit",
    "aiPrimaryConfidence",
    "aiFallbackConfidence",
    "aiReplyPolicy",
    "aiSystemInstruction",
    "activePersonaPackId",
    "qualityGateMode",
    "qualityGateThreshold",
  ],
  connections: [],
  voice: [],
  automation: [
    "ignoreGroupsByDefault",
    "reactionsEnabled",
    "stickersEnabled",
    "memesEnabled",
    "generatedMemesEnabled",
    "generatedMemesAutoSendEnabled",
    "memeThreadCooldownMs",
    "memeSendProbability",
    "soulModeEnabled",
    "humorLearningEnabled",
    "selfRoastModeEnabled",
    "statusAutoReplyEnabled",
    "statusReplyRequireFunny",
    "captureGroupMediaEnabled",
    "funnyStatusKeywords",
    "funnyStatusEmojis",
    "humanDelayMinMs",
    "humanDelayMaxMs",
    "humanTypingMinMs",
    "humanTypingMaxMs",
    "outboxClaimLimit",
    "outboxPollMs",
    "inboundMergeWindowMs",
    "manualInterventionCooldownMs",
    "inboundConcurrency",
    "outboxSendConcurrency",
    "statusRetentionMs",
    "statusCleanupIntervalMs",
    "statusCleanupBatchLimit",
    "statusContextKeepPerThread",
    "groupContextKeepPerThread",
    "contextCompactionIntervalMs",
    "contextCompactionMaxThreads",
    "contextCompactionMaxDeletes",
    "compactContextGroupJids",
    "quietHoursEnabled",
    "quietHoursStartHour",
    "quietHoursEndHour",
    "autoMarkReadEnabled",
    "autoMarkReadGroups",
    "autoMarkReadStatus",
    "presenceSubscribeEnabled",
    "chatModifyQuietHoursEnabled",
    "aboutAutomationEnabled",
    "aboutAutomationIntervalMinutes",
    "aboutAutomationTemplate",
    "sendRateWindowMinutes",
    "sendMaxPerThreadInWindow",
    "sendMaxGlobalInWindow",
    "voiceNotesAutoEnabled",
    "voiceNotesAutoProbability",
    "voiceNotesAutoMaxPerThreadPerDay",
    "voiceNotesAutoNeedKeywords",
    "romanticPartnerJids",
    "romanticMorningEnabled",
    "romanticMorningStartHour",
    "romanticMorningEndHour",
    "romanticMorningLeadRatio",
    "romanticMorningCollisionCooldownHours",
    "romanticMorningMaxPerThreadPerDay",
    "instagramDmDelayMinMs",
    "instagramDmDelayMaxMs",
    "instagramTypingMinMs",
    "instagramTypingMaxMs",
    "instagramSendRateWindowMinutes",
    "instagramSendMaxPerThreadInWindow",
    "instagramSendMaxGlobalInWindow",
    "instagramStoryCadenceHours",
    "instagramStoryDailyMaxPosts",
    "outreachEnabled",
    "outreachCadenceHours",
    "outreachMaxContactsPerRun",
    "outreachContactJids",
    "outreachStarterTemplate",
    "conversationIntelligenceEnabled",
    "checkInRecencyTargetDays",
    "topicDyingAckStreakThreshold",
    "topicLaneMaxActive",
    "pivotReplyEnabled",
    "antiDwellingEnabled",
    "antiDwellingEndgameCloseCooldownMinutes",
    "antiDwellingTopicTurnSoftLimit",
    "antiDwellingTopicTurnHardLimit",
    "topicLeadPivotEnabled",
    "topicLeadPivotMinVibeScore",
    "topicLeadPivotCooldownMinutes",
    "statusBuilderEnabled",
    "statusBuilderCadenceHours",
    "statusBuilderDailyMaxPosts",
    "statusBuilderTextPostRatio",
    "statusBuilderReviewRatio",
    "statusPostAudienceMode",
    "statusBuilderAudienceJids",
    "statusBuilderAudienceSampleSize",
  ],
  personality: [],
  media: [],
  style: [],
  rules: [],
};
const SETTINGS_SEARCH_STORAGE_KEY = "slm.settings.search";

function fieldValueChanged<T extends keyof SettingsState>(field: T, draft: SettingsState, remote: SettingsState) {
  return JSON.stringify(draft[field]) !== JSON.stringify(remote[field]);
}

function isSettingsTab(value: string | null): value is SettingsTab {
  return SETTINGS_TABS.some((tab) => tab.id === value);
}

const STATUS_BUILDER_MAX_TEXT_POST_RATIO = 0.45;
const HEX_CHAR_TO_INT: Record<string, number> = {
  "0": 0,
  "1": 1,
  "2": 2,
  "3": 3,
  "4": 4,
  "5": 5,
  "6": 6,
  "7": 7,
  "8": 8,
  "9": 9,
  a: 10,
  b: 11,
  c: 12,
  d: 13,
  e: 14,
  f: 15,
};
const BIT_COUNTS = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];

function toState(source: Partial<SettingsState> | undefined): SettingsState {
  return {
    ignoreGroupsByDefault: source?.ignoreGroupsByDefault ?? true,
    reactionsEnabled: source?.reactionsEnabled ?? true,
    stickersEnabled: source?.stickersEnabled ?? true,
    memesEnabled: source?.memesEnabled ?? true,
    generatedMemesEnabled: source?.generatedMemesEnabled ?? true,
    generatedMemesAutoSendEnabled: source?.generatedMemesAutoSendEnabled ?? false,
    memeThreadCooldownMs: source?.memeThreadCooldownMs ?? 150 * 60 * 1000,
    memeSendProbability: source?.memeSendProbability ?? 0.3,
    soulModeEnabled: source?.soulModeEnabled ?? true,
    humorLearningEnabled: source?.humorLearningEnabled ?? true,
    selfRoastModeEnabled: source?.selfRoastModeEnabled ?? false,
    statusAutoReplyEnabled: source?.statusAutoReplyEnabled ?? true,
    statusReplyRequireFunny: source?.statusReplyRequireFunny ?? true,
    captureGroupMediaEnabled: source?.captureGroupMediaEnabled ?? false,
    funnyStatusKeywords:
      source?.funnyStatusKeywords ?? ["lol", "lmao", "haha", "funny", "joke", "banter", "meme", "roast"],
    funnyStatusEmojis: source?.funnyStatusEmojis ?? ["😂", "🤣", "😹", "😆", "😅", "😄", "😁", "😜", "🤪", "🙃"],
    aiFallbackMode: source?.aiFallbackMode ?? "all",
    aiModelFirstEnabled: source?.aiModelFirstEnabled ?? false,
    aiDeterministicModes: source?.aiDeterministicModes ?? ["hard_stop", "anti_beggi_beggi", "anti_sales_pitch"],
    aiAckRoutingEnabled: source?.aiAckRoutingEnabled ?? false,
    aiTemperature: source?.aiTemperature ?? 0.7,
    aiMaxOutputTokens: source?.aiMaxOutputTokens ?? 140,
    aiMaxReplyChars: source?.aiMaxReplyChars ?? 320,
    aiHistoryLineLimit: source?.aiHistoryLineLimit ?? 12,
    aiPrimaryConfidence: source?.aiPrimaryConfidence ?? 0.78,
    aiFallbackConfidence: source?.aiFallbackConfidence ?? 0.58,
    aiReplyPolicy: source?.aiReplyPolicy ?? "",
    aiSystemInstruction: source?.aiSystemInstruction ?? "",
    activePersonaPackId: source?.activePersonaPackId ?? "",
    activePersonaPackIdsByProfile: source?.activePersonaPackIdsByProfile ?? {},
    qualityGateMode: source?.qualityGateMode ?? "auto_rewrite_once",
    qualityGateThreshold: source?.qualityGateThreshold ?? 0.76,
    humanDelayMinMs: source?.humanDelayMinMs ?? 22000,
    humanDelayMaxMs: source?.humanDelayMaxMs ?? 95000,
    humanTypingMinMs: source?.humanTypingMinMs ?? 4000,
    humanTypingMaxMs: source?.humanTypingMaxMs ?? 14000,
    outboxClaimLimit: source?.outboxClaimLimit ?? 8,
    outboxPollMs: source?.outboxPollMs ?? 3000,
    inboundMergeWindowMs: source?.inboundMergeWindowMs ?? 45000,
    manualInterventionCooldownMs: source?.manualInterventionCooldownMs ?? 90_000,
    inboundConcurrency: source?.inboundConcurrency ?? 4,
    outboxSendConcurrency: source?.outboxSendConcurrency ?? 4,
    statusRetentionMs: source?.statusRetentionMs ?? 40 * 60 * 1000,
    statusCleanupIntervalMs: source?.statusCleanupIntervalMs ?? 40 * 60 * 1000,
    statusCleanupBatchLimit: source?.statusCleanupBatchLimit ?? 160,
    statusContextKeepPerThread: source?.statusContextKeepPerThread ?? 24,
    groupContextKeepPerThread: source?.groupContextKeepPerThread ?? 24,
    contextCompactionIntervalMs: source?.contextCompactionIntervalMs ?? 12 * 60 * 1000,
    contextCompactionMaxThreads: source?.contextCompactionMaxThreads ?? 24,
    contextCompactionMaxDeletes: source?.contextCompactionMaxDeletes ?? 260,
    compactContextGroupJids: source?.compactContextGroupJids ?? [],
    quietHoursEnabled: source?.quietHoursEnabled ?? false,
    quietHoursStartHour: source?.quietHoursStartHour ?? 23,
    quietHoursEndHour: source?.quietHoursEndHour ?? 7,
    autoMarkReadEnabled: source?.autoMarkReadEnabled ?? true,
    autoMarkReadGroups: source?.autoMarkReadGroups ?? false,
    autoMarkReadStatus: source?.autoMarkReadStatus ?? false,
    presenceSubscribeEnabled: source?.presenceSubscribeEnabled ?? true,
    chatModifyQuietHoursEnabled: source?.chatModifyQuietHoursEnabled ?? false,
    aboutAutomationEnabled: source?.aboutAutomationEnabled ?? false,
    aboutAutomationIntervalMinutes: source?.aboutAutomationIntervalMinutes ?? 360,
    aboutAutomationTemplate: source?.aboutAutomationTemplate ?? "",
    sendRateWindowMinutes: source?.sendRateWindowMinutes ?? 60,
    sendMaxPerThreadInWindow: source?.sendMaxPerThreadInWindow ?? 4,
    sendMaxGlobalInWindow: source?.sendMaxGlobalInWindow ?? 40,
    voiceNotesAutoEnabled: source?.voiceNotesAutoEnabled ?? false,
    voiceNotesAutoProbability: source?.voiceNotesAutoProbability ?? 0.35,
    voiceNotesAutoMaxPerThreadPerDay: source?.voiceNotesAutoMaxPerThreadPerDay ?? 1,
    voiceNotesAutoNeedKeywords:
      source?.voiceNotesAutoNeedKeywords ??
      ["voice note", "voice", "call", "explain", "walk you through", "hear me out", "quick update", "sorry", "miss you", "love you"],
    romanticPartnerJids: source?.romanticPartnerJids ?? [],
    romanticMorningEnabled: source?.romanticMorningEnabled ?? true,
    romanticMorningStartHour: source?.romanticMorningStartHour ?? 6,
    romanticMorningEndHour: source?.romanticMorningEndHour ?? 10,
    romanticMorningLeadRatio: source?.romanticMorningLeadRatio ?? 0.7,
    romanticMorningCollisionCooldownHours: source?.romanticMorningCollisionCooldownHours ?? 6,
    romanticMorningMaxPerThreadPerDay: source?.romanticMorningMaxPerThreadPerDay ?? 1,
    instagramDmDelayMinMs: source?.instagramDmDelayMinMs ?? 16000,
    instagramDmDelayMaxMs: source?.instagramDmDelayMaxMs ?? 75000,
    instagramTypingMinMs: source?.instagramTypingMinMs ?? 3000,
    instagramTypingMaxMs: source?.instagramTypingMaxMs ?? 11000,
    instagramSendRateWindowMinutes: source?.instagramSendRateWindowMinutes ?? 60,
    instagramSendMaxPerThreadInWindow: source?.instagramSendMaxPerThreadInWindow ?? 4,
    instagramSendMaxGlobalInWindow: source?.instagramSendMaxGlobalInWindow ?? 40,
    instagramStoryCadenceHours: source?.instagramStoryCadenceHours ?? 3,
    instagramStoryDailyMaxPosts: source?.instagramStoryDailyMaxPosts ?? 6,
    outreachEnabled: source?.outreachEnabled ?? false,
    outreachCadenceHours: source?.outreachCadenceHours ?? 36,
    outreachMaxContactsPerRun: source?.outreachMaxContactsPerRun ?? 3,
    outreachContactJids: source?.outreachContactJids ?? [],
    outreachStarterTemplate: source?.outreachStarterTemplate ?? "Hey {{name}}, checking in on you today.",
    conversationIntelligenceEnabled: source?.conversationIntelligenceEnabled ?? true,
    checkInRecencyTargetDays: source?.checkInRecencyTargetDays ?? 7,
    topicDyingAckStreakThreshold: source?.topicDyingAckStreakThreshold ?? 3,
    topicLaneMaxActive: source?.topicLaneMaxActive ?? 4,
    pivotReplyEnabled: source?.pivotReplyEnabled ?? true,
    antiDwellingEnabled: source?.antiDwellingEnabled ?? true,
    antiDwellingEndgameCloseCooldownMinutes: source?.antiDwellingEndgameCloseCooldownMinutes ?? 45,
    antiDwellingTopicTurnSoftLimit: source?.antiDwellingTopicTurnSoftLimit ?? 6,
    antiDwellingTopicTurnHardLimit: source?.antiDwellingTopicTurnHardLimit ?? 10,
    topicLeadPivotEnabled: source?.topicLeadPivotEnabled ?? true,
    topicLeadPivotMinVibeScore: source?.topicLeadPivotMinVibeScore ?? 0.6,
    topicLeadPivotCooldownMinutes: source?.topicLeadPivotCooldownMinutes ?? 180,
    statusBuilderEnabled: source?.statusBuilderEnabled ?? true,
    statusBuilderCadenceHours: source?.statusBuilderCadenceHours ?? 2,
    statusBuilderDailyMaxPosts: source?.statusBuilderDailyMaxPosts ?? 10,
    statusBuilderTextPostRatio: Math.min(source?.statusBuilderTextPostRatio ?? 0.25, STATUS_BUILDER_MAX_TEXT_POST_RATIO),
    statusBuilderReviewRatio: source?.statusBuilderReviewRatio ?? 0.35,
    statusPostAudienceMode: source?.statusPostAudienceMode === "manual_allowlist" ? "manual_allowlist" : "whatsapp_privacy",
    statusBuilderAudienceJids: source?.statusBuilderAudienceJids ?? [],
    statusBuilderAudienceSampleSize: source?.statusBuilderAudienceSampleSize ?? 80,
  };
}

function nearlyEqual(a: number, b: number) {
  return Math.abs(a - b) < 0.00001;
}

function stateEquals(a: SettingsState, b: SettingsState) {
  return (
    a.ignoreGroupsByDefault === b.ignoreGroupsByDefault &&
    a.reactionsEnabled === b.reactionsEnabled &&
    a.stickersEnabled === b.stickersEnabled &&
    a.memesEnabled === b.memesEnabled &&
    a.generatedMemesEnabled === b.generatedMemesEnabled &&
    a.generatedMemesAutoSendEnabled === b.generatedMemesAutoSendEnabled &&
    nearlyEqual(a.memeThreadCooldownMs, b.memeThreadCooldownMs) &&
    nearlyEqual(a.memeSendProbability, b.memeSendProbability) &&
    a.soulModeEnabled === b.soulModeEnabled &&
    a.humorLearningEnabled === b.humorLearningEnabled &&
    a.selfRoastModeEnabled === b.selfRoastModeEnabled &&
    a.statusAutoReplyEnabled === b.statusAutoReplyEnabled &&
    a.statusReplyRequireFunny === b.statusReplyRequireFunny &&
    a.captureGroupMediaEnabled === b.captureGroupMediaEnabled &&
    a.funnyStatusKeywords.join("\n") === b.funnyStatusKeywords.join("\n") &&
    a.funnyStatusEmojis.join("\n") === b.funnyStatusEmojis.join("\n") &&
    a.aiFallbackMode === b.aiFallbackMode &&
    a.aiModelFirstEnabled === b.aiModelFirstEnabled &&
    a.aiDeterministicModes.join("\n") === b.aiDeterministicModes.join("\n") &&
    a.aiAckRoutingEnabled === b.aiAckRoutingEnabled &&
    nearlyEqual(a.aiTemperature, b.aiTemperature) &&
    nearlyEqual(a.aiMaxOutputTokens, b.aiMaxOutputTokens) &&
    nearlyEqual(a.aiMaxReplyChars, b.aiMaxReplyChars) &&
    nearlyEqual(a.aiHistoryLineLimit, b.aiHistoryLineLimit) &&
    nearlyEqual(a.aiPrimaryConfidence, b.aiPrimaryConfidence) &&
    nearlyEqual(a.aiFallbackConfidence, b.aiFallbackConfidence) &&
    a.aiReplyPolicy === b.aiReplyPolicy &&
    a.aiSystemInstruction === b.aiSystemInstruction &&
    a.activePersonaPackId === b.activePersonaPackId &&
    JSON.stringify(a.activePersonaPackIdsByProfile || {}) === JSON.stringify(b.activePersonaPackIdsByProfile || {}) &&
    a.qualityGateMode === b.qualityGateMode &&
    nearlyEqual(a.qualityGateThreshold, b.qualityGateThreshold) &&
    nearlyEqual(a.humanDelayMinMs, b.humanDelayMinMs) &&
    nearlyEqual(a.humanDelayMaxMs, b.humanDelayMaxMs) &&
    nearlyEqual(a.humanTypingMinMs, b.humanTypingMinMs) &&
    nearlyEqual(a.humanTypingMaxMs, b.humanTypingMaxMs) &&
    nearlyEqual(a.outboxClaimLimit, b.outboxClaimLimit) &&
    nearlyEqual(a.outboxPollMs, b.outboxPollMs) &&
    nearlyEqual(a.inboundMergeWindowMs, b.inboundMergeWindowMs) &&
    nearlyEqual(a.manualInterventionCooldownMs, b.manualInterventionCooldownMs) &&
    nearlyEqual(a.inboundConcurrency, b.inboundConcurrency) &&
    nearlyEqual(a.outboxSendConcurrency, b.outboxSendConcurrency) &&
    nearlyEqual(a.statusRetentionMs, b.statusRetentionMs) &&
    nearlyEqual(a.statusCleanupIntervalMs, b.statusCleanupIntervalMs) &&
    nearlyEqual(a.statusCleanupBatchLimit, b.statusCleanupBatchLimit) &&
    nearlyEqual(a.statusContextKeepPerThread, b.statusContextKeepPerThread) &&
    nearlyEqual(a.groupContextKeepPerThread, b.groupContextKeepPerThread) &&
    nearlyEqual(a.contextCompactionIntervalMs, b.contextCompactionIntervalMs) &&
    nearlyEqual(a.contextCompactionMaxThreads, b.contextCompactionMaxThreads) &&
    nearlyEqual(a.contextCompactionMaxDeletes, b.contextCompactionMaxDeletes) &&
    a.compactContextGroupJids.join("\n") === b.compactContextGroupJids.join("\n") &&
    a.quietHoursEnabled === b.quietHoursEnabled &&
    nearlyEqual(a.quietHoursStartHour, b.quietHoursStartHour) &&
    nearlyEqual(a.quietHoursEndHour, b.quietHoursEndHour) &&
    a.autoMarkReadEnabled === b.autoMarkReadEnabled &&
    a.autoMarkReadGroups === b.autoMarkReadGroups &&
    a.autoMarkReadStatus === b.autoMarkReadStatus &&
    a.presenceSubscribeEnabled === b.presenceSubscribeEnabled &&
    a.chatModifyQuietHoursEnabled === b.chatModifyQuietHoursEnabled &&
    a.aboutAutomationEnabled === b.aboutAutomationEnabled &&
    nearlyEqual(a.aboutAutomationIntervalMinutes, b.aboutAutomationIntervalMinutes) &&
    a.aboutAutomationTemplate === b.aboutAutomationTemplate &&
    nearlyEqual(a.sendRateWindowMinutes, b.sendRateWindowMinutes) &&
    nearlyEqual(a.sendMaxPerThreadInWindow, b.sendMaxPerThreadInWindow) &&
    nearlyEqual(a.sendMaxGlobalInWindow, b.sendMaxGlobalInWindow) &&
    a.voiceNotesAutoEnabled === b.voiceNotesAutoEnabled &&
    nearlyEqual(a.voiceNotesAutoProbability, b.voiceNotesAutoProbability) &&
    nearlyEqual(a.voiceNotesAutoMaxPerThreadPerDay, b.voiceNotesAutoMaxPerThreadPerDay) &&
    a.voiceNotesAutoNeedKeywords.join("\n") === b.voiceNotesAutoNeedKeywords.join("\n") &&
    a.romanticPartnerJids.join("\n") === b.romanticPartnerJids.join("\n") &&
    a.romanticMorningEnabled === b.romanticMorningEnabled &&
    nearlyEqual(a.romanticMorningStartHour, b.romanticMorningStartHour) &&
    nearlyEqual(a.romanticMorningEndHour, b.romanticMorningEndHour) &&
    nearlyEqual(a.romanticMorningLeadRatio, b.romanticMorningLeadRatio) &&
    nearlyEqual(a.romanticMorningCollisionCooldownHours, b.romanticMorningCollisionCooldownHours) &&
    nearlyEqual(a.romanticMorningMaxPerThreadPerDay, b.romanticMorningMaxPerThreadPerDay) &&
    nearlyEqual(a.instagramDmDelayMinMs, b.instagramDmDelayMinMs) &&
    nearlyEqual(a.instagramDmDelayMaxMs, b.instagramDmDelayMaxMs) &&
    nearlyEqual(a.instagramTypingMinMs, b.instagramTypingMinMs) &&
    nearlyEqual(a.instagramTypingMaxMs, b.instagramTypingMaxMs) &&
    nearlyEqual(a.instagramSendRateWindowMinutes, b.instagramSendRateWindowMinutes) &&
    nearlyEqual(a.instagramSendMaxPerThreadInWindow, b.instagramSendMaxPerThreadInWindow) &&
    nearlyEqual(a.instagramSendMaxGlobalInWindow, b.instagramSendMaxGlobalInWindow) &&
    nearlyEqual(a.instagramStoryCadenceHours, b.instagramStoryCadenceHours) &&
    nearlyEqual(a.instagramStoryDailyMaxPosts, b.instagramStoryDailyMaxPosts) &&
    a.outreachEnabled === b.outreachEnabled &&
    nearlyEqual(a.outreachCadenceHours, b.outreachCadenceHours) &&
    nearlyEqual(a.outreachMaxContactsPerRun, b.outreachMaxContactsPerRun) &&
    a.outreachStarterTemplate === b.outreachStarterTemplate &&
    a.outreachContactJids.join("\n") === b.outreachContactJids.join("\n") &&
    a.conversationIntelligenceEnabled === b.conversationIntelligenceEnabled &&
    nearlyEqual(a.checkInRecencyTargetDays, b.checkInRecencyTargetDays) &&
    nearlyEqual(a.topicDyingAckStreakThreshold, b.topicDyingAckStreakThreshold) &&
    nearlyEqual(a.topicLaneMaxActive, b.topicLaneMaxActive) &&
    a.pivotReplyEnabled === b.pivotReplyEnabled &&
    a.antiDwellingEnabled === b.antiDwellingEnabled &&
    nearlyEqual(a.antiDwellingEndgameCloseCooldownMinutes, b.antiDwellingEndgameCloseCooldownMinutes) &&
    nearlyEqual(a.antiDwellingTopicTurnSoftLimit, b.antiDwellingTopicTurnSoftLimit) &&
    nearlyEqual(a.antiDwellingTopicTurnHardLimit, b.antiDwellingTopicTurnHardLimit) &&
    a.topicLeadPivotEnabled === b.topicLeadPivotEnabled &&
    nearlyEqual(a.topicLeadPivotMinVibeScore, b.topicLeadPivotMinVibeScore) &&
    nearlyEqual(a.topicLeadPivotCooldownMinutes, b.topicLeadPivotCooldownMinutes) &&
    a.statusBuilderEnabled === b.statusBuilderEnabled &&
    nearlyEqual(a.statusBuilderCadenceHours, b.statusBuilderCadenceHours) &&
    nearlyEqual(a.statusBuilderDailyMaxPosts, b.statusBuilderDailyMaxPosts) &&
    nearlyEqual(a.statusBuilderTextPostRatio, b.statusBuilderTextPostRatio) &&
    nearlyEqual(a.statusBuilderReviewRatio, b.statusBuilderReviewRatio) &&
    a.statusPostAudienceMode === b.statusPostAudienceMode &&
    a.statusBuilderAudienceJids.join("\n") === b.statusBuilderAudienceJids.join("\n") &&
    nearlyEqual(a.statusBuilderAudienceSampleSize, b.statusBuilderAudienceSampleSize)
  );
}

function parseNumber(value: string, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseContactJids(value: string) {
  return [
    ...new Set(
      value
        .split(/[\n,]/)
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
}

function normalizeContactJid(value: string) {
  return value.trim().toLowerCase();
}

function contactFallbackName(jid: string) {
  const normalized = normalizeContactJid(jid);
  if (normalized === "status@broadcast") {
    return "WhatsApp Status";
  }
  if (normalized === "ig:story:broadcast") {
    return "Instagram Story";
  }
  const local = normalized.split("@")[0] || normalized;
  if (/^\d+$/.test(local)) {
    return `+${local}`;
  }
  return local.replace(/[-_.]+/g, " ");
}

function contactDisplayName(contact?: KnownContact | null, jid?: string) {
  const title = contact?.title?.trim();
  if (title) {
    return title;
  }
  return contactFallbackName(contact?.jid || jid || "");
}

function RecipientPickerField({
  label,
  helper,
  contacts,
  selectedJids,
  disabled,
  contactsLoading,
  addPlaceholder = "Add from previous contacts",
  inputPlaceholder = "Paste one or more contacts",
  emptyLabel = "No contacts selected.",
  contactFilter,
  onAdd,
  onRemove,
}: {
  label: string;
  helper?: string;
  contacts: KnownContact[];
  selectedJids: string[];
  disabled?: boolean;
  contactsLoading?: boolean;
  addPlaceholder?: string;
  inputPlaceholder?: string;
  emptyLabel?: string;
  contactFilter?: (contact: KnownContact) => boolean;
  onAdd: (jid: string) => void;
  onRemove: (jid: string) => void;
}) {
  const [manualInput, setManualInput] = useState("");
  const selectedSet = useMemo(() => new Set(selectedJids.map(normalizeContactJid)), [selectedJids]);
  const contactsByJid = useMemo(() => {
    const map = new Map<string, KnownContact>();
    for (const contact of contacts) {
      map.set(normalizeContactJid(contact.jid), contact);
    }
    return map;
  }, [contacts]);
  const availableContacts = useMemo(
    () =>
      contacts
        .filter((contact) => (contactFilter ? contactFilter(contact) : true))
        .filter((contact) => !selectedSet.has(normalizeContactJid(contact.jid)))
        .sort((a, b) => contactDisplayName(a).localeCompare(contactDisplayName(b))),
    [contactFilter, contacts, selectedSet],
  );

  const commitManualInput = () => {
    const values = parseContactJids(manualInput);
    if (values.length === 0) {
      return;
    }
    values.forEach(onAdd);
    setManualInput("");
  };

  return (
    <div className="stack compact recipient-picker-field">
      <span className="queue-meta">{label}</span>
      <SearchableSelect
        value=""
        onChange={(event) => {
          if (!event.target.value) {
            return;
          }
          onAdd(event.target.value);
        }}
        disabled={disabled || contactsLoading}
        aria-disabled={disabled || contactsLoading}
      >
        <option value="">{contactsLoading ? "Loading contacts..." : addPlaceholder}</option>
        {availableContacts.map((contact) => (
          <option key={contact._id} value={contact.jid}>
            {contactDisplayName(contact)}
          </option>
        ))}
      </SearchableSelect>

      <div className="recipient-manual-row">
        <input
          type="text"
          value={manualInput}
          onChange={(event) => setManualInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") {
              return;
            }
            event.preventDefault();
            commitManualInput();
          }}
          placeholder={inputPlaceholder}
          disabled={disabled}
          aria-disabled={disabled}
        />
        <button
          type="button"
          className="btn btn-ghost"
          onClick={commitManualInput}
          disabled={disabled || manualInput.trim().length === 0}
          aria-disabled={disabled || manualInput.trim().length === 0}
        >
          Add
        </button>
      </div>

      {helper ? <span className="queue-meta">{helper}</span> : null}

      {selectedJids.length > 0 ? (
        <div className="recipient-chip-list" aria-label={`${label} selected contacts`}>
          {selectedJids.map((jid) => {
            const normalized = normalizeContactJid(jid);
            const contact = contactsByJid.get(normalized);
            return (
              <span key={jid} className="recipient-chip">
                <span className="recipient-chip-copy">
                  <strong>{contactDisplayName(contact, jid)}</strong>
                  <small>{normalized}</small>
                </span>
                <button
                  type="button"
                  onClick={() => onRemove(jid)}
                  disabled={disabled}
                  aria-disabled={disabled}
                  aria-label={`Remove ${contactDisplayName(contact, jid)}`}
                >
                  ×
                </button>
              </span>
            );
          })}
        </div>
      ) : (
        <p className="queue-meta">{emptyLabel}</p>
      )}
    </div>
  );
}

function parseSimpleList(value: string, lowercase = false) {
  const normalized = value
    .split(/[\n,]/)
    .map((item) => (lowercase ? item.trim().toLowerCase() : item.trim()))
    .filter(Boolean);
  return [...new Set(normalized)];
}

function parseTagInput(input: string) {
  const tags = input
    .split(",")
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean);
  return [...new Set(tags)].slice(0, 20);
}

async function hashFileSha256Hex(file: File) {
  const bytes = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const parts = Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0"));
  return parts.join("");
}

function clamp01(value: number) {
  if (!Number.isFinite(value)) {
    return 0.7;
  }
  return Math.max(0, Math.min(value, 1));
}

function normalizeHexHash(value?: string) {
  const normalized = (value || "").trim().toLowerCase();
  if (!normalized || !/^[0-9a-f]+$/.test(normalized)) {
    return null;
  }
  return normalized;
}

function hammingDistanceHex(a: string, b: string) {
  const length = Math.min(a.length, b.length);
  if (length === 0) {
    return null;
  }
  let distance = 0;
  for (let i = 0; i < length; i += 1) {
    const left = HEX_CHAR_TO_INT[a[i]];
    const right = HEX_CHAR_TO_INT[b[i]];
    if (left === undefined || right === undefined) {
      return null;
    }
    distance += BIT_COUNTS[left ^ right];
  }
  return {
    bits: distance,
    maxBits: length * 4,
  };
}

function buildAverageImageHash(url: string): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 8;
        canvas.height = 8;
        const context = canvas.getContext("2d");
        if (!context) {
          resolve(null);
          return;
        }
        context.drawImage(img, 0, 0, 8, 8);
        const imageData = context.getImageData(0, 0, 8, 8);
        const values: number[] = [];
        for (let i = 0; i < imageData.data.length; i += 4) {
          const r = imageData.data[i];
          const g = imageData.data[i + 1];
          const b = imageData.data[i + 2];
          const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
          values.push(gray);
        }
        const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
        const bits = values.map((value) => (value >= avg ? "1" : "0")).join("");
        const hexParts: string[] = [];
        for (let i = 0; i < bits.length; i += 4) {
          const nibble = bits.slice(i, i + 4);
          hexParts.push(Number.parseInt(nibble, 2).toString(16));
        }
        resolve(hexParts.join(""));
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function pickMergeDirection(a: MediaAsset, b: MediaAsset) {
  const scoreAsset = (asset: MediaAsset) => {
    return (
      (asset.enabled ? 1 : 0) +
      (asset.tags?.length || 0) +
      (asset.contextTags?.length || 0) +
      (asset.contextTriggers?.length || 0) +
      (asset.contextSummary ? 2 : 0)
    );
  };
  const scoreA = scoreAsset(a);
  const scoreB = scoreAsset(b);
  if (scoreA > scoreB) {
    return { source: b, target: a };
  }
  if (scoreB > scoreA) {
    return { source: a, target: b };
  }
  if (a.label.length >= b.label.length) {
    return { source: b, target: a };
  }
  return { source: a, target: b };
}

function ProfileEditorForm({ profile, pending, error, onSave }: ProfileEditorFormProps) {
  const [name, setName] = useState(profile.name);
  const [description, setDescription] = useState(profile.description);
  const [prompt, setPrompt] = useState(profile.prompt);
  const [defaultIntensity, setDefaultIntensity] = useState(clamp01(profile.defaultIntensity));

  const hasChanged = useMemo(() => {
    return (
      name.trim() !== profile.name ||
      description.trim() !== profile.description ||
      prompt.trim() !== profile.prompt ||
      Math.abs(defaultIntensity - clamp01(profile.defaultIntensity)) >= 0.001
    );
  }, [defaultIntensity, description, name, profile.defaultIntensity, profile.description, profile.name, profile.prompt, prompt]);

  return (
    <div className="personality-editor-form">
      <div className="personality-section-head">
        <div>
          <h3>Edit selected profile</h3>
          <p className="queue-meta">These changes affect replies that use this voice.</p>
        </div>
        <span className="personality-inline-badge">{profile.isDefault ? "Default" : "Custom"}</span>
      </div>
      <label className="setup-input-group">
        <span className="queue-meta">Name shown in Settings</span>
        <input type="text" value={name} onChange={(event) => setName(event.target.value)} disabled={pending} aria-disabled={pending} />
      </label>

      <label className="setup-input-group">
        <span className="queue-meta">When to use it</span>
        <input
          type="text"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          disabled={pending}
          aria-disabled={pending}
          placeholder="Warm with family, concise at work, playful with close friends."
        />
      </label>

      <label className="setup-input-group">
        <span className="queue-meta">How replies should sound</span>
        <textarea rows={4} value={prompt} onChange={(event) => setPrompt(event.target.value)} disabled={pending} aria-disabled={pending} />
        <span className="queue-meta">Use plain language: tone, phrases to prefer, and things to avoid.</span>
      </label>

      <label className="setup-input-group">
        <span className="queue-meta">Style strength: {Math.round(defaultIntensity * 100)}%</span>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={defaultIntensity}
          onChange={(event) => setDefaultIntensity(Number(event.target.value))}
          disabled={pending}
          aria-disabled={pending}
        />
        <span className="queue-meta">Lower is subtle. Higher makes this profile more noticeable.</span>
      </label>

      <button
        type="button"
        className="btn btn-primary"
        onClick={() =>
          onSave({
            slug: profile.slug,
            name,
            description,
            prompt,
            defaultIntensity,
          })
        }
        disabled={!hasChanged || pending}
        aria-disabled={!hasChanged || pending}
      >
        {pending ? "Saving..." : "Save profile"}
      </button>

      {error ? (
        <p className="queue-meta action-inline-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function LiveSettings() {
  const tenantScope = useTenantScopeArgs();
  const saveSettings = useMutation(api.settings.save);
  const upsertPersonalityProfile = useMutation(api.personality.upsertProfile);
  const deletePersonalityProfile = useMutation(api.personality.deleteProfile);
  const rollbackProfileVersion = useMutation(api.personality.rollbackProfileVersion);
  const generateUploadUrl = useMutation(api.media.generateUploadUrl);
  const registerAssetIfMissing = useMutation(api.media.registerAssetIfMissing);
  const toggleAsset = useMutation(api.media.toggleAsset);
  const updateAssetMetadata = useMutation(api.media.updateAssetMetadata);
  const mergeMediaAssets = useMutation(api.media.mergeAssets);
  const deleteAsset = useMutation(api.media.deleteAsset);
  const settings = useQuery(api.settings.get, tenantScope) as SettingsState | undefined;
  const defaults = useQuery(api.settings.defaults, {}) as SettingsState | undefined;
  const instagramSetup = useQuery(api.system.setupStatus, { ...tenantScope, provider: "instagram" }) as SetupState | null | undefined;
  const contacts = useQuery(api.threads.listContacts, { ...tenantScope, limit: 300 }) as KnownContact[] | undefined;
  const profilesQuery = useQuery(api.personality.listProfiles, tenantScope) as PersonalityProfile[] | undefined;
  const personaPacks = useQuery(api.personality.listPersonaPacks, tenantScope) as PersonaPacksPayload | undefined;
  const mediaAssets = useQuery(api.media.listAssets, tenantScope) as MediaAsset[] | undefined;
  const curatedMediaAssets = useMemo(
    () => (mediaAssets || []).filter((asset) => asset.kind === "sticker" || asset.kind === "meme"),
    [mediaAssets],
  );
  const enabledMediaCount = useMemo(
    () => curatedMediaAssets.filter((asset) => asset.enabled).length,
    [curatedMediaAssets],
  );
  const stickerCount = useMemo(
    () => curatedMediaAssets.filter((asset) => asset.kind === "sticker").length,
    [curatedMediaAssets],
  );
  const memeCount = useMemo(
    () => curatedMediaAssets.filter((asset) => asset.kind === "meme").length,
    [curatedMediaAssets],
  );
  const visualHashAttemptedRef = useRef<Set<string>>(new Set());
  const [visualHashByAssetId, setVisualHashByAssetId] = useState<Record<string, string>>({});
  const suggestedMerges = useMemo(() => {
    const pairCandidates: Array<{
      source: MediaAsset;
      target: MediaAsset;
      score: number;
      similaritySource: "visual_hash" | "content_hash";
      distanceBits?: number;
      groupKey: string;
      groupLabel: string;
    }> = [];
    const byKind = new Map<"sticker" | "meme", MediaAsset[]>();
    for (const asset of curatedMediaAssets) {
      const kind = asset.kind === "meme" ? "meme" : "sticker";
      const list = byKind.get(kind) || [];
      list.push(asset);
      byKind.set(kind, list);
    }

    for (const [, assets] of byKind) {
      for (let i = 0; i < assets.length; i += 1) {
        for (let j = i + 1; j < assets.length; j += 1) {
          const first = assets[i];
          const second = assets[j];
          const firstVisualHash = normalizeHexHash(visualHashByAssetId[first._id]);
          const secondVisualHash = normalizeHexHash(visualHashByAssetId[second._id]);

          let score = 0;
          let similaritySource: "visual_hash" | "content_hash" | null = null;
          let distanceBits: number | undefined;
          let groupKey = "";
          let groupLabel = "";

          if (firstVisualHash && secondVisualHash && firstVisualHash.length === secondVisualHash.length) {
            const distance = hammingDistanceHex(firstVisualHash, secondVisualHash);
            if (!distance) {
              continue;
            }
            const similarity = 1 - distance.bits / distance.maxBits;
            if (similarity < 0.84) {
              continue;
            }
            score = similarity;
            similaritySource = "visual_hash";
            distanceBits = distance.bits;
            groupKey = `v:${firstVisualHash.slice(0, 6)}:${secondVisualHash.slice(0, 6)}`;
            groupLabel = `Visual hash (~${Math.round(similarity * 100)}%)`;
          } else {
            const firstContentHash = normalizeHexHash(first.contentHash);
            const secondContentHash = normalizeHexHash(second.contentHash);
            if (!firstContentHash || !secondContentHash || firstContentHash !== secondContentHash) {
              continue;
            }
            score = 1;
            similaritySource = "content_hash";
            groupKey = `c:${firstContentHash.slice(0, 12)}`;
            groupLabel = "Exact content hash match";
          }

          if (!similaritySource) {
            continue;
          }

          const { source, target } = pickMergeDirection(first, second);
          pairCandidates.push({
            source,
            target,
            score,
            similaritySource,
            distanceBits,
            groupKey,
            groupLabel,
          });
        }
      }
    }

    const bestBySource = new Map<string, (typeof pairCandidates)[number]>();
    for (const candidate of pairCandidates) {
      const existing = bestBySource.get(candidate.source._id);
      if (!existing || candidate.score > existing.score) {
        bestBySource.set(candidate.source._id, candidate);
      }
    }

    const dedupedByPair = new Map<string, MergeSuggestion>();
    for (const candidate of bestBySource.values()) {
      const pairKey = [candidate.source._id, candidate.target._id].sort().join(":");
      const existing = dedupedByPair.get(pairKey);
      if (existing && existing.score >= candidate.score) {
        continue;
      }
      dedupedByPair.set(pairKey, {
        key: pairKey,
        kind: candidate.source.kind === "meme" ? "meme" : "sticker",
        sourceAssetId: candidate.source._id,
        sourceLabel: candidate.source.label,
        targetAssetId: candidate.target._id,
        targetLabel: candidate.target.label,
        score: candidate.score,
        similaritySource: candidate.similaritySource,
        distanceBits: candidate.distanceBits,
        groupKey: candidate.groupKey,
        groupLabel: candidate.groupLabel,
      });
    }

    return [...dedupedByPair.values()].sort((a, b) => b.score - a.score);
  }, [curatedMediaAssets, visualHashByAssetId]);
  const suggestedMergeGroups = useMemo(() => {
    const grouped = new Map<string, { label: string; items: MergeSuggestion[] }>();
    for (const suggestion of suggestedMerges) {
      const existing = grouped.get(suggestion.groupKey);
      if (existing) {
        existing.items.push(suggestion);
      } else {
        grouped.set(suggestion.groupKey, {
          label: suggestion.groupLabel,
          items: [suggestion],
        });
      }
    }
    return [...grouped.entries()].map(([groupKey, group]) => ({
      groupKey,
      label: group.label,
      items: group.items.sort((a, b) => b.score - a.score),
    }));
  }, [suggestedMerges]);
  const mediaAssetsLoading = mediaAssets === undefined;
  const settingsLoading = settings === undefined || defaults === undefined;
  const contactsLoading = contacts === undefined;
  const profilesLoading = profilesQuery === undefined;
  const personaPacksLoading = personaPacks === undefined;
  const { runAction, getRecord, notices, dismissNotice, pushNotice } = useActionStateRegistry();
  const key = "settings:save";
  const profileKey = "personality:profile";
  const mediaKey = "media:library";

  const remoteState = useMemo(() => toState(settings), [settings]);
  const defaultState = useMemo(() => toState(defaults), [defaults]);
  const knownContacts = useMemo(() => contacts || [], [contacts]);
  const knownWhatsAppContacts = useMemo(
    () => knownContacts.filter((contact) => (contact.provider || "whatsapp") === "whatsapp"),
    [knownContacts],
  );
  const profiles = profilesQuery || [];
  const availablePersonaPacks = personaPacks?.packs || [];
  const [tab, setTab] = useState<SettingsTab>("runtime");
  const [settingsSearch, setSettingsSearch] = useState("");
  const [draft, setDraft] = useState<SettingsState>(remoteState);
  const [editorSlug, setEditorSlug] = useState("");
  const [assetKind, setAssetKind] = useState<"sticker" | "meme">("sticker");
  const [assetLabel, setAssetLabel] = useState("");
  const [assetTags, setAssetTags] = useState("");
  const [assetFile, setAssetFile] = useState<File | null>(null);
  const [editingAssetId, setEditingAssetId] = useState<string | null>(null);
  const [editAssetLabel, setEditAssetLabel] = useState("");
  const [editAssetTags, setEditAssetTags] = useState("");
  const [editContextSummary, setEditContextSummary] = useState("");
  const [editContextTags, setEditContextTags] = useState("");
  const [editContextTriggers, setEditContextTriggers] = useState("");
  const [editContextAvoid, setEditContextAvoid] = useState("");
  const [editContextConfidence, setEditContextConfidence] = useState("");
  const [autoMergeSuggestionsEnabled, setAutoMergeSuggestionsEnabled] = useState(true);
  const attemptedAutoMergeSignatureRef = useRef("");
  const [newProfileSlug, setNewProfileSlug] = useState("");
  const [newProfileName, setNewProfileName] = useState("");
  const [newProfileDescription, setNewProfileDescription] = useState("");
  const [newProfilePrompt, setNewProfilePrompt] = useState("");
  const [newProfileIntensity, setNewProfileIntensity] = useState(0.65);

  useEffect(() => {
    setDraft(remoteState);
  }, [remoteState]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const savedSearch = window.localStorage.getItem(SETTINGS_SEARCH_STORAGE_KEY) || "";
    if (savedSearch) {
      setSettingsSearch(savedSearch);
    }
  }, []);

  useEffect(() => {
    const missing = curatedMediaAssets.filter((asset) => {
      if (!asset.fileUrl) {
        return false;
      }
      if (visualHashByAssetId[asset._id]) {
        return false;
      }
      return !visualHashAttemptedRef.current.has(asset._id);
    });
    if (missing.length === 0) {
      return;
    }

    let cancelled = false;
    const computeHashes = async () => {
      for (const asset of missing) {
        visualHashAttemptedRef.current.add(asset._id);
        const hash = await buildAverageImageHash(asset.fileUrl as string);
        if (cancelled) {
          return;
        }
        if (!hash) {
          continue;
        }
        setVisualHashByAssetId((prev) => {
          if (prev[asset._id] === hash) {
            return prev;
          }
          return {
            ...prev,
            [asset._id]: hash,
          };
        });
      }
    };
    void computeHashes();

    return () => {
      cancelled = true;
    };
  }, [curatedMediaAssets, visualHashByAssetId]);

  const selectedEditorSlug = editorSlug || profiles[0]?.slug || "";
  const selectedEditorProfile = profiles.find((profile) => profile.slug === selectedEditorSlug) || null;
  const instagramConnected = Boolean(
    instagramSetup?.hasAuth || instagramSetup?.listenerActive || instagramSetup?.status === "connected",
  );
  const profileVersions = useQuery(
    api.personality.listProfileVersions,
    selectedEditorProfile ? { ...tenantScope, slug: selectedEditorProfile.slug, limit: 20 } : "skip",
  ) as PersonalityProfileVersion[] | undefined;
  const profileVersionsLoading = Boolean(selectedEditorProfile) && profileVersions === undefined;

  const hasChanged = useMemo(() => !stateEquals(draft, remoteState), [draft, remoteState]);
  const record = getRecord(key);
  const profileRecord = getRecord(profileKey);
  const mediaRecord = getRecord(mediaKey);
  const showRuntime = tab === "runtime";
  const showAutomation = tab === "automation";
  const showConnections = tab === "connections";
  const showVoice = tab === "voice";
  const showPersonality = tab === "personality";
  const showMedia = tab === "media";
  const showStyle = tab === "style";
  const showRules = tab === "rules";
  const showDraftActions = showRuntime || showAutomation;
  const tabDirtyMap = useMemo<Record<SettingsTab, boolean>>(() => {
    return {
      runtime: SETTINGS_TAB_FIELDS.runtime.some((field) => fieldValueChanged(field, draft, remoteState)),
      automation: SETTINGS_TAB_FIELDS.automation.some((field) => fieldValueChanged(field, draft, remoteState)),
      connections: false,
      voice: false,
      personality: false,
      media: false,
      style: false,
      rules: false,
    };
  }, [draft, remoteState]);
  const dirtyTabCount = useMemo(
    () => SETTINGS_TABS.filter((tabItem) => tabDirtyMap[tabItem.id]).length,
    [tabDirtyMap],
  );
  const activeTabLabel = useMemo(
    () => SETTINGS_TABS.find((tabItem) => tabItem.id === tab)?.label || "Runtime",
    [tab],
  );
  const normalizedSettingsSearch = settingsSearch.trim().toLowerCase();
  const visibleTabs = useMemo(() => {
    if (!normalizedSettingsSearch) {
      return SETTINGS_TABS;
    }
    return SETTINGS_TABS.filter((tabItem) => {
      const haystack = `${tabItem.label} ${(SETTINGS_TAB_KEYWORDS[tabItem.id] || []).join(" ")}`.toLowerCase();
      return haystack.includes(normalizedSettingsSearch);
    });
  }, [normalizedSettingsSearch]);

  const selectTab = useCallback((nextTab: SettingsTab) => {
    setTab(nextTab);
    if (typeof window === "undefined") {
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.set("section", nextTab);
    window.history.replaceState(null, "", `${url.pathname}?${url.searchParams.toString()}${url.hash}`);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const params = new URLSearchParams(window.location.search);
    const section = params.get("section") || params.get("tab");
    if (isSettingsTab(section)) {
      setTab(section);
    }
  }, []);

  useEffect(() => {
    if (!normalizedSettingsSearch || visibleTabs.length !== 1) {
      return;
    }
    if (visibleTabs[0].id !== tab) {
      selectTab(visibleTabs[0].id);
    }
  }, [normalizedSettingsSearch, selectTab, tab, visibleTabs]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(SETTINGS_SEARCH_STORAGE_KEY, settingsSearch);
  }, [settingsSearch]);

  const saveDraft = () => {
    if (!hasChanged) {
      return;
    }

    void runAction(
      key,
      async () => {
        await saveSettings({
          ...tenantScope,
          ignoreGroupsByDefault: draft.ignoreGroupsByDefault,
          reactionsEnabled: draft.reactionsEnabled,
          stickersEnabled: draft.stickersEnabled,
          memesEnabled: draft.memesEnabled,
          generatedMemesEnabled: draft.generatedMemesEnabled,
          generatedMemesAutoSendEnabled: draft.generatedMemesAutoSendEnabled,
          memeThreadCooldownMs: Math.round(draft.memeThreadCooldownMs),
          memeSendProbability: draft.memeSendProbability,
          soulModeEnabled: draft.soulModeEnabled,
          humorLearningEnabled: draft.humorLearningEnabled,
          selfRoastModeEnabled: draft.selfRoastModeEnabled,
          statusAutoReplyEnabled: draft.statusAutoReplyEnabled,
          statusReplyRequireFunny: draft.statusReplyRequireFunny,
          captureGroupMediaEnabled: draft.captureGroupMediaEnabled,
          funnyStatusKeywords: draft.funnyStatusKeywords,
          funnyStatusEmojis: draft.funnyStatusEmojis,
          aiFallbackMode: draft.aiFallbackMode,
          aiModelFirstEnabled: draft.aiModelFirstEnabled,
          aiDeterministicModes: draft.aiDeterministicModes,
          aiAckRoutingEnabled: draft.aiAckRoutingEnabled,
          aiTemperature: draft.aiTemperature,
          aiMaxOutputTokens: Math.round(draft.aiMaxOutputTokens),
          aiMaxReplyChars: Math.round(draft.aiMaxReplyChars),
          aiHistoryLineLimit: Math.round(draft.aiHistoryLineLimit),
          aiPrimaryConfidence: draft.aiPrimaryConfidence,
          aiFallbackConfidence: draft.aiFallbackConfidence,
          aiReplyPolicy: draft.aiReplyPolicy,
          aiSystemInstruction: draft.aiSystemInstruction,
          activePersonaPackId: draft.activePersonaPackId,
          activePersonaPackIdsByProfile: draft.activePersonaPackIdsByProfile || {},
          qualityGateMode: draft.qualityGateMode,
          qualityGateThreshold: draft.qualityGateThreshold,
          humanDelayMinMs: Math.round(draft.humanDelayMinMs),
          humanDelayMaxMs: Math.round(draft.humanDelayMaxMs),
          humanTypingMinMs: Math.round(draft.humanTypingMinMs),
          humanTypingMaxMs: Math.round(draft.humanTypingMaxMs),
          outboxClaimLimit: Math.round(draft.outboxClaimLimit),
          outboxPollMs: Math.round(draft.outboxPollMs),
          inboundMergeWindowMs: Math.round(draft.inboundMergeWindowMs),
          manualInterventionCooldownMs: Math.round(draft.manualInterventionCooldownMs),
          inboundConcurrency: Math.round(draft.inboundConcurrency),
          outboxSendConcurrency: Math.round(draft.outboxSendConcurrency),
          statusRetentionMs: Math.round(draft.statusRetentionMs),
          statusCleanupIntervalMs: Math.round(draft.statusCleanupIntervalMs),
          statusCleanupBatchLimit: Math.round(draft.statusCleanupBatchLimit),
          statusContextKeepPerThread: Math.round(draft.statusContextKeepPerThread),
          groupContextKeepPerThread: Math.round(draft.groupContextKeepPerThread),
          contextCompactionIntervalMs: Math.round(draft.contextCompactionIntervalMs),
          contextCompactionMaxThreads: Math.round(draft.contextCompactionMaxThreads),
          contextCompactionMaxDeletes: Math.round(draft.contextCompactionMaxDeletes),
          compactContextGroupJids: draft.compactContextGroupJids,
          quietHoursEnabled: draft.quietHoursEnabled,
          quietHoursStartHour: Math.round(draft.quietHoursStartHour),
          quietHoursEndHour: Math.round(draft.quietHoursEndHour),
          autoMarkReadEnabled: draft.autoMarkReadEnabled,
          autoMarkReadGroups: draft.autoMarkReadGroups,
          autoMarkReadStatus: draft.autoMarkReadStatus,
          presenceSubscribeEnabled: draft.presenceSubscribeEnabled,
          chatModifyQuietHoursEnabled: draft.chatModifyQuietHoursEnabled,
          aboutAutomationEnabled: draft.aboutAutomationEnabled,
          aboutAutomationIntervalMinutes: Math.round(draft.aboutAutomationIntervalMinutes),
          aboutAutomationTemplate: draft.aboutAutomationTemplate,
          sendRateWindowMinutes: Math.round(draft.sendRateWindowMinutes),
          sendMaxPerThreadInWindow: Math.round(draft.sendMaxPerThreadInWindow),
          sendMaxGlobalInWindow: Math.round(draft.sendMaxGlobalInWindow),
          voiceNotesAutoEnabled: draft.voiceNotesAutoEnabled,
          voiceNotesAutoProbability: draft.voiceNotesAutoProbability,
          voiceNotesAutoMaxPerThreadPerDay: Math.round(draft.voiceNotesAutoMaxPerThreadPerDay),
          voiceNotesAutoNeedKeywords: draft.voiceNotesAutoNeedKeywords,
          romanticPartnerJids: draft.romanticPartnerJids,
          romanticMorningEnabled: draft.romanticMorningEnabled,
          romanticMorningStartHour: Math.round(draft.romanticMorningStartHour),
          romanticMorningEndHour: Math.round(draft.romanticMorningEndHour),
          romanticMorningLeadRatio: draft.romanticMorningLeadRatio,
          romanticMorningCollisionCooldownHours: Math.round(draft.romanticMorningCollisionCooldownHours),
          romanticMorningMaxPerThreadPerDay: Math.round(draft.romanticMorningMaxPerThreadPerDay),
          instagramDmDelayMinMs: Math.round(draft.instagramDmDelayMinMs),
          instagramDmDelayMaxMs: Math.round(draft.instagramDmDelayMaxMs),
          instagramTypingMinMs: Math.round(draft.instagramTypingMinMs),
          instagramTypingMaxMs: Math.round(draft.instagramTypingMaxMs),
          instagramSendRateWindowMinutes: Math.round(draft.instagramSendRateWindowMinutes),
          instagramSendMaxPerThreadInWindow: Math.round(draft.instagramSendMaxPerThreadInWindow),
          instagramSendMaxGlobalInWindow: Math.round(draft.instagramSendMaxGlobalInWindow),
          instagramStoryCadenceHours: Math.round(draft.instagramStoryCadenceHours),
          instagramStoryDailyMaxPosts: Math.round(draft.instagramStoryDailyMaxPosts),
          outreachEnabled: draft.outreachEnabled,
          outreachCadenceHours: Math.round(draft.outreachCadenceHours),
          outreachMaxContactsPerRun: Math.round(draft.outreachMaxContactsPerRun),
          outreachContactJids: draft.outreachContactJids,
          outreachStarterTemplate: draft.outreachStarterTemplate,
          conversationIntelligenceEnabled: draft.conversationIntelligenceEnabled,
          checkInRecencyTargetDays: Math.round(draft.checkInRecencyTargetDays),
          topicDyingAckStreakThreshold: Math.round(draft.topicDyingAckStreakThreshold),
          topicLaneMaxActive: Math.round(draft.topicLaneMaxActive),
          pivotReplyEnabled: draft.pivotReplyEnabled,
          antiDwellingEnabled: draft.antiDwellingEnabled,
          antiDwellingEndgameCloseCooldownMinutes: Math.round(draft.antiDwellingEndgameCloseCooldownMinutes),
          antiDwellingTopicTurnSoftLimit: Math.round(draft.antiDwellingTopicTurnSoftLimit),
          antiDwellingTopicTurnHardLimit: Math.round(draft.antiDwellingTopicTurnHardLimit),
          topicLeadPivotEnabled: draft.topicLeadPivotEnabled,
          topicLeadPivotMinVibeScore: draft.topicLeadPivotMinVibeScore,
          topicLeadPivotCooldownMinutes: Math.round(draft.topicLeadPivotCooldownMinutes),
          statusBuilderEnabled: draft.statusBuilderEnabled,
          statusBuilderCadenceHours: Math.round(draft.statusBuilderCadenceHours),
          statusBuilderDailyMaxPosts: Math.round(draft.statusBuilderDailyMaxPosts),
          statusBuilderTextPostRatio: draft.statusBuilderTextPostRatio,
          statusBuilderReviewRatio: draft.statusBuilderReviewRatio,
          statusPostAudienceMode: draft.statusPostAudienceMode,
          statusBuilderAudienceJids: draft.statusBuilderAudienceJids,
          statusBuilderAudienceSampleSize: Math.round(draft.statusBuilderAudienceSampleSize),
        });
      },
      {
        pendingLabel: "Saving...",
        successMessage: "Settings saved.",
      },
    );
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    saveDraft();
  };

  const restoreDefaults = () => {
    setDraft(defaultState);
  };

  const addRomanticPartner = (jid: string) => {
    const normalized = normalizeContactJid(jid);
    if (!normalized) {
      return;
    }

    setDraft((prev) => {
      if (prev.romanticPartnerJids.includes(normalized)) {
        return prev;
      }
      return {
        ...prev,
        romanticPartnerJids: [...prev.romanticPartnerJids, normalized],
      };
    });
  };

  const removeRomanticPartner = (jid: string) => {
    setDraft((prev) => ({
      ...prev,
      romanticPartnerJids: prev.romanticPartnerJids.filter((item) => item !== jid),
    }));
  };

  const addCompactContextGroup = (jid: string) => {
    const normalized = normalizeContactJid(jid);
    if (!normalized) {
      return;
    }

    setDraft((prev) => {
      if (prev.compactContextGroupJids.includes(normalized)) {
        return prev;
      }
      return {
        ...prev,
        compactContextGroupJids: [...prev.compactContextGroupJids, normalized],
      };
    });
  };

  const removeCompactContextGroup = (jid: string) => {
    setDraft((prev) => ({
      ...prev,
      compactContextGroupJids: prev.compactContextGroupJids.filter((item) => item !== jid),
    }));
  };

  const addOutreachContact = (jid: string) => {
    const normalized = normalizeContactJid(jid);
    if (!normalized) {
      return;
    }

    setDraft((prev) => {
      if (prev.outreachContactJids.includes(normalized)) {
        return prev;
      }
      return {
        ...prev,
        outreachContactJids: [...prev.outreachContactJids, normalized],
      };
    });
  };

  const removeOutreachContact = (jid: string) => {
    setDraft((prev) => ({
      ...prev,
      outreachContactJids: prev.outreachContactJids.filter((item) => item !== jid),
    }));
  };

  const addStatusAudience = (jid: string) => {
    const normalized = normalizeContactJid(jid);
    if (!normalized) {
      return;
    }

    setDraft((prev) => {
      if (prev.statusBuilderAudienceJids.includes(normalized)) {
        return prev;
      }
      return {
        ...prev,
        statusBuilderAudienceJids: [...prev.statusBuilderAudienceJids, normalized],
      };
    });
  };

  const removeStatusAudience = (jid: string) => {
    setDraft((prev) => ({
      ...prev,
      statusBuilderAudienceJids: prev.statusBuilderAudienceJids.filter((item) => item !== jid),
    }));
  };

  const saveProfile = (values: {
    slug: string;
    name: string;
    description: string;
    prompt: string;
    defaultIntensity: number;
  }) => {
    void runAction(
      profileKey,
      async () => {
        await upsertPersonalityProfile({
          ...tenantScope,
          slug: values.slug,
          name: values.name.trim(),
          description: values.description.trim(),
          prompt: values.prompt.trim(),
          defaultIntensity: clamp01(values.defaultIntensity),
        });
      },
      {
        pendingLabel: "Saving profile...",
        successMessage: "Personality profile updated.",
      },
    );
  };

  const createProfile = () => {
    const slug = newProfileSlug.trim();
    const name = newProfileName.trim();
    const description = newProfileDescription.trim();
    const prompt = newProfilePrompt.trim();
    if (!slug || !name || !prompt) {
      return;
    }

    void runAction(
      profileKey,
      async () => {
        await upsertPersonalityProfile({
          ...tenantScope,
          slug,
          name,
          description: description || "Custom profile",
          prompt,
          defaultIntensity: clamp01(newProfileIntensity),
        });
        setNewProfileSlug("");
        setNewProfileName("");
        setNewProfileDescription("");
        setNewProfilePrompt("");
        setNewProfileIntensity(0.65);
      },
      {
        pendingLabel: "Creating profile...",
        successMessage: "Profile created.",
      },
    );
  };

  const removeProfile = (slug: string) => {
    void runAction(
      profileKey,
      async () => {
        await deletePersonalityProfile({ ...tenantScope, slug });
      },
      {
        pendingLabel: "Deleting profile...",
        successMessage: "Profile deleted.",
      },
    );
  };

  const rollbackProfile = (versionId: string) => {
    if (!selectedEditorProfile) {
      return;
    }
    void runAction(
      profileKey,
      async () => {
        await rollbackProfileVersion({
          ...tenantScope,
          slug: selectedEditorProfile.slug,
          versionId: versionId as Id<"personalityProfileVersions">,
        });
      },
      {
        pendingLabel: "Rolling back profile...",
        successMessage: "Profile rolled back.",
      },
    );
  };

  const uploadAsset = () => {
    if (!assetFile) {
      return;
    }

    void runAction(
      mediaKey,
      async () => {
        const contentHash = await hashFileSha256Hex(assetFile);
        const uploadUrl = await generateUploadUrl({});
        const upload = await fetch(uploadUrl as string, {
          method: "POST",
          headers: {
            "Content-Type": assetFile.type || "application/octet-stream",
          },
          body: assetFile,
        });

        if (!upload.ok) {
          throw new Error(`Upload failed (${upload.status})`);
        }

        const payload = (await upload.json()) as { storageId?: string };
        if (!payload.storageId) {
          throw new Error("Upload response missing storageId.");
        }

        await registerAssetIfMissing({
          ...tenantScope,
          kind: assetKind,
          label: assetLabel.trim() || assetFile.name,
          tags: parseTagInput(assetTags),
          fileId: payload.storageId as Id<"_storage">,
          mimeType: assetFile.type || "application/octet-stream",
          contentHash,
          enabled: true,
        });

        setAssetFile(null);
        setAssetLabel("");
        setAssetTags("");
      },
      {
        pendingLabel: "Uploading media asset...",
        successMessage: "Media asset added.",
      },
    );
  };

  const startAssetEdit = (asset: MediaAsset) => {
    setEditingAssetId(asset._id);
    setEditAssetLabel(asset.label);
    setEditAssetTags((asset.tags || []).join(", "));
    setEditContextSummary(asset.contextSummary || "");
    setEditContextTags((asset.contextTags || []).join(", "));
    setEditContextTriggers((asset.contextTriggers || []).join(", "));
    setEditContextAvoid((asset.contextAvoid || []).join(", "));
    setEditContextConfidence(
      asset.contextConfidence !== undefined && Number.isFinite(asset.contextConfidence) ? String(asset.contextConfidence) : "",
    );
  };

  const cancelAssetEdit = () => {
    setEditingAssetId(null);
    setEditAssetLabel("");
    setEditAssetTags("");
    setEditContextSummary("");
    setEditContextTags("");
    setEditContextTriggers("");
    setEditContextAvoid("");
    setEditContextConfidence("");
  };

  const saveAssetEdit = (assetId: string) => {
    const confidenceInput = editContextConfidence.trim();
    const parsedConfidence = confidenceInput ? Number(confidenceInput) : null;
    if (confidenceInput && !Number.isFinite(parsedConfidence)) {
      return;
    }
    const contextTags = parseSimpleList(editContextTags, false);
    const contextTriggers = parseSimpleList(editContextTriggers, false);
    const contextAvoid = parseSimpleList(editContextAvoid, false);

    void runAction(
      mediaKey,
      async () => {
        await updateAssetMetadata({
          ...tenantScope,
          assetId: assetId as Id<"mediaAssets">,
          label: editAssetLabel.trim(),
          tags: parseSimpleList(editAssetTags, true).slice(0, 20),
          contextSummary: editContextSummary.trim() ? editContextSummary.trim() : null,
          contextTags: contextTags.length > 0 ? contextTags : null,
          contextTriggers: contextTriggers.length > 0 ? contextTriggers : null,
          contextAvoid: contextAvoid.length > 0 ? contextAvoid : null,
          contextConfidence: parsedConfidence === null ? null : clamp01(parsedConfidence),
          contextSource: "heuristic",
        });
        cancelAssetEdit();
      },
      {
        pendingLabel: "Saving sticker metadata...",
        successMessage: "Sticker updated.",
      },
    );
  };

  const mergeSuggestedPair = (sourceAssetId: string, targetAssetId: string) => {
    const source = curatedMediaAssets.find((asset) => asset._id === sourceAssetId);
    const target = curatedMediaAssets.find((asset) => asset._id === targetAssetId);
    if (!source) {
      return;
    }
    if (!target) {
      return;
    }
    if (!window.confirm(`Merge "${source.label}" into "${target.label}"? This deletes the source asset.`)) {
      return;
    }
    void runAction(
      mediaKey,
      async () => {
        await mergeMediaAssets({
          ...tenantScope,
          sourceAssetId: source._id as Id<"mediaAssets">,
          targetAssetId: target._id as Id<"mediaAssets">,
        });
        if (editingAssetId === source._id) {
          cancelAssetEdit();
        }
      },
      {
        pendingLabel: "Merging assets...",
        successMessage: "Assets merged.",
      },
    );
  };

  const mergeAllSuggestedPairs = useCallback((options?: { requireConfirm?: boolean }) => {
    if (suggestedMerges.length === 0) {
      return;
    }
    if (options?.requireConfirm !== false && !window.confirm(`Merge all ${suggestedMerges.length} suggested pair(s)?`)) {
      return;
    }

    const queuedSuggestions = [...suggestedMerges];
    void runAction(
      mediaKey,
      async () => {
        let merged = 0;
        let skipped = 0;
        let failed = 0;
        for (const suggestion of queuedSuggestions) {
          try {
            await mergeMediaAssets({
              ...tenantScope,
              sourceAssetId: suggestion.sourceAssetId as Id<"mediaAssets">,
              targetAssetId: suggestion.targetAssetId as Id<"mediaAssets">,
            });
            merged += 1;
            if (editingAssetId === suggestion.sourceAssetId) {
              setEditingAssetId(null);
              setEditAssetLabel("");
              setEditAssetTags("");
              setEditContextSummary("");
              setEditContextTags("");
              setEditContextTriggers("");
              setEditContextAvoid("");
              setEditContextConfidence("");
            }
          } catch (error) {
            const message = error instanceof Error ? error.message.toLowerCase() : "";
            if (
              message.includes("must exist") ||
              message.includes("not found") ||
              message.includes("must be different assets")
            ) {
              skipped += 1;
              continue;
            }
            failed += 1;
          }
        }
        return { merged, skipped, failed };
      },
      {
        pendingLabel: "Merging all suggestions...",
        suppressSuccessNotice: true,
      },
    ).then((result) => {
      if (!result.executed || result.error || !result.value) {
        return;
      }
      const summary = result.value;
      const message = `Merge all complete. Merged ${summary.merged}, skipped ${summary.skipped}, failed ${summary.failed}.`;
      if (summary.failed > 0) {
        pushNotice("error", message);
      } else if (summary.skipped > 0) {
        pushNotice("info", message);
      } else {
        pushNotice("success", message);
      }
    });
  }, [
    editingAssetId,
    mediaKey,
    mergeMediaAssets,
    pushNotice,
	    runAction,
	    suggestedMerges,
	    tenantScope,
	  ]);

  useEffect(() => {
    if (suggestedMerges.length === 0) {
      attemptedAutoMergeSignatureRef.current = "";
      return;
    }
    if (!autoMergeSuggestionsEnabled || mediaRecord.pending) {
      return;
    }
    const signature = suggestedMerges.map((item) => item.key).sort().join("|");
    if (!signature || attemptedAutoMergeSignatureRef.current === signature) {
      return;
    }
    attemptedAutoMergeSignatureRef.current = signature;
    mergeAllSuggestedPairs({ requireConfirm: false });
  }, [autoMergeSuggestionsEnabled, mediaRecord.pending, mergeAllSuggestedPairs, suggestedMerges]);

  if (settingsLoading) {
    return (
      <section className="panel-grid two-col settings-workspace">
        <article className="panel-card">
          <ActionNotices notices={notices} onDismiss={dismissNotice} />
          <h3>AI Runtime</h3>
          <LoadingBlock label="Loading settings…" rows={3} />
        </article>
        <article className="panel-card">
          <h3>Pacing & Review</h3>
          <LoadingBlock label="Loading worker defaults…" rows={3} />
        </article>
      </section>
    );
  }

  return (
    <section className="settings-workspace">
      <div className="settings-window">
        <aside className="settings-sidebar" aria-label="Settings sections">
          <label className="settings-search-field">
            <span className="sr-only">Search settings</span>
            <input
              type="search"
              value={settingsSearch}
              onChange={(event) => setSettingsSearch(event.target.value)}
              placeholder="Search settings"
            />
          </label>
          <nav className="settings-sidebar-list">
            {visibleTabs.map((item) => {
              const selected = item.id === tab;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`settings-sidebar-item ${selected ? "settings-sidebar-item-active" : ""}`}
                  aria-current={selected ? "page" : undefined}
                  onClick={() => selectTab(item.id)}
                >
                  <span>
                    <strong>{item.label}</strong>
                    <small>{SETTINGS_TAB_SUMMARIES[item.id]}</small>
                  </span>
                  {tabDirtyMap[item.id] ? <em>Edited</em> : null}
                </button>
              );
            })}
          </nav>
          {normalizedSettingsSearch && visibleTabs.length === 0 ? (
            <p className="queue-meta settings-empty-search">No section matches this search.</p>
          ) : null}
        </aside>

        <div className="settings-detail">
          <header className="settings-detail-header">
            <div>
              <p className="settings-eyebrow">Settings</p>
              <h2>{activeTabLabel}</h2>
              <p className="queue-meta">
                {dirtyTabCount > 0
                  ? `${dirtyTabCount} section${dirtyTabCount === 1 ? "" : "s"} need saving.`
                  : "Everything is saved."}
              </p>
            </div>
            {showDraftActions ? (
              <div className="topbar-controls settings-primary-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={saveDraft}
                  disabled={record.pending || !hasChanged}
                  aria-disabled={record.pending || !hasChanged}
                >
                  {record.pending ? "Saving..." : "Save"}
                </button>
                <button type="button" className="btn" onClick={restoreDefaults} disabled={record.pending} aria-disabled={record.pending}>
                  Restore
                </button>
              </div>
            ) : null}
          </header>

          <div className="panel-grid two-col settings-panel-grid">
        {showRuntime ? (
          <>
            <article className="panel-card">
        <ActionNotices notices={notices} onDismiss={dismissNotice} />
        <h3>AI Runtime</h3>
        <form onSubmit={onSubmit} className="stack compact" aria-busy={record.pending}>
          <div className="stack compact">
            <span className="queue-meta">Temperature</span>
            <input
              type="number"
              min={0}
              max={1.3}
              step={0.01}
              value={draft.aiTemperature}
              onChange={(event) => setDraft((prev) => ({ ...prev, aiTemperature: parseNumber(event.target.value, prev.aiTemperature) }))}
              disabled={record.pending}
              aria-disabled={record.pending}
            />
          </div>

          <div className="stack compact">
            <span className="queue-meta">Max output tokens</span>
            <input
              type="number"
              min={40}
              max={2000}
              step={1}
              value={draft.aiMaxOutputTokens}
              onChange={(event) => setDraft((prev) => ({ ...prev, aiMaxOutputTokens: parseNumber(event.target.value, prev.aiMaxOutputTokens) }))}
              disabled={record.pending}
              aria-disabled={record.pending}
            />
          </div>

          <label className="stack compact">
            <span className="queue-meta">Max reply chars</span>
            <input
              type="number"
              min={60}
              max={2400}
              step={1}
              value={draft.aiMaxReplyChars}
              onChange={(event) => setDraft((prev) => ({ ...prev, aiMaxReplyChars: parseNumber(event.target.value, prev.aiMaxReplyChars) }))}
              disabled={record.pending}
              aria-disabled={record.pending}
            />
          </label>

          <label className="stack compact">
            <span className="queue-meta">History line limit</span>
            <input
              type="number"
              min={4}
              max={120}
              step={1}
              value={draft.aiHistoryLineLimit}
              onChange={(event) => setDraft((prev) => ({ ...prev, aiHistoryLineLimit: parseNumber(event.target.value, prev.aiHistoryLineLimit) }))}
              disabled={record.pending}
              aria-disabled={record.pending}
            />
          </label>

          <label className="stack compact">
            <span className="queue-meta">Fallback mode</span>
            <SearchableSelect
              value={draft.aiFallbackMode}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  aiFallbackMode: event.target.value === "azure_only" ? "azure_only" : "all",
                }))
              }
              disabled={record.pending}
              aria-disabled={record.pending}
            >
              <option value="all">Allow Codex + heuristic fallback</option>
              <option value="azure_only">Azure only (disable all fallback providers)</option>
            </SearchableSelect>
          </label>

          <label className="stack compact">
            <span className="queue-meta">Model-first generation</span>
            <SearchableSelect
              value={draft.aiModelFirstEnabled ? "true" : "false"}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  aiModelFirstEnabled: event.target.value === "true",
                }))
              }
              disabled={record.pending}
              aria-disabled={record.pending}
            >
              <option value="false">Disabled (use legacy steering flow)</option>
              <option value="true">Enabled (GPT-5.4 first)</option>
            </SearchableSelect>
          </label>

          <label className="stack compact">
            <span className="queue-meta">Model acknowledgment routing</span>
            <SearchableSelect
              value={draft.aiAckRoutingEnabled ? "true" : "false"}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  aiAckRoutingEnabled: event.target.value === "true",
                }))
              }
              disabled={record.pending}
              aria-disabled={record.pending}
            >
              <option value="false">Disabled (always use reaction heuristic)</option>
              <option value="true">Enabled (model picks reaction or text)</option>
            </SearchableSelect>
          </label>

          <label className="stack compact">
            <span className="queue-meta">Deterministic mode list</span>
            <textarea
              name="aiDeterministicModes"
              value={draft.aiDeterministicModes.join("\n")}
              rows={3}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  aiDeterministicModes: parseSimpleList(event.target.value, true),
                }))
              }
              disabled={record.pending}
              aria-disabled={record.pending}
            />
            <span className="queue-meta">Enter one mode per line (or comma-separated).</span>
          </label>

          <label className="stack compact">
            <span className="queue-meta">Primary confidence</span>
            <input
              type="number"
              min={0.01}
              max={1}
              step={0.01}
              value={draft.aiPrimaryConfidence}
              onChange={(event) => setDraft((prev) => ({ ...prev, aiPrimaryConfidence: parseNumber(event.target.value, prev.aiPrimaryConfidence) }))}
              disabled={record.pending}
              aria-disabled={record.pending}
            />
          </label>

          <label className="stack compact">
            <span className="queue-meta">Heuristic fallback confidence</span>
            <input
              type="number"
              min={0.01}
              max={1}
              step={0.01}
              value={draft.aiFallbackConfidence}
              onChange={(event) => setDraft((prev) => ({ ...prev, aiFallbackConfidence: parseNumber(event.target.value, prev.aiFallbackConfidence) }))}
              disabled={record.pending || draft.aiFallbackMode === "azure_only"}
              aria-disabled={record.pending || draft.aiFallbackMode === "azure_only"}
            />
            {draft.aiFallbackMode === "azure_only" ? (
              <span className="queue-meta">Not used in Azure-only mode.</span>
            ) : null}
          </label>

          <label className="stack compact">
            <span className="queue-meta">AI reply policy (optional)</span>
            <textarea
              name="aiReplyPolicy"
              value={draft.aiReplyPolicy}
              rows={3}
              onChange={(event) => setDraft((prev) => ({ ...prev, aiReplyPolicy: event.target.value }))}
              disabled={record.pending}
              aria-disabled={record.pending}
            />
          </label>

          <label className="stack compact">
            <span className="queue-meta">AI system instruction override (optional)</span>
            <textarea
              name="aiSystemInstruction"
              value={draft.aiSystemInstruction}
              rows={3}
              onChange={(event) => setDraft((prev) => ({ ...prev, aiSystemInstruction: event.target.value }))}
              disabled={record.pending}
              aria-disabled={record.pending}
            />
          </label>

          <label className="stack compact">
            <span className="queue-meta">Active persona pack (optional)</span>
            <SearchableSelect
              name="activePersonaPackId"
              value={draft.activePersonaPackId}
              onChange={(event) => setDraft((prev) => ({ ...prev, activePersonaPackId: event.target.value }))}
              disabled={record.pending || personaPacksLoading}
              aria-disabled={record.pending || personaPacksLoading}
            >
              <option value="">None</option>
              {draft.activePersonaPackId &&
              !availablePersonaPacks.some((pack) => pack.id === draft.activePersonaPackId) ? (
                <option value={draft.activePersonaPackId}>{draft.activePersonaPackId} (Unavailable)</option>
              ) : null}
              {availablePersonaPacks.map((pack) => (
                <option key={pack.id} value={pack.id}>
                  {pack.name} ({pack.version})
                </option>
              ))}
            </SearchableSelect>
            {draft.activePersonaPackId ? (
              <span className="queue-meta">
                {availablePersonaPacks.find((pack) => pack.id === draft.activePersonaPackId)?.description || "Persona pack selected."}
              </span>
            ) : null}
          </label>

          <label className="stack compact">
            <span className="queue-meta">Quality gate mode</span>
            <SearchableSelect
              value={draft.qualityGateMode}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  qualityGateMode:
                    event.target.value === "manual_review"
                      ? "manual_review"
                      : event.target.value === "log_only"
                        ? "log_only"
                        : "auto_rewrite_once",
                }))
              }
              disabled={record.pending}
              aria-disabled={record.pending}
            >
              <option value="auto_rewrite_once">Auto rewrite once</option>
              <option value="manual_review">Manual review</option>
              <option value="log_only">Log only</option>
            </SearchableSelect>
          </label>

          <label className="stack compact">
            <span className="queue-meta">Quality gate threshold</span>
            <input
              type="number"
              min={0.4}
              max={0.95}
              step={0.01}
              value={draft.qualityGateThreshold}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  qualityGateThreshold: parseNumber(event.target.value, prev.qualityGateThreshold),
                }))
              }
              disabled={record.pending}
              aria-disabled={record.pending}
            />
          </label>

          <button type="submit" className="btn btn-primary" disabled={record.pending || !hasChanged} aria-disabled={record.pending || !hasChanged}>
            {record.pending ? "Saving..." : "Save"}
          </button>
        </form>
      </article>

      <article className="panel-card">
        <h3>Pacing & Review</h3>
        <div className="stack compact">
          <label className="stack compact">
            <span className="queue-meta">Ignore groups by default</span>
            <SearchableSelect
              value={draft.ignoreGroupsByDefault ? "true" : "false"}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  ignoreGroupsByDefault: event.target.value === "true",
                }))
              }
              disabled={record.pending}
              aria-disabled={record.pending}
            >
              <option value="true">Yes</option>
              <option value="false">No</option>
            </SearchableSelect>
          </label>

          <label className="stack compact">
            <span className="queue-meta">Enable reactions</span>
            <SearchableSelect
              value={draft.reactionsEnabled ? "true" : "false"}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  reactionsEnabled: event.target.value === "true",
                }))
              }
              disabled={record.pending}
              aria-disabled={record.pending}
            >
              <option value="true">Yes</option>
              <option value="false">No</option>
            </SearchableSelect>
          </label>

          <label className="stack compact">
            <span className="queue-meta">Enable stickers</span>
            <SearchableSelect
              value={draft.stickersEnabled ? "true" : "false"}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  stickersEnabled: event.target.value === "true",
                }))
              }
              disabled={record.pending}
              aria-disabled={record.pending}
            >
              <option value="true">Yes</option>
              <option value="false">No</option>
            </SearchableSelect>
          </label>

          <label className="stack compact">
            <span className="queue-meta">Enable memes</span>
            <SearchableSelect
              value={draft.memesEnabled ? "true" : "false"}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  memesEnabled: event.target.value === "true",
                }))
              }
              disabled={record.pending}
              aria-disabled={record.pending}
            >
              <option value="true">Yes</option>
              <option value="false">No</option>
            </SearchableSelect>
          </label>

          <label className="stack compact">
            <span className="queue-meta">Enable generated memes</span>
            <SearchableSelect
              value={draft.generatedMemesEnabled ? "true" : "false"}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  generatedMemesEnabled: event.target.value === "true",
                }))
              }
              disabled={record.pending || !draft.memesEnabled}
              aria-disabled={record.pending || !draft.memesEnabled}
            >
              <option value="true">Yes</option>
              <option value="false">No</option>
            </SearchableSelect>
          </label>

          <label className="stack compact">
            <span className="queue-meta">Auto-send generated memes</span>
            <SearchableSelect
              value={draft.generatedMemesAutoSendEnabled ? "true" : "false"}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  generatedMemesAutoSendEnabled: event.target.value === "true",
                }))
              }
              disabled={record.pending || !draft.generatedMemesEnabled || !draft.memesEnabled}
              aria-disabled={record.pending || !draft.generatedMemesEnabled || !draft.memesEnabled}
            >
              <option value="false">No (staged/manual first)</option>
              <option value="true">Yes (auto-send allowed)</option>
            </SearchableSelect>
          </label>

          <label className="stack compact">
            <span className="queue-meta">Meme thread cooldown (ms)</span>
            <input
              type="number"
              min={300000}
              max={604800000}
              step={1000}
              value={draft.memeThreadCooldownMs}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, memeThreadCooldownMs: parseNumber(event.target.value, prev.memeThreadCooldownMs) }))
              }
              disabled={record.pending || !draft.memesEnabled}
              aria-disabled={record.pending || !draft.memesEnabled}
            />
          </label>

          <label className="stack compact">
            <span className="queue-meta">Meme send probability (0-1)</span>
            <input
              type="number"
              min={0}
              max={1}
              step={0.01}
              value={draft.memeSendProbability}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, memeSendProbability: parseNumber(event.target.value, prev.memeSendProbability) }))
              }
              disabled={record.pending || !draft.memesEnabled}
              aria-disabled={record.pending || !draft.memesEnabled}
            />
          </label>

          <label className="stack compact">
            <span className="queue-meta">Identity-led voice</span>
            <SearchableSelect
              value={draft.soulModeEnabled ? "true" : "false"}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  soulModeEnabled: event.target.value === "true",
                }))
              }
              disabled={record.pending}
              aria-disabled={record.pending}
            >
              <option value="true">On (prioritize your tone and phrasing)</option>
              <option value="false">Off (use neutral tone)</option>
            </SearchableSelect>
          </label>

          <label className="stack compact">
            <span className="queue-meta">Humor learning</span>
            <SearchableSelect
              value={draft.humorLearningEnabled ? "true" : "false"}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  humorLearningEnabled: event.target.value === "true",
                }))
              }
              disabled={record.pending}
              aria-disabled={record.pending}
            >
              <option value="true">On (learn from positive funny signals)</option>
              <option value="false">Off</option>
            </SearchableSelect>
          </label>

          <label className="stack compact">
            <span className="queue-meta">Self-roast mode (safe)</span>
            <SearchableSelect
              value={draft.selfRoastModeEnabled ? "true" : "false"}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  selfRoastModeEnabled: event.target.value === "true",
                }))
              }
              disabled={record.pending}
              aria-disabled={record.pending}
            >
              <option value="false">Off</option>
              <option value="true">On (allow playful self-roast, keep profile facts accurate)</option>
            </SearchableSelect>
          </label>

          <label className="stack compact">
            <span className="queue-meta">Status auto-replies</span>
            <SearchableSelect
              value={draft.statusAutoReplyEnabled ? "true" : "false"}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  statusAutoReplyEnabled: event.target.value === "true",
                }))
              }
              disabled={record.pending}
              aria-disabled={record.pending}
            >
              <option value="true">On</option>
              <option value="false">Off</option>
            </SearchableSelect>
          </label>

          <label className="stack compact">
            <span className="queue-meta">Status auto-reply scope</span>
            <SearchableSelect
              value={draft.statusReplyRequireFunny ? "true" : "false"}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  statusReplyRequireFunny: event.target.value === "true",
                }))
              }
              disabled={record.pending || !draft.statusAutoReplyEnabled}
              aria-disabled={record.pending || !draft.statusAutoReplyEnabled}
            >
              <option value="true">Playful + science/tech + market signals</option>
              <option value="false">Any status text</option>
            </SearchableSelect>
            {!draft.statusAutoReplyEnabled ? <span className="queue-meta">Enable status auto-replies to use this.</span> : null}
            <span className="queue-meta">Status replies are skipped when a status contains a link or email.</span>
          </label>

          <label className="stack compact">
            <span className="queue-meta">Capture media from group chats</span>
            <SearchableSelect
              value={draft.captureGroupMediaEnabled ? "true" : "false"}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  captureGroupMediaEnabled: event.target.value === "true",
                }))
              }
              disabled={record.pending}
              aria-disabled={record.pending}
            >
              <option value="false">No (lower storage)</option>
              <option value="true">Yes (capture group media)</option>
            </SearchableSelect>
          </label>

          <label className="stack compact">
            <span className="queue-meta">Status retention window (ms)</span>
            <input
              type="number"
              min={300000}
              max={86400000}
              step={60000}
              value={draft.statusRetentionMs}
              onChange={(event) => setDraft((prev) => ({ ...prev, statusRetentionMs: parseNumber(event.target.value, prev.statusRetentionMs) }))}
              disabled={record.pending}
              aria-disabled={record.pending}
            />
            <span className="queue-meta">Older status context is removed from local storage.</span>
          </label>

          <label className="stack compact">
            <span className="queue-meta">Status cleanup interval (ms)</span>
            <input
              type="number"
              min={300000}
              max={86400000}
              step={60000}
              value={draft.statusCleanupIntervalMs}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, statusCleanupIntervalMs: parseNumber(event.target.value, prev.statusCleanupIntervalMs) }))
              }
              disabled={record.pending}
              aria-disabled={record.pending}
            />
          </label>

          <label className="stack compact">
            <span className="queue-meta">Status cleanup batch limit</span>
            <input
              type="number"
              min={20}
              max={800}
              step={1}
              value={draft.statusCleanupBatchLimit}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, statusCleanupBatchLimit: parseNumber(event.target.value, prev.statusCleanupBatchLimit) }))
              }
              disabled={record.pending}
              aria-disabled={record.pending}
            />
          </label>

          <label className="stack compact">
            <span className="queue-meta">Status context keep per thread</span>
            <input
              type="number"
              min={8}
              max={120}
              step={1}
              value={draft.statusContextKeepPerThread}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, statusContextKeepPerThread: parseNumber(event.target.value, prev.statusContextKeepPerThread) }))
              }
              disabled={record.pending}
              aria-disabled={record.pending}
            />
          </label>

          <label className="stack compact">
            <span className="queue-meta">Group context keep per thread</span>
            <input
              type="number"
              min={8}
              max={120}
              step={1}
              value={draft.groupContextKeepPerThread}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, groupContextKeepPerThread: parseNumber(event.target.value, prev.groupContextKeepPerThread) }))
              }
              disabled={record.pending}
              aria-disabled={record.pending}
            />
          </label>

          <label className="stack compact">
            <span className="queue-meta">Context compaction interval (ms)</span>
            <input
              type="number"
              min={120000}
              max={86400000}
              step={60000}
              value={draft.contextCompactionIntervalMs}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  contextCompactionIntervalMs: parseNumber(event.target.value, prev.contextCompactionIntervalMs),
                }))
              }
              disabled={record.pending}
              aria-disabled={record.pending}
            />
          </label>

          <label className="stack compact">
            <span className="queue-meta">Context compaction max threads</span>
            <input
              type="number"
              min={2}
              max={80}
              step={1}
              value={draft.contextCompactionMaxThreads}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, contextCompactionMaxThreads: parseNumber(event.target.value, prev.contextCompactionMaxThreads) }))
              }
              disabled={record.pending}
              aria-disabled={record.pending}
            />
          </label>

          <label className="stack compact">
            <span className="queue-meta">Context compaction max deletes</span>
            <input
              type="number"
              min={20}
              max={800}
              step={1}
              value={draft.contextCompactionMaxDeletes}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, contextCompactionMaxDeletes: parseNumber(event.target.value, prev.contextCompactionMaxDeletes) }))
              }
              disabled={record.pending}
              aria-disabled={record.pending}
            />
          </label>

          <RecipientPickerField
            label="Groups for aggressive context cleanup"
            helper="Leave empty to apply the cleanup policy to all recent groups."
            contacts={knownContacts}
            selectedJids={draft.compactContextGroupJids}
            disabled={record.pending}
            contactsLoading={contactsLoading}
            addPlaceholder="Add from previous groups"
            inputPlaceholder="Paste a group address"
            emptyLabel="No groups selected."
            contactFilter={(contact) => normalizeContactJid(contact.jid).endsWith("@g.us")}
            onAdd={addCompactContextGroup}
            onRemove={removeCompactContextGroup}
          />

          <label className="stack compact">
            <span className="queue-meta">Funny status keywords (comma or new line)</span>
            <textarea
              rows={3}
              value={draft.funnyStatusKeywords.join("\n")}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  funnyStatusKeywords: parseSimpleList(event.target.value, true),
                }))
              }
              disabled={record.pending}
              aria-disabled={record.pending}
            />
            <span className="queue-meta">
              Used for funny-status detection only; market-interest matching runs separately.
            </span>
          </label>

          <label className="stack compact">
            <span className="queue-meta">Funny status emojis (comma or new line)</span>
            <textarea
              rows={2}
              value={draft.funnyStatusEmojis.join("\n")}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  funnyStatusEmojis: parseSimpleList(event.target.value, false),
                }))
              }
              disabled={record.pending}
              aria-disabled={record.pending}
            />
          </label>

          <label className="stack compact">
            <span className="queue-meta">Send delay min (ms)</span>
            <input
              type="number"
              min={500}
              max={180000}
              step={100}
              value={draft.humanDelayMinMs}
              onChange={(event) => setDraft((prev) => ({ ...prev, humanDelayMinMs: parseNumber(event.target.value, prev.humanDelayMinMs) }))}
              disabled={record.pending}
              aria-disabled={record.pending}
            />
          </label>

          <label className="stack compact">
            <span className="queue-meta">Send delay max (ms)</span>
            <input
              type="number"
              min={500}
              max={240000}
              step={100}
              value={draft.humanDelayMaxMs}
              onChange={(event) => setDraft((prev) => ({ ...prev, humanDelayMaxMs: parseNumber(event.target.value, prev.humanDelayMaxMs) }))}
              disabled={record.pending}
              aria-disabled={record.pending}
            />
          </label>

          <label className="stack compact">
            <span className="queue-meta">Typing min (ms)</span>
            <input
              type="number"
              min={200}
              max={60000}
              step={50}
              value={draft.humanTypingMinMs}
              onChange={(event) => setDraft((prev) => ({ ...prev, humanTypingMinMs: parseNumber(event.target.value, prev.humanTypingMinMs) }))}
              disabled={record.pending}
              aria-disabled={record.pending}
            />
          </label>

          <label className="stack compact">
            <span className="queue-meta">Typing max (ms)</span>
            <input
              type="number"
              min={200}
              max={120000}
              step={50}
              value={draft.humanTypingMaxMs}
              onChange={(event) => setDraft((prev) => ({ ...prev, humanTypingMaxMs: parseNumber(event.target.value, prev.humanTypingMaxMs) }))}
              disabled={record.pending}
              aria-disabled={record.pending}
            />
          </label>

          <label className="stack compact">
            <span className="queue-meta">Outbox batch size</span>
            <input
              type="number"
              min={1}
              max={20}
              step={1}
              value={draft.outboxClaimLimit}
              onChange={(event) => setDraft((prev) => ({ ...prev, outboxClaimLimit: parseNumber(event.target.value, prev.outboxClaimLimit) }))}
              disabled={record.pending}
              aria-disabled={record.pending}
            />
          </label>

          <label className="stack compact">
            <span className="queue-meta">Outbox poll interval (ms)</span>
            <input
              type="number"
              min={500}
              max={60000}
              step={100}
              value={draft.outboxPollMs}
              onChange={(event) => setDraft((prev) => ({ ...prev, outboxPollMs: parseNumber(event.target.value, prev.outboxPollMs) }))}
              disabled={record.pending}
              aria-disabled={record.pending}
            />
          </label>

          <label className="stack compact">
            <span className="queue-meta">Inbound merge window (ms)</span>
            <input
              type="number"
              min={2000}
              max={180000}
              step={500}
              value={draft.inboundMergeWindowMs}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, inboundMergeWindowMs: parseNumber(event.target.value, prev.inboundMergeWindowMs) }))
              }
              disabled={record.pending}
              aria-disabled={record.pending}
            />
            <span className="queue-meta">
              Inbound messages in this window update the pending unsent reply instead of creating a new one.
            </span>
          </label>

          <label className="stack compact">
            <span className="queue-meta">Manual reply cooldown (ms)</span>
            <input
              type="number"
              min={0}
              max={7200000}
              step={1000}
              value={draft.manualInterventionCooldownMs}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  manualInterventionCooldownMs: parseNumber(event.target.value, prev.manualInterventionCooldownMs),
                }))
              }
              disabled={record.pending}
              aria-disabled={record.pending}
            />
            <span className="queue-meta">
              After you reply manually in WhatsApp, auto-replies pause for this duration in that chat.
            </span>
          </label>

          <label className="stack compact">
            <span className="queue-meta">Inbound worker concurrency</span>
            <input
              type="number"
              min={1}
              max={16}
              step={1}
              value={draft.inboundConcurrency}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  inboundConcurrency: parseNumber(event.target.value, prev.inboundConcurrency),
                }))
              }
              disabled={record.pending}
              aria-disabled={record.pending}
            />
          </label>

          <label className="stack compact">
            <span className="queue-meta">Outbound send concurrency</span>
            <input
              type="number"
              min={1}
              max={16}
              step={1}
              value={draft.outboxSendConcurrency}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  outboxSendConcurrency: parseNumber(event.target.value, prev.outboxSendConcurrency),
                }))
              }
              disabled={record.pending}
              aria-disabled={record.pending}
            />
          </label>

          <label className="stack compact">
            <span className="queue-meta">Quiet hours for automatic sends</span>
            <SearchableSelect
              value={draft.quietHoursEnabled ? "true" : "false"}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  quietHoursEnabled: event.target.value === "true",
                }))
              }
              disabled={record.pending}
              aria-disabled={record.pending}
            >
              <option value="false">Disabled</option>
              <option value="true">Enabled</option>
            </SearchableSelect>
          </label>

          <label className="stack compact">
            <span className="queue-meta">Quiet start hour (0-23)</span>
            <input
              type="number"
              min={0}
              max={23}
              step={1}
              value={draft.quietHoursStartHour}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, quietHoursStartHour: parseNumber(event.target.value, prev.quietHoursStartHour) }))
              }
              disabled={record.pending || !draft.quietHoursEnabled}
              aria-disabled={record.pending || !draft.quietHoursEnabled}
            />
          </label>

          <label className="stack compact">
            <span className="queue-meta">Quiet end hour (0-23)</span>
            <input
              type="number"
              min={0}
              max={23}
              step={1}
              value={draft.quietHoursEndHour}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, quietHoursEndHour: parseNumber(event.target.value, prev.quietHoursEndHour) }))
              }
              disabled={record.pending || !draft.quietHoursEnabled}
              aria-disabled={record.pending || !draft.quietHoursEnabled}
            />
            <span className="queue-meta">Server-local time window where automatic sends are deferred.</span>
          </label>

          <label className="stack compact">
            <span className="queue-meta">Auto-mark inbound as read</span>
            <SearchableSelect
              value={draft.autoMarkReadEnabled ? "true" : "false"}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  autoMarkReadEnabled: event.target.value === "true",
                }))
              }
              disabled={record.pending}
              aria-disabled={record.pending}
            >
              <option value="true">Enabled</option>
              <option value="false">Disabled</option>
            </SearchableSelect>
          </label>

          <label className="stack compact">
            <span className="queue-meta">Auto-mark group chats as read</span>
            <SearchableSelect
              value={draft.autoMarkReadGroups ? "true" : "false"}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  autoMarkReadGroups: event.target.value === "true",
                }))
              }
              disabled={record.pending || !draft.autoMarkReadEnabled}
              aria-disabled={record.pending || !draft.autoMarkReadEnabled}
            >
              <option value="false">Disabled</option>
              <option value="true">Enabled</option>
            </SearchableSelect>
          </label>

          <label className="stack compact">
            <span className="queue-meta">Auto-mark status as read</span>
            <SearchableSelect
              value={draft.autoMarkReadStatus ? "true" : "false"}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  autoMarkReadStatus: event.target.value === "true",
                }))
              }
              disabled={record.pending || !draft.autoMarkReadEnabled}
              aria-disabled={record.pending || !draft.autoMarkReadEnabled}
            >
              <option value="false">Disabled</option>
              <option value="true">Enabled</option>
            </SearchableSelect>
          </label>

          <label className="stack compact">
            <span className="queue-meta">Presence subscribe before typing</span>
            <SearchableSelect
              value={draft.presenceSubscribeEnabled ? "true" : "false"}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  presenceSubscribeEnabled: event.target.value === "true",
                }))
              }
              disabled={record.pending}
              aria-disabled={record.pending}
            >
              <option value="true">Enabled</option>
              <option value="false">Disabled</option>
            </SearchableSelect>
          </label>

          <label className="stack compact">
            <span className="queue-meta">Sync chat mute during quiet hours</span>
            <SearchableSelect
              value={draft.chatModifyQuietHoursEnabled ? "true" : "false"}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  chatModifyQuietHoursEnabled: event.target.value === "true",
                }))
              }
              disabled={record.pending || !draft.quietHoursEnabled}
              aria-disabled={record.pending || !draft.quietHoursEnabled}
            >
              <option value="false">Disabled</option>
              <option value="true">Enabled (mute/unmute chats)</option>
            </SearchableSelect>
            {!draft.quietHoursEnabled ? <span className="queue-meta">Enable quiet hours to use chat mute sync.</span> : null}
          </label>

          <label className="stack compact">
            <span className="queue-meta">Allow WhatsApp About text updates</span>
            <SearchableSelect
              value={draft.aboutAutomationEnabled ? "true" : "false"}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  aboutAutomationEnabled: event.target.value === "true",
                }))
              }
              disabled={record.pending}
              aria-disabled={record.pending}
            >
              <option value="false">Disabled</option>
              <option value="true">Enabled</option>
            </SearchableSelect>
          </label>

          <label className="stack compact">
            <span className="queue-meta">About update interval (minutes)</span>
            <input
              type="number"
              min={15}
              max={10080}
              step={1}
              value={draft.aboutAutomationIntervalMinutes}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  aboutAutomationIntervalMinutes: parseNumber(event.target.value, prev.aboutAutomationIntervalMinutes),
                }))
              }
              disabled={record.pending || !draft.aboutAutomationEnabled}
              aria-disabled={record.pending || !draft.aboutAutomationEnabled}
            />
          </label>

          <label className="stack compact">
            <span className="queue-meta">WhatsApp About template (optional)</span>
            <textarea
              rows={2}
              value={draft.aboutAutomationTemplate}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  aboutAutomationTemplate: event.target.value,
                }))
              }
              disabled={record.pending || !draft.aboutAutomationEnabled}
              aria-disabled={record.pending || !draft.aboutAutomationEnabled}
              placeholder="Odogwu HQ active • {date} {time}"
            />
            <span className="queue-meta">Supports placeholders: {"{date}"}, {"{time}"}, {"{datetime}"}.</span>
          </label>

          <label className="stack compact">
            <span className="queue-meta">Send rate window (minutes)</span>
            <input
              type="number"
              min={5}
              max={1440}
              step={1}
              value={draft.sendRateWindowMinutes}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, sendRateWindowMinutes: parseNumber(event.target.value, prev.sendRateWindowMinutes) }))
              }
              disabled={record.pending}
              aria-disabled={record.pending}
            />
          </label>

          <label className="stack compact">
            <span className="queue-meta">Per-thread send limit in window</span>
            <input
              type="number"
              min={1}
              max={100}
              step={1}
              value={draft.sendMaxPerThreadInWindow}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, sendMaxPerThreadInWindow: parseNumber(event.target.value, prev.sendMaxPerThreadInWindow) }))
              }
              disabled={record.pending}
              aria-disabled={record.pending}
            />
          </label>

          <label className="stack compact">
            <span className="queue-meta">Global send limit in window</span>
            <input
              type="number"
              min={1}
              max={1000}
              step={1}
              value={draft.sendMaxGlobalInWindow}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, sendMaxGlobalInWindow: parseNumber(event.target.value, prev.sendMaxGlobalInWindow) }))
              }
              disabled={record.pending}
              aria-disabled={record.pending}
            />
          </label>

          <div className="queue-item">
            <p className="queue-title">Automatic voice notes (VoxCPM)</p>
            <p className="queue-meta">
              Convert some outbound text drafts to cloned voice notes when intent matches your configured cues.
            </p>
          </div>

          <label className="stack compact">
            <span className="queue-meta">Allow automatic voice note replies</span>
            <SearchableSelect
              value={draft.voiceNotesAutoEnabled ? "true" : "false"}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  voiceNotesAutoEnabled: event.target.value === "true",
                }))
              }
              disabled={record.pending}
              aria-disabled={record.pending}
            >
              <option value="false">Disabled</option>
              <option value="true">Enabled</option>
            </SearchableSelect>
            <span className="queue-meta">
              Explicit `/vn` directives still send voice notes when you request them.
            </span>
          </label>

          <label className="stack compact">
            <span className="queue-meta">Auto voice-note probability (0-1)</span>
            <input
              type="number"
              min={0}
              max={1}
              step={0.01}
              value={draft.voiceNotesAutoProbability}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, voiceNotesAutoProbability: parseNumber(event.target.value, prev.voiceNotesAutoProbability) }))
              }
              disabled={record.pending || !draft.voiceNotesAutoEnabled}
              aria-disabled={record.pending || !draft.voiceNotesAutoEnabled}
            />
          </label>

          <label className="stack compact">
            <span className="queue-meta">Max auto voice notes per thread/day</span>
            <input
              type="number"
              min={1}
              max={12}
              step={1}
              value={draft.voiceNotesAutoMaxPerThreadPerDay}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  voiceNotesAutoMaxPerThreadPerDay: parseNumber(event.target.value, prev.voiceNotesAutoMaxPerThreadPerDay),
                }))
              }
              disabled={record.pending || !draft.voiceNotesAutoEnabled}
              aria-disabled={record.pending || !draft.voiceNotesAutoEnabled}
            />
          </label>

          <label className="stack compact">
            <span className="queue-meta">Voice-note intent keywords (comma or new line)</span>
            <textarea
              rows={3}
              value={draft.voiceNotesAutoNeedKeywords.join("\n")}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  voiceNotesAutoNeedKeywords: parseSimpleList(event.target.value, true),
                }))
              }
              disabled={record.pending || !draft.voiceNotesAutoEnabled}
              aria-disabled={record.pending || !draft.voiceNotesAutoEnabled}
            />
            <span className="queue-meta">Automatic mode only considers replies that contain at least one keyword.</span>
          </label>

          {instagramConnected ? (
            <>
              <div className="queue-item">
                <p className="queue-title">Instagram DM and Story Runtime</p>
                <p className="queue-meta">
                  Separate pacing for Instagram outbound DMs and story posting. WhatsApp settings stay unchanged.
                </p>
              </div>

              <label className="stack compact">
                <span className="queue-meta">IG DM delay min (ms)</span>
                <input
                  type="number"
                  min={500}
                  max={180000}
                  step={100}
                  value={draft.instagramDmDelayMinMs}
                  onChange={(event) =>
                    setDraft((prev) => ({ ...prev, instagramDmDelayMinMs: parseNumber(event.target.value, prev.instagramDmDelayMinMs) }))
                  }
                  disabled={record.pending}
                  aria-disabled={record.pending}
                />
              </label>

              <label className="stack compact">
                <span className="queue-meta">IG DM delay max (ms)</span>
                <input
                  type="number"
                  min={500}
                  max={240000}
                  step={100}
                  value={draft.instagramDmDelayMaxMs}
                  onChange={(event) =>
                    setDraft((prev) => ({ ...prev, instagramDmDelayMaxMs: parseNumber(event.target.value, prev.instagramDmDelayMaxMs) }))
                  }
                  disabled={record.pending}
                  aria-disabled={record.pending}
                />
              </label>

              <label className="stack compact">
                <span className="queue-meta">IG typing min (ms)</span>
                <input
                  type="number"
                  min={200}
                  max={60000}
                  step={100}
                  value={draft.instagramTypingMinMs}
                  onChange={(event) =>
                    setDraft((prev) => ({ ...prev, instagramTypingMinMs: parseNumber(event.target.value, prev.instagramTypingMinMs) }))
                  }
                  disabled={record.pending}
                  aria-disabled={record.pending}
                />
              </label>

              <label className="stack compact">
                <span className="queue-meta">IG typing max (ms)</span>
                <input
                  type="number"
                  min={200}
                  max={120000}
                  step={100}
                  value={draft.instagramTypingMaxMs}
                  onChange={(event) =>
                    setDraft((prev) => ({ ...prev, instagramTypingMaxMs: parseNumber(event.target.value, prev.instagramTypingMaxMs) }))
                  }
                  disabled={record.pending}
                  aria-disabled={record.pending}
                />
              </label>

              <label className="stack compact">
                <span className="queue-meta">IG rate window (minutes)</span>
                <input
                  type="number"
                  min={5}
                  max={1440}
                  step={1}
                  value={draft.instagramSendRateWindowMinutes}
                  onChange={(event) =>
                    setDraft((prev) => ({
                      ...prev,
                      instagramSendRateWindowMinutes: parseNumber(event.target.value, prev.instagramSendRateWindowMinutes),
                    }))
                  }
                  disabled={record.pending}
                  aria-disabled={record.pending}
                />
              </label>

              <label className="stack compact">
                <span className="queue-meta">IG max sends per thread in window</span>
                <input
                  type="number"
                  min={1}
                  max={100}
                  step={1}
                  value={draft.instagramSendMaxPerThreadInWindow}
                  onChange={(event) =>
                    setDraft((prev) => ({
                      ...prev,
                      instagramSendMaxPerThreadInWindow: parseNumber(event.target.value, prev.instagramSendMaxPerThreadInWindow),
                    }))
                  }
                  disabled={record.pending}
                  aria-disabled={record.pending}
                />
              </label>

              <label className="stack compact">
                <span className="queue-meta">IG max global sends in window</span>
                <input
                  type="number"
                  min={1}
                  max={1000}
                  step={1}
                  value={draft.instagramSendMaxGlobalInWindow}
                  onChange={(event) =>
                    setDraft((prev) => ({
                      ...prev,
                      instagramSendMaxGlobalInWindow: parseNumber(event.target.value, prev.instagramSendMaxGlobalInWindow),
                    }))
                  }
                  disabled={record.pending}
                  aria-disabled={record.pending}
                />
              </label>

              <label className="stack compact">
                <span className="queue-meta">IG story cadence (hours)</span>
                <input
                  type="number"
                  min={1}
                  max={168}
                  step={1}
                  value={draft.instagramStoryCadenceHours}
                  onChange={(event) =>
                    setDraft((prev) => ({
                      ...prev,
                      instagramStoryCadenceHours: parseNumber(event.target.value, prev.instagramStoryCadenceHours),
                    }))
                  }
                  disabled={record.pending}
                  aria-disabled={record.pending}
                />
              </label>

              <label className="stack compact">
                <span className="queue-meta">IG story daily max posts</span>
                <input
                  type="number"
                  min={1}
                  max={24}
                  step={1}
                  value={draft.instagramStoryDailyMaxPosts}
                  onChange={(event) =>
                    setDraft((prev) => ({
                      ...prev,
                      instagramStoryDailyMaxPosts: parseNumber(event.target.value, prev.instagramStoryDailyMaxPosts),
                    }))
                  }
                  disabled={record.pending}
                  aria-disabled={record.pending}
                />
              </label>
            </>
          ) : null}

          <p className="queue-meta">Most values apply live. Restart the worker after changing the poll interval.</p>

          {record.error ? (
            <p className="queue-meta action-inline-error" role="alert">
              {record.error}
            </p>
          ) : null}
        </div>
      </article>
          </>
        ) : null}

        {showConnections ? (
          <article className="panel-card settings-connection-card">
            <div className="settings-connection-header">
              <div>
                <h3>Connections</h3>
                <p className="queue-meta">Manage local sessions for every messaging platform enabled for this workspace.</p>
              </div>
            </div>
            <SetupWizard realtimeEnabled embedded includeVoiceOption={false} showNotices={false} />
          </article>
        ) : null}

        {showVoice ? (
          <article className="panel-card settings-voice-card">
            <div className="settings-voice-launch">
              <div>
                <p className="settings-eyebrow">Local voice</p>
                <h3>Voice sample</h3>
                <p className="queue-meta">
                  Record or replace the voice sample OdogwuHQ uses for local Vox voice notes in the same setup recorder.
                </p>
              </div>
              <Link className="btn btn-primary" href="/setup?connect=voice&returnTo=%2Fsettings%3Fsection%3Dvoice">
                Open voice setup
              </Link>
            </div>
          </article>
        ) : null}

        {showAutomation ? (
          <>
            <article className="panel-card">
        <h3>Romantic Contacts</h3>
        <div className="stack compact">
          <div className="stack compact">
            <RecipientPickerField
              label="Romantic contacts"
              helper="Select from previous WhatsApp contacts or paste one contact address."
              contacts={knownWhatsAppContacts}
              selectedJids={draft.romanticPartnerJids}
              disabled={record.pending}
              contactsLoading={contactsLoading}
              addPlaceholder="Add from previous WhatsApp contacts"
              inputPlaceholder="Paste a WhatsApp contact address"
              emptyLabel="No romantic contacts selected."
              onAdd={addRomanticPartner}
              onRemove={removeRomanticPartner}
            />
            {draft.romanticMorningEnabled && draft.romanticPartnerJids.length === 0 ? (
              <p className="queue-meta">
                Good-morning automation is enabled, but no romantic contacts are configured. Add at least one
                target so the protocol can prepare messages.
              </p>
            ) : null}
            <label className="stack compact">
              <span className="queue-meta">Allow adaptive good-morning drafts</span>
              <SearchableSelect
                value={draft.romanticMorningEnabled ? "true" : "false"}
                onChange={(event) =>
                  setDraft((prev) => ({
                    ...prev,
                    romanticMorningEnabled: event.target.value === "true",
                  }))
                }
                disabled={record.pending}
                aria-disabled={record.pending}
              >
                <option value="true">Yes</option>
                <option value="false">No</option>
              </SearchableSelect>
            </label>
            <label className="stack compact">
              <span className="queue-meta">Morning start hour (24h)</span>
              <input
                type="number"
                min={0}
                max={23}
                step={1}
                value={draft.romanticMorningStartHour}
                onChange={(event) =>
                  setDraft((prev) => ({
                    ...prev,
                    romanticMorningStartHour: parseNumber(event.target.value, prev.romanticMorningStartHour),
                  }))
                }
                disabled={record.pending || !draft.romanticMorningEnabled}
                aria-disabled={record.pending || !draft.romanticMorningEnabled}
              />
            </label>
            <label className="stack compact">
              <span className="queue-meta">Morning end hour (24h)</span>
              <input
                type="number"
                min={0}
                max={23}
                step={1}
                value={draft.romanticMorningEndHour}
                onChange={(event) =>
                  setDraft((prev) => ({
                    ...prev,
                    romanticMorningEndHour: parseNumber(event.target.value, prev.romanticMorningEndHour),
                  }))
                }
                disabled={record.pending || !draft.romanticMorningEnabled}
                aria-disabled={record.pending || !draft.romanticMorningEnabled}
              />
            </label>
            <label className="stack compact">
              <span className="queue-meta">Lead opener ratio: {Math.round(draft.romanticMorningLeadRatio * 100)}%</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={draft.romanticMorningLeadRatio}
                onChange={(event) =>
                  setDraft((prev) => ({
                    ...prev,
                    romanticMorningLeadRatio: parseNumber(event.target.value, prev.romanticMorningLeadRatio),
                  }))
                }
                disabled={record.pending || !draft.romanticMorningEnabled}
                aria-disabled={record.pending || !draft.romanticMorningEnabled}
              />
            </label>
            <label className="stack compact">
              <span className="queue-meta">Starter collision cooldown (hours)</span>
              <input
                type="number"
                min={1}
                max={72}
                step={1}
                value={draft.romanticMorningCollisionCooldownHours}
                onChange={(event) =>
                  setDraft((prev) => ({
                    ...prev,
                    romanticMorningCollisionCooldownHours: parseNumber(
                      event.target.value,
                      prev.romanticMorningCollisionCooldownHours,
                    ),
                  }))
                }
                disabled={record.pending || !draft.romanticMorningEnabled}
                aria-disabled={record.pending || !draft.romanticMorningEnabled}
              />
            </label>
            <label className="stack compact">
              <span className="queue-meta">Max good-morning drafts per thread/day</span>
              <input
                type="number"
                min={1}
                max={3}
                step={1}
                value={draft.romanticMorningMaxPerThreadPerDay}
                onChange={(event) =>
                  setDraft((prev) => ({
                    ...prev,
                    romanticMorningMaxPerThreadPerDay: parseNumber(
                      event.target.value,
                      prev.romanticMorningMaxPerThreadPerDay,
                    ),
                  }))
                }
                disabled={record.pending || !draft.romanticMorningEnabled}
                aria-disabled={record.pending || !draft.romanticMorningEnabled}
              />
            </label>
          </div>
        </div>
      </article>

            <article className="panel-card">
        <h3>Proactive Outreach</h3>
        <div className="stack compact">
          <label className="stack compact">
            <span className="queue-meta">Allow proactive check-in drafts</span>
            <SearchableSelect
              value={draft.outreachEnabled ? "true" : "false"}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  outreachEnabled: event.target.value === "true",
                }))
              }
              disabled={record.pending}
              aria-disabled={record.pending}
            >
              <option value="true">Yes</option>
              <option value="false">No</option>
            </SearchableSelect>
          </label>

          <label className="stack compact">
            <span className="queue-meta">Cadence (hours per contact)</span>
            <input
              type="number"
              min={6}
              max={336}
              step={1}
              value={draft.outreachCadenceHours}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  outreachCadenceHours: parseNumber(event.target.value, prev.outreachCadenceHours),
                }))
              }
              disabled={record.pending}
              aria-disabled={record.pending}
            />
          </label>

          <label className="stack compact">
            <span className="queue-meta">Max contacts per run</span>
            <input
              type="number"
              min={1}
              max={25}
              step={1}
              value={draft.outreachMaxContactsPerRun}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  outreachMaxContactsPerRun: parseNumber(event.target.value, prev.outreachMaxContactsPerRun),
                }))
              }
              disabled={record.pending}
              aria-disabled={record.pending}
            />
          </label>

          <div className="stack compact">
            <RecipientPickerField
              label="Fixed outreach contacts"
              helper="Choose previous contacts or paste contact addresses."
              contacts={knownContacts}
              selectedJids={draft.outreachContactJids}
              disabled={record.pending}
              contactsLoading={contactsLoading}
              addPlaceholder="Add from previous contacts"
              inputPlaceholder="Paste contact addresses"
              emptyLabel="No fixed outreach contacts selected."
              onAdd={addOutreachContact}
              onRemove={removeOutreachContact}
            />
            {draft.outreachEnabled && draft.outreachContactJids.length === 0 ? (
              <p className="queue-meta">
                Proactive outreach is enabled, but no fixed contacts are configured. Add at least one contact to activate
                scheduled outreach drafts.
              </p>
            ) : null}
          </div>

          <label className="stack compact">
            <span className="queue-meta">Starter template</span>
            <textarea
              rows={3}
              value={draft.outreachStarterTemplate}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  outreachStarterTemplate: event.target.value,
                }))
              }
              disabled={record.pending}
              aria-disabled={record.pending}
            />
            <span className="queue-meta">Supports {"{{name}}"} and optional {"{{icebreaker}}"}.</span>
          </label>
        </div>
      </article>

            <article className="panel-card">
        <h3>Conversation Intelligence</h3>
        <div className="stack compact">
          <label className="stack compact">
            <span className="queue-meta">Enable conversation signal tracking</span>
            <SearchableSelect
              value={draft.conversationIntelligenceEnabled ? "true" : "false"}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  conversationIntelligenceEnabled: event.target.value === "true",
                }))
              }
              disabled={record.pending}
              aria-disabled={record.pending}
            >
              <option value="true">Yes</option>
              <option value="false">No</option>
            </SearchableSelect>
          </label>

          <label className="stack compact">
            <span className="queue-meta">Mutual check-in recency target (days)</span>
            <input
              type="number"
              min={1}
              max={60}
              step={1}
              value={draft.checkInRecencyTargetDays}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  checkInRecencyTargetDays: parseNumber(event.target.value, prev.checkInRecencyTargetDays),
                }))
              }
              disabled={record.pending || !draft.conversationIntelligenceEnabled}
              aria-disabled={record.pending || !draft.conversationIntelligenceEnabled}
            />
          </label>

          <label className="stack compact">
            <span className="queue-meta">Max active topic lanes per thread</span>
            <input
              type="number"
              min={1}
              max={12}
              step={1}
              value={draft.topicLaneMaxActive}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  topicLaneMaxActive: parseNumber(event.target.value, prev.topicLaneMaxActive),
                }))
              }
              disabled={record.pending || !draft.conversationIntelligenceEnabled}
              aria-disabled={record.pending || !draft.conversationIntelligenceEnabled}
            />
          </label>

          <label className="stack compact">
            <span className="queue-meta">Topic-ending acknowledgement threshold</span>
            <input
              type="number"
              min={1}
              max={12}
              step={1}
              value={draft.topicDyingAckStreakThreshold}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  topicDyingAckStreakThreshold: parseNumber(event.target.value, prev.topicDyingAckStreakThreshold),
                }))
              }
              disabled={record.pending || !draft.conversationIntelligenceEnabled}
              aria-disabled={record.pending || !draft.conversationIntelligenceEnabled}
            />
          </label>

          <label className="stack compact">
            <span className="queue-meta">Enable anti-dwelling guards</span>
            <SearchableSelect
              value={draft.antiDwellingEnabled ? "true" : "false"}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  antiDwellingEnabled: event.target.value === "true",
                }))
              }
              disabled={record.pending || !draft.conversationIntelligenceEnabled}
              aria-disabled={record.pending || !draft.conversationIntelligenceEnabled}
            >
              <option value="true">Yes</option>
              <option value="false">No</option>
            </SearchableSelect>
          </label>

          <label className="stack compact">
            <span className="queue-meta">Conversation-close cooldown (minutes)</span>
            <input
              type="number"
              min={5}
              max={1440}
              step={1}
              value={draft.antiDwellingEndgameCloseCooldownMinutes}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  antiDwellingEndgameCloseCooldownMinutes: parseNumber(
                    event.target.value,
                    prev.antiDwellingEndgameCloseCooldownMinutes,
                  ),
                }))
              }
              disabled={record.pending || !draft.conversationIntelligenceEnabled || !draft.antiDwellingEnabled}
              aria-disabled={record.pending || !draft.conversationIntelligenceEnabled || !draft.antiDwellingEnabled}
            />
          </label>

          <label className="stack compact">
            <span className="queue-meta">Topic turn soft limit</span>
            <input
              type="number"
              min={2}
              max={20}
              step={1}
              value={draft.antiDwellingTopicTurnSoftLimit}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  antiDwellingTopicTurnSoftLimit: parseNumber(event.target.value, prev.antiDwellingTopicTurnSoftLimit),
                }))
              }
              disabled={record.pending || !draft.conversationIntelligenceEnabled || !draft.antiDwellingEnabled}
              aria-disabled={record.pending || !draft.conversationIntelligenceEnabled || !draft.antiDwellingEnabled}
            />
          </label>

          <label className="stack compact">
            <span className="queue-meta">Topic turn hard limit</span>
            <input
              type="number"
              min={3}
              max={30}
              step={1}
              value={draft.antiDwellingTopicTurnHardLimit}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  antiDwellingTopicTurnHardLimit: parseNumber(event.target.value, prev.antiDwellingTopicTurnHardLimit),
                }))
              }
              disabled={record.pending || !draft.conversationIntelligenceEnabled || !draft.antiDwellingEnabled}
              aria-disabled={record.pending || !draft.conversationIntelligenceEnabled || !draft.antiDwellingEnabled}
            />
            <span className="queue-meta">Hard limit should be greater than soft limit. Invalid ranges are clamped before use.</span>
          </label>

          <label className="stack compact">
            <span className="queue-meta">Allow pivot replies</span>
            <SearchableSelect
              value={draft.pivotReplyEnabled ? "true" : "false"}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  pivotReplyEnabled: event.target.value === "true",
                }))
              }
              disabled={record.pending || !draft.conversationIntelligenceEnabled}
              aria-disabled={record.pending || !draft.conversationIntelligenceEnabled}
            >
              <option value="true">Yes</option>
              <option value="false">No</option>
            </SearchableSelect>
          </label>

          <label className="stack compact">
            <span className="queue-meta">Allow lead-pivot mode</span>
            <SearchableSelect
              value={draft.topicLeadPivotEnabled ? "true" : "false"}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  topicLeadPivotEnabled: event.target.value === "true",
                }))
              }
              disabled={record.pending || !draft.conversationIntelligenceEnabled || !draft.pivotReplyEnabled}
              aria-disabled={record.pending || !draft.conversationIntelligenceEnabled || !draft.pivotReplyEnabled}
            >
              <option value="true">Yes</option>
              <option value="false">No</option>
            </SearchableSelect>
          </label>

          <label className="stack compact">
            <span className="queue-meta">Lead-pivot minimum vibe score</span>
            <input
              type="number"
              min={0}
              max={1}
              step={0.01}
              value={draft.topicLeadPivotMinVibeScore}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  topicLeadPivotMinVibeScore: parseNumber(event.target.value, prev.topicLeadPivotMinVibeScore),
                }))
              }
              disabled={
                record.pending ||
                !draft.conversationIntelligenceEnabled ||
                !draft.pivotReplyEnabled ||
                !draft.topicLeadPivotEnabled
              }
              aria-disabled={
                record.pending ||
                !draft.conversationIntelligenceEnabled ||
                !draft.pivotReplyEnabled ||
                !draft.topicLeadPivotEnabled
              }
            />
          </label>

          <label className="stack compact">
            <span className="queue-meta">Lead-pivot cooldown (minutes)</span>
            <input
              type="number"
              min={5}
              max={1440}
              step={1}
              value={draft.topicLeadPivotCooldownMinutes}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  topicLeadPivotCooldownMinutes: parseNumber(event.target.value, prev.topicLeadPivotCooldownMinutes),
                }))
              }
              disabled={
                record.pending ||
                !draft.conversationIntelligenceEnabled ||
                !draft.pivotReplyEnabled ||
                !draft.topicLeadPivotEnabled
              }
              aria-disabled={
                record.pending ||
                !draft.conversationIntelligenceEnabled ||
                !draft.pivotReplyEnabled ||
                !draft.topicLeadPivotEnabled
              }
            />
          </label>
        </div>
      </article>

            <article className="panel-card">
        <h3>Auto Status Builder</h3>
        <div className="stack compact">
          <label className="stack compact">
            <span className="queue-meta">Allow automatic status posting</span>
            <SearchableSelect
              value={draft.statusBuilderEnabled ? "true" : "false"}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  statusBuilderEnabled: event.target.value === "true",
                }))
              }
              disabled={record.pending}
              aria-disabled={record.pending}
            >
              <option value="true">Yes</option>
              <option value="false">No</option>
            </SearchableSelect>
          </label>

          <label className="stack compact">
            <span className="queue-meta">Cadence (hours between posts)</span>
            <input
              type="number"
              min={1}
              max={168}
              step={1}
              value={draft.statusBuilderCadenceHours}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  statusBuilderCadenceHours: parseNumber(event.target.value, prev.statusBuilderCadenceHours),
                }))
              }
              disabled={record.pending || !draft.statusBuilderEnabled}
              aria-disabled={record.pending || !draft.statusBuilderEnabled}
            />
          </label>

          <label className="stack compact">
            <span className="queue-meta">Max posts per 24 hours</span>
            <input
              type="number"
              min={1}
              max={24}
              step={1}
              value={draft.statusBuilderDailyMaxPosts}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  statusBuilderDailyMaxPosts: parseNumber(event.target.value, prev.statusBuilderDailyMaxPosts),
                }))
              }
              disabled={record.pending || !draft.statusBuilderEnabled}
              aria-disabled={record.pending || !draft.statusBuilderEnabled}
            />
          </label>

          <label className="stack compact">
            <span className="queue-meta">
              Text-only share ratio: {Math.round(draft.statusBuilderTextPostRatio * 100)}%
            </span>
            <input
              type="range"
              min={0}
              max={STATUS_BUILDER_MAX_TEXT_POST_RATIO}
              step={0.05}
              value={draft.statusBuilderTextPostRatio}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  statusBuilderTextPostRatio: parseNumber(event.target.value, prev.statusBuilderTextPostRatio),
                }))
              }
              disabled={record.pending || !draft.statusBuilderEnabled}
              aria-disabled={record.pending || !draft.statusBuilderEnabled}
            />
            <span className="queue-meta">Lower values favor meme-image statuses; text share is capped so memes stay the majority.</span>
          </label>

          <label className="stack compact">
            <span className="queue-meta">
              Manual review sampling: {Math.round(draft.statusBuilderReviewRatio * 100)}%
            </span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={draft.statusBuilderReviewRatio}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  statusBuilderReviewRatio: parseNumber(event.target.value, prev.statusBuilderReviewRatio),
                }))
              }
              disabled={record.pending || !draft.statusBuilderEnabled}
              aria-disabled={record.pending || !draft.statusBuilderEnabled}
            />
            <span className="queue-meta">Share of generated statuses routed to manual approval before posting.</span>
          </label>

          <label className="stack compact">
            <span className="queue-meta">Status audience mode</span>
            <SearchableSelect
              value={draft.statusPostAudienceMode}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  statusPostAudienceMode: event.target.value === "manual_allowlist" ? "manual_allowlist" : "whatsapp_privacy",
                }))
              }
              disabled={record.pending || !draft.statusBuilderEnabled}
              aria-disabled={record.pending || !draft.statusBuilderEnabled}
            >
              <option value="whatsapp_privacy">Respect WhatsApp privacy settings</option>
              <option value="manual_allowlist">Manual allowlist (selected contacts)</option>
            </SearchableSelect>
            <span className="queue-meta">
              Privacy mode posts to My Status using your WhatsApp privacy setting. Manual allowlist mode sends only to selected contacts and skips posting when the allowlist is empty.
            </span>
          </label>

          <label className="stack compact">
            <span className="queue-meta">Trend sampling audience cap</span>
            <input
              type="number"
              min={10}
              max={256}
              step={1}
              value={draft.statusBuilderAudienceSampleSize}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  statusBuilderAudienceSampleSize: parseNumber(event.target.value, prev.statusBuilderAudienceSampleSize),
                }))
              }
              disabled={record.pending || !draft.statusBuilderEnabled}
              aria-disabled={record.pending || !draft.statusBuilderEnabled}
            />
            <span className="queue-meta">
              {draft.statusPostAudienceMode === "manual_allowlist"
                ? "Used for trend sampling and status allowlist delivery."
                : "Used for trend sampling only. Delivery follows your WhatsApp status privacy setting."}
            </span>
          </label>

          <RecipientPickerField
            label={draft.statusPostAudienceMode === "manual_allowlist" ? "Status audience" : "Trend sampling audience"}
            helper={
              draft.statusPostAudienceMode === "manual_allowlist"
                ? "Used for trend sampling and status allowlist delivery."
                : "Optional. Delivery still follows your WhatsApp status privacy setting."
            }
            contacts={knownContacts}
            selectedJids={draft.statusBuilderAudienceJids}
            disabled={record.pending || !draft.statusBuilderEnabled}
            contactsLoading={contactsLoading}
            addPlaceholder="Add from previous contacts"
            inputPlaceholder="Paste contact addresses"
            emptyLabel="No audience contacts selected."
            onAdd={addStatusAudience}
            onRemove={removeStatusAudience}
          />
        </div>
      </article>
          </>
        ) : null}

        {showPersonality ? (
          <article className="panel-card">
        <h3>Personality Profiles</h3>
        <p className="queue-meta">Profiles are reusable voices. Pick one to edit, or make a new one for a different kind of conversation.</p>
        {profilesLoading ? (
          <LoadingBlock label="Loading personality profiles…" rows={4} />
        ) : profiles.length > 0 ? (
          <div className="personality-settings-flow">
            <div className="personality-profile-picker" aria-label="Choose a personality profile">
              <div className="personality-section-head">
                <div>
                  <h3>Choose a profile</h3>
                  <p className="queue-meta">Select the voice you want to inspect or edit.</p>
                </div>
              </div>
              <div className="personality-profile-list">
                {profiles.map((profile) => {
                  const selected = profile.slug === selectedEditorSlug;
                  return (
                    <button
                      key={profile.slug}
                      type="button"
                      className={`personality-profile-option ${selected ? "personality-profile-option-active" : ""}`}
                      aria-pressed={selected}
                      onClick={() => setEditorSlug(profile.slug)}
                    >
                      <span>
                        <strong>{profile.name}</strong>
                        <small>{profile.description || "No description yet."}</small>
                      </span>
                      <em>{profile.isDefault ? "Default" : "Custom"}</em>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="personality-editor-pane">
              {selectedEditorProfile ? (
                <>
                  <div className="personality-selected-summary">
                    <div>
                      <p className="settings-eyebrow">Selected profile</p>
                      <h3>{selectedEditorProfile.name}</h3>
                      <p className="queue-meta">{selectedEditorProfile.description || "Add a short note so this profile is easy to recognize."}</p>
                    </div>
                    <dl>
                      <div>
                        <dt>Short ID</dt>
                        <dd>{selectedEditorProfile.slug}</dd>
                      </div>
                      <div>
                        <dt>Strength</dt>
                        <dd>{Math.round(clamp01(selectedEditorProfile.defaultIntensity) * 100)}%</dd>
                      </div>
                    </dl>
                  </div>

                  <ProfileEditorForm
                    key={`${selectedEditorProfile.slug}:${selectedEditorProfile.updatedAt || 0}`}
                    profile={selectedEditorProfile}
                    pending={profileRecord.pending}
                    error={profileRecord.error}
                    onSave={saveProfile}
                  />

                  <div className="personality-secondary-actions">
                    {selectedEditorProfile.isDefault ? (
                      <p className="queue-meta">Default profiles stay available so you always have a safe fallback.</p>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => removeProfile(selectedEditorProfile.slug)}
                        disabled={profileRecord.pending}
                        aria-disabled={profileRecord.pending}
                      >
                        Delete this custom profile
                      </button>
                    )}
                  </div>
                </>
              ) : null}
            </div>

            <details className="personality-config-block personality-create-panel">
              <summary>
                <span>Make a new profile</span>
                <small>Use this for a different voice, audience, or situation.</small>
              </summary>
              <label className="setup-input-group">
                <span className="queue-meta">Short ID</span>
                <input value={newProfileSlug} onChange={(event) => setNewProfileSlug(event.target.value)} placeholder="family_warm" />
                <span className="queue-meta">Lowercase words with underscores work best. You will not need this day to day.</span>
              </label>
              <label className="setup-input-group">
                <span className="queue-meta">Name</span>
                <input value={newProfileName} onChange={(event) => setNewProfileName(event.target.value)} placeholder="Family Warm" />
              </label>
              <label className="setup-input-group">
                <span className="queue-meta">When to use it</span>
                <input value={newProfileDescription} onChange={(event) => setNewProfileDescription(event.target.value)} placeholder="Gentle and caring." />
              </label>
              <label className="setup-input-group">
                <span className="queue-meta">How replies should sound</span>
                <textarea rows={3} value={newProfilePrompt} onChange={(event) => setNewProfilePrompt(event.target.value)} />
              </label>
              <label className="setup-input-group">
                <span className="queue-meta">Style strength: {Math.round(newProfileIntensity * 100)}%</span>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={newProfileIntensity}
                  onChange={(event) => setNewProfileIntensity(Number(event.target.value))}
                />
              </label>
              <button
                type="button"
                className="btn btn-primary"
                onClick={createProfile}
                disabled={profileRecord.pending || !newProfileSlug.trim() || !newProfileName.trim() || !newProfilePrompt.trim()}
                aria-disabled={profileRecord.pending || !newProfileSlug.trim() || !newProfileName.trim() || !newProfilePrompt.trim()}
              >
                Create profile
              </button>
            </details>

            <details className="personality-config-block personality-history-panel">
              <summary>
                <span>Previous saves</span>
                <small>Restore an older version if a profile starts feeling off.</small>
              </summary>
              <div className="stack">
                {profileVersionsLoading ? <LoadingBlock label="Loading profile history…" rows={2} compact /> : null}
                {(profileVersions || []).map((version) => (
                  <div key={version._id} className="queue-item">
                    <p className="queue-title">
                      v{version.versionNumber} · {version.name}
                    </p>
                    <p className="queue-meta">
                      {version.reason || "snapshot"} · {formatDateTime(version.createdAt)}
                    </p>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => rollbackProfile(version._id)}
                      disabled={profileRecord.pending}
                      aria-disabled={profileRecord.pending}
                    >
                      Rollback to This
                    </button>
                  </div>
                ))}
                {profileVersions !== undefined && profileVersions.length === 0 ? (
                  <EmptyState
                    variant="style"
                    compact
                    title="No history entries yet."
                    description="Profile snapshots will appear here after saves so you can roll back."
                  />
                ) : null}
              </div>
            </details>
          </div>
        ) : (
          <div className="personality-settings-flow">
            <EmptyState
              variant="style"
              title="No personality profiles yet."
              description="Create one profile to save a clear voice for replies."
            />
            <details className="personality-config-block personality-create-panel" open>
              <summary>
                <span>Make your first profile</span>
                <small>Start with a simple name and a few tone notes.</small>
              </summary>
              <label className="setup-input-group">
                <span className="queue-meta">Short ID</span>
                <input value={newProfileSlug} onChange={(event) => setNewProfileSlug(event.target.value)} placeholder="family_warm" />
              </label>
              <label className="setup-input-group">
                <span className="queue-meta">Name</span>
                <input value={newProfileName} onChange={(event) => setNewProfileName(event.target.value)} placeholder="Family Warm" />
              </label>
              <label className="setup-input-group">
                <span className="queue-meta">When to use it</span>
                <input value={newProfileDescription} onChange={(event) => setNewProfileDescription(event.target.value)} placeholder="Gentle and caring." />
              </label>
              <label className="setup-input-group">
                <span className="queue-meta">How replies should sound</span>
                <textarea rows={3} value={newProfilePrompt} onChange={(event) => setNewProfilePrompt(event.target.value)} />
              </label>
              <button
                type="button"
                className="btn btn-primary"
                onClick={createProfile}
                disabled={profileRecord.pending || !newProfileSlug.trim() || !newProfileName.trim() || !newProfilePrompt.trim()}
                aria-disabled={profileRecord.pending || !newProfileSlug.trim() || !newProfileName.trim() || !newProfilePrompt.trim()}
              >
                Create profile
              </button>
            </details>
          </div>
        )}
      </article>
        ) : null}

        {showMedia ? (
          <article className="panel-card">
        <h3>Media Library</h3>
        <p className="queue-meta">Add images that OdogwuHQ can use as stickers or memes. Keep names and tags simple so they are easy to choose later.</p>
        <div className="media-settings-flow">
          <aside className="media-upload-panel" aria-label="Add media">
            <div className="personality-section-head">
              <div>
                <h3>Add media</h3>
                <p className="queue-meta">Upload one sticker or meme at a time.</p>
              </div>
            </div>
            <label className="setup-input-group">
              <span className="queue-meta">Type</span>
              <SearchableSelect
                value={assetKind}
                onChange={(event) => setAssetKind(event.target.value === "meme" ? "meme" : "sticker")}
                disabled={mediaRecord.pending}
                aria-disabled={mediaRecord.pending}
              >
                <option value="sticker">Sticker</option>
                <option value="meme">Meme</option>
              </SearchableSelect>
            </label>
            <label className="setup-input-group">
              <span className="queue-meta">Name</span>
              <input
                type="text"
                value={assetLabel}
                onChange={(event) => setAssetLabel(event.target.value)}
                disabled={mediaRecord.pending}
                aria-disabled={mediaRecord.pending}
                placeholder={assetKind === "meme" ? "Side-eye reaction" : "Laughing sticker"}
              />
            </label>
            <label className="setup-input-group">
              <span className="queue-meta">Tags</span>
              <input
                type="text"
                value={assetTags}
                onChange={(event) => setAssetTags(event.target.value)}
                disabled={mediaRecord.pending}
                aria-disabled={mediaRecord.pending}
                placeholder="funny, greeting, apology"
              />
              <span className="queue-meta">Separate tags with commas.</span>
            </label>
            <label className="setup-input-group">
              <span className="queue-meta">Image file</span>
              <input
                type="file"
                accept="image/*,.webp"
                onChange={(event: ChangeEvent<HTMLInputElement>) => setAssetFile(event.target.files?.[0] || null)}
                disabled={mediaRecord.pending}
                aria-disabled={mediaRecord.pending}
              />
            </label>
            <button
              type="button"
              className="btn btn-primary"
              onClick={uploadAsset}
              disabled={mediaRecord.pending || !assetFile}
              aria-disabled={mediaRecord.pending || !assetFile}
            >
              {mediaRecord.pending ? "Adding..." : "Add to library"}
            </button>
          </aside>

          <div className="media-library-pane">
            <div className="media-library-summary">
              <div>
                <p className="settings-eyebrow">Library</p>
                <h3>Your media</h3>
                <p className="queue-meta">
                  {curatedMediaAssets.length === 0
                    ? "No stickers or memes yet."
                    : `${enabledMediaCount} of ${curatedMediaAssets.length} available for replies.`}
                </p>
              </div>
              <dl>
                <div>
                  <dt>Stickers</dt>
                  <dd>{stickerCount}</dd>
                </div>
                <div>
                  <dt>Memes</dt>
                  <dd>{memeCount}</dd>
                </div>
              </dl>
            </div>

            <details className="media-cleanup-panel">
              <summary>
                <span>Duplicate cleanup</span>
                <small>
                  {suggestedMerges.length > 0
                    ? `${suggestedMerges.length} possible duplicate${suggestedMerges.length === 1 ? "" : "s"} found.`
                    : "Possible duplicates will appear here."}
                </small>
              </summary>
              <div className="media-cleanup-actions">
                <label className="queue-meta media-inline-check">
                  <input
                    type="checkbox"
                    checked={autoMergeSuggestionsEnabled}
                    onChange={(event) => setAutoMergeSuggestionsEnabled(event.target.checked)}
                    disabled={mediaRecord.pending}
                    aria-disabled={mediaRecord.pending}
                  />
                  Automatically merge future matches
                </label>
                {suggestedMerges.length > 0 ? (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => mergeAllSuggestedPairs({ requireConfirm: true })}
                    disabled={mediaRecord.pending}
                    aria-disabled={mediaRecord.pending}
                  >
                    Merge all
                  </button>
                ) : null}
              </div>
              <p className="queue-meta">Matches are based on similar appearance or exact file content.</p>
              {suggestedMergeGroups.map((group) => (
                <div key={group.groupKey} className="stack compact">
                  <p className="queue-title">
                    {group.label} · {group.items.length} pair{group.items.length === 1 ? "" : "s"}
                  </p>
                  {group.items.map((suggestion) => (
                    <div key={suggestion.key} className="queue-item">
                      <p className="queue-title">
                        Merge {suggestion.sourceLabel} into {suggestion.targetLabel} ({suggestion.kind})
                      </p>
                      <p className="queue-meta">
                        Similarity {Math.round(suggestion.score * 100)}%
                        {suggestion.similaritySource === "visual_hash"
                          ? suggestion.distanceBits !== undefined
                            ? ` · visual distance ${suggestion.distanceBits} bits`
                            : " · visual match"
                          : " · exact file match"}
                      </p>
                      <div className="queue-actions">
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => mergeSuggestedPair(suggestion.sourceAssetId, suggestion.targetAssetId)}
                          disabled={mediaRecord.pending}
                          aria-disabled={mediaRecord.pending}
                        >
                          Merge this pair
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
              {!mediaAssetsLoading && curatedMediaAssets.length > 1 && suggestedMerges.length === 0 ? (
                <EmptyState
                  variant="settings"
                  compact
                  title="No duplicate suggestions."
                  description="This library looks clean right now."
                />
              ) : null}
              {autoMergeSuggestionsEnabled && suggestedMerges.length > 0 ? (
                <p className="queue-meta">Automatic cleanup is on for new matching batches.</p>
              ) : null}
            </details>

            <div className="media-settings-grid">
              {mediaAssetsLoading ? <LoadingBlock label="Loading media assets…" rows={3} compact /> : null}
              {curatedMediaAssets.map((asset) => (
                <article
                  key={asset._id}
                  className={`media-settings-card ${asset.enabled ? "" : "media-settings-card-disabled"}`}
                >
                <div className="media-settings-preview-shell">
                  {asset.fileUrl ? (
                    <a href={asset.fileUrl} target="_blank" rel="noreferrer" className="media-settings-preview-link" aria-label={`Open ${asset.label}`}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={asset.fileUrl} alt={asset.label || `${asset.kind} preview`} className="media-settings-preview-image" loading="lazy" />
                    </a>
                  ) : (
                    <p className="queue-meta media-settings-preview-empty">Preview unavailable.</p>
                  )}
                </div>
                <div className="media-settings-card-body">
                  <div className="media-settings-card-head">
                    <div>
                      <p className="queue-title">{asset.label}</p>
                      <p className="queue-meta">{asset.kind === "sticker" ? "Sticker" : "Meme"}</p>
                    </div>
                    <span className={asset.enabled ? "media-status-pill" : "media-status-pill media-status-pill-muted"}>
                      {asset.enabled ? "On" : "Off"}
                    </span>
                  </div>
                  {asset.tags.length > 0 ? (
                    <div className="media-tag-row" aria-label={`${asset.label} tags`}>
                      {asset.tags.slice(0, 6).map((tag) => (
                        <span key={tag}>{tag}</span>
                      ))}
                    </div>
                  ) : (
                    <p className="queue-meta">No tags yet.</p>
                  )}
                  {asset.contextSummary ? <p className="queue-meta">Use when: {asset.contextSummary}</p> : null}
                {asset.contextUpdatedAt ? (
                  <p className="queue-meta">
                    Notes updated {formatDateTime(asset.contextUpdatedAt)}
                    {asset.contextConfidence !== undefined ? ` · confidence ${Math.round(asset.contextConfidence * 100)}%` : ""}
                  </p>
                ) : null}

                {editingAssetId === asset._id ? (
                  <div className="media-asset-edit-panel">
                    <label className="setup-input-group">
                      <span className="queue-meta">Name</span>
                      <input value={editAssetLabel} onChange={(event) => setEditAssetLabel(event.target.value)} disabled={mediaRecord.pending} />
                    </label>
                    <label className="setup-input-group">
                      <span className="queue-meta">Tags</span>
                      <textarea rows={2} value={editAssetTags} onChange={(event) => setEditAssetTags(event.target.value)} disabled={mediaRecord.pending} />
                    </label>
                    <label className="setup-input-group">
                      <span className="queue-meta">Use when</span>
                      <textarea
                        rows={2}
                        value={editContextSummary}
                        onChange={(event) => setEditContextSummary(event.target.value)}
                        disabled={mediaRecord.pending}
                      />
                    </label>
                    <label className="setup-input-group">
                      <span className="queue-meta">Context tags</span>
                      <textarea
                        rows={2}
                        value={editContextTags}
                        onChange={(event) => setEditContextTags(event.target.value)}
                        disabled={mediaRecord.pending}
                      />
                    </label>
                    <label className="setup-input-group">
                      <span className="queue-meta">Good moments</span>
                      <textarea
                        rows={2}
                        value={editContextTriggers}
                        onChange={(event) => setEditContextTriggers(event.target.value)}
                        disabled={mediaRecord.pending}
                      />
                    </label>
                    <label className="setup-input-group">
                      <span className="queue-meta">Avoid when</span>
                      <textarea
                        rows={2}
                        value={editContextAvoid}
                        onChange={(event) => setEditContextAvoid(event.target.value)}
                        disabled={mediaRecord.pending}
                      />
                    </label>
                    <label className="setup-input-group">
                      <span className="queue-meta">Confidence (0-1)</span>
                      <input
                        type="number"
                        min={0}
                        max={1}
                        step={0.01}
                        value={editContextConfidence}
                        onChange={(event) => setEditContextConfidence(event.target.value)}
                        disabled={mediaRecord.pending}
                      />
                    </label>
                    <div className="queue-actions">
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => saveAssetEdit(asset._id)}
                        disabled={mediaRecord.pending}
                        aria-disabled={mediaRecord.pending}
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={cancelAssetEdit}
                        disabled={mediaRecord.pending}
                        aria-disabled={mediaRecord.pending}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : null}

                <div className="queue-actions">
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => (editingAssetId === asset._id ? cancelAssetEdit() : startAssetEdit(asset))}
                    disabled={mediaRecord.pending}
                    aria-disabled={mediaRecord.pending}
                  >
                    {editingAssetId === asset._id ? "Close" : "Edit notes"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() =>
                      void runAction(
                        mediaKey,
                        async () => {
                          await toggleAsset({
                            ...tenantScope,
                            assetId: asset._id as Id<"mediaAssets">,
                            enabled: !asset.enabled,
                          });
                        },
                        {
                          pendingLabel: "Updating asset...",
                          successMessage: "Asset updated.",
                        },
                      )
                    }
                    disabled={mediaRecord.pending}
                    aria-disabled={mediaRecord.pending}
                  >
                    {asset.enabled ? "Turn off" : "Turn on"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => {
                      if (!window.confirm(`Delete "${asset.label}"?`)) {
                        return;
                      }
                      void runAction(
                        mediaKey,
                        async () => {
                          await deleteAsset({
                            ...tenantScope,
                            assetId: asset._id as Id<"mediaAssets">,
                          });
                          if (editingAssetId === asset._id) {
                            cancelAssetEdit();
                          }
                        },
                        {
                          pendingLabel: "Deleting asset...",
                          successMessage: "Asset deleted.",
                        },
                      );
                    }}
                    disabled={mediaRecord.pending}
                    aria-disabled={mediaRecord.pending}
                  >
                    Delete
                  </button>
                </div>
                </div>

              </article>
              ))}
              {!mediaAssetsLoading && curatedMediaAssets.length === 0 ? (
                <EmptyState
                  variant="media"
                  title="No media assets yet."
                  description="Add a sticker or meme and it will appear here."
                />
              ) : null}
            </div>
          </div>
        </div>
      </article>
        ) : null}

        {showStyle ? (
          <div className="settings-embedded-section">
            <LiveStyleLab />
          </div>
        ) : null}

        {showRules ? (
          <div className="settings-embedded-section">
            <LiveRules />
          </div>
        ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
