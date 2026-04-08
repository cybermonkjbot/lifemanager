"use client";

import { ActionNotices } from "@/components/action-notices";
import { UIModal } from "@/components/ui-modal";
import { useActionStateRegistry } from "@/lib/ui/action-state";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { formatDateTime, trim } from "@/lib/format";
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

type MessageMediaPreview = {
  assetId: string;
  kind: "sticker" | "meme" | "image" | "video" | "audio" | "document";
  mimeType: string;
  label: string;
  url: string | null;
};

type ConversationMessageType = "text" | "reaction" | "sticker" | "meme" | "image" | "video" | "audio" | "document";

type ThreadMessage = {
  _id: string;
  direction: "inbound" | "outbound";
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
  const preview = message.mediaPreview;
  if (!preview?.url) {
    return message.mediaAssetId ? <p className="queue-meta">Media preview unavailable.</p> : null;
  }

  const mimeType = preview.mimeType.toLowerCase();
  const altText = preview.label || (preview.kind === "meme" ? "Meme" : preview.kind === "sticker" ? "Sticker" : "Media");
  if (mimeType.startsWith("image/") || preview.kind === "meme" || preview.kind === "sticker") {
    return (
      <button
        type="button"
        className="message-media-open"
        onClick={() => (onOpenImagePreview ? onOpenImagePreview(preview) : undefined)}
        aria-label={`Open ${altText}`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={preview.url} alt={altText} className="message-media-image" loading="lazy" />
      </button>
    );
  }
  if (mimeType.startsWith("video/")) {
    return <video src={preview.url} controls preload="metadata" className="message-media-video" />;
  }
  if (mimeType.startsWith("audio/")) {
    return <audio src={preview.url} controls preload="none" className="message-media-audio" />;
  }

  return (
    <a href={preview.url} target="_blank" rel="noreferrer" className="message-media-link">
      Open media attachment
    </a>
  );
}

function clamp01(value: number) {
  if (!Number.isFinite(value)) {
    return 0.7;
  }
  return Math.max(0, Math.min(value, 1));
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
      <p className="queue-meta">Set how replies should sound for this specific conversation.</p>

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
      <p className="queue-meta">Auto-build this conversation profile from all available thread history, including WhatsApp synced history, then edit manually if needed.</p>

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
      <p className="queue-meta">Set preferred names and vibe notes for better nickname and tone grounding.</p>
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
      <p className="queue-meta">Auto aliases: {autoAliases.join(", ") || "None yet"}</p>
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
  const threads = useQuery(api.threads.list, { limit: threadLimit }) as
    | Array<{
        _id: string;
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
  const setThreadPersonality = useMutation(api.personality.setThreadSetting);
  const setThreadPromptProfile = useMutation(api.personality.setThreadPromptProfile);
  const autoBuildThreadPromptProfile = useMutation(api.personality.autoBuildThreadPromptProfile);
  const saveGroundingMutation = useMutation(api.grounding.saveThreadGrounding);
  const ignoreThreadMutation = useMutation(api.backlog.ignoreThread);
  const recordEvent = useMutation(api.system.recordEvent);
  const { runAction, getRecord, notices, dismissNotice } = useActionStateRegistry();

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

  return (
    <section className="panel-grid split-view">
      <article className="panel-card">
        <h3>Threads</h3>
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
          {threadsLoading ? <p className="empty-line">Loading threads…</p> : null}
          {threadList.map((item) => (
            <Link
              key={item._id}
              href={`/conversations?threadId=${item._id}`}
              className={`thread-row${item._id === selectedThreadId ? " active" : ""}`}
              aria-current={item._id === selectedThreadId ? "page" : undefined}
            >
              <p className="queue-title">{item.title || item.jid}</p>
              <p className="queue-meta">
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
            Open Settings
          </button>
        </div>
        {threadLoading ? (
          <p className="empty-line">Loading timeline...</p>
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
              {(thread.messages || []).map((message) => {
                const outbound = message.direction === "outbound";
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
        ) : (
          <p className="empty-line">{threadsLoading ? "Loading threads..." : "Choose a thread from the left."}</p>
        )}

        <UIModal
          open={settingsModalOpen}
          onClose={() => setSettingsModalOpen(false)}
          title={selectedThreadId ? "Conversation Settings" : "Workspace Settings"}
          description="Manage thread-specific personality, prompt profile, and grounding."
        >
          <div className="conversation-controls">
            {selectedThreadId && (threadPersonalityLoading || profilesLoading) ? (
              <p className="empty-line">Loading personality settings…</p>
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
                <p className="queue-title">Tool Calls</p>
                {selectedToolSummary.toolCalls.length === 0 ? (
                  <p className="empty-line">No tool calls captured for this response.</p>
                ) : (
                  <div className="stack compact">
                    {selectedToolSummary.toolCalls.map((event) => (
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
