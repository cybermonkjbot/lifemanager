"use client";

import { ActionNotices } from "@/components/action-notices";
import { LoadingBlock, LoadingIndicator } from "@/components/loading-state";
import { SharedMediaPreview } from "@/components/media-preview";
import { ProviderFilter, type ProviderFilterValue } from "@/components/provider-filter";
import { UIModal } from "@/components/ui-modal";
import { followupRescheduleDueAt } from "@/lib/ui/followups";
import { useActionStateRegistry } from "@/lib/ui/action-state";
import type { MediaPreviewResource } from "@/lib/ui/media";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { formatDateTime, formatDateTimeWithRelative, trim } from "@/lib/format";
import { useEffect, useMemo, useRef, useState } from "react";

type LiveConversationsProps = {
  initialThreadId?: string;
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

type ThreadPersonalitySetting = {
  profileSlug: string;
  intensity: number;
  customPrompt?: string;
  memePolicyMode?: "auto" | "always_allow" | "always_block";
  memeAutoProfessional?: boolean;
  memeAutoProfessionalScore?: number;
  memeAutoProfessionalSignals?: string[];
  threadPromptProfile?: string;
  threadPromptProfileSource?: "manual" | "auto";
  threadPromptProfileLookbackDays?: number;
  threadPromptProfileMessageCount?: number;
  threadPromptProfileUpdatedAt?: number;
};

type ThreadPersonalityFormProps = {
  profiles: PersonalityProfile[];
  initialProfileSlug: string;
  initialIntensity: number;
  initialCustomPrompt: string;
  initialMemePolicyMode: "auto" | "always_allow" | "always_block";
  autoProfessional?: boolean;
  autoProfessionalScore?: number;
  autoProfessionalSignals?: string[];
  pending: boolean;
  onSave: (values: {
    profileSlug: string;
    intensity: number;
    customPrompt: string;
    memePolicyMode: "auto" | "always_allow" | "always_block";
  }) => void;
};

type PromptProfileFormProps = {
  initialPromptProfile: string;
  source?: "manual" | "auto";
  messageCount?: number;
  updatedAt?: number;
  pending: boolean;
  onAutoBuild: () => void;
  onSaveManual: (promptProfile: string) => void;
};

type GroundingFormProps = {
  initialMyName: string;
  initialTheirName: string;
  initialVibeNotes: string;
  autoAliases: string[];
  pending: boolean;
  onSave: (values: { myName: string; theirName: string; vibeNotes: string }) => void;
};

type ThreadGrounding = {
  myName?: string;
  theirName?: string;
  autoAliases: string[];
  vibeNotes?: string;
};

type MessageMediaPreview = MediaPreviewResource;

type ConversationMessageType = "text" | "reaction" | "sticker" | "meme" | "image" | "video" | "audio" | "document";

type ThreadMessage = {
  _id: string;
  direction: "inbound" | "outbound";
  isStatus?: boolean;
  toolRunId?: string;
  text: string;
  messageType?: ConversationMessageType;
  reactionEmoji?: string;
  reactionTargetWhatsAppMessageId?: string;
  mediaAssetId?: string;
  mediaCaption?: string;
  mediaPreview?: MessageMediaPreview | null;
  messageAt: number;
};

type ThreadReviewNeedsReplyItem = {
  _id: string;
  messageProvider?: "whatsapp" | "instagram";
  provider: string;
  delayMs: number;
  typingMs: number;
  text: string;
  sendKind?: "text" | "reaction" | "sticker" | "meme";
  mediaAssetId?: string;
  mediaCaption?: string;
  mediaPreview?: MessageMediaPreview | null;
  sourceMessageId: string;
  sourceMessage?:
    | {
        _id: string;
        text?: string;
        mediaAssetId?: string;
        mediaCaption?: string;
        mediaPreview?: MessageMediaPreview | null;
      }
    | null;
};

type ThreadReviewFollowupItem = {
  _id: string;
  sourceMessageId: string;
  reason: string;
  dueAt: number;
  confidence?: number;
  sourceSnippet?: string;
  sourceMessage?:
    | {
        _id: string;
        text?: string;
        messageAt?: number;
        direction?: "inbound" | "outbound";
        mediaAssetId?: string;
        mediaCaption?: string;
        mediaPreview?: MessageMediaPreview | null;
      }
    | null;
};

type ThreadReviewTodoItem = {
  _id: string;
  sourceMessageId: string;
  title: string;
  suggestedDueAt?: number;
  sourceMessage?:
    | {
        _id: string;
        text?: string;
        messageAt?: number;
        direction?: "inbound" | "outbound";
      }
    | null;
};

type ThreadReviewGuardrailItem = {
  _id: string;
  severity: "low" | "medium" | "high";
  reason: string;
  sourceMessageId?: string;
  sourceMessage?:
    | {
        _id: string;
        text?: string;
        messageAt?: number;
        direction?: "inbound" | "outbound";
      }
    | null;
};

type ThreadReviewQueue = {
  needsReply: ThreadReviewNeedsReplyItem[];
  followupConfirmations: ThreadReviewFollowupItem[];
  todoCandidates: ThreadReviewTodoItem[];
  guardrailFlags: ThreadReviewGuardrailItem[];
};

type ThreadToolEvent = {
  _id: string;
  createdAt: number;
  eventType: string;
  source: string;
  toolRunId?: string;
  phase: "reply" | "outreach";
  kind: "tool_call" | "context_window" | "style_guardrail";
  toolName?: string;
  latencyMs?: number;
  inputText?: string;
  outputText?: string;
  parsedInput?: unknown;
  parsedOutput?: unknown;
  detail?: string;
  passed?: boolean;
  score?: number;
  threshold?: number;
  hints?: string[];
};

type MessageToolSummary = {
  messageId: string;
  messageAt: number;
  toolCalls: ThreadToolEvent[];
  contextWindows: ThreadToolEvent[];
  styleGuardrails: ThreadToolEvent[];
};

type PlannerSummary = {
  intentLabel: string;
  replyMode: "answer" | "confirm" | "clarify" | "close";
  explicitAskCount: number;
  ambiguityCount: number;
  confidence: number;
};

const STATUS_THREAD_JIDS = new Set(["status@broadcast", "ig:story:broadcast"]);

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function parsePlannerSummary(value: unknown): PlannerSummary | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const intentLabel = typeof record.intentLabel === "string" ? record.intentLabel : "";
  const replyModeRaw = typeof record.replyMode === "string" ? record.replyMode : "";
  const replyMode =
    replyModeRaw === "answer" || replyModeRaw === "confirm" || replyModeRaw === "clarify" || replyModeRaw === "close"
      ? replyModeRaw
      : null;
  const explicitAskCount = Number(record.explicitAskCount);
  const ambiguityCount = Number(record.ambiguityCount);
  const confidence = Number(record.confidence);

  if (!intentLabel || !replyMode || !Number.isFinite(explicitAskCount) || !Number.isFinite(ambiguityCount) || !Number.isFinite(confidence)) {
    return null;
  }

  return {
    intentLabel,
    replyMode,
    explicitAskCount: Math.max(0, Math.round(explicitAskCount)),
    ambiguityCount: Math.max(0, Math.round(ambiguityCount)),
    confidence: clamp01(confidence),
  };
}

function plannerModeLabel(mode: PlannerSummary["replyMode"]) {
  if (mode === "answer") return "Answer";
  if (mode === "confirm") return "Confirm";
  if (mode === "clarify") return "Clarify";
  return "Close";
}

function messageKindLabel(kind?: string) {
  if (kind === "reaction") {
    return "Reaction";
  }
  if (kind === "sticker") {
    return "Sticker";
  }
  if (kind === "meme") {
    return "Meme";
  }
  if (kind === "image") {
    return "Image";
  }
  if (kind === "video") {
    return "Video";
  }
  if (kind === "audio") {
    return "Audio";
  }
  if (kind === "document") {
    return "Document";
  }
  return "Text";
}

function isStatusPostMessage(message: Pick<ThreadMessage, "isStatus">, threadJid?: string) {
  if (message.isStatus === true) {
    return true;
  }
  return Boolean(threadJid && STATUS_THREAD_JIDS.has(threadJid));
}

function messageDisplayText(message: {
  text: string;
  messageType?: ConversationMessageType;
  reactionEmoji?: string;
}) {
  const normalized = message.text.trim();
  if (normalized) {
    return normalized;
  }
  if (message.messageType === "reaction") {
    return message.reactionEmoji ? `Reacted with ${message.reactionEmoji}` : "Sent a reaction";
  }
  if (message.messageType === "sticker") {
    return "Sent a sticker";
  }
  if (message.messageType === "meme") {
    return "Sent a meme";
  }
  if (message.messageType === "image") {
    return "Sent an image";
  }
  if (message.messageType === "video") {
    return "Sent a video";
  }
  if (message.messageType === "audio") {
    return "Sent audio";
  }
  if (message.messageType === "document") {
    return "Sent a document";
  }
  return "Sent a message";
}

function renderMessageMediaPreview(message: ThreadMessage, onOpenImagePreview?: (preview: MessageMediaPreview) => void) {
  return (
    <SharedMediaPreview
      preview={message.mediaPreview}
      mediaAssetId={message.mediaAssetId}
      onOpenImagePreview={onOpenImagePreview}
    />
  );
}

function clamp01(value: number) {
  if (!Number.isFinite(value)) {
    return 0.7;
  }
  return Math.max(0, Math.min(value, 1));
}

async function readApiError(response: Response) {
  try {
    const payload = (await response.json()) as { error?: string };
    if (payload?.error && payload.error.trim()) {
      return payload.error;
    }
  } catch {
    // Ignore non-JSON payloads.
  }

  return `Request failed (${response.status}).`;
}

function buildDraftImprovementPrompt(args: { sourceText: string; draftText: string }) {
  const sourceText = args.sourceText.trim() || "(No inbound text available)";
  const draftText = args.draftText.trim();

  return [
    "You are polishing a reply draft for a private chat conversation.",
    "Improve clarity, flow, and tone while preserving the exact intent and commitments.",
    "Keep it concise and natural. Do not add new promises, facts, or unrelated questions.",
    "Return only the improved reply text.",
    `Inbound message:\n${sourceText}`,
    `Draft reply:\n${draftText}`,
  ].join("\n\n");
}

const TOOL_EVENT_MAX_LAG_MS = 2 * 60 * 1000;
const TOOL_EVENT_MAX_LEAD_MS = 45 * 60 * 1000;

function buildMessageToolSummaries(messages: ThreadMessage[] | undefined, events: ThreadToolEvent[] | undefined) {
  const outboundMessages = (messages || []).filter((message) => message.direction === "outbound").sort((a, b) => a.messageAt - b.messageAt);
  const eventsAsc = [...(events || [])].sort((a, b) => a.createdAt - b.createdAt);
  const byMessageId = new Map<string, MessageToolSummary>();
  const messageIdByRunId = new Map<string, string>();
  const unmatchedEvents: ThreadToolEvent[] = [];

  for (const message of outboundMessages) {
    byMessageId.set(message._id, {
      messageId: message._id,
      messageAt: message.messageAt,
      toolCalls: [],
      contextWindows: [],
      styleGuardrails: [],
    });
    if (message.toolRunId) {
      messageIdByRunId.set(message.toolRunId, message._id);
    }
  }

  let messageCursor = 0;
  for (const event of eventsAsc) {
    if (event.toolRunId) {
      const exactMessageId = messageIdByRunId.get(event.toolRunId);
      if (exactMessageId) {
        const exactSummary = byMessageId.get(exactMessageId);
        if (exactSummary) {
          if (event.kind === "tool_call") {
            exactSummary.toolCalls.push(event);
          } else if (event.kind === "context_window") {
            exactSummary.contextWindows.push(event);
          } else {
            exactSummary.styleGuardrails.push(event);
          }
          continue;
        }
      }
    }

    while (
      messageCursor < outboundMessages.length &&
      outboundMessages[messageCursor].messageAt + TOOL_EVENT_MAX_LAG_MS < event.createdAt
    ) {
      messageCursor += 1;
    }

    const candidate = outboundMessages[messageCursor];
    if (!candidate) {
      unmatchedEvents.push(event);
      continue;
    }

    const deltaMs = candidate.messageAt - event.createdAt;
    if (deltaMs < -TOOL_EVENT_MAX_LAG_MS || deltaMs > TOOL_EVENT_MAX_LEAD_MS) {
      unmatchedEvents.push(event);
      continue;
    }

    const summary = byMessageId.get(candidate._id);
    if (!summary) {
      unmatchedEvents.push(event);
      continue;
    }

    if (event.kind === "tool_call") {
      summary.toolCalls.push(event);
      continue;
    }
    if (event.kind === "context_window") {
      summary.contextWindows.push(event);
      continue;
    }
    summary.styleGuardrails.push(event);
  }

  for (const summary of byMessageId.values()) {
    summary.toolCalls.sort((a, b) => b.createdAt - a.createdAt);
    summary.contextWindows.sort((a, b) => b.createdAt - a.createdAt);
    summary.styleGuardrails.sort((a, b) => b.createdAt - a.createdAt);
  }

  return {
    byMessageId,
    unmatchedEvents: unmatchedEvents.sort((a, b) => b.createdAt - a.createdAt),
  };
}

function ThreadPersonalityForm({
  profiles,
  initialProfileSlug,
  initialIntensity,
  initialCustomPrompt,
  initialMemePolicyMode,
  autoProfessional,
  autoProfessionalScore,
  autoProfessionalSignals,
  pending,
  onSave,
}: ThreadPersonalityFormProps) {
  const [profileSlug, setProfileSlug] = useState(initialProfileSlug);
  const [intensity, setIntensity] = useState(clamp01(initialIntensity));
  const [customPrompt, setCustomPrompt] = useState(initialCustomPrompt);
  const [memePolicyMode, setMemePolicyMode] = useState<"auto" | "always_allow" | "always_block">(initialMemePolicyMode);

  const hasChanged = useMemo(() => {
    const profileChanged = profileSlug !== initialProfileSlug;
    const intensityChanged = Math.abs(intensity - clamp01(initialIntensity)) >= 0.001;
    const promptChanged = customPrompt.trim() !== initialCustomPrompt.trim();
    const memePolicyChanged = memePolicyMode !== initialMemePolicyMode;
    return profileChanged || intensityChanged || promptChanged || memePolicyChanged;
  }, [customPrompt, initialCustomPrompt, initialIntensity, initialMemePolicyMode, initialProfileSlug, intensity, memePolicyMode, profileSlug]);

  return (
    <div className="personality-config-block">
      <h3>Conversation Personality</h3>
      <p className="queue-meta">Set reply style for this thread.</p>

      <label className="setup-input-group">
        <span className="queue-meta">Profile</span>
        <select
          value={profileSlug}
          onChange={(event) => setProfileSlug(event.target.value)}
          disabled={pending}
          aria-disabled={pending}
        >
          {profiles.map((profile) => (
            <option key={profile.slug} value={profile.slug}>
              {profile.name}
            </option>
          ))}
        </select>
      </label>

      <label className="setup-input-group">
        <span className="queue-meta">Intensity: {Math.round(intensity * 100)}%</span>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={intensity}
          onChange={(event) => setIntensity(Number(event.target.value))}
          disabled={pending}
          aria-disabled={pending}
        />
      </label>

      <label className="setup-input-group">
        <span className="queue-meta">Thread-specific note (optional)</span>
        <textarea
          rows={3}
          value={customPrompt}
          onChange={(event) => setCustomPrompt(event.target.value)}
          placeholder="Examples: Be extra playful. Use pet names lightly. Keep this one more formal."
          disabled={pending}
          aria-disabled={pending}
        />
      </label>

      <label className="setup-input-group">
        <span className="queue-meta">Meme policy</span>
        <select
          value={memePolicyMode}
          onChange={(event) =>
            setMemePolicyMode(
              event.target.value === "always_allow" ? "always_allow" : event.target.value === "always_block" ? "always_block" : "auto",
            )
          }
          disabled={pending}
          aria-disabled={pending}
        >
          <option value="auto">Auto</option>
          <option value="always_allow">Always allow</option>
          <option value="always_block">Always block</option>
        </select>
      </label>

      <p className="queue-meta">
        Auto professional detector: {autoProfessional ? "Professional" : "Non-professional"}
        {typeof autoProfessionalScore === "number" ? ` (score ${autoProfessionalScore.toFixed(2)})` : ""}
        {autoProfessionalSignals?.length ? ` · ${autoProfessionalSignals.slice(0, 3).join(", ")}` : ""}
      </p>

      <button
        type="button"
        className="btn btn-primary"
        onClick={() => onSave({ profileSlug, intensity, customPrompt, memePolicyMode })}
        disabled={!hasChanged || pending}
        aria-disabled={!hasChanged || pending}
      >
        {pending ? "Saving..." : "Save Conversation Personality"}
      </button>
    </div>
  );
}

function PromptProfileForm({
  initialPromptProfile,
  source,
  messageCount,
  updatedAt,
  pending,
  onAutoBuild,
  onSaveManual,
}: PromptProfileFormProps) {
  const [promptProfile, setPromptProfile] = useState(initialPromptProfile);

  const promptChanged = useMemo(() => promptProfile.trim() !== initialPromptProfile.trim(), [initialPromptProfile, promptProfile]);

  return (
    <div className="personality-config-block">
      <h3>Prompt Profile Builder</h3>
      <p className="queue-meta">Build a prompt profile from thread history, then edit manually if needed.</p>

      <button
        type="button"
        className="btn btn-primary"
        onClick={onAutoBuild}
        disabled={pending}
        aria-disabled={pending}
      >
        {pending ? "Building..." : "Auto-Build From All History"}
      </button>

      <label className="setup-input-group">
        <span className="queue-meta">Conversation prompt profile</span>
        <textarea
          rows={8}
          value={promptProfile}
          onChange={(event) => setPromptProfile(event.target.value)}
          placeholder="Example: Keep this chat casual and playful, use short replies, and mirror their emoji style."
          disabled={pending}
          aria-disabled={pending}
        />
      </label>

      <div className="queue-actions">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => onSaveManual(promptProfile)}
          disabled={pending || !promptChanged}
          aria-disabled={pending || !promptChanged}
        >
          {pending ? "Saving..." : "Save Manual Edit"}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => onSaveManual("")}
          disabled={pending || !promptProfile.trim()}
          aria-disabled={pending || !promptProfile.trim()}
        >
          Clear Profile
        </button>
      </div>

      <p className="queue-meta">
        Source: {source || "none"} {typeof messageCount === "number" ? `· ${messageCount} messages` : ""}
        {typeof updatedAt === "number" && updatedAt > 0 ? ` · Updated ${formatDateTime(updatedAt)}` : ""}
      </p>
    </div>
  );
}

function GroundingForm({ initialMyName, initialTheirName, initialVibeNotes, autoAliases, pending, onSave }: GroundingFormProps) {
  const [myName, setMyName] = useState(initialMyName);
  const [theirName, setTheirName] = useState(initialTheirName);
  const [vibeNotes, setVibeNotes] = useState(initialVibeNotes);

  const hasChanged = useMemo(() => {
    return myName.trim() !== initialMyName.trim() || theirName.trim() !== initialTheirName.trim() || vibeNotes.trim() !== initialVibeNotes.trim();
  }, [initialMyName, initialTheirName, initialVibeNotes, myName, theirName, vibeNotes]);

  return (
    <div className="personality-config-block">
      <h3>Conversation Grounding</h3>
      <p className="queue-meta">Set preferred names and tone notes for this thread.</p>
      <label className="setup-input-group">
        <span className="queue-meta">My name in this conversation</span>
        <input type="text" value={myName} onChange={(event) => setMyName(event.target.value)} disabled={pending} aria-disabled={pending} />
      </label>
      <label className="setup-input-group">
        <span className="queue-meta">Their preferred name</span>
        <input type="text" value={theirName} onChange={(event) => setTheirName(event.target.value)} disabled={pending} aria-disabled={pending} />
      </label>
      <label className="setup-input-group">
        <span className="queue-meta">Vibe notes</span>
        <textarea rows={2} value={vibeNotes} onChange={(event) => setVibeNotes(event.target.value)} disabled={pending} aria-disabled={pending} />
      </label>
      <p className="queue-meta">Detected aliases: {autoAliases.join(", ") || "None"}</p>
      <button
        type="button"
        className="btn btn-primary"
        onClick={() => onSave({ myName, theirName, vibeNotes })}
        disabled={pending || !hasChanged}
        aria-disabled={pending || !hasChanged}
      >
        {pending ? "Saving..." : "Save Grounding"}
      </button>
    </div>
  );
}

function ConversationsContent({ initialThreadId }: { initialThreadId?: string }) {
  const [threadLimit, setThreadLimit] = useState(80);
  const [threadSearch, setThreadSearch] = useState("");
  const [providerFilter, setProviderFilter] = useState<ProviderFilterValue>("all");
  const threads = useQuery(api.threads.list, { limit: threadLimit, provider: providerFilter }) as
    | Array<{
        _id: string;
        provider?: "whatsapp" | "instagram";
        title?: string;
        jid: string;
        threadKind?: "direct" | "group" | "broadcast_or_system";
        isArchived?: boolean;
        lastMessageAt: number;
        latestDraft?: { text?: string } | null;
      }>
    | undefined;
  const threadsLoading = threads === undefined;
  const normalizedThreadSearch = threadSearch.trim().toLowerCase();
  const threadList = (threads || []).filter((thread) => {
    if (!normalizedThreadSearch) {
      return true;
    }
    const haystack = `${thread.title || ""}\n${thread.jid}`.toLowerCase();
    return haystack.includes(normalizedThreadSearch);
  });

  const profilesQuery = useQuery(api.personality.listProfiles, {}) as PersonalityProfile[] | undefined;
  const profilesLoading = profilesQuery === undefined;
  const profiles = profilesQuery || [];
  const approveDraft = useMutation(api.draft.approve);
  const snoozeDraft = useMutation(api.draft.snooze);
  const rejectDraft = useMutation(api.draft.reject);
  const updateDraftContent = useMutation(api.draft.updateDraftContent);
  const confirmFollowup = useMutation(api.followups.confirm);
  const snoozeFollowup = useMutation(api.followups.snooze);
  const rescheduleFollowup = useMutation(api.followups.reschedule);
  const cancelFollowup = useMutation(api.followups.cancel);
  const createTodoFromCandidate = useMutation(api.todos.fromCandidate);
  const resolveGuardrail = useMutation(api.queue.resolveGuardrail);
  const setThreadPersonality = useMutation(api.personality.setThreadSetting);
  const setThreadPromptProfile = useMutation(api.personality.setThreadPromptProfile);
  const autoBuildThreadPromptProfile = useMutation(api.personality.autoBuildThreadPromptProfile);
  const saveGroundingMutation = useMutation(api.grounding.saveThreadGrounding);
  const ignoreThreadMutation = useMutation(api.backlog.ignoreThread);
  const recordEvent = useMutation(api.system.recordEvent);
  const { runAction, getRecord, isPending, notices, dismissNotice } = useActionStateRegistry();

  const selectedThreadId =
    (initialThreadId && threadList.some((thread) => thread._id === initialThreadId) ? initialThreadId : undefined) || threadList[0]?._id;
  const thread = useQuery(
    api.threads.get,
    selectedThreadId ? { threadId: selectedThreadId as Id<"threads"> } : "skip",
  ) as
    | {
        thread: {
          title?: string;
          jid: string;
          threadKind?: "direct" | "group" | "broadcast_or_system";
          isArchived?: boolean;
          isIgnored?: boolean;
        };
        messages: ThreadMessage[];
        reactions: Array<{
          messageId: string;
          actorJid: string;
          emoji: string;
          direction: "inbound" | "outbound";
        }>;
        grounding?: ThreadGrounding | null;
        reviewQueue?: ThreadReviewQueue;
      }
    | null
    | undefined;

  const threadPersonality = useQuery(
    api.personality.getThreadSetting,
    selectedThreadId ? { threadId: selectedThreadId as Id<"threads"> } : "skip",
  ) as ThreadPersonalitySetting | null | undefined;
  const threadLoading = Boolean(selectedThreadId) && thread === undefined;
  const threadMissing = Boolean(selectedThreadId) && thread === null;
  const threadPersonalityLoading = Boolean(selectedThreadId) && threadPersonality === undefined;
  const threadGrounding = useQuery(
    api.grounding.getThreadGrounding,
    selectedThreadId ? { threadId: selectedThreadId as Id<"threads"> } : "skip",
  ) as ThreadGrounding | null | undefined;
  const threadToolEvents = useQuery(
    api.threads.getToolEvents,
    selectedThreadId ? { threadId: selectedThreadId as Id<"threads">, limit: 260 } : "skip",
  ) as ThreadToolEvent[] | undefined;
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [toolSummaryMessageId, setToolSummaryMessageId] = useState<string | null>(null);
  const [mediaPreviewModal, setMediaPreviewModal] = useState<MessageMediaPreview | null>(null);
  const [draftEdits, setDraftEdits] = useState<Record<string, string>>({});

  const settingsKey = selectedThreadId ? `personality:thread:${selectedThreadId}` : "personality:thread:none";
  const promptProfileKey = selectedThreadId ? `personality:promptprofile:${selectedThreadId}` : "personality:promptprofile:none";
  const groundingKey = selectedThreadId ? `grounding:thread:${selectedThreadId}` : "grounding:thread:none";
  const ignoreThreadKey = selectedThreadId ? `conversation:ignore:${selectedThreadId}` : "conversation:ignore:none";

  const settingsRecord = getRecord(settingsKey);
  const promptProfileRecord = getRecord(promptProfileKey);
  const groundingRecord = getRecord(groundingKey);
  const ignoreThreadRecord = getRecord(ignoreThreadKey);
  const lastLoadStartedThreadRef = useRef<string | null>(null);
  const lastLoadedThreadRef = useRef<string | null>(null);

  useEffect(() => {
    if (!selectedThreadId || lastLoadStartedThreadRef.current === selectedThreadId) {
      return;
    }

    lastLoadStartedThreadRef.current = selectedThreadId;
    void recordEvent({
      source: "dashboard",
      eventType: "conversation.load.start",
      detail: "Loading conversation timeline...",
      threadId: selectedThreadId as Id<"threads">,
    });
  }, [recordEvent, selectedThreadId]);

  useEffect(() => {
    if (!selectedThreadId || !thread || lastLoadedThreadRef.current === selectedThreadId) {
      return;
    }

    lastLoadedThreadRef.current = selectedThreadId;
    void recordEvent({
      source: "dashboard",
      eventType: "conversation.load.ready",
      detail: `Conversation loaded (${thread.messages?.length ?? 0} messages).`,
      threadId: selectedThreadId as Id<"threads">,
    });
  }, [recordEvent, selectedThreadId, thread]);

  const draftEditKey = (draftId: string) => {
    return `${selectedThreadId || "none"}:${draftId}`;
  };

  const getDraftEditorText = (item: ThreadReviewNeedsReplyItem) => {
    return draftEdits[draftEditKey(item._id)] ?? item.text ?? "";
  };

  const saveReviewDraftText = async (item: ThreadReviewNeedsReplyItem) => {
    const nextText = getDraftEditorText(item).trim();
    if (!nextText) {
      throw new Error("Reply text cannot be empty.");
    }
    if (nextText === (item.text || "").trim()) {
      return nextText;
    }
    await updateDraftContent({
      draftId: item._id as Id<"replyDrafts">,
      text: nextText,
    });
    return nextText;
  };

  const saveThreadSetting = (values: {
    profileSlug: string;
    intensity: number;
    customPrompt: string;
    memePolicyMode: "auto" | "always_allow" | "always_block";
  }) => {
    if (!selectedThreadId) {
      return;
    }

    void runAction(
      settingsKey,
      async () => {
        await setThreadPersonality({
          threadId: selectedThreadId as Id<"threads">,
          profileSlug: values.profileSlug,
          intensity: clamp01(values.intensity),
          customPrompt: values.customPrompt.trim() || undefined,
          memePolicyMode: values.memePolicyMode,
        });
      },
      {
        pendingLabel: "Saving conversation personality...",
        successMessage: "Conversation personality updated.",
      },
    );
  };

  const savePromptProfile = (promptProfile: string) => {
    if (!selectedThreadId) {
      return;
    }

    void runAction(
      promptProfileKey,
      async () => {
        await setThreadPromptProfile({
          threadId: selectedThreadId as Id<"threads">,
          promptProfile,
        });
      },
      {
        pendingLabel: promptProfile.trim() ? "Saving conversation prompt profile..." : "Clearing conversation prompt profile...",
        successMessage: promptProfile.trim()
          ? "Conversation prompt profile saved."
          : "Conversation prompt profile cleared.",
      },
    );
  };

  const autoBuildPromptProfile = () => {
    if (!selectedThreadId) {
      return;
    }

    void runAction(
      promptProfileKey,
      async () => {
        await autoBuildThreadPromptProfile({
          threadId: selectedThreadId as Id<"threads">,
        });
      },
      {
        pendingLabel: "Building prompt profile from conversation history...",
        successMessage: "Conversation prompt profile auto-built.",
      },
    );
  };

  const saveGrounding = (values: { myName: string; theirName: string; vibeNotes: string }) => {
    if (!selectedThreadId) {
      return;
    }
    void runAction(
      groundingKey,
      async () => {
        await saveGroundingMutation({
          threadId: selectedThreadId as Id<"threads">,
          myName: values.myName.trim() || undefined,
          theirName: values.theirName.trim() || undefined,
          vibeNotes: values.vibeNotes.trim() || undefined,
        });
      },
      {
        pendingLabel: "Saving grounding...",
        successMessage: "Conversation grounding updated.",
      },
    );
  };

  const toggleIgnoreFromConversation = () => {
    if (!selectedThreadId || !thread) {
      return;
    }
    const enableIgnore = !Boolean(thread.thread.isIgnored);
    void runAction(
      ignoreThreadKey,
      async () => {
        await ignoreThreadMutation({
          threadId: selectedThreadId as Id<"threads">,
          enabled: enableIgnore,
        });
      },
      {
        pendingLabel: enableIgnore ? "Disabling auto-respond..." : "Enabling auto-respond...",
        successMessage: enableIgnore ? "Conversation set to do-not-auto-respond." : "Conversation restored for auto-respond.",
      },
    );
  };

  const onReviewSend = (item: ThreadReviewNeedsReplyItem) => {
    const key = `send:${item._id}`;
    void runAction(
      key,
      async () => {
        await saveReviewDraftText(item);
        await approveDraft({ draftId: item._id as Id<"replyDrafts">, sendImmediately: true });
      },
      {
        pendingLabel: "Sending...",
        successMessage: "Reply approved and queued.",
      },
    );
  };

  const onReviewSnooze = (item: ThreadReviewNeedsReplyItem) => {
    const key = `snooze:${item._id}`;
    void runAction(
      key,
      async () => {
        await saveReviewDraftText(item);
        await snoozeDraft({ draftId: item._id as Id<"replyDrafts">, minutes: 30 });
      },
      {
        pendingLabel: "Snoozing...",
        successMessage: "Reply snoozed for 30 minutes.",
      },
    );
  };

  const onReviewReject = (draftId: string) => {
    const key = `reject:${draftId}`;
    void runAction(
      key,
      async () => {
        await rejectDraft({ draftId: draftId as Id<"replyDrafts"> });
      },
      {
        pendingLabel: "Rejecting...",
        successMessage: "Draft rejected.",
      },
    );
  };

  const onReviewSave = (item: ThreadReviewNeedsReplyItem) => {
    const key = `edit:${item._id}`;
    if (!getDraftEditorText(item).trim()) {
      return;
    }
    void runAction(
      key,
      async () => {
        await saveReviewDraftText(item);
      },
      {
        pendingLabel: "Saving edit...",
        successMessage: "Draft updated.",
      },
    );
  };

  const onReviewAiImprove = (item: ThreadReviewNeedsReplyItem) => {
    const key = `improve:${item._id}`;
    const draftText = getDraftEditorText(item).trim();
    if (!draftText) {
      return;
    }

    const sourceText = (item.sourceMessage?.text || "").trim() || (item.text || "").trim();
    const message = buildDraftImprovementPrompt({
      sourceText,
      draftText,
    });

    void runAction(
      key,
      async () => {
        const response = await fetch("/api/actions/test-ai", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            message,
            threadId: selectedThreadId,
          }),
        });

        if (!response.ok) {
          throw new Error(await readApiError(response));
        }

        const payload = (await response.json()) as {
          replyText?: string;
          guardrailBlocked?: boolean;
          guardrailReason?: string;
        };

        if (payload.guardrailBlocked) {
          throw new Error(payload.guardrailReason?.trim() || "AI improvement was blocked by guardrail.");
        }

        const improvedText = typeof payload.replyText === "string" ? payload.replyText.trim() : "";
        if (!improvedText) {
          throw new Error("AI returned an empty improvement.");
        }

        setDraftEdits((current) => ({
          ...current,
          [draftEditKey(item._id)]: improvedText,
        }));
      },
      {
        pendingLabel: "Improving draft with AI...",
        successMessage: "AI improvement ready. Review before sending.",
      },
    );
  };

  const onReviewConfirmFollowup = (followUpId: string) => {
    const key = `followup:${followUpId}`;
    void runAction(
      key,
      async () => {
        await confirmFollowup({ followUpId: followUpId as Id<"followUps"> });
      },
      {
        pendingLabel: "Confirming...",
        successMessage: "Follow-up confirmed.",
      },
    );
  };

  const onReviewSnoozeFollowup = (followUpId: string, minutes: number) => {
    const key = `followup:snooze:${followUpId}`;
    void runAction(
      key,
      async () => {
        await snoozeFollowup({ followUpId: followUpId as Id<"followUps">, minutes });
      },
      {
        pendingLabel: "Snoozing...",
        successMessage: "Follow-up snoozed.",
      },
    );
  };

  const onReviewRescheduleFollowup = (followUpId: string, hoursAhead: number) => {
    const key = `followup:reschedule:${followUpId}`;
    void runAction(
      key,
      async () => {
        await rescheduleFollowup({
          followUpId: followUpId as Id<"followUps">,
          dueAt: followupRescheduleDueAt(hoursAhead),
        });
      },
      {
        pendingLabel: "Rescheduling...",
        successMessage: "Follow-up rescheduled.",
      },
    );
  };

  const onReviewDismissFollowup = (followUpId: string) => {
    const key = `followup:cancel:${followUpId}`;
    void runAction(
      key,
      async () => {
        await cancelFollowup({ followUpId: followUpId as Id<"followUps"> });
      },
      {
        pendingLabel: "Dismissing...",
        successMessage: "Follow-up dismissed.",
      },
    );
  };

  const onReviewConvertTodo = (candidateId: string) => {
    const key = `todo:${candidateId}`;
    void runAction(
      key,
      async () => {
        await createTodoFromCandidate({ candidateId: candidateId as Id<"todoCandidates"> });
      },
      {
        pendingLabel: "Converting...",
        successMessage: "Candidate converted to TODO.",
      },
    );
  };

  const onReviewResolveGuardrail = (guardrailEventId: string) => {
    const key = `guardrail:resolve:${guardrailEventId}`;
    void runAction(
      key,
      async () => {
        await resolveGuardrail({
          guardrailEventId: guardrailEventId as Id<"guardrailEvents">,
          resolutionNote: "Reviewed and resolved from conversation thread.",
          closeDraft: true,
        });
      },
      {
        pendingLabel: "Resolving guardrail...",
        successMessage: "Guardrail resolved.",
      },
    );
  };

  const reactionsByMessage = useMemo(() => {
    const map = new Map<string, Array<{ actorJid: string; emoji: string; direction: "inbound" | "outbound" }>>();
    const rows = thread?.reactions || [];
    for (const row of rows) {
      const list = map.get(row.messageId) || [];
      list.push({
        actorJid: row.actorJid,
        emoji: row.emoji,
        direction: row.direction,
      });
      map.set(row.messageId, list);
    }
    return map;
  }, [thread?.reactions]);

  const threadSettingKey = `${selectedThreadId || "none"}:${threadPersonality?.profileSlug || "casual"}:${threadPersonality?.intensity || 0.6}:${threadPersonality?.customPrompt || ""}:${threadPersonality?.memePolicyMode || "auto"}:${threadPersonality?.memeAutoProfessional ? "pro" : "casual"}:${threadPersonality?.memeAutoProfessionalScore || 0}`;
  const promptProfileFormKey = `${selectedThreadId || "none"}:${threadPersonality?.threadPromptProfile || ""}:${threadPersonality?.threadPromptProfileLookbackDays || 365}:${threadPersonality?.threadPromptProfileSource || "none"}:${threadPersonality?.threadPromptProfileUpdatedAt || 0}`;
  const toolEventSummary = useMemo(
    () => buildMessageToolSummaries(thread?.messages, threadToolEvents),
    [thread?.messages, threadToolEvents],
  );
  const threadMessagesById = useMemo(() => {
    const map = new Map<string, ThreadMessage>();
    for (const message of thread?.messages || []) {
      map.set(message._id, message);
    }
    return map;
  }, [thread?.messages]);
  const selectedToolSummary = toolSummaryMessageId ? toolEventSummary.byMessageId.get(toolSummaryMessageId) || null : null;
  const selectedToolSummaryMessage = toolSummaryMessageId ? threadMessagesById.get(toolSummaryMessageId) || null : null;

  const threadReviewQueue = thread?.reviewQueue || {
    needsReply: [],
    followupConfirmations: [],
    todoCandidates: [],
    guardrailFlags: [],
  };

  const reviewCount =
    threadReviewQueue.needsReply.length +
    threadReviewQueue.followupConfirmations.length +
    threadReviewQueue.todoCandidates.length +
    threadReviewQueue.guardrailFlags.length;

  const threadReviewBySourceMessageId = useMemo(() => {
    type ReviewEntry =
      | { kind: "needsReply"; item: ThreadReviewNeedsReplyItem }
      | { kind: "followup"; item: ThreadReviewFollowupItem }
      | { kind: "todo"; item: ThreadReviewTodoItem }
      | { kind: "guardrail"; item: ThreadReviewGuardrailItem };

    const bySource = new Map<string, ReviewEntry[]>();
    const unanchored: ReviewEntry[] = [];

    const push = (sourceMessageId: string | undefined, entry: ReviewEntry) => {
      if (sourceMessageId && threadMessagesById.has(sourceMessageId)) {
        const list = bySource.get(sourceMessageId) || [];
        list.push(entry);
        bySource.set(sourceMessageId, list);
        return;
      }
      unanchored.push(entry);
    };

    for (const item of threadReviewQueue.needsReply) {
      push(item.sourceMessageId, { kind: "needsReply", item });
    }
    for (const item of threadReviewQueue.followupConfirmations) {
      push(item.sourceMessageId, { kind: "followup", item });
    }
    for (const item of threadReviewQueue.todoCandidates) {
      push(item.sourceMessageId, { kind: "todo", item });
    }
    for (const item of threadReviewQueue.guardrailFlags) {
      push(item.sourceMessageId, { kind: "guardrail", item });
    }

    return { bySource, unanchored };
  }, [threadMessagesById, threadReviewQueue.followupConfirmations, threadReviewQueue.guardrailFlags, threadReviewQueue.needsReply, threadReviewQueue.todoCandidates]);

  const renderThreadReviewEntry = (
    entry:
      | { kind: "needsReply"; item: ThreadReviewNeedsReplyItem }
      | { kind: "followup"; item: ThreadReviewFollowupItem }
      | { kind: "todo"; item: ThreadReviewTodoItem }
      | { kind: "guardrail"; item: ThreadReviewGuardrailItem },
  ) => {
    if (entry.kind === "needsReply") {
      const item = entry.item;
      const editorText = getDraftEditorText(item);
      const hasDraftText = Boolean(editorText.trim());
      const isDirty = editorText.trim() !== (item.text || "").trim();
      const savePending = isPending(`edit:${item._id}`);
      const improvePending = isPending(`improve:${item._id}`);
      const sendOrSnoozePending = isPending(`send:${item._id}`) || isPending(`snooze:${item._id}`);
      const rejectPending = isPending(`reject:${item._id}`);
      const actionPending = sendOrSnoozePending || savePending || improvePending || rejectPending;
      return (
        <div key={`review:draft:${item._id}`} className="thread-review-item" aria-busy={actionPending}>
          <p className="thread-review-title">Needs Reply Review</p>
          <p className="queue-body">{trim(item.sourceMessage?.text || item.text || "", 240)}</p>
          <SharedMediaPreview preview={item.sourceMessage?.mediaPreview} mediaAssetId={item.sourceMessage?.mediaAssetId} />
          <label className="setup-input-group">
            <span className="queue-meta">Manual response (editable)</span>
            <textarea
              rows={4}
              value={editorText}
              onChange={(event) =>
                setDraftEdits((current) => ({
                  ...current,
                  [draftEditKey(item._id)]: event.target.value,
                }))
              }
              placeholder="Write your response, then optionally click AI Improve."
              disabled={sendOrSnoozePending || improvePending}
              aria-disabled={sendOrSnoozePending || improvePending}
            />
          </label>
          <SharedMediaPreview preview={item.mediaPreview} mediaAssetId={item.mediaAssetId} />
          {item.mediaCaption?.trim() ? <p className="queue-meta">Media caption: {trim(item.mediaCaption.trim(), 220)}</p> : null}
          <p className="queue-meta">
            Channel: {item.messageProvider || "whatsapp"} · Model: {item.provider} · Delay: {Math.round(item.delayMs / 1000)}s · Typing:{" "}
            {Math.round(item.typingMs / 1000)}s
          </p>
          <div className="queue-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => onReviewSend(item)}
              disabled={sendOrSnoozePending || savePending || improvePending || !hasDraftText}
              aria-disabled={sendOrSnoozePending || savePending || improvePending || !hasDraftText}
            >
              Send
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => onReviewSnooze(item)}
              disabled={sendOrSnoozePending || savePending || improvePending || !hasDraftText}
              aria-disabled={sendOrSnoozePending || savePending || improvePending || !hasDraftText}
            >
              Snooze 30m
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => onReviewSave(item)}
              disabled={!isDirty || savePending || sendOrSnoozePending || improvePending || !hasDraftText}
              aria-disabled={!isDirty || savePending || sendOrSnoozePending || improvePending || !hasDraftText}
            >
              {savePending ? "Saving..." : "Save"}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => onReviewAiImprove(item)}
              disabled={improvePending || sendOrSnoozePending || savePending || !hasDraftText}
              aria-disabled={improvePending || sendOrSnoozePending || savePending || !hasDraftText}
            >
              {improvePending ? "Improving..." : "AI Improve"}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => onReviewReject(item._id)}
              disabled={actionPending}
              aria-disabled={actionPending}
            >
              Reject
            </button>
          </div>
          {getRecord(`send:${item._id}`).error || getRecord(`snooze:${item._id}`).error ? (
            <p className="queue-meta action-inline-error" role="alert">
              {getRecord(`send:${item._id}`).error || getRecord(`snooze:${item._id}`).error}
            </p>
          ) : null}
          {getRecord(`edit:${item._id}`).error ? (
            <p className="queue-meta action-inline-error" role="alert">
              {getRecord(`edit:${item._id}`).error}
            </p>
          ) : null}
          {getRecord(`improve:${item._id}`).error ? (
            <p className="queue-meta action-inline-error" role="alert">
              {getRecord(`improve:${item._id}`).error}
            </p>
          ) : null}
          {getRecord(`reject:${item._id}`).error ? (
            <p className="queue-meta action-inline-error" role="alert">
              {getRecord(`reject:${item._id}`).error}
            </p>
          ) : null}
        </div>
      );
    }

    if (entry.kind === "followup") {
      const item = entry.item;
      return (
        <div key={`review:followup:${item._id}`} className="thread-review-item">
          <p className="thread-review-title">Follow-up Confirmation</p>
          <p className="queue-meta">Due: {formatDateTimeWithRelative(item.dueAt)}</p>
          <p className="queue-body">{item.reason}</p>
          {item.sourceSnippet?.trim() || item.sourceMessage?.text?.trim() ? (
            <p className="queue-meta">Source: {trim(item.sourceSnippet?.trim() || item.sourceMessage?.text?.trim() || "", 220)}</p>
          ) : null}
          {typeof item.confidence === "number" ? (
            <p className="queue-meta">Detector confidence: {Math.round(item.confidence * 100)}%</p>
          ) : null}
          <div className="queue-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => onReviewConfirmFollowup(item._id)}
              disabled={isPending(`followup:${item._id}`)}
              aria-disabled={isPending(`followup:${item._id}`)}
            >
              {isPending(`followup:${item._id}`) ? "Confirming..." : "Confirm"}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => onReviewSnoozeFollowup(item._id, 24 * 60)}
              disabled={isPending(`followup:snooze:${item._id}`)}
              aria-disabled={isPending(`followup:snooze:${item._id}`)}
            >
              {isPending(`followup:snooze:${item._id}`) ? "Snoozing..." : "Snooze 1d"}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => onReviewRescheduleFollowup(item._id, 24)}
              disabled={isPending(`followup:reschedule:${item._id}`)}
              aria-disabled={isPending(`followup:reschedule:${item._id}`)}
            >
              {isPending(`followup:reschedule:${item._id}`) ? "Rescheduling..." : "+24h"}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => onReviewDismissFollowup(item._id)}
              disabled={isPending(`followup:cancel:${item._id}`)}
              aria-disabled={isPending(`followup:cancel:${item._id}`)}
            >
              {isPending(`followup:cancel:${item._id}`) ? "Dismissing..." : "Dismiss"}
            </button>
          </div>
          {getRecord(`followup:${item._id}`).error ? (
            <p className="queue-meta action-inline-error" role="alert">
              {getRecord(`followup:${item._id}`).error}
            </p>
          ) : null}
          {getRecord(`followup:snooze:${item._id}`).error ? (
            <p className="queue-meta action-inline-error" role="alert">
              {getRecord(`followup:snooze:${item._id}`).error}
            </p>
          ) : null}
          {getRecord(`followup:reschedule:${item._id}`).error ? (
            <p className="queue-meta action-inline-error" role="alert">
              {getRecord(`followup:reschedule:${item._id}`).error}
            </p>
          ) : null}
          {getRecord(`followup:cancel:${item._id}`).error ? (
            <p className="queue-meta action-inline-error" role="alert">
              {getRecord(`followup:cancel:${item._id}`).error}
            </p>
          ) : null}
        </div>
      );
    }

    if (entry.kind === "todo") {
      const item = entry.item;
      return (
        <div key={`review:todo:${item._id}`} className="thread-review-item">
          <p className="thread-review-title">TODO Candidate</p>
          <p className="queue-body">{item.title}</p>
          <p className="queue-meta">Suggested due: {formatDateTime(item.suggestedDueAt)}</p>
          <div className="queue-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => onReviewConvertTodo(item._id)}
              disabled={isPending(`todo:${item._id}`)}
              aria-disabled={isPending(`todo:${item._id}`)}
            >
              {isPending(`todo:${item._id}`) ? "Converting..." : "Convert to TODO"}
            </button>
          </div>
          {getRecord(`todo:${item._id}`).error ? (
            <p className="queue-meta action-inline-error" role="alert">
              {getRecord(`todo:${item._id}`).error}
            </p>
          ) : null}
        </div>
      );
    }

    const item = entry.item;
    return (
      <div key={`review:guardrail:${item._id}`} className="thread-review-item">
        <p className="thread-review-title">Guardrail Flag</p>
        <p className="queue-meta">Severity: {item.severity}</p>
        <p className="queue-body">{item.reason}</p>
        <div className="queue-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => onReviewResolveGuardrail(item._id)}
            disabled={isPending(`guardrail:resolve:${item._id}`)}
            aria-disabled={isPending(`guardrail:resolve:${item._id}`)}
          >
            {isPending(`guardrail:resolve:${item._id}`) ? "Resolving..." : "Resolve"}
          </button>
        </div>
        {getRecord(`guardrail:resolve:${item._id}`).error ? (
          <p className="queue-meta action-inline-error" role="alert">
            {getRecord(`guardrail:resolve:${item._id}`).error}
          </p>
        ) : null}
      </div>
    );
  };

  return (
    <section className="panel-grid split-view">
      <article className="panel-card">
        <h3>Threads</h3>
        <ProviderFilter
          value={providerFilter}
          onChange={setProviderFilter}
          label="Conversations provider filter"
        />
        <div className="queue-actions">
          <label className="setup-input-group inline">
            <span className="queue-meta">Search</span>
            <input
              type="text"
              value={threadSearch}
              placeholder="Search thread..."
              onChange={(event) => setThreadSearch(event.target.value)}
            />
          </label>
        </div>
        <div className="stack thread-list">
          {threadsLoading ? <LoadingBlock label="Loading threads…" rows={5} compact /> : null}
          {threadList.map((item) => (
            <Link
              key={item._id}
              href={`/conversations?threadId=${item._id}`}
              className={`thread-row${item._id === selectedThreadId ? " active" : ""}`}
              aria-current={item._id === selectedThreadId ? "page" : undefined}
            >
              <p className="queue-title">{item.title || item.jid}</p>
              <p className="queue-meta">
                {(item.provider || "whatsapp") === "instagram" ? "Instagram" : "WhatsApp"} ·{" "}
                {item.threadKind === "broadcast_or_system" ? "Broadcast/System" : item.threadKind === "group" ? "Group" : "Direct"}
                {item.isArchived ? " · Archived" : ""}
              </p>
              <p className="queue-body">{trim(item.latestDraft?.text || "No draft yet")}</p>
              <p className="queue-meta">Last activity: {formatDateTime(item.lastMessageAt)}</p>
            </Link>
          ))}
          {!threadsLoading && threadList.length === 0 ? <p className="empty-line">No threads yet.</p> : null}
          {!threadsLoading ? (
            <div className="thread-list-footer">
              <button type="button" className="btn btn-ghost" onClick={() => setThreadLimit((prev) => Math.min(prev + 80, 500))}>
                Load More
              </button>
            </div>
          ) : null}
        </div>
      </article>

      <article className="panel-card" aria-busy={threadLoading}>
        <ActionNotices notices={notices} onDismiss={dismissNotice} />
        <h3>Timeline</h3>
        <div className="queue-actions">
          <button type="button" className="btn btn-ghost" onClick={() => setSettingsModalOpen(true)}>
            Thread Settings
          </button>
        </div>
        {threadLoading ? (
          <LoadingBlock label="Loading timeline..." rows={4} />
        ) : thread ? (
          <div className="conversation-chat">
            <header className="conversation-chat-header">
              <p className="queue-title">{thread.thread.title || thread.thread.jid}</p>
              <p className="queue-meta">
                {thread.thread.threadKind === "broadcast_or_system"
                  ? "Broadcast/System thread (automation blocked)"
                  : thread.thread.threadKind === "group"
                    ? "Group thread"
                    : "Direct thread"}
                {thread.thread.isArchived ? " · Archived (read-only automation)" : ""}
              </p>
              <p className="queue-meta">{thread.thread.jid}</p>
              <p className="queue-meta">
                Auto-respond: {thread.thread.isIgnored ? "Disabled (ignored)" : "Enabled"}
              </p>
              <p className="queue-meta">Needs review in this thread: {reviewCount}</p>
              <div className="queue-actions">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={toggleIgnoreFromConversation}
                  disabled={ignoreThreadRecord.pending}
                  aria-disabled={ignoreThreadRecord.pending}
                >
                  {ignoreThreadRecord.pending
                    ? thread.thread.isIgnored
                      ? "Enabling..."
                      : "Disabling..."
                    : thread.thread.isIgnored
                      ? "Allow Auto-Respond"
                      : "Do Not Auto-Respond"}
                </button>
              </div>
              {ignoreThreadRecord.error ? (
                <p className="queue-meta action-inline-error" role="alert">
                  {ignoreThreadRecord.error}
                </p>
              ) : null}
            </header>
            <div className="conversation-chat-window" role="log" aria-live="polite">
              {(thread.messages || []).length === 0 ? (
                <p className="empty-line">No messages in this thread yet.</p>
              ) : null}
              {threadReviewBySourceMessageId.unanchored.length > 0 ? (
                <div className="thread-review-stack thread-review-floating">
                  <p className="thread-review-group-title">Review items from older messages</p>
                  {threadReviewBySourceMessageId.unanchored.map((entry) => renderThreadReviewEntry(entry))}
                </div>
              ) : null}
              {(thread.messages || []).map((message) => {
                const outbound = message.direction === "outbound";
                const isStatusPost = isStatusPostMessage(message, thread.thread.jid);
                const senderName = outbound
                  ? threadGrounding?.myName?.trim() || "You"
                  : threadGrounding?.theirName?.trim() || thread.thread.title || "Contact";
                const senderBadge = senderName.charAt(0).toUpperCase();
                const displayText = messageDisplayText(message);
                const mediaCaption = message.mediaCaption?.trim();
                const showMediaCaption = Boolean(mediaCaption && mediaCaption !== displayText);
                const messageToolSummary = outbound ? toolEventSummary.byMessageId.get(message._id) : undefined;
                const toolSummaryCount = messageToolSummary
                  ? messageToolSummary.toolCalls.length + messageToolSummary.contextWindows.length + messageToolSummary.styleGuardrails.length
                  : 0;
                const plannerEvent = messageToolSummary?.toolCalls.find((event) => event.toolName === "response_workbench");
                const plannerSummary = parsePlannerSummary(plannerEvent?.parsedOutput);
                const reviewEntries = threadReviewBySourceMessageId.bySource.get(message._id) || [];

                return (
                  <div key={message._id} className={`chat-row ${outbound ? "outbound" : "inbound"}`}>
                    <span className={`chat-avatar ${outbound ? "outbound" : "inbound"}`} aria-hidden="true">
                      {senderBadge || (outbound ? "Y" : "C")}
                    </span>
                    <div className={`message-bubble ${outbound ? "outbound" : "inbound"}`}>
                      <p className="message-sender">{senderName}</p>
                      <p className="message-text">{displayText}</p>
                      {renderMessageMediaPreview(message, (preview) => setMediaPreviewModal(preview))}
                      {showMediaCaption ? <p className="message-media-caption">{mediaCaption}</p> : null}
                      <p className="queue-meta">{messageKindLabel(message.messageType)}</p>
                      {isStatusPost ? <p className="message-status-chip">Status Post</p> : null}
                      {(reactionsByMessage.get(message._id) || []).length > 0 ? (
                        <div className="queue-actions">
                          {(reactionsByMessage.get(message._id) || []).map((reaction, index) => (
                            <span key={`${reaction.actorJid}:${index}`} className="queue-meta">
                              {reaction.emoji} {reaction.direction === "outbound" ? "me" : "them"}
                            </span>
                          ))}
                        </div>
                      ) : null}
                      {outbound && toolSummaryCount > 0 ? (
                        <div className="queue-actions">
                          <button
                            type="button"
                            className="btn btn-ghost message-tool-summary-trigger"
                            onClick={() => setToolSummaryMessageId(message._id)}
                          >
                            Tools used ({messageToolSummary?.toolCalls.length || 0})
                          </button>
                          <p className="queue-meta message-tool-summary-meta">
                            {messageToolSummary?.contextWindows.length ? `${messageToolSummary.contextWindows.length} context window` : "No context window"}
                            {messageToolSummary?.styleGuardrails.length
                              ? ` · ${messageToolSummary.styleGuardrails.length} style guardrail`
                              : ""}
                          </p>
                          {plannerSummary ? (
                            <p className="queue-meta message-tool-summary-meta">
                              Planner {plannerModeLabel(plannerSummary.replyMode).toLowerCase()} · {plannerSummary.intentLabel} ·{" "}
                              {Math.round(plannerSummary.confidence * 100)}%
                            </p>
                          ) : null}
                        </div>
                      ) : null}
                      {reviewEntries.length > 0 ? (
                        <div className="thread-review-stack">
                          <p className="thread-review-group-title">Needs review ({reviewEntries.length})</p>
                          {reviewEntries.map((entry) => renderThreadReviewEntry(entry))}
                        </div>
                      ) : null}
                      <span>{formatDateTime(message.messageAt)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : threadMissing ? (
          <p className="empty-line">This thread is no longer available.</p>
        ) : threadsLoading ? (
          <LoadingIndicator label="Loading threads..." />
        ) : (
          <p className="empty-line">Choose a thread from the left.</p>
        )}

        <UIModal
          open={settingsModalOpen}
          onClose={() => setSettingsModalOpen(false)}
          title={selectedThreadId ? "Conversation Settings" : "Workspace Settings"}
          description="Adjust personality, prompt profile, and grounding."
        >
          <div className="conversation-controls">
            {selectedThreadId && (threadPersonalityLoading || profilesLoading) ? (
              <LoadingIndicator label="Loading personality settings…" />
            ) : null}

            {selectedThreadId && !threadLoading && !threadMissing && !threadPersonalityLoading && profiles.length > 0 ? (
              <ThreadPersonalityForm
                key={threadSettingKey}
                profiles={profiles}
                initialProfileSlug={threadPersonality?.profileSlug || "casual"}
                initialIntensity={threadPersonality?.intensity ?? 0.6}
                initialCustomPrompt={threadPersonality?.customPrompt || ""}
                initialMemePolicyMode={threadPersonality?.memePolicyMode || "auto"}
                autoProfessional={threadPersonality?.memeAutoProfessional}
                autoProfessionalScore={threadPersonality?.memeAutoProfessionalScore}
                autoProfessionalSignals={threadPersonality?.memeAutoProfessionalSignals}
                pending={settingsRecord.pending}
                onSave={saveThreadSetting}
              />
            ) : null}

            {selectedThreadId && !threadLoading && !threadMissing && !threadPersonalityLoading ? (
              <PromptProfileForm
                key={promptProfileFormKey}
                initialPromptProfile={threadPersonality?.threadPromptProfile || ""}
                source={threadPersonality?.threadPromptProfileSource}
                messageCount={threadPersonality?.threadPromptProfileMessageCount}
                updatedAt={threadPersonality?.threadPromptProfileUpdatedAt}
                pending={promptProfileRecord.pending}
                onAutoBuild={autoBuildPromptProfile}
                onSaveManual={savePromptProfile}
              />
            ) : null}

            {selectedThreadId && !threadLoading && !threadMissing ? (
              <GroundingForm
                key={`${selectedThreadId}:${threadGrounding?.myName || ""}:${threadGrounding?.theirName || ""}:${threadGrounding?.vibeNotes || ""}`}
                initialMyName={threadGrounding?.myName || ""}
                initialTheirName={threadGrounding?.theirName || ""}
                initialVibeNotes={threadGrounding?.vibeNotes || ""}
                autoAliases={threadGrounding?.autoAliases || []}
                pending={groundingRecord.pending}
                onSave={saveGrounding}
              />
            ) : null}

            <p className="queue-meta">
              Global profile studio lives in{" "}
              <Link href="/settings" onClick={() => setSettingsModalOpen(false)}>
                Settings
              </Link>
              . Unified media view lives in{" "}
              <Link href="/media" onClick={() => setSettingsModalOpen(false)}>
                Media
              </Link>
              .
            </p>
          </div>
        </UIModal>

        <UIModal
          open={Boolean(mediaPreviewModal)}
          onClose={() => setMediaPreviewModal(null)}
          title={mediaPreviewModal?.label || "Media Preview"}
          description={mediaPreviewModal?.mimeType || "Conversation attachment preview."}
        >
          {mediaPreviewModal?.url ? (
            <div className="stack compact">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={mediaPreviewModal.url} alt={mediaPreviewModal.label || "Media preview"} className="message-media-image modal-preview-image" />
              <a href={mediaPreviewModal.url} target="_blank" rel="noreferrer" className="message-media-link">
                Open full size
              </a>
            </div>
          ) : (
            <p className="empty-line">Media preview unavailable.</p>
          )}
        </UIModal>

        <UIModal
          open={Boolean(selectedToolSummary)}
          onClose={() => setToolSummaryMessageId(null)}
          title="Tool Call Summary"
          description="Context tools and checks captured before this outbound response."
        >
          {selectedToolSummary ? (
            <div className="stack compact">
              <div className="queue-item">
                <p className="queue-title">Response</p>
                <p className="queue-body">{trim(selectedToolSummaryMessage?.text || "No response text available.", 340)}</p>
                <p className="queue-meta">Sent: {formatDateTime(selectedToolSummary.messageAt)}</p>
              </div>

              <div className="queue-item">
                <p className="queue-title">Response Planner</p>
                {(() => {
                  const plannerEvent = selectedToolSummary.toolCalls.find((event) => event.toolName === "response_workbench");
                  const plannerSummary = parsePlannerSummary(plannerEvent?.parsedOutput);
                  if (!plannerEvent || !plannerSummary) {
                    return <p className="empty-line">No planner diagnostics captured for this response.</p>;
                  }
                  return (
                    <div className="tool-summary-item">
                      <p className="queue-meta">
                        {plannerEvent.phase === "outreach" ? "Outreach" : "Reply"} planner · {plannerEvent.latencyMs || 0}ms ·{" "}
                        {formatDateTime(plannerEvent.createdAt)}
                      </p>
                      <p className="queue-body">
                        Mode: {plannerModeLabel(plannerSummary.replyMode)} · Intent: {plannerSummary.intentLabel} · Confidence:{" "}
                        {Math.round(plannerSummary.confidence * 100)}%
                      </p>
                      <p className="queue-meta">
                        Explicit asks: {plannerSummary.explicitAskCount} · Ambiguity signals: {plannerSummary.ambiguityCount}
                      </p>
                    </div>
                  );
                })()}
              </div>

              <div className="queue-item">
                <p className="queue-title">Tool Calls</p>
                {selectedToolSummary.toolCalls.length === 0 ? (
                  <p className="empty-line">No tool calls captured for this response.</p>
                ) : (
                  <div className="stack compact">
                    {selectedToolSummary.toolCalls
                      .filter((event) => event.toolName !== "response_workbench")
                      .map((event) => (
                      <div key={event._id} className="tool-summary-item">
                        <p className="queue-meta">
                          {event.phase === "outreach" ? "Outreach" : "Reply"} · {event.toolName || event.eventType} · {event.latencyMs || 0}ms ·{" "}
                          {formatDateTime(event.createdAt)}
                        </p>
                        <p className="queue-meta">Input</p>
                        <pre className="tool-summary-json">{event.inputText || "(not captured)"}</pre>
                        <p className="queue-meta">Output</p>
                        <pre className="tool-summary-json">{event.outputText || "(not captured)"}</pre>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="queue-item">
                <p className="queue-title">Context Window + Guardrail</p>
                {selectedToolSummary.contextWindows.length === 0 && selectedToolSummary.styleGuardrails.length === 0 ? (
                  <p className="empty-line">No context-window or style-guardrail events captured.</p>
                ) : (
                  <div className="stack compact">
                    {selectedToolSummary.contextWindows.map((event) => (
                      <div key={event._id} className="tool-summary-item">
                        <p className="queue-meta">
                          {event.phase === "outreach" ? "Outreach" : "Reply"} context window · {formatDateTime(event.createdAt)}
                        </p>
                        <pre className="tool-summary-json">{event.detail || "(no detail)"}</pre>
                      </div>
                    ))}
                    {selectedToolSummary.styleGuardrails.map((event) => (
                      <div key={event._id} className="tool-summary-item">
                        <p className="queue-meta">
                          Style guardrail {event.passed ? "passed" : "failed"} · score {Number(event.score || 0).toFixed(2)} /{" "}
                          {Number(event.threshold || 0).toFixed(2)} · {formatDateTime(event.createdAt)}
                        </p>
                        <pre className="tool-summary-json">
                          {(event.hints || []).length > 0 ? (event.hints || []).join("\n") : event.detail || "(no hints captured)"}
                        </pre>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {toolEventSummary.unmatchedEvents.length > 0 ? (
                <p className="queue-meta">
                  {toolEventSummary.unmatchedEvents.length} recent tool event
                  {toolEventSummary.unmatchedEvents.length === 1 ? "" : "s"} could not be matched to a visible outbound message.
                </p>
              ) : null}
            </div>
          ) : null}
        </UIModal>
      </article>
    </section>
  );
}

export function LiveConversations({ initialThreadId }: LiveConversationsProps) {
  return <ConversationsContent initialThreadId={initialThreadId} />;
}
