"use client";

import { ActionNotices } from "@/components/action-notices";
import { useActionStateRegistry } from "@/lib/ui/action-state";
import { formatDateTime } from "@/lib/format";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";

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
  statusBuilderEnabled: boolean;
  statusBuilderCadenceHours: number;
  statusBuilderDailyMaxPosts: number;
  statusBuilderTextPostRatio: number;
  statusBuilderReviewRatio: number;
  statusBuilderAudienceJids: string[];
  statusBuilderAudienceSampleSize: number;
};

type KnownContact = {
  _id: string;
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
  qualityGateMode: "auto_rewrite_once" | "manual_review" | "log_only";
  qualityGateThreshold: number;
  packs: Array<{
    id: string;
    name: string;
    version: string;
    description: string;
    allowedProfileSlugs: string[];
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
};

type SetupState = {
  status?: "idle" | "starting" | "authenticating" | "qr_ready" | "code_ready" | "challenge_required" | "syncing" | "connected" | "error";
  hasAuth?: boolean;
  listenerActive?: boolean;
};

function toState(source: Partial<SettingsState> | undefined): SettingsState {
  return {
    ignoreGroupsByDefault: source?.ignoreGroupsByDefault ?? true,
    reactionsEnabled: source?.reactionsEnabled ?? true,
    stickersEnabled: source?.stickersEnabled ?? true,
    memesEnabled: source?.memesEnabled ?? true,
    generatedMemesEnabled: source?.generatedMemesEnabled ?? true,
    generatedMemesAutoSendEnabled: source?.generatedMemesAutoSendEnabled ?? false,
    memeThreadCooldownMs: source?.memeThreadCooldownMs ?? 3 * 60 * 60 * 1000,
    memeSendProbability: source?.memeSendProbability ?? 0.3,
    soulModeEnabled: source?.soulModeEnabled ?? true,
    humorLearningEnabled: source?.humorLearningEnabled ?? true,
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
    qualityGateMode: source?.qualityGateMode ?? "auto_rewrite_once",
    qualityGateThreshold: source?.qualityGateThreshold ?? 0.72,
    humanDelayMinMs: source?.humanDelayMinMs ?? 22000,
    humanDelayMaxMs: source?.humanDelayMaxMs ?? 95000,
    humanTypingMinMs: source?.humanTypingMinMs ?? 4000,
    humanTypingMaxMs: source?.humanTypingMaxMs ?? 14000,
    outboxClaimLimit: source?.outboxClaimLimit ?? 8,
    outboxPollMs: source?.outboxPollMs ?? 3000,
    inboundMergeWindowMs: source?.inboundMergeWindowMs ?? 45000,
    manualInterventionCooldownMs: source?.manualInterventionCooldownMs ?? 120000,
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
    sendRateWindowMinutes: source?.sendRateWindowMinutes ?? 60,
    sendMaxPerThreadInWindow: source?.sendMaxPerThreadInWindow ?? 4,
    sendMaxGlobalInWindow: source?.sendMaxGlobalInWindow ?? 40,
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
    statusBuilderEnabled: source?.statusBuilderEnabled ?? true,
    statusBuilderCadenceHours: source?.statusBuilderCadenceHours ?? 2,
    statusBuilderDailyMaxPosts: source?.statusBuilderDailyMaxPosts ?? 10,
    statusBuilderTextPostRatio: source?.statusBuilderTextPostRatio ?? 0.4,
    statusBuilderReviewRatio: source?.statusBuilderReviewRatio ?? 0.35,
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
    nearlyEqual(a.sendRateWindowMinutes, b.sendRateWindowMinutes) &&
    nearlyEqual(a.sendMaxPerThreadInWindow, b.sendMaxPerThreadInWindow) &&
    nearlyEqual(a.sendMaxGlobalInWindow, b.sendMaxGlobalInWindow) &&
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
    a.statusBuilderEnabled === b.statusBuilderEnabled &&
    nearlyEqual(a.statusBuilderCadenceHours, b.statusBuilderCadenceHours) &&
    nearlyEqual(a.statusBuilderDailyMaxPosts, b.statusBuilderDailyMaxPosts) &&
    nearlyEqual(a.statusBuilderTextPostRatio, b.statusBuilderTextPostRatio) &&
    nearlyEqual(a.statusBuilderReviewRatio, b.statusBuilderReviewRatio) &&
    a.statusBuilderAudienceJids.join("\n") === b.statusBuilderAudienceJids.join("\n") &&
    nearlyEqual(a.statusBuilderAudienceSampleSize, b.statusBuilderAudienceSampleSize)
  );
}

function parseNumber(value: string, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseContactJids(value: string) {
  return [...new Set(value.split("\n").map((item) => item.trim()).filter(Boolean))];
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

function clamp01(value: number) {
  if (!Number.isFinite(value)) {
    return 0.7;
  }
  return Math.max(0, Math.min(value, 1));
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
    <div className="personality-config-block">
      <h3>Edit Profile</h3>
      <label className="setup-input-group">
        <span className="queue-meta">Display Name</span>
        <input type="text" value={name} onChange={(event) => setName(event.target.value)} disabled={pending} aria-disabled={pending} />
      </label>

      <label className="setup-input-group">
        <span className="queue-meta">Description</span>
        <input
          type="text"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          disabled={pending}
          aria-disabled={pending}
        />
      </label>

      <label className="setup-input-group">
        <span className="queue-meta">Behavior Prompt</span>
        <textarea rows={4} value={prompt} onChange={(event) => setPrompt(event.target.value)} disabled={pending} aria-disabled={pending} />
      </label>

      <label className="setup-input-group">
        <span className="queue-meta">Default Intensity: {Math.round(defaultIntensity * 100)}%</span>
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
        {pending ? "Saving..." : "Save Profile"}
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
  const saveSettings = useMutation(api.settings.save);
  const upsertPersonalityProfile = useMutation(api.personality.upsertProfile);
  const deletePersonalityProfile = useMutation(api.personality.deleteProfile);
  const rollbackProfileVersion = useMutation(api.personality.rollbackProfileVersion);
  const generateUploadUrl = useMutation(api.media.generateUploadUrl);
  const registerAsset = useMutation(api.media.registerAsset);
  const toggleAsset = useMutation(api.media.toggleAsset);
  const deleteAsset = useMutation(api.media.deleteAsset);
  const settings = useQuery(api.settings.get, {}) as SettingsState | undefined;
  const defaults = useQuery(api.settings.defaults, {}) as SettingsState | undefined;
  const instagramSetup = useQuery(api.system.setupStatus, { provider: "instagram" }) as SetupState | null | undefined;
  const contacts = useQuery(api.threads.listContacts, { limit: 300 }) as KnownContact[] | undefined;
  const profilesQuery = useQuery(api.personality.listProfiles, {}) as PersonalityProfile[] | undefined;
  const personaPacks = useQuery(api.personality.listPersonaPacks, {}) as PersonaPacksPayload | undefined;
  const mediaAssets = useQuery(api.media.listAssets, {}) as MediaAsset[] | undefined;
  const curatedMediaAssets = (mediaAssets || []).filter((asset) => asset.kind === "sticker" || asset.kind === "meme");
  const settingsLoading = settings === undefined || defaults === undefined;
  const contactsLoading = contacts === undefined;
  const profilesLoading = profilesQuery === undefined;
  const personaPacksLoading = personaPacks === undefined;
  const { runAction, getRecord, notices, dismissNotice } = useActionStateRegistry();
  const key = "settings:save";
  const profileKey = "personality:profile";
  const mediaKey = "media:library";

  const remoteState = useMemo(() => toState(settings), [settings]);
  const defaultState = useMemo(() => toState(defaults), [defaults]);
  const knownContacts = useMemo(() => contacts || [], [contacts]);
  const profiles = profilesQuery || [];
  const availablePersonaPacks = personaPacks?.packs || [];
  const [draft, setDraft] = useState<SettingsState>(remoteState);
  const [editorSlug, setEditorSlug] = useState("");
  const [assetKind, setAssetKind] = useState<"sticker" | "meme">("sticker");
  const [assetLabel, setAssetLabel] = useState("");
  const [assetTags, setAssetTags] = useState("");
  const [assetFile, setAssetFile] = useState<File | null>(null);
  const [newProfileSlug, setNewProfileSlug] = useState("");
  const [newProfileName, setNewProfileName] = useState("");
  const [newProfileDescription, setNewProfileDescription] = useState("");
  const [newProfilePrompt, setNewProfilePrompt] = useState("");
  const [newProfileIntensity, setNewProfileIntensity] = useState(0.65);

  useEffect(() => {
    setDraft(remoteState);
  }, [remoteState]);

  const selectedEditorSlug = editorSlug || profiles[0]?.slug || "";
  const selectedEditorProfile = profiles.find((profile) => profile.slug === selectedEditorSlug) || null;
  const instagramConnected = Boolean(
    instagramSetup?.hasAuth || instagramSetup?.listenerActive || instagramSetup?.status === "connected",
  );
  const profileVersions = useQuery(
    api.personality.listProfileVersions,
    selectedEditorProfile ? { slug: selectedEditorProfile.slug, limit: 20 } : "skip",
  ) as PersonalityProfileVersion[] | undefined;

  const hasChanged = useMemo(() => !stateEquals(draft, remoteState), [draft, remoteState]);
  const record = getRecord(key);
  const profileRecord = getRecord(profileKey);
  const mediaRecord = getRecord(mediaKey);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!hasChanged) {
      return;
    }

    void runAction(
      key,
      async () => {
        await saveSettings({
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
          sendRateWindowMinutes: Math.round(draft.sendRateWindowMinutes),
          sendMaxPerThreadInWindow: Math.round(draft.sendMaxPerThreadInWindow),
          sendMaxGlobalInWindow: Math.round(draft.sendMaxGlobalInWindow),
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
          statusBuilderEnabled: draft.statusBuilderEnabled,
          statusBuilderCadenceHours: Math.round(draft.statusBuilderCadenceHours),
          statusBuilderDailyMaxPosts: Math.round(draft.statusBuilderDailyMaxPosts),
          statusBuilderTextPostRatio: draft.statusBuilderTextPostRatio,
          statusBuilderReviewRatio: draft.statusBuilderReviewRatio,
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

  const restoreDefaults = () => {
    setDraft(defaultState);
  };

  const addOutreachContact = (jid: string) => {
    const normalized = jid.trim();
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
    const normalized = jid.trim();
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
        await deletePersonalityProfile({ slug });
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

        await registerAsset({
          kind: assetKind,
          label: assetLabel.trim() || assetFile.name,
          tags: parseTagInput(assetTags),
          fileId: payload.storageId as Id<"_storage">,
          mimeType: assetFile.type || "application/octet-stream",
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

  if (settingsLoading) {
    return (
      <section className="panel-grid two-col">
        <article className="panel-card">
          <ActionNotices notices={notices} onDismiss={dismissNotice} />
          <h3>AI Runtime</h3>
          <p className="empty-line">Loading settings…</p>
        </article>
        <article className="panel-card">
          <h3>Pacing & Queue</h3>
          <p className="empty-line">Loading worker defaults…</p>
        </article>
      </section>
    );
  }

  return (
    <section className="panel-grid two-col">
      <article className="panel-card">
        <ActionNotices notices={notices} onDismiss={dismissNotice} />
        <h3>AI Runtime</h3>
        <form onSubmit={onSubmit} className="stack compact" aria-busy={record.pending}>
          <label className="stack compact">
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
          </label>

          <label className="stack compact">
            <span className="queue-meta">Max output tokens</span>
            <input
              type="number"
              min={40}
              max={1000}
              step={1}
              value={draft.aiMaxOutputTokens}
              onChange={(event) => setDraft((prev) => ({ ...prev, aiMaxOutputTokens: parseNumber(event.target.value, prev.aiMaxOutputTokens) }))}
              disabled={record.pending}
              aria-disabled={record.pending}
            />
          </label>

          <label className="stack compact">
            <span className="queue-meta">Max reply chars</span>
            <input
              type="number"
              min={60}
              max={1200}
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
              max={40}
              step={1}
              value={draft.aiHistoryLineLimit}
              onChange={(event) => setDraft((prev) => ({ ...prev, aiHistoryLineLimit: parseNumber(event.target.value, prev.aiHistoryLineLimit) }))}
              disabled={record.pending}
              aria-disabled={record.pending}
            />
          </label>

          <label className="stack compact">
            <span className="queue-meta">Fallback mode</span>
            <select
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
            </select>
          </label>

          <label className="stack compact">
            <span className="queue-meta">Model-first generation</span>
            <select
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
              <option value="false">Disabled (legacy steering bypass)</option>
              <option value="true">Enabled (GPT-5.4 first)</option>
            </select>
          </label>

          <label className="stack compact">
            <span className="queue-meta">Ack routing via model</span>
            <select
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
              <option value="false">Disabled (reaction-only heuristic)</option>
              <option value="true">Enabled (reaction vs text by model)</option>
            </select>
          </label>

          <label className="stack compact">
            <span className="queue-meta">Deterministic steering modes</span>
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
            <span className="queue-meta">One mode per line (or comma separated).</span>
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
            <select
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
            </select>
            {draft.activePersonaPackId ? (
              <span className="queue-meta">
                {availablePersonaPacks.find((pack) => pack.id === draft.activePersonaPackId)?.description || "Persona pack selected."}
              </span>
            ) : null}
          </label>

          <label className="stack compact">
            <span className="queue-meta">Quality gate mode</span>
            <select
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
            </select>
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

          <div className="topbar-controls">
            <button
              type="submit"
              className="btn btn-primary"
              disabled={record.pending || !hasChanged}
              aria-disabled={record.pending || !hasChanged}
            >
              {record.pending ? "Saving..." : "Save Settings"}
            </button>
            <button
              type="button"
              className="btn"
              onClick={restoreDefaults}
              disabled={record.pending}
              aria-disabled={record.pending}
            >
              Restore Defaults
            </button>
          </div>
        </form>
      </article>

      <article className="panel-card">
        <h3>Pacing & Queue</h3>
        <div className="stack compact">
          <label className="stack compact">
            <span className="queue-meta">Ignore groups by default</span>
            <select
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
            </select>
          </label>

          <label className="stack compact">
            <span className="queue-meta">Enable reactions</span>
            <select
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
            </select>
          </label>

          <label className="stack compact">
            <span className="queue-meta">Enable stickers</span>
            <select
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
            </select>
          </label>

          <label className="stack compact">
            <span className="queue-meta">Enable memes</span>
            <select
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
            </select>
          </label>

          <label className="stack compact">
            <span className="queue-meta">Enable generated memes</span>
            <select
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
            </select>
          </label>

          <label className="stack compact">
            <span className="queue-meta">Auto-send generated memes</span>
            <select
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
            </select>
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
            <span className="queue-meta">Soul mode</span>
            <select
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
              <option value="true">On (identity-led voice: everything sounds like me)</option>
              <option value="false">Off (neutral tone)</option>
            </select>
          </label>

          <label className="stack compact">
            <span className="queue-meta">Humor learning</span>
            <select
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
            </select>
          </label>

          <label className="stack compact">
            <span className="queue-meta">Status auto-replies</span>
            <select
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
            </select>
          </label>

          <label className="stack compact">
            <span className="queue-meta">Status reply mode</span>
            <select
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
            </select>
            {!draft.statusAutoReplyEnabled ? <span className="queue-meta">Enable status auto-replies to use this.</span> : null}
            <span className="queue-meta">Status replies are skipped when a status contains a link or email.</span>
          </label>

          <label className="stack compact">
            <span className="queue-meta">Capture media from group chats</span>
            <select
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
            </select>
          </label>

          <label className="stack compact">
            <span className="queue-meta">Status retention (ms)</span>
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
            <span className="queue-meta">Older status entries are removed.</span>
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

          <label className="stack compact">
            <span className="queue-meta">Aggressive-compaction group JIDs (optional, one per line)</span>
            <textarea
              rows={4}
              placeholder={"1234567890-123456789@g.us\n9876543210-111222333@g.us"}
              value={draft.compactContextGroupJids.join("\n")}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  compactContextGroupJids: parseContactJids(event.target.value),
                }))
              }
              disabled={record.pending}
              aria-disabled={record.pending}
            />
            <span className="queue-meta">Leave empty to include all recent groups.</span>
          </label>

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
              Used by playful detection; market-interest matching runs separately.
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
            <span className="queue-meta">Delay min (ms)</span>
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
            <span className="queue-meta">Delay max (ms)</span>
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
            <span className="queue-meta">Outbox claim limit</span>
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
            <span className="queue-meta">Manual interruption cooldown (ms)</span>
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
              After a manual WhatsApp reply, auto-replies pause for this duration in that chat.
            </span>
          </label>

          <label className="stack compact">
            <span className="queue-meta">Quiet hours</span>
            <select
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
            </select>
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
            <span className="queue-meta">Server-local time window where sends are deferred.</span>
          </label>

          <label className="stack compact">
            <span className="queue-meta">Rate window (minutes)</span>
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
            <span className="queue-meta">Max sends per thread in window</span>
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
            <span className="queue-meta">Max global sends in window</span>
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

          {instagramConnected ? (
            <>
              <div className="queue-item">
                <p className="queue-title">Instagram DM + Story Runtime</p>
                <p className="queue-meta">
                  Separate pacing for Instagram outbound DMs and story posting. WhatsApp settings above remain unchanged.
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

          <p className="queue-meta">Most values apply live. Restart the worker after changing poll interval.</p>

          {record.error ? (
            <p className="queue-meta action-inline-error" role="alert">
              {record.error}
            </p>
          ) : null}
        </div>
      </article>

      <article className="panel-card">
        <h3>Proactive Outreach</h3>
        <div className="stack compact">
          <label className="stack compact">
            <span className="queue-meta">Enable proactive check-ins</span>
            <select
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
            </select>
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

          <label className="stack compact">
            <span className="queue-meta">Fixed contacts (one WhatsApp JID per line)</span>
            <select
              value=""
              onChange={(event) => {
                if (!event.target.value) {
                  return;
                }
                addOutreachContact(event.target.value);
              }}
              disabled={record.pending || contactsLoading}
              aria-disabled={record.pending || contactsLoading}
            >
              <option value="">{contactsLoading ? "Loading previous contacts..." : "Add from previous contacts"}</option>
              {knownContacts.map((contact) => (
                <option key={contact._id} value={contact.jid}>
                  {contact.title ? `${contact.title} (${contact.jid})` : contact.jid}
                </option>
              ))}
            </select>
            <textarea
              rows={6}
              placeholder={"2348012345678@s.whatsapp.net\n2348098765432@s.whatsapp.net"}
              value={draft.outreachContactJids.join("\n")}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  outreachContactJids: parseContactJids(event.target.value),
                }))
              }
              disabled={record.pending}
              aria-disabled={record.pending}
            />
            {draft.outreachContactJids.length > 0 ? (
              <div className="stack compact">
                {draft.outreachContactJids.map((jid) => (
                  <div key={jid} className="queue-item">
                    <p className="queue-body">{jid}</p>
                    <div className="queue-actions">
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => removeOutreachContact(jid)}
                        disabled={record.pending}
                        aria-disabled={record.pending}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </label>

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
        <h3>Auto Status Builder</h3>
        <div className="stack compact">
          <label className="stack compact">
            <span className="queue-meta">Enable auto status posting</span>
            <select
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
            </select>
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
              max={1}
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
            <span className="queue-meta">Lower = more meme-image statuses; higher = more text statuses.</span>
          </label>

          <label className="stack compact">
            <span className="queue-meta">
              Manual-review sampling: {Math.round(draft.statusBuilderReviewRatio * 100)}%
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
            <span className="queue-meta">Sampled share of auto-statuses routed to manual approval.</span>
          </label>

          <label className="stack compact">
            <span className="queue-meta">Audience size cap per status post</span>
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
          </label>

          <label className="stack compact">
            <span className="queue-meta">Fixed audience JIDs (optional; leave empty to auto-pick active contacts)</span>
            <select
              value=""
              onChange={(event) => {
                if (!event.target.value) {
                  return;
                }
                addStatusAudience(event.target.value);
              }}
              disabled={record.pending || contactsLoading || !draft.statusBuilderEnabled}
              aria-disabled={record.pending || contactsLoading || !draft.statusBuilderEnabled}
            >
              <option value="">{contactsLoading ? "Loading contacts..." : "Add from previous contacts"}</option>
              {knownContacts.map((contact) => (
                <option key={contact._id} value={contact.jid}>
                  {contact.title ? `${contact.title} (${contact.jid})` : contact.jid}
                </option>
              ))}
            </select>
            <textarea
              rows={5}
              placeholder={"2348012345678@s.whatsapp.net\n2348098765432@s.whatsapp.net"}
              value={draft.statusBuilderAudienceJids.join("\n")}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  statusBuilderAudienceJids: parseContactJids(event.target.value),
                }))
              }
              disabled={record.pending || !draft.statusBuilderEnabled}
              aria-disabled={record.pending || !draft.statusBuilderEnabled}
            />
            {draft.statusBuilderAudienceJids.length > 0 ? (
              <div className="stack compact">
                {draft.statusBuilderAudienceJids.map((jid) => (
                  <div key={jid} className="queue-item">
                    <p className="queue-body">{jid}</p>
                    <div className="queue-actions">
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => removeStatusAudience(jid)}
                        disabled={record.pending || !draft.statusBuilderEnabled}
                        aria-disabled={record.pending || !draft.statusBuilderEnabled}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </label>
        </div>
      </article>

      <article className="panel-card">
        <h3>Personality Profiles</h3>
        {profilesLoading ? (
          <p className="empty-line">Loading personality profiles…</p>
        ) : profiles.length > 0 ? (
          <div className="stack compact">
            <div className="personality-config-block">
              <p className="queue-meta">Profiles are global across all conversations.</p>
              <label className="setup-input-group">
                <span className="queue-meta">Profile to Edit</span>
                <select value={selectedEditorSlug} onChange={(event) => setEditorSlug(event.target.value)}>
                  {profiles.map((profile) => (
                    <option key={profile.slug} value={profile.slug}>
                      {profile.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {selectedEditorProfile ? (
              <ProfileEditorForm
                key={`${selectedEditorProfile.slug}:${selectedEditorProfile.updatedAt || 0}`}
                profile={selectedEditorProfile}
                pending={profileRecord.pending}
                error={profileRecord.error}
                onSave={saveProfile}
              />
            ) : null}

            {selectedEditorProfile && !selectedEditorProfile.isDefault ? (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => removeProfile(selectedEditorProfile.slug)}
                disabled={profileRecord.pending}
                aria-disabled={profileRecord.pending}
              >
                Delete Profile
              </button>
            ) : null}

            <div className="personality-config-block">
              <h3>Create Profile</h3>
              <label className="setup-input-group">
                <span className="queue-meta">Slug</span>
                <input value={newProfileSlug} onChange={(event) => setNewProfileSlug(event.target.value)} placeholder="family_warm" />
              </label>
              <label className="setup-input-group">
                <span className="queue-meta">Name</span>
                <input value={newProfileName} onChange={(event) => setNewProfileName(event.target.value)} placeholder="Family Warm" />
              </label>
              <label className="setup-input-group">
                <span className="queue-meta">Description</span>
                <input value={newProfileDescription} onChange={(event) => setNewProfileDescription(event.target.value)} placeholder="Gentle and caring." />
              </label>
              <label className="setup-input-group">
                <span className="queue-meta">Prompt</span>
                <textarea rows={3} value={newProfilePrompt} onChange={(event) => setNewProfilePrompt(event.target.value)} />
              </label>
              <label className="setup-input-group">
                <span className="queue-meta">Default Intensity: {Math.round(newProfileIntensity * 100)}%</span>
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
                Create Profile
              </button>
            </div>

            <div className="personality-config-block">
              <h3>Profile Version History</h3>
              <div className="stack">
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
                  <p className="empty-line">No history entries yet.</p>
                ) : null}
              </div>
            </div>
          </div>
        ) : (
          <p className="empty-line">No personality profiles configured yet.</p>
        )}
      </article>

      <article className="panel-card">
        <h3>Media Library</h3>
        <p className="queue-meta">Upload sticker and meme assets for outbound use.</p>
        <div className="stack compact">
          <label className="setup-input-group">
            <span className="queue-meta">Kind</span>
            <select
              value={assetKind}
              onChange={(event) => setAssetKind(event.target.value === "meme" ? "meme" : "sticker")}
              disabled={mediaRecord.pending}
              aria-disabled={mediaRecord.pending}
            >
              <option value="sticker">Sticker</option>
              <option value="meme">Meme</option>
            </select>
          </label>
          <label className="setup-input-group">
            <span className="queue-meta">Label</span>
            <input
              type="text"
              value={assetLabel}
              onChange={(event) => setAssetLabel(event.target.value)}
              disabled={mediaRecord.pending}
              aria-disabled={mediaRecord.pending}
            />
          </label>
          <label className="setup-input-group">
            <span className="queue-meta">Tags (comma separated)</span>
            <input
              type="text"
              value={assetTags}
              onChange={(event) => setAssetTags(event.target.value)}
              disabled={mediaRecord.pending}
              aria-disabled={mediaRecord.pending}
            />
          </label>
          <label className="setup-input-group">
            <span className="queue-meta">File</span>
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
            {mediaRecord.pending ? "Uploading..." : "Upload Asset"}
          </button>
          <div className="stack">
            {curatedMediaAssets.map((asset) => (
              <div key={asset._id} className="queue-item">
                <p className="queue-title">
                  {asset.label} ({asset.kind})
                </p>
                <p className="queue-meta">
                  {asset.enabled ? "Enabled" : "Disabled"} · {asset.tags.join(", ") || "No tags"}
                </p>
                <div className="queue-actions">
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() =>
                      void runAction(
                        mediaKey,
                        async () => {
                          await toggleAsset({
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
                  >
                    {asset.enabled ? "Disable" : "Enable"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() =>
                      void runAction(
                        mediaKey,
                        async () => {
                          await deleteAsset({
                            assetId: asset._id as Id<"mediaAssets">,
                          });
                        },
                        {
                          pendingLabel: "Deleting asset...",
                          successMessage: "Asset deleted.",
                        },
                      )
                    }
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
            {curatedMediaAssets.length === 0 ? <p className="empty-line">No media assets yet.</p> : null}
          </div>
        </div>
      </article>
    </section>
  );
}
