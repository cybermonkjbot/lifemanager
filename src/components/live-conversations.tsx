"use client";

import { ActionNotices } from "@/components/action-notices";
import { SearchableSelect } from "@/components/app-ui";
import { LoadingBlock, LoadingIndicator } from "@/components/loading-state";
import { SharedMediaPreview } from "@/components/media-preview";
import { ProviderFilter, type ProviderFilterValue } from "@/components/provider-filter";
import { useTenantScopeArgs } from "@/components/tenant-scope-provider";
import { ModalTabs, UIModal } from "@/components/ui-modal";
import { followupRescheduleDueAt, generateFollowupReasonWithAi } from "@/lib/ui/followups";
import { useActionStateRegistry } from "@/lib/ui/action-state";
import type { MediaPreviewResource } from "@/lib/ui/media";
import { generateTodoTitleWithAi } from "@/lib/ui/todos";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { formatDateTime, formatDateTimeWithRelative, trim } from "@/lib/format";
import { useEffect, useMemo, useRef, useState } from "react";

type LiveConversationsProps = {
  initialThreadId?: string;
};

const MAX_THREAD_PROMPT_PROFILE_CHARS = 8000;
const CONVERSATIONS_SEARCH_STORAGE_KEY = "slm.conversations.thread_search";
const CONVERSATIONS_PROVIDER_STORAGE_KEY = "slm.conversations.provider_filter";

function readStoredThreadSearch() {
  if (typeof window === "undefined") {
    return "";
  }
  return window.localStorage.getItem(CONVERSATIONS_SEARCH_STORAGE_KEY) || "";
}

function readStoredProviderFilter(): ProviderFilterValue {
  if (typeof window === "undefined") {
    return "all";
  }
  const saved = window.localStorage.getItem(CONVERSATIONS_PROVIDER_STORAGE_KEY);
  if (saved === "whatsapp" || saved === "instagram" || saved === "all") {
    return saved;
  }
  return "all";
}

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

type RelationshipThreadState = {
  profileSlug?: string;
  priorityTier: "romantic" | "professional" | "general";
  trustScore: number;
  warmthTrend: -1 | 0 | 1;
  conflictFlag: boolean;
  responsivenessMismatch: boolean;
  repairNeeded: boolean;
  lastReason?: string;
  updatedAt: number;
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

type ContactMemoryFact = {
  _id: string;
  factKey: string;
  factValue: string;
  factType: "preference" | "profile" | "schedule" | "relationship" | "promise" | "other";
  confidence?: number;
  sourceExcerpt?: string;
  updatedAt?: number;
};

type ContactMemoryFactsPayload = {
  facts: ContactMemoryFact[];
};

type CorrectableGender = "unknown" | "female" | "male" | "nonbinary";

type IdentityCorrectionFormProps = {
  facts: ContactMemoryFact[];
  loading: boolean;
  pending: boolean;
  onSaveGender: (gender: CorrectableGender, note: string) => void;
};

type MessageMediaPreview = MediaPreviewResource;

type ThreadAvatarPreview = {
  assetId: string;
  url: string;
  mimeType: string;
  updatedAt?: number;
} | null;

type ConversationMessageType =
  | "text"
  | "reaction"
  | "sticker"
  | "meme"
  | "image"
  | "video"
  | "audio"
  | "voice_note"
  | "document";

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

type ThreadMediaItem = {
  _id: string;
  direction: "inbound" | "outbound";
  text: string;
  messageType?: ConversationMessageType;
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
  sendKind?: "text" | "reaction" | "sticker" | "meme" | "voice_note";
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
  status?: string;
  errorCode?: string;
};

type ThreadTimelineActivity = {
  _id: string;
  createdAt: number;
  source: string;
  eventType: string;
  detail: string;
  outboxId?: string;
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
  replyMode: "answer" | "confirm" | "clarify" | "close" | "lead";
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

function safePrettyJson(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function numberField(record: Record<string, unknown> | null, key: string) {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringField(record: Record<string, unknown> | null, key: string) {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizedGenderFromFactValue(value: string): CorrectableGender {
  const text = ` ${value.toLowerCase()} `;
  if (/\b(nonbinary|non-binary|genderfluid|they\/them)\b/.test(text)) {
    return "nonbinary";
  }
  if (/\b(female|woman|girl|lady|she\/her)\b/.test(text)) {
    return "female";
  }
  if (/\b(male|man|guy|boy|he\/him)\b/.test(text)) {
    return "male";
  }
  return "unknown";
}

function factLabel(key: string) {
  return key.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function parsePlannerSummary(value: unknown): PlannerSummary | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const intentLabel = typeof record.intentLabel === "string" ? record.intentLabel : "";
  const replyModeRaw = typeof record.replyMode === "string" ? record.replyMode : "";
  const replyMode =
    replyModeRaw === "answer" ||
    replyModeRaw === "confirm" ||
    replyModeRaw === "clarify" ||
    replyModeRaw === "close" ||
    replyModeRaw === "lead"
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
  if (mode === "lead") return "Lead";
  return "Close";
}

function formatLatencyMs(value?: number) {
  if (!Number.isFinite(value)) {
    return "0ms";
  }
  const rounded = Math.max(0, Math.round(value as number));
  if (rounded >= 1000) {
    return `${(rounded / 1000).toFixed(1)}s`;
  }
  return `${rounded}ms`;
}

function toolDisplayName(toolName?: string) {
  if (toolName === "conversation_history_search") return "Conversation search";
  if (toolName === "context_window_cleaning") return "Context cleanup";
  if (toolName === "context_window_detection") return "Context window";
  if (toolName === "contact_memory_fact_selection") return "Memory facts";
  if (toolName === "model_tool_router_plan") return "Tool router";
  if (toolName === "response_workbench") return "Response planner";
  return toolName || "Tool call";
}

function toolTone(event: ThreadToolEvent) {
  const output = asRecord(event.parsedOutput);
  const status = stringField(output, "status") || event.status || "";
  if (status === "error" || status === "timeout" || event.errorCode || stringField(output, "errorCode")) {
    return "danger";
  }
  return "ok";
}

function toolOutcomeText(event: ThreadToolEvent) {
  const output = asRecord(event.parsedOutput);
  const status = stringField(output, "status") || event.status || "";
  const errorMessage = stringField(output, "errorMessage");
  if (status === "error" || status === "timeout" || event.errorCode || stringField(output, "errorCode")) {
    return errorMessage ? `Needs attention: ${trim(errorMessage, 140)}` : "Needs attention before trusting this context.";
  }

  if (event.toolName === "conversation_history_search") {
    const hits = numberField(output, "hits");
    const source = stringField(output, "source") || stringField(asRecord(event.parsedInput), "source");
    const stage = stringField(output, "retrievalStage");
    const sourceText = source === "external" ? " from external retrieval" : "";
    const stageText = stage ? ` (${stage.replaceAll("_", " ")})` : "";
    return `Found ${hits ?? 0} relevant history ${hits === 1 ? "hit" : "hits"}${sourceText}${stageText}.`;
  }

  if (event.toolName === "contact_memory_fact_selection") {
    const selectedFacts = numberField(output, "selectedFacts");
    const matchedFacts = numberField(output, "matchedFacts");
    return `Selected ${selectedFacts ?? 0} contact ${selectedFacts === 1 ? "fact" : "facts"} from ${matchedFacts ?? 0} matches.`;
  }

  if (event.toolName === "context_window_cleaning") {
    const cleaned = numberField(output, "cleanedHistoryLines");
    const removed = numberField(output, "removedCount");
    return `Kept ${cleaned ?? 0} clean history ${cleaned === 1 ? "line" : "lines"} and removed ${removed ?? 0}.`;
  }

  if (event.toolName === "context_window_detection") {
    const overflow = numberField(output, "overflowTokens");
    const promptTokens = numberField(output, "estimatedPromptTokens");
    return overflow && overflow > 0
      ? `Context exceeded budget by ${Math.round(overflow)} tokens.`
      : `Context fit inside the window${promptTokens ? ` at about ${Math.round(promptTokens)} tokens` : ""}.`;
  }

  if (event.toolName === "model_tool_router_plan") {
    const preview = stringField(output, "preview");
    return preview ? trim(preview, 160) : `Router finished with status ${status || "ok"}.`;
  }

  return event.outputText ? trim(event.outputText, 180) : "Completed with captured output.";
}

function toolMetricChips(event: ThreadToolEvent) {
  const input = asRecord(event.parsedInput);
  const output = asRecord(event.parsedOutput);
  const chips: string[] = [];
  const status = stringField(output, "status") || event.status;
  if (status) {
    chips.push(status);
  }
  const hits = numberField(output, "hits");
  if (hits !== null) {
    chips.push(`${hits} ${hits === 1 ? "hit" : "hits"}`);
  }
  const selectedFacts = numberField(output, "selectedFacts");
  if (selectedFacts !== null) {
    chips.push(`${selectedFacts} facts`);
  }
  const searchedHistoryLines = numberField(input, "searchedHistoryLines");
  if (searchedHistoryLines !== null) {
    chips.push(`${searchedHistoryLines} searched`);
  }
  const confidence = numberField(output, "confidence");
  if (confidence !== null) {
    chips.push(`${Math.round(clamp01(confidence) * 100)}% confidence`);
  }
  const overflowTokens = numberField(output, "overflowTokens");
  if (overflowTokens !== null) {
    chips.push(overflowTokens > 0 ? `${Math.round(overflowTokens)} overflow tokens` : "fits context");
  }
  return chips.slice(0, 4);
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

function timelineEventLabel(eventType: string) {
  if (eventType === "draft.pending.active") return "Draft pending";
  if (eventType === "outbox.pending.active") return "Queued";
  if (eventType === "outbox.claimed.active") return "Sending";
  if (eventType === "draft.approved") return "Draft approved";
  if (eventType === "draft.pending.cleared") return "Draft cleared";
  if (eventType === "outbox.sent") return "Sent";
  if (eventType === "outbox.failed.retry") return "Send failed (retry)";
  if (eventType === "outbox.failed.final") return "Send failed";
  if (eventType.startsWith("outbox.suppressed.")) return "Suppressed";
  if (eventType.startsWith("outbox.deferred.")) return "Deferred";
  if (eventType.startsWith("guardrail.")) return "Guardrail";
  if (eventType.startsWith("followup.")) return "Follow-up";
  if (eventType.startsWith("todo.")) return "TODO";
  if (eventType.startsWith("ai.context.tool.")) return "Tool call";
  if (eventType === "ai.context.window") return "Context window";
  if (eventType.startsWith("ai.style_guardrail.")) return "Style guardrail";
  return eventType.replaceAll(".", " ");
}

function timelineEventTone(eventType: string) {
  if (eventType.includes(".failed") || eventType.includes(".blocked") || eventType.includes(".rejected")) {
    return "danger";
  }
  if (eventType.includes(".suppressed") || eventType.includes(".deferred") || eventType.includes(".ignored")) {
    return "warn";
  }
  if (eventType.includes(".sent") || eventType.includes(".approved") || eventType.includes(".confirmed")) {
    return "ok";
  }
  return "neutral";
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
  if (message.messageType === "voice_note") {
    return "Sent a voice note";
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

function renderThreadAvatar(label: string, avatarPreview?: ThreadAvatarPreview, className = "") {
  const fallback = (label || "?").charAt(0).toUpperCase();
  return (
    <span className={`thread-row-avatar${className ? ` ${className}` : ""}`} aria-hidden="true">
      {avatarPreview?.url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={avatarPreview.url} alt="" loading="lazy" decoding="async" />
      ) : (
        fallback
      )}
    </span>
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
        <SearchableSelect
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
        </SearchableSelect>
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
        <SearchableSelect
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
        </SearchableSelect>
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
  const hasSavedManualPrompt = source === "manual" && Boolean(initialPromptProfile.trim());
  const autoActionLabel = hasSavedManualPrompt ? "Auto-Improve And Add To Prompt" : "Auto-Build From All History";
  const autoActionPendingLabel = hasSavedManualPrompt ? "Improving..." : "Building...";
  const helperCopy = hasSavedManualPrompt
    ? "Auto-improve from thread history and append guidance without replacing your saved manual prompt."
    : "Build a prompt profile from thread history, then edit manually if needed.";

  const promptChanged = useMemo(() => promptProfile.trim() !== initialPromptProfile.trim(), [initialPromptProfile, promptProfile]);

  return (
    <div className="personality-config-block">
      <h3>Prompt Profile Builder</h3>
      <p className="queue-meta">{helperCopy}</p>

      <button
        type="button"
        className="btn btn-primary"
        onClick={onAutoBuild}
        disabled={pending}
        aria-disabled={pending}
      >
        {pending ? autoActionPendingLabel : autoActionLabel}
      </button>

      <label className="setup-input-group">
        <span className="queue-meta">Conversation prompt profile</span>
        <textarea
          rows={12}
          value={promptProfile}
          onChange={(event) => setPromptProfile(event.target.value)}
          placeholder="Example: Keep this chat casual and playful, use short replies, and mirror their emoji style."
          maxLength={MAX_THREAD_PROMPT_PROFILE_CHARS}
          disabled={pending}
          aria-disabled={pending}
        />
      </label>
      <p className="queue-meta">
        {promptProfile.length}/{MAX_THREAD_PROMPT_PROFILE_CHARS} characters
      </p>

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

function IdentityCorrectionForm({ facts, loading, pending, onSaveGender }: IdentityCorrectionFormProps) {
  const overrideFact = facts.find((fact) => fact.factKey === "profile_gender_override" || fact.factKey === "gender_override");
  const inferredFact = facts.find((fact) => fact.factKey === "inferred_gender");
  const relevantFacts = facts.filter((fact) => /(gender|pronoun|identity|profile)/i.test(`${fact.factKey} ${fact.factValue}`)).slice(0, 8);
  const activeFact = overrideFact || inferredFact || relevantFacts[0];
  const [gender, setGender] = useState<CorrectableGender>(() => normalizedGenderFromFactValue(activeFact?.factValue || ""));
  const [note, setNote] = useState("");
  const savedGender = normalizedGenderFromFactValue(overrideFact?.factValue || "");
  const hasSavedOverride = Boolean(overrideFact);
  const hasChanged = gender !== savedGender || Boolean(note.trim());

  return (
    <div className="personality-config-block identity-correction-panel">
      <h3>Contact Identity</h3>
      <p className="queue-meta">
        Correct the system&apos;s gender read for this conversation. Manual corrections are used before inferred name, pronoun, or chat-language cues.
      </p>

      {loading ? <LoadingIndicator label="Loading saved identity facts..." /> : null}

      <div className="identity-correction-grid">
        <div className="identity-correction-summary">
          <p className="queue-title">Current read</p>
          <p className="identity-correction-value">{hasSavedOverride ? factLabel(gender) : factLabel(normalizedGenderFromFactValue(activeFact?.factValue || ""))}</p>
          <p className="queue-meta">
            {hasSavedOverride
              ? "Manually corrected in settings."
              : activeFact
                ? `Inferred from ${factLabel(activeFact.factKey)}${typeof activeFact.confidence === "number" ? ` · ${Math.round(activeFact.confidence * 100)}%` : ""}`
                : "No saved gender cue yet."}
          </p>
        </div>

        <label className="setup-input-group">
          <span className="queue-meta">Correct gender cue</span>
          <SearchableSelect
            value={gender}
            onChange={(event) => setGender(event.target.value as CorrectableGender)}
            disabled={pending}
            aria-disabled={pending}
          >
            <option value="unknown">Unknown / do not infer</option>
            <option value="female">Female</option>
            <option value="male">Male</option>
            <option value="nonbinary">Nonbinary</option>
          </SearchableSelect>
        </label>
      </div>

      <label className="setup-input-group">
        <span className="queue-meta">Optional note for future scans</span>
        <textarea
          rows={2}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Example: She/her; confirmed by conversation. Avoid guessing from name alone."
          disabled={pending}
          aria-disabled={pending}
        />
      </label>

      <button
        type="button"
        className="btn btn-primary"
        onClick={() => onSaveGender(gender, note)}
        disabled={pending || !hasChanged}
        aria-disabled={pending || !hasChanged}
      >
        {pending ? "Saving..." : "Save Identity Correction"}
      </button>

      <div className="identity-fact-list">
        <p className="queue-title">Saved cues</p>
        {relevantFacts.length ? (
          relevantFacts.map((fact) => (
            <div className="identity-fact-row" key={fact._id}>
              <span>{factLabel(fact.factKey)}</span>
              <p>{fact.factValue}</p>
              <em>{typeof fact.updatedAt === "number" ? formatDateTime(fact.updatedAt) : "Saved memory"}</em>
            </div>
          ))
        ) : (
          <p className="queue-meta">No identity cues saved for this conversation yet.</p>
        )}
      </div>
    </div>
  );
}

function ConversationsContent({ initialThreadId }: { initialThreadId?: string }) {
  const tenantScope = useTenantScopeArgs();
  type ThreadListItem = {
    _id: string;
    provider?: "whatsapp" | "instagram";
    title?: string;
    jid: string;
    threadKind?: "direct" | "group" | "broadcast_or_system";
    isArchived?: boolean;
    lastMessageAt: number;
    avatarPreview?: ThreadAvatarPreview;
    latestDraft?: { text?: string } | null;
    latestMessage?: { text?: string | null; direction?: "inbound" | "outbound"; messageAt?: number } | null;
  };

  const [threadVisibleCount, setThreadVisibleCount] = useState(80);
  const [threadSearch, setThreadSearch] = useState(() => readStoredThreadSearch());
  const [providerFilter, setProviderFilter] = useState<ProviderFilterValue>(() => readStoredProviderFilter());
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [desktopInspectorOpen, setDesktopInspectorOpen] = useState(false);
  const [mobileInspectorOpen, setMobileInspectorOpen] = useState(false);
  const threads = useQuery(api.threads.list, { ...tenantScope, limit: 500, provider: providerFilter }) as
    | ThreadListItem[]
    | undefined;
  const visibleThreads = threads || [];
  const threadsLoading = threads === undefined;
  const normalizedThreadSearch = threadSearch.trim().toLowerCase();
  const filteredThreadList = visibleThreads.filter((thread) => {
    if (!normalizedThreadSearch) {
      return true;
    }
    const haystack = `${thread.title || ""}\n${thread.jid}`.toLowerCase();
    return haystack.includes(normalizedThreadSearch);
  });
  const threadList = filteredThreadList.slice(0, threadVisibleCount);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(CONVERSATIONS_SEARCH_STORAGE_KEY, threadSearch);
  }, [threadSearch]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(CONVERSATIONS_PROVIDER_STORAGE_KEY, providerFilter);
  }, [providerFilter]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const mediaQuery = window.matchMedia("(max-width: 980px)");
    const syncViewport = () => setIsMobileViewport(mediaQuery.matches);
    syncViewport();
    mediaQuery.addEventListener("change", syncViewport);
    return () => mediaQuery.removeEventListener("change", syncViewport);
  }, []);

  const profilesQuery = useQuery(api.personality.listProfiles, tenantScope) as PersonalityProfile[] | undefined;
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
  const updateTodoCandidateTitle = useMutation(api.todos.updateCandidateTitle);
  const resolveGuardrail = useMutation(api.queue.resolveGuardrail);
  const setThreadPersonality = useMutation(api.personality.setThreadSetting);
  const setThreadPromptProfile = useMutation(api.personality.setThreadPromptProfile);
  const autoBuildThreadPromptProfile = useMutation(api.personality.autoBuildThreadPromptProfile);
  const saveGroundingMutation = useMutation(api.grounding.saveThreadGrounding);
  const upsertContactMemoryFact = useMutation(api.chatTools.upsertContactMemoryFact);
  const ignoreThreadMutation = useMutation(api.backlog.ignoreThread);
  const deleteThreadMutation = useMutation(api.threads.deleteThread);
  const recordEvent = useMutation(api.system.recordEvent);
  const { runAction, getRecord, isPending, notices, dismissNotice } = useActionStateRegistry();

  const selectedThreadId =
    (initialThreadId && threadList.some((thread) => thread._id === initialThreadId) ? initialThreadId : undefined) ||
    (!isMobileViewport ? threadList[0]?._id : undefined);

	  const thread = useQuery(
	    api.threads.get,
	    selectedThreadId ? { ...tenantScope, threadId: selectedThreadId as Id<"threads"> } : "skip",
  ) as
    | {
        thread: {
          title?: string;
          baileysSavedName?: string;
          baileysNotifyName?: string;
          baileysVerifiedName?: string;
          baileysPhoneNumber?: string;
          baileysLid?: string;
          baileysChatName?: string;
          baileysConversationName?: string;
          baileysSubject?: string;
          baileysUnreadCount?: number;
          baileysMetadataUpdatedAt?: number;
          jid: string;
          provider?: "whatsapp" | "instagram";
          threadKind?: "direct" | "group" | "broadcast_or_system";
          isArchived?: boolean;
          isIgnored?: boolean;
          lastMessageAt?: number;
          avatarPreview?: ThreadAvatarPreview;
        };
        messages: ThreadMessage[];
        threadMedia?: ThreadMediaItem[];
        reactions: Array<{
          messageId: string;
          actorJid: string;
          emoji: string;
          direction: "inbound" | "outbound";
        }>;
        conversationState?: {
          lastMutualCheckInAt?: number;
          lastInboundCheckInAt?: number;
          lastOutboundCheckInAt?: number;
          currentPrimaryTopicKey?: string;
          topicDyingScore?: number;
          nextMove?: "none" | "check_in" | "pivot" | "close";
          conversationEndImminent?: boolean;
          topicDwellScore?: number;
          lastPivotAt?: number;
          lastCloseAt?: number;
          lastLeadQuestionAt?: number;
        } | null;
        topicLanes?: Array<{
          topicKey: string;
          topicLabel: string;
          status: "active" | "cooling" | "closed";
          lastMessageAt?: number;
          inboundTurns?: number;
          outboundTurns?: number;
          dyingScore?: number;
        }>;
        checkInDiagnostics?: {
          promptDetectionsRecent?: number;
          responseDetectionsRecent?: number;
          mutualUpdatesRecent?: number;
          lastPromptAt?: number;
          lastResponseAt?: number;
          lastMutualUpdateAt?: number;
          lastMutualUpdateDetail?: string;
          lastMutualCheckInAt?: number;
        } | null;
        timelineActivity?: ThreadTimelineActivity[];
        grounding?: ThreadGrounding | null;
        reviewQueue?: ThreadReviewQueue;
      }
    | null
    | undefined;

  const threadPersonality = useQuery(
    api.personality.getThreadSetting,
    selectedThreadId ? { ...tenantScope, threadId: selectedThreadId as Id<"threads"> } : "skip",
  ) as ThreadPersonalitySetting | null | undefined;
  const threadLoading = Boolean(selectedThreadId) && thread === undefined;
  const threadMissing = Boolean(selectedThreadId) && thread === null;
  const threadPersonalityLoading = Boolean(selectedThreadId) && threadPersonality === undefined;
  const threadGrounding = useQuery(
    api.grounding.getThreadGrounding,
    selectedThreadId ? { threadId: selectedThreadId as Id<"threads"> } : "skip",
  ) as ThreadGrounding | null | undefined;
  const contactMemoryFacts = useQuery(
    api.chatTools.contactMemoryFactsList,
    selectedThreadId ? { threadId: selectedThreadId as Id<"threads">, factType: "profile", limit: 80 } : "skip",
  ) as ContactMemoryFactsPayload | undefined;
	  const threadToolEvents = useQuery(
	    api.threads.getToolEvents,
	    selectedThreadId ? { ...tenantScope, threadId: selectedThreadId as Id<"threads">, limit: 260 } : "skip",
  ) as ThreadToolEvent[] | undefined;
  const relationshipState = useQuery(
    api.relationshipState.getThreadState,
    selectedThreadId ? { threadId: selectedThreadId as Id<"threads"> } : "skip",
  ) as RelationshipThreadState | null | undefined;
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [toolSummaryMessageId, setToolSummaryMessageId] = useState<string | null>(null);
  const [mediaPreviewModal, setMediaPreviewModal] = useState<MessageMediaPreview | null>(null);
  const [draftEdits, setDraftEdits] = useState<Record<string, string>>({});
  const [autoTodoTitles, setAutoTodoTitles] = useState<Record<string, string>>({});
  const [autoFollowupReasons, setAutoFollowupReasons] = useState<Record<string, string>>({});
  const messageRowRefs = useRef(new Map<string, HTMLDivElement>());
  const conversationWindowRef = useRef<HTMLDivElement | null>(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const autoTodoAttemptedRef = useRef<Set<string>>(new Set());
  const autoFollowupAttemptedRef = useRef<Set<string>>(new Set());

  const settingsKey = selectedThreadId ? `personality:thread:${selectedThreadId}` : "personality:thread:none";
  const promptProfileKey = selectedThreadId ? `personality:promptprofile:${selectedThreadId}` : "personality:promptprofile:none";
  const groundingKey = selectedThreadId ? `grounding:thread:${selectedThreadId}` : "grounding:thread:none";
  const identityCorrectionKey = selectedThreadId ? `identity:thread:${selectedThreadId}` : "identity:thread:none";
  const ignoreThreadKey = selectedThreadId ? `conversation:ignore:${selectedThreadId}` : "conversation:ignore:none";
  const deleteThreadKey = selectedThreadId ? `conversation:delete:${selectedThreadId}` : "conversation:delete:none";

  const settingsRecord = getRecord(settingsKey);
  const promptProfileRecord = getRecord(promptProfileKey);
  const groundingRecord = getRecord(groundingKey);
  const identityCorrectionRecord = getRecord(identityCorrectionKey);
  const ignoreThreadRecord = getRecord(ignoreThreadKey);
  const deleteThreadRecord = getRecord(deleteThreadKey);
  const lastLoadStartedThreadRef = useRef<string | null>(null);
  const lastLoadedThreadRef = useRef<string | null>(null);

  useEffect(() => {
    if (!selectedThreadId || lastLoadStartedThreadRef.current === selectedThreadId) {
      return;
    }

    lastLoadStartedThreadRef.current = selectedThreadId;
    void recordEvent({
      ...tenantScope,
      source: "dashboard",
      eventType: "conversation.load.start",
      detail: "Loading conversation timeline...",
      threadId: selectedThreadId as Id<"threads">,
    });
  }, [recordEvent, selectedThreadId, tenantScope]);

  useEffect(() => {
    if (!selectedThreadId || !thread || lastLoadedThreadRef.current === selectedThreadId) {
      return;
    }

    lastLoadedThreadRef.current = selectedThreadId;
    void recordEvent({
      ...tenantScope,
      source: "dashboard",
      eventType: "conversation.load.ready",
      detail: `Conversation loaded (${thread.messages?.length ?? 0} messages).`,
      threadId: selectedThreadId as Id<"threads">,
    });
  }, [recordEvent, selectedThreadId, tenantScope, thread]);

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
          ...tenantScope,
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
          ...tenantScope,
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
    const hasSavedManualPrompt =
      threadPersonality?.threadPromptProfileSource === "manual" && Boolean((threadPersonality?.threadPromptProfile || "").trim());

    void runAction(
      promptProfileKey,
      async () => {
        await autoBuildThreadPromptProfile({
          ...tenantScope,
          threadId: selectedThreadId as Id<"threads">,
        });
      },
      {
        pendingLabel: hasSavedManualPrompt
          ? "Auto-improving prompt profile from conversation history..."
          : "Building prompt profile from conversation history...",
        successMessage: hasSavedManualPrompt
          ? "Conversation prompt profile improved and appended."
          : "Conversation prompt profile auto-built.",
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

  const saveIdentityCorrection = (gender: CorrectableGender, note: string) => {
    if (!selectedThreadId) {
      return;
    }
    const label = gender === "unknown" ? "unknown; manually corrected; do not infer gender unless stronger evidence appears" : gender;
    const cleanedNote = note.trim();
    void runAction(
      identityCorrectionKey,
      async () => {
        await upsertContactMemoryFact({
          threadId: selectedThreadId as Id<"threads">,
          factKey: "profile_gender_override",
          factValue: cleanedNote ? `${label}; ${cleanedNote}` : `${label}; manually corrected in conversation settings`,
          factType: "profile",
          confidence: 0.99,
          sourceExcerpt: "Manual gender correction from Conversation Settings.",
        });
      },
      {
        pendingLabel: "Saving identity correction...",
        successMessage: "Identity correction saved.",
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

  const deleteSelectedThread = () => {
    if (!selectedThreadId || !thread) {
      return;
    }
    const threadLabel = thread.thread.title || thread.thread.jid;
    const confirmed = window.confirm(
      `Delete this thread?\n\n${threadLabel}\n\nThis permanently removes the thread and its related conversation data.`,
    );
    if (!confirmed) {
      return;
    }

    void runAction(
      deleteThreadKey,
      async () => {
        await deleteThreadMutation({
          threadId: selectedThreadId as Id<"threads">,
        });
      },
      {
        pendingLabel: "Deleting conversation thread...",
        successMessage: "Conversation thread deleted.",
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
        pendingLabel: "Discarding draft...",
        successMessage: "Draft discarded.",
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
          throw new Error(payload.guardrailReason?.trim() || "AI improvement was blocked by a safety rule.");
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

  const onReviewConvertTodo = (item: ThreadReviewTodoItem) => {
    const key = `todo:${item._id}`;
    void runAction(
      key,
      async () => {
        const generatedTitle = (autoTodoTitles[item._id] || item.title).trim();
        await updateTodoCandidateTitle({
          candidateId: item._id as Id<"todoCandidates">,
          title: generatedTitle,
        });
        await createTodoFromCandidate({ candidateId: item._id as Id<"todoCandidates"> });
      },
      {
        pendingLabel: "Adding task...",
        successMessage: "Task added.",
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
        pendingLabel: "Resolving safety flag...",
        successMessage: "Safety flag resolved.",
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
  const isSelfChatSystemThread = useMemo(() => {
    if (!thread) {
      return false;
    }
    if (thread.thread.threadKind && thread.thread.threadKind !== "direct") {
      return false;
    }
    const nonStatusMessages = (thread.messages || []).filter((message) => !message.isStatus);
    if (nonStatusMessages.length === 0) {
      return false;
    }
    const inboundCount = nonStatusMessages.filter((message) => message.direction === "inbound").length;
    const manualOutboundCount = nonStatusMessages.filter(
      (message) => message.direction === "outbound" && !message.toolRunId,
    ).length;
    const automatedOutboundCount = nonStatusMessages.filter(
      (message) => message.direction === "outbound" && Boolean(message.toolRunId),
    ).length;
    return inboundCount === 0 && manualOutboundCount > 0 && automatedOutboundCount > 0;
  }, [thread]);
  const threadMessagesById = useMemo(() => {
    const map = new Map<string, ThreadMessage>();
    for (const message of thread?.messages || []) {
      map.set(message._id, message);
    }
    return map;
  }, [thread?.messages]);
  const timelineRows = useMemo(() => {
    const messageRows = (thread?.messages || []).map((message) => ({
      key: `message:${message._id}`,
      at: message.messageAt,
      priority: 1,
      kind: "message" as const,
      message,
    }));
    const activityRows = (thread?.timelineActivity || []).map((activity) => ({
      key: `activity:${activity._id}`,
      at: activity.createdAt,
      priority: 0,
      kind: "activity" as const,
      activity,
    }));
    return [...messageRows, ...activityRows]
      .sort((left, right) => (left.at === right.at ? left.priority - right.priority : left.at - right.at))
      .slice(-600);
  }, [thread?.messages, thread?.timelineActivity]);
  const selectedToolSummary = toolSummaryMessageId ? toolEventSummary.byMessageId.get(toolSummaryMessageId) || null : null;
  const selectedToolSummaryMessage = toolSummaryMessageId ? threadMessagesById.get(toolSummaryMessageId) || null : null;

  const threadReviewQueue = thread?.reviewQueue || {
    needsReply: [],
    followupConfirmations: [],
    todoCandidates: [],
    guardrailFlags: [],
  };
  const reviewItemCount =
    threadReviewQueue.needsReply.length +
    threadReviewQueue.followupConfirmations.length +
    threadReviewQueue.todoCandidates.length +
    threadReviewQueue.guardrailFlags.length;
  const contactFacts = contactMemoryFacts?.facts || [];
  const profileFacts = contactFacts.filter((fact) => fact.factType === "profile").slice(0, 5);
  const selectedProfile = profiles.find((profile) => profile.slug === (threadPersonality?.profileSlug || "casual"));
  const latestThreadMessage = thread?.messages?.[thread.messages.length - 1];
  const mutualCheckInAgeDays = useMemo(() => {
    const at = thread?.conversationState?.lastMutualCheckInAt;
    if (!Number.isFinite(at) || (at || 0) <= 0) {
      return undefined;
    }
    const referenceAt = Math.max(
      Number(thread?.thread?.lastMessageAt || 0),
      Number(thread?.messages?.[thread.messages.length - 1]?.messageAt || 0),
      Number(at),
    );
    return Math.max(0, Math.floor((referenceAt - Number(at)) / (24 * 60 * 60 * 1000)));
  }, [thread?.conversationState?.lastMutualCheckInAt, thread?.messages, thread?.thread?.lastMessageAt]);
  const laneSummary = useMemo(() => {
    return (thread?.topicLanes || [])
      .slice(0, 3)
      .map((lane) => {
        const turnCount = Math.max(0, lane.inboundTurns || 0) + Math.max(0, lane.outboundTurns || 0);
        return `${lane.topicLabel} (${lane.status}, ${turnCount} turns)`;
      })
      .join(" · ");
  }, [thread?.topicLanes]);
  const threadMedia = useMemo(() => thread?.threadMedia || [], [thread?.threadMedia]);
  const mediaKindCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of threadMedia) {
      const kind = messageKindLabel(item.messageType || item.mediaPreview?.kind).toLowerCase();
      counts.set(kind, (counts.get(kind) || 0) + 1);
    }
    return [...counts.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 4)
      .map(([kind, count]) => `${count} ${kind}${count === 1 ? "" : "s"}`)
      .join(" · ");
  }, [threadMedia]);
  const baileysMetadataRows = useMemo(() => {
    if (!thread) {
      return [] as Array<{ label: string; value: string }>;
    }
    return [
      { label: "Saved name", value: thread.thread.baileysSavedName },
      { label: "WhatsApp name", value: thread.thread.baileysNotifyName },
      { label: "Verified name", value: thread.thread.baileysVerifiedName },
      { label: "Chat name", value: thread.thread.baileysChatName },
      { label: "Conversation", value: thread.thread.baileysConversationName },
      { label: "Subject", value: thread.thread.baileysSubject },
      { label: "Phone", value: thread.thread.baileysPhoneNumber },
      { label: "LID", value: thread.thread.baileysLid },
      {
        label: "Unread",
        value: typeof thread.thread.baileysUnreadCount === "number" ? String(thread.thread.baileysUnreadCount) : undefined,
      },
      {
        label: "Metadata seen",
        value: thread.thread.baileysMetadataUpdatedAt ? formatDateTime(thread.thread.baileysMetadataUpdatedAt) : undefined,
      },
    ].filter((row): row is { label: string; value: string } => Boolean(row.value && row.value.trim()));
  }, [thread]);

  useEffect(() => {
    if (!selectedThreadId) {
      return;
    }
    let cancelled = false;
    const run = async () => {
      for (const item of threadReviewQueue.todoCandidates) {
        if (autoTodoAttemptedRef.current.has(item._id)) {
          continue;
        }
        autoTodoAttemptedRef.current.add(item._id);
        try {
          const generatedTitle = await generateTodoTitleWithAi({
            currentTitle: item.title,
            sourceText: item.sourceMessage?.text,
            threadId: selectedThreadId,
          });
          if (cancelled) {
            return;
          }
          setAutoTodoTitles((current) => ({
            ...current,
            [item._id]: generatedTitle,
          }));
          if (generatedTitle.trim() !== item.title.trim()) {
            await updateTodoCandidateTitle({
              candidateId: item._id as Id<"todoCandidates">,
              title: generatedTitle,
            });
          }
        } catch {
          // Best-effort background enhancement.
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [selectedThreadId, threadReviewQueue.todoCandidates, updateTodoCandidateTitle]);

  useEffect(() => {
    if (!selectedThreadId) {
      return;
    }
    let cancelled = false;
    const run = async () => {
      for (const item of threadReviewQueue.followupConfirmations) {
        if (autoFollowupAttemptedRef.current.has(item._id)) {
          continue;
        }
        autoFollowupAttemptedRef.current.add(item._id);
        try {
          const generatedReason = await generateFollowupReasonWithAi({
            currentReason: item.reason,
            sourceText: item.sourceSnippet || item.sourceMessage?.text,
            dueAt: item.dueAt,
            threadId: selectedThreadId,
          });
          if (cancelled) {
            return;
          }
          setAutoFollowupReasons((current) => ({
            ...current,
            [item._id]: generatedReason,
          }));
        } catch {
          // Best-effort background enhancement.
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [selectedThreadId, threadReviewQueue.followupConfirmations]);

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
  const lastInboundMessageId = useMemo(() => {
    const rows = thread?.messages || [];
    for (let i = rows.length - 1; i >= 0; i -= 1) {
      if (rows[i].direction === "inbound") {
        return rows[i]._id;
      }
    }
    return null;
  }, [thread?.messages]);
  const lastMessageId = useMemo(() => {
    const rows = thread?.messages || [];
    return rows.length > 0 ? rows[rows.length - 1]._id : null;
  }, [thread?.messages]);
  const inboundMessageIds = useMemo(
    () => (thread?.messages || []).filter((message) => message.direction === "inbound").map((message) => message._id),
    [thread?.messages],
  );

  const jumpToMessage = (messageId: string | null) => {
    if (!messageId) {
      return;
    }
    const element = messageRowRefs.current.get(messageId);
    if (!element) {
      return;
    }
    element.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightedMessageId(messageId);
    window.setTimeout(() => {
      setHighlightedMessageId((current) => (current === messageId ? null : current));
    }, 1400);
  };
  const jumpToLastMessage = () => jumpToMessage(lastMessageId);

  useEffect(() => {
    const container = conversationWindowRef.current;
    if (!container) {
      return;
    }

    const updateVisibility = () => {
      const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight <= 48;
      setShowJumpToLatest(Boolean(lastMessageId) && !nearBottom);
    };

    updateVisibility();
    container.addEventListener("scroll", updateVisibility, { passive: true });
    return () => {
      container.removeEventListener("scroll", updateVisibility);
    };
  }, [lastMessageId, selectedThreadId, thread?.messages]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)
      ) {
        return;
      }

      if (!selectedThreadId || inboundMessageIds.length === 0) {
        return;
      }

      if (event.altKey && event.key.toLowerCase() === "i") {
        event.preventDefault();
        jumpToMessage(lastInboundMessageId);
        return;
      }

      if (event.altKey && event.key.toLowerCase() === "j") {
        event.preventDefault();
        const currentIndex = highlightedMessageId ? inboundMessageIds.indexOf(highlightedMessageId) : -1;
        const nextIndex = currentIndex <= 0 ? inboundMessageIds.length - 1 : currentIndex - 1;
        jumpToMessage(inboundMessageIds[nextIndex] || null);
        return;
      }

      if (event.altKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        const currentIndex = highlightedMessageId ? inboundMessageIds.indexOf(highlightedMessageId) : -1;
        const nextIndex = currentIndex < 0 || currentIndex >= inboundMessageIds.length - 1 ? 0 : currentIndex + 1;
        jumpToMessage(inboundMessageIds[nextIndex] || null);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [highlightedMessageId, inboundMessageIds, lastInboundMessageId, selectedThreadId]);

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
          <p className="thread-review-title">Reply draft review</p>
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
              placeholder="Write your response, then optionally improve it with AI."
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
              {improvePending ? "Improving..." : "Improve with AI"}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => onReviewReject(item._id)}
              disabled={actionPending}
              aria-disabled={actionPending}
            >
              Discard
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
      const reasonText = autoFollowupReasons[item._id] || item.reason;
      return (
        <div key={`review:followup:${item._id}`} className="thread-review-item">
          <p className="thread-review-title">Follow-up confirmation</p>
          <p className="queue-meta">Due: {formatDateTimeWithRelative(item.dueAt)}</p>
          <p className="queue-body">{reasonText}</p>
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
      const titleText = autoTodoTitles[item._id] || item.title;
      return (
        <div key={`review:todo:${item._id}`} className="thread-review-item">
          <p className="thread-review-title">Task suggestion</p>
          <p className="queue-body">{titleText}</p>
          <p className="queue-meta">Suggested due: {formatDateTime(item.suggestedDueAt)}</p>
          {item.sourceMessage?.text?.trim() ? <p className="queue-meta">Context: {trim(item.sourceMessage.text.trim(), 220)}</p> : null}
          <div className="queue-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => onReviewConvertTodo(item)}
              disabled={isPending(`todo:${item._id}`)}
              aria-disabled={isPending(`todo:${item._id}`)}
            >
              {isPending(`todo:${item._id}`) ? "Adding..." : "Add task"}
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
        <p className="thread-review-title">Safety flag</p>
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

  const showThreadSidebar = !isMobileViewport || !selectedThreadId;
  const showConversationPane = !isMobileViewport || (Boolean(selectedThreadId) && !mobileInspectorOpen);
  const showInspectorPane = Boolean(selectedThreadId) && (isMobileViewport ? mobileInspectorOpen : desktopInspectorOpen);

  return (
    <section className={`conversations-workspace${showInspectorPane ? " inspector-open" : ""}`}>
      {showThreadSidebar ? (
      <article className="conversation-sidebar" aria-label="Conversation threads">
        <div className="conversation-sidebar-header">
          <div>
            <p className="conversation-kicker">Messages</p>
            <h3>Conversations</h3>
          </div>
          <span className="conversation-count-pill">{filteredThreadList.length}</span>
        </div>
        <ProviderFilter
          value={providerFilter}
          onChange={setProviderFilter}
          label="Conversations provider filter"
        />
        <div className="queue-actions">
          <label className="setup-input-group inline search-field-group">
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
          {threadList.map((item) => {
            const previewBase = item.latestMessage?.text?.trim() || "No messages yet";
            const previewText =
              item.latestMessage?.direction === "outbound" && previewBase !== "No messages yet" ? `You: ${previewBase}` : previewBase;

            return (
              <Link
                key={item._id}
                href={`/conversations?threadId=${item._id}`}
                className={`thread-row${item._id === selectedThreadId ? " active" : ""}`}
                aria-current={item._id === selectedThreadId ? "page" : undefined}
                onClick={() => setMobileInspectorOpen(false)}
              >
                {renderThreadAvatar(item.title || item.jid, item.avatarPreview)}
                <div className="thread-row-header">
                  <p className="queue-title">{item.title || item.jid}</p>
                  <p className="queue-meta">{formatDateTime(item.lastMessageAt)}</p>
                </div>
                <p className="queue-meta">
                  {(item.provider || "whatsapp") === "instagram" ? "Instagram" : "WhatsApp"} ·{" "}
                  {item.threadKind === "broadcast_or_system" ? "Broadcast/System" : item.threadKind === "group" ? "Group" : "Direct"}
                  {item.isArchived ? " · Archived" : ""}
                </p>
                <p className="queue-body">{trim(previewText)}</p>
              </Link>
            );
          })}
          {!threadsLoading && threadList.length === 0 ? <p className="empty-line">No threads yet.</p> : null}
          {!threadsLoading && threadList.length < filteredThreadList.length ? (
            <div className="thread-list-footer">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setThreadVisibleCount((prev) => Math.min(prev + 80, 500))}
              >
                Load More
              </button>
            </div>
          ) : null}
        </div>
      </article>
      ) : null}

      {showConversationPane ? (
      <article className="conversation-main" aria-busy={threadLoading}>
        <ActionNotices notices={notices} onDismiss={dismissNotice} />
        {isMobileViewport && selectedThreadId ? (
          <div className="conversation-mobile-back-row">
            <Link href="/conversations" className="btn btn-ghost">
              Back to Threads
            </Link>
          </div>
        ) : null}
        {threadLoading ? (
          <LoadingBlock label="Loading timeline..." rows={4} />
        ) : thread ? (
          <div className="conversation-chat">
            <header className="conversation-chat-header">
              <div className="conversation-chat-header-main">
                <div className="conversation-chat-header-top">
                  <p className="queue-title">{thread.thread.title || thread.thread.jid}</p>
                  <p className="queue-meta">{thread.thread.jid}</p>
                  <p className="conversation-toolbar-summary">
                    {(thread.thread.provider || "whatsapp") === "instagram" ? "Instagram" : "WhatsApp"} ·{" "}
                    {thread.thread.isIgnored ? "Auto-reply off" : "Auto-reply on"}
                    {reviewItemCount > 0 ? ` · ${reviewItemCount} to review` : ""}
                  </p>
                </div>
                <div className="conversation-chat-header-actions">
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
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => {
                      if (isMobileViewport) {
                        setMobileInspectorOpen(true);
                        return;
                      }
                      setDesktopInspectorOpen((open) => !open);
                    }}
                    aria-expanded={showInspectorPane}
                  >
                    {showInspectorPane ? "Hide Details" : "Details"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-icon"
                    onClick={() => setSettingsModalOpen(true)}
                    aria-label="Thread settings"
                    title="Thread settings"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                      <path
                        fill="currentColor"
                        d="M19.14 12.94a7.8 7.8 0 0 0 .05-.94 7.8 7.8 0 0 0-.05-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.17 7.17 0 0 0-1.63-.94l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54c-.58.22-1.12.54-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.7 8.84a.5.5 0 0 0 .12.64l2.03 1.58a7.8 7.8 0 0 0-.05.94 7.8 7.8 0 0 0 .05.94L2.82 14.52a.5.5 0 0 0-.12.64l1.92 3.32a.5.5 0 0 0 .6.22l2.39-.96c.5.4 1.05.72 1.63.94l.36 2.54a.5.5 0 0 0 .5.42h3.84a.5.5 0 0 0 .5-.42l.36-2.54c.58-.22 1.12-.54 1.63-.94l2.39.96a.5.5 0 0 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58ZM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7Z"
                      />
                    </svg>
                    <span className="sr-only">Thread settings</span>
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger-ghost btn-icon"
                    onClick={deleteSelectedThread}
                    disabled={!selectedThreadId || !thread || deleteThreadRecord.pending}
                    aria-disabled={!selectedThreadId || !thread || deleteThreadRecord.pending}
                    aria-label={deleteThreadRecord.pending ? "Deleting thread" : "Delete thread"}
                    title={deleteThreadRecord.pending ? "Deleting thread..." : "Delete thread"}
                  >
                    {deleteThreadRecord.pending ? (
                      <span aria-hidden="true">...</span>
                    ) : (
                      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                        <path
                          fill="currentColor"
                          d="M9 3h6l1 2h4v2H4V5h4l1-2Zm-3 6h12l-1 11a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L6 9Zm3 2v8h2v-8H9Zm4 0v8h2v-8h-2Z"
                        />
                      </svg>
                    )}
                    <span className="sr-only">{deleteThreadRecord.pending ? "Deleting thread..." : "Delete thread"}</span>
                  </button>
                </div>
              </div>
              <div className="conversation-chat-chip-row" aria-label="Thread status">
                <span className="conversation-chip">{(thread.thread.provider || "whatsapp") === "instagram" ? "Instagram" : "WhatsApp"}</span>
                <span className="conversation-chip">
                  {thread.thread.threadKind === "broadcast_or_system"
                    ? "Broadcast/System"
                    : thread.thread.threadKind === "group"
                      ? "Group"
                      : "Direct"}
                </span>
                <span className={`conversation-chip ${thread.thread.isIgnored ? "warn" : "ok"}`}>
                  Auto-respond {thread.thread.isIgnored ? "Off" : "On"}
                </span>
                {thread.thread.isArchived ? <span className="conversation-chip muted">Archived</span> : null}
                <span className={`conversation-chip ${relationshipState?.conflictFlag ? "warn" : "ok"}`}>
                  Conflict {relationshipState?.conflictFlag ? "Active" : "Clear"}
                </span>
                {relationshipState?.repairNeeded ? <span className="conversation-chip warn">Repair Needed</span> : null}
                {thread.conversationState?.nextMove ? (
                  <span className="conversation-chip muted">
                    Next move {thread.conversationState.nextMove.replace("_", " ")}
                  </span>
                ) : null}
                {thread.conversationState?.conversationEndImminent ? (
                  <span className="conversation-chip warn">Endgame Signal</span>
                ) : null}
                {typeof thread.conversationState?.topicDwellScore === "number" ? (
                  <span
                    className={`conversation-chip ${
                      thread.conversationState.topicDwellScore >= 0.65 ? "warn" : "muted"
                    }`}
                  >
                    Dwell {thread.conversationState.topicDwellScore.toFixed(2)}
                  </span>
                ) : null}
                {mutualCheckInAgeDays === undefined ? (
                  <span className="conversation-chip warn">Mutual Check-in None</span>
                ) : (
                  <span className={`conversation-chip ${mutualCheckInAgeDays >= 7 ? "warn" : "ok"}`}>
                    Mutual Check-in {mutualCheckInAgeDays}d
                  </span>
                )}
              </div>
              {relationshipState?.lastReason ? <p className="queue-meta">Last policy reason: {relationshipState.lastReason}</p> : null}
              {thread.checkInDiagnostics ? (
                <p className="queue-meta">
                  Check-in diagnostics: prompts {thread.checkInDiagnostics.promptDetectionsRecent || 0} · responses{" "}
                  {thread.checkInDiagnostics.responseDetectionsRecent || 0} · mutual updates{" "}
                  {thread.checkInDiagnostics.mutualUpdatesRecent || 0}
                </p>
              ) : null}
              {laneSummary ? <p className="queue-meta">Topic lanes: {laneSummary}</p> : null}
              {ignoreThreadRecord.error ? (
                <p className="queue-meta action-inline-error" role="alert">
                  {ignoreThreadRecord.error}
                </p>
              ) : null}
              {deleteThreadRecord.error ? (
                <p className="queue-meta action-inline-error" role="alert">
                  {deleteThreadRecord.error}
                </p>
              ) : null}
            </header>
            <div className="conversation-chat-window-frame">
              <div className="conversation-chat-window" role="log" aria-live="polite" ref={conversationWindowRef}>
                {(thread.messages || []).length === 0 ? (
                  <p className="empty-line">No messages in this thread yet.</p>
                ) : null}
                {threadReviewBySourceMessageId.unanchored.length > 0 ? (
                  <div className="thread-review-stack thread-review-floating">
                    <p className="thread-review-group-title">Review items from older messages</p>
                    {threadReviewBySourceMessageId.unanchored.map((entry) => renderThreadReviewEntry(entry))}
                  </div>
                ) : null}
                {timelineRows.map((row) => {
                  if (row.kind === "activity") {
                    const activity = row.activity;
                    const tone = timelineEventTone(activity.eventType);
                    const level = tone === "danger" ? "ERR" : tone === "warn" ? "WRN" : tone === "ok" ? "OK " : "INF";
                    return (
                      <div key={row.key} className={`timeline-cli-row ${tone}`} role="status" aria-live="polite">
                        <p className="timeline-cli-line">
                          <span className="timeline-cli-time">{formatDateTime(activity.createdAt)}</span>
                          <span className="timeline-cli-level">[{level}]</span>
                          <span className="timeline-cli-event">{timelineEventLabel(activity.eventType)}</span>
                          <span className="timeline-cli-detail">{activity.detail || "Status updated."}</span>
                          <span className="timeline-cli-meta">
                            ({activity.source}
                            {activity.outboxId ? ` · outbox ${activity.outboxId}` : ""})
                          </span>
                        </p>
                        <p className="timeline-cli-raw">{activity.eventType}</p>
                      </div>
                    );
                  }

                  const message = row.message;
                  const isAutomatedSelfChatReply =
                    isSelfChatSystemThread && message.direction === "outbound" && Boolean(message.toolRunId);
                  const outbound = message.direction === "outbound" && !isAutomatedSelfChatReply;
                  const isStatusPost = isStatusPostMessage(message, thread.thread.jid);
                  const senderName = outbound
                    ? threadGrounding?.myName?.trim() || "You"
                    : isAutomatedSelfChatReply
                      ? "System"
                      : threadGrounding?.theirName?.trim() || thread.thread.title || "Contact";
                  const senderBadge = senderName.charAt(0).toUpperCase();
                  const displayText = messageDisplayText(message);
                  const mediaCaption = message.mediaCaption?.trim();
                  const showMediaCaption = Boolean(mediaCaption && mediaCaption !== displayText);
                  const messageToolSummary = message.direction === "outbound" ? toolEventSummary.byMessageId.get(message._id) : undefined;
                  const toolSummaryCount = messageToolSummary
                    ? messageToolSummary.toolCalls.length + messageToolSummary.contextWindows.length + messageToolSummary.styleGuardrails.length
                    : 0;
                  const plannerEvent = messageToolSummary?.toolCalls.find((event) => event.toolName === "response_workbench");
                  const plannerSummary = parsePlannerSummary(plannerEvent?.parsedOutput);
                  const reviewEntries = threadReviewBySourceMessageId.bySource.get(message._id) || [];

                  return (
                    <div
                      key={message._id}
                      ref={(element) => {
                        if (element) {
                          messageRowRefs.current.set(message._id, element);
                        } else {
                          messageRowRefs.current.delete(message._id);
                        }
                      }}
                      className={`chat-row ${outbound ? "outbound" : "inbound"}${highlightedMessageId === message._id ? " highlight" : ""}`}
                    >
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
                        {message.direction === "outbound" && toolSummaryCount > 0 ? (
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
                                ? ` · ${messageToolSummary.styleGuardrails.length} style check`
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
              <button
                type="button"
                className="timeline-jump-latest"
                onClick={jumpToLastMessage}
                aria-label="Jump to latest message"
                title="Jump to latest message"
                disabled={!lastMessageId}
                aria-hidden={!showJumpToLatest}
                tabIndex={showJumpToLatest ? 0 : -1}
                style={{ opacity: showJumpToLatest ? 1 : 0, pointerEvents: showJumpToLatest ? "auto" : "none" }}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path fill="currentColor" d="M12 18a1 1 0 0 1-.7-.29l-6-6a1 1 0 1 1 1.4-1.42L12 15.58l5.3-5.3a1 1 0 1 1 1.4 1.42l-6 6A1 1 0 0 1 12 18Z" />
                </svg>
              </button>
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
          title={
            selectedThreadId && thread
              ? `Conversation Settings: ${thread.thread.title || thread.thread.jid}`
              : selectedThreadId
                ? "Conversation Settings"
                : "Page Settings"
          }
          description={
            selectedThreadId && thread
              ? `${thread.thread.jid} · ${(thread.thread.provider || "whatsapp") === "instagram" ? "Instagram" : "WhatsApp"} · ${
                  thread.thread.threadKind === "broadcast_or_system"
                    ? "Broadcast/System"
                    : thread.thread.threadKind === "group"
                      ? "Group"
                      : "Direct"
                } · Auto-respond ${thread.thread.isIgnored ? "off" : "on"}`
              : "Adjust personality, prompt profile, and grounding."
          }
        >
          <div className="conversation-controls">
            {selectedThreadId && (threadPersonalityLoading || profilesLoading) ? (
              <LoadingIndicator label="Loading personality settings…" />
            ) : null}

            {selectedThreadId && !threadLoading && !threadMissing ? (
              <ModalTabs
                label="Conversation settings sections"
                tabs={[
                  {
                    id: "personality",
                    label: "Personality",
                    content:
                      !threadPersonalityLoading && profiles.length > 0 ? (
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
                      ) : (
                        <p className="empty-line">Personality settings are still loading.</p>
                      ),
                  },
                  {
                    id: "prompt",
                    label: "Prompt",
                    content: !threadPersonalityLoading ? (
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
                    ) : (
                      <p className="empty-line">Prompt profile is still loading.</p>
                    ),
                  },
                  {
                    id: "grounding",
                    label: "Grounding",
                    content: (
                      <GroundingForm
                        key={`${selectedThreadId}:${threadGrounding?.myName || ""}:${threadGrounding?.theirName || ""}:${threadGrounding?.vibeNotes || ""}`}
                        initialMyName={threadGrounding?.myName || ""}
                        initialTheirName={threadGrounding?.theirName || ""}
                        initialVibeNotes={threadGrounding?.vibeNotes || ""}
                        autoAliases={threadGrounding?.autoAliases || []}
                        pending={groundingRecord.pending}
                        onSave={saveGrounding}
                      />
                    ),
                  },
                  {
                    id: "identity",
                    label: "Identity",
                    content: (
                      <IdentityCorrectionForm
                        key={`${selectedThreadId}:${(contactMemoryFacts?.facts || [])
                          .filter((fact) => fact.factKey === "profile_gender_override" || fact.factKey === "inferred_gender")
                          .map((fact) => `${fact.factKey}:${fact.factValue}`)
                          .join("|")}`}
                        facts={contactMemoryFacts?.facts || []}
                        loading={contactMemoryFacts === undefined}
                        pending={identityCorrectionRecord.pending}
                        onSaveGender={saveIdentityCorrection}
                      />
                    ),
                  },
                ]}
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
          size="wide"
        >
          {selectedToolSummary ? (
            <ModalTabs
              label="Tool call summary sections"
              tabs={[
                {
                  id: "summary",
                  label: "Summary",
                  content: (
                    <div className="stack compact">
                      <div className="queue-item">
                        <p className="queue-title">Response</p>
                        <p className="queue-body">{trim(selectedToolSummaryMessage?.text || "No response text available.", 340)}</p>
                        <p className="queue-meta">Sent: {formatDateTime(selectedToolSummary.messageAt)}</p>
                      </div>

                      <div className="queue-item">
                        <p className="queue-title">Trust Snapshot</p>
                        {(() => {
                          const plannerEvent = selectedToolSummary.toolCalls.find((event) => event.toolName === "response_workbench");
                          const plannerSummary = parsePlannerSummary(plannerEvent?.parsedOutput);
                          const toolCalls = selectedToolSummary.toolCalls.filter((event) => event.toolName !== "response_workbench");
                          const failedToolCount = toolCalls.filter((event) => toolTone(event) === "danger").length;
                          const passedGuardrails = selectedToolSummary.styleGuardrails.filter((event) => event.passed).length;
                          const failedGuardrails = selectedToolSummary.styleGuardrails.filter((event) => event.passed === false).length;
                          return (
                            <div className="tool-evidence-grid">
                              <div className="tool-evidence-stat">
                                <span>Planner</span>
                                <strong>
                                  {plannerSummary
                                    ? `${plannerModeLabel(plannerSummary.replyMode)} · ${Math.round(plannerSummary.confidence * 100)}%`
                                    : "Not captured"}
                                </strong>
                              </div>
                              <div className="tool-evidence-stat">
                                <span>Tool calls</span>
                                <strong>{failedToolCount > 0 ? `${failedToolCount} need attention` : `${toolCalls.length} completed`}</strong>
                              </div>
                              <div className="tool-evidence-stat">
                                <span>Context</span>
                                <strong>
                                  {selectedToolSummary.contextWindows.length} window
                                  {selectedToolSummary.contextWindows.length === 1 ? "" : "s"}
                                </strong>
                              </div>
                              <div className="tool-evidence-stat">
                                <span>Style check</span>
                                <strong>
                                  {failedGuardrails > 0
                                    ? `${failedGuardrails} failed`
                                    : passedGuardrails > 0
                                      ? `${passedGuardrails} passed`
                                      : "Not captured"}
                                </strong>
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                  ),
                },
                {
                  id: "planner",
                  label: "Planner",
                  content: (
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
                  ),
                },
                {
                  id: "tools",
                  label: "Tools",
                  badge: selectedToolSummary.toolCalls.filter((event) => event.toolName !== "response_workbench").length,
                  content: (
                    <div className="queue-item">
                      <p className="queue-title">Tool Calls</p>
                      {(() => {
                        const toolCalls = selectedToolSummary.toolCalls.filter((event) => event.toolName !== "response_workbench");
                        if (toolCalls.length === 0) {
                          return <p className="empty-line">No tool calls captured for this response.</p>;
                        }
                        return (
                          <div className="stack compact">
                            {toolCalls.map((event) => {
                              const chips = toolMetricChips(event);
                              const inputPayload = safePrettyJson(event.parsedInput) || event.inputText || "(not captured)";
                              const outputPayload = safePrettyJson(event.parsedOutput) || event.outputText || "(not captured)";
                              return (
                                <div key={event._id} className="tool-summary-item tool-evidence-item">
                                  <div className="tool-evidence-head">
                                    <span className={`tool-evidence-dot tool-evidence-dot-${toolTone(event)}`} aria-hidden="true" />
                                    <div className="tool-evidence-title-block">
                                      <p className="queue-title">{toolDisplayName(event.toolName)}</p>
                                      <p className="queue-meta">
                                        {event.phase === "outreach" ? "Outreach" : "Reply"} · {event.toolName || event.eventType} ·{" "}
                                        {formatLatencyMs(event.latencyMs)} · {formatDateTime(event.createdAt)}
                                      </p>
                                    </div>
                                  </div>
                                  <p className="queue-body">{toolOutcomeText(event)}</p>
                                  {chips.length > 0 ? (
                                    <div className="tool-evidence-chips" aria-label="Tool metrics">
                                      {chips.map((chip) => (
                                        <span key={chip}>{chip}</span>
                                      ))}
                                    </div>
                                  ) : null}
                                  <details className="tool-technical-details">
                                    <summary>Technical details</summary>
                                    <p className="queue-meta">Input</p>
                                    <pre className="tool-summary-json">{inputPayload}</pre>
                                    <p className="queue-meta">Output</p>
                                    <pre className="tool-summary-json">{outputPayload}</pre>
                                  </details>
                                </div>
                              );
                            })}
                          </div>
                        );
                      })()}
                    </div>
                  ),
                },
                {
                  id: "context",
                  label: "Context",
                  badge: selectedToolSummary.contextWindows.length + selectedToolSummary.styleGuardrails.length,
                  content: (
                    <div className="stack compact">
                      <div className="queue-item">
                        <p className="queue-title">Context Window + Style Check</p>
                        {selectedToolSummary.contextWindows.length === 0 && selectedToolSummary.styleGuardrails.length === 0 ? (
                          <p className="empty-line">No context-window or style-check events captured.</p>
                        ) : (
                          <div className="stack compact">
                            {selectedToolSummary.contextWindows.map((event) => (
                              <div key={event._id} className="tool-summary-item tool-evidence-item">
                                <div className="tool-evidence-head">
                                  <span className="tool-evidence-dot tool-evidence-dot-ok" aria-hidden="true" />
                                  <div className="tool-evidence-title-block">
                                    <p className="queue-title">Context window</p>
                                    <p className="queue-meta">
                                      {event.phase === "outreach" ? "Outreach" : "Reply"} · {formatDateTime(event.createdAt)}
                                    </p>
                                  </div>
                                </div>
                                <p className="queue-body">{trim(event.detail || "No detail captured.", 220)}</p>
                                <details className="tool-technical-details">
                                  <summary>Technical details</summary>
                                  <pre className="tool-summary-json">{event.detail || "(no detail)"}</pre>
                                </details>
                              </div>
                            ))}
                            {selectedToolSummary.styleGuardrails.map((event) => (
                              <div key={event._id} className="tool-summary-item tool-evidence-item">
                                <div className="tool-evidence-head">
                                  <span
                                    className={`tool-evidence-dot ${event.passed ? "tool-evidence-dot-ok" : "tool-evidence-dot-danger"}`}
                                    aria-hidden="true"
                                  />
                                  <div className="tool-evidence-title-block">
                                    <p className="queue-title">Style check {event.passed ? "passed" : "failed"}</p>
                                    <p className="queue-meta">
                                      Score {Number(event.score || 0).toFixed(2)} / {Number(event.threshold || 0).toFixed(2)} ·{" "}
                                      {formatDateTime(event.createdAt)}
                                    </p>
                                  </div>
                                </div>
                                <p className="queue-body">
                                  {(event.hints || []).length > 0
                                    ? trim((event.hints || []).join(" · "), 220)
                                    : trim(event.detail || "No hints captured.", 220)}
                                </p>
                                <details className="tool-technical-details">
                                  <summary>Technical details</summary>
                                  <pre className="tool-summary-json">
                                    {(event.hints || []).length > 0 ? (event.hints || []).join("\n") : event.detail || "(no hints captured)"}
                                  </pre>
                                </details>
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
                  ),
                },
              ]}
            />
          ) : null}
        </UIModal>
      </article>
      ) : null}
      {showInspectorPane ? (
        <aside className="conversation-inspector" aria-label="Conversation details">
          {isMobileViewport ? (
            <div className="conversation-mobile-back-row">
              <button type="button" className="btn btn-ghost" onClick={() => setMobileInspectorOpen(false)}>
                Back to Conversation
              </button>
            </div>
          ) : null}

          {thread ? (
            <>
              <header className="conversation-inspector-header">
                {renderThreadAvatar(thread.thread.title || thread.thread.jid, thread.thread.avatarPreview, "conversation-inspector-avatar")}
                <div>
                  <p className="conversation-kicker">Person Summary</p>
                  <h3>{threadGrounding?.theirName?.trim() || thread.thread.title || thread.thread.jid}</h3>
                  <p className="queue-meta">{thread.thread.jid}</p>
                </div>
              </header>

              <div className="conversation-inspector-stats" aria-label="Conversation status">
                <div>
                  <span>Auto-reply</span>
                  <strong>{thread.thread.isIgnored ? "Off" : "On"}</strong>
                </div>
                <div>
                  <span>Review</span>
                  <strong>{reviewItemCount}</strong>
                </div>
                <div>
                  <span>Trust</span>
                  <strong>{relationshipState ? `${Math.round(relationshipState.trustScore * 100)}%` : "-"}</strong>
                </div>
              </div>

              <section className="conversation-inspector-section">
                <div className="conversation-inspector-section-head">
                  <p className="queue-title">Context</p>
                  <span className={`conversation-chip ${relationshipState?.conflictFlag || relationshipState?.repairNeeded ? "warn" : "ok"}`}>
                    {relationshipState?.conflictFlag || relationshipState?.repairNeeded ? "Needs care" : "Clear"}
                  </span>
                </div>
                <dl className="conversation-inspector-list">
                  <div>
                    <dt>Channel</dt>
                    <dd>{(thread.thread.provider || "whatsapp") === "instagram" ? "Instagram" : "WhatsApp"}</dd>
                  </div>
                  <div>
                    <dt>Type</dt>
                    <dd>
                      {thread.thread.threadKind === "broadcast_or_system"
                        ? "Broadcast/System"
                        : thread.thread.threadKind === "group"
                          ? "Group"
                          : "Direct"}
                    </dd>
                  </div>
                  <div>
                    <dt>Last message</dt>
                    <dd>{formatDateTime(latestThreadMessage?.messageAt || thread.thread.lastMessageAt)}</dd>
                  </div>
                  <div>
                    <dt>Next move</dt>
                    <dd>{thread.conversationState?.nextMove ? thread.conversationState.nextMove.replace("_", " ") : "None"}</dd>
                  </div>
                  <div>
                    <dt>Mutual check-in</dt>
                    <dd>{mutualCheckInAgeDays === undefined ? "None" : `${mutualCheckInAgeDays}d ago`}</dd>
                  </div>
                </dl>
                {relationshipState?.lastReason ? <p className="queue-meta">{trim(relationshipState.lastReason, 180)}</p> : null}
              </section>

              <section className="conversation-inspector-section">
                <div className="conversation-inspector-section-head">
                  <p className="queue-title">Style</p>
                  {!isMobileViewport ? (
                    <button type="button" className="btn btn-ghost" onClick={() => setSettingsModalOpen(true)}>
                      Full Settings
                    </button>
                  ) : null}
                </div>
                <dl className="conversation-inspector-list">
                  <div>
                    <dt>Profile</dt>
                    <dd>{selectedProfile?.name || threadPersonality?.profileSlug || "Casual"}</dd>
                  </div>
                  <div>
                    <dt>Intensity</dt>
                    <dd>{Math.round((threadPersonality?.intensity ?? 0.6) * 100)}%</dd>
                  </div>
                  <div>
                    <dt>Names</dt>
                    <dd>
                      {[threadGrounding?.myName, threadGrounding?.theirName].filter(Boolean).join(" / ") || "Not set"}
                    </dd>
                  </div>
                </dl>
                {threadGrounding?.vibeNotes?.trim() ? <p className="queue-body">{trim(threadGrounding.vibeNotes.trim(), 220)}</p> : null}
              </section>

              <section className="conversation-inspector-section">
                <div className="conversation-inspector-section-head">
                  <div>
                    <p className="queue-title">Media</p>
                    <p className="queue-meta">{threadMedia.length ? mediaKindCounts || `${threadMedia.length} attachments` : "No exchanged media yet"}</p>
                  </div>
                  <Link href="/media" className="btn btn-ghost">
                    Library
                  </Link>
                </div>
                {threadMedia.length > 0 ? (
                  <div className="conversation-media-grid">
                    {threadMedia.slice(0, 18).map((item) => (
                      <div className="conversation-media-item" key={`${item._id}:${item.mediaAssetId || "asset"}`}>
                        <SharedMediaPreview
                          preview={item.mediaPreview}
                          mediaAssetId={item.mediaAssetId}
                          onOpenImagePreview={(preview) => setMediaPreviewModal(preview)}
                          imageButtonClassName="conversation-media-open"
                          imageClassName="conversation-media-image"
                          attachmentText={messageKindLabel(item.messageType)}
                        />
                        <p className="queue-meta">
                          {item.direction === "outbound" ? "You" : "Them"} · {formatDateTime(item.messageAt)}
                        </p>
                        {item.mediaCaption?.trim() || item.text.trim() ? (
                          <p className="conversation-media-caption">{trim(item.mediaCaption?.trim() || item.text.trim(), 72)}</p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="empty-line">Photos, stickers, voice notes, videos, and documents from this thread will appear here.</p>
                )}
              </section>

              <details className="conversation-inspector-section" open={baileysMetadataRows.length > 0}>
                <summary>Baileys Metadata</summary>
                {baileysMetadataRows.length > 0 ? (
                  <dl className="conversation-inspector-list">
                    {baileysMetadataRows.map((row) => (
                      <div key={row.label}>
                        <dt>{row.label}</dt>
                        <dd>{row.value}</dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <p className="empty-line">No extra WhatsApp metadata has been captured for this thread yet.</p>
                )}
              </details>

              <details className="conversation-inspector-section">
                <summary>Pending Review</summary>
                {reviewItemCount > 0 ? (
                  <div className="conversation-inspector-review-list">
                    {threadReviewBySourceMessageId.unanchored.map((entry) => renderThreadReviewEntry(entry))}
                    {[...threadReviewBySourceMessageId.bySource.values()].flat().map((entry) => renderThreadReviewEntry(entry))}
                  </div>
                ) : (
                  <p className="empty-line">No pending review items.</p>
                )}
              </details>

              <details className="conversation-inspector-section">
                <summary>Memory</summary>
                {profileFacts.length > 0 ? (
                  <div className="identity-fact-list">
                    {profileFacts.map((fact) => (
                      <div className="identity-fact-row" key={fact._id}>
                        <span>{factLabel(fact.factKey)}</span>
                        <p>{fact.factValue}</p>
                        <em>{typeof fact.updatedAt === "number" ? formatDateTime(fact.updatedAt) : "Saved memory"}</em>
                      </div>
                    ))}
                  </div>
                ) : contactMemoryFacts === undefined ? (
                  <LoadingIndicator label="Loading memory..." />
                ) : (
                  <p className="empty-line">No saved profile memory yet.</p>
                )}
              </details>

              <details className="conversation-inspector-section">
                <summary>Style And Identity</summary>
                {selectedThreadId && (threadPersonalityLoading || profilesLoading) ? (
                  <LoadingIndicator label="Loading personality settings..." />
                ) : null}
                {selectedThreadId && !threadLoading && !threadMissing ? (
                  <ModalTabs
                    label="Conversation inspector settings sections"
                    tabs={[
                      {
                        id: "personality",
                        label: "Personality",
                        content:
                          !threadPersonalityLoading && profiles.length > 0 ? (
                            <ThreadPersonalityForm
                              key={`inspector:${threadSettingKey}`}
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
                          ) : (
                            <p className="empty-line">Personality settings are still loading.</p>
                          ),
                      },
                      {
                        id: "prompt",
                        label: "Prompt",
                        content: !threadPersonalityLoading ? (
                          <PromptProfileForm
                            key={`inspector:${promptProfileFormKey}`}
                            initialPromptProfile={threadPersonality?.threadPromptProfile || ""}
                            source={threadPersonality?.threadPromptProfileSource}
                            messageCount={threadPersonality?.threadPromptProfileMessageCount}
                            updatedAt={threadPersonality?.threadPromptProfileUpdatedAt}
                            pending={promptProfileRecord.pending}
                            onAutoBuild={autoBuildPromptProfile}
                            onSaveManual={savePromptProfile}
                          />
                        ) : (
                          <p className="empty-line">Prompt profile is still loading.</p>
                        ),
                      },
                      {
                        id: "grounding",
                        label: "Grounding",
                        content: (
                          <GroundingForm
                            key={`inspector:${selectedThreadId}:${threadGrounding?.myName || ""}:${threadGrounding?.theirName || ""}:${threadGrounding?.vibeNotes || ""}`}
                            initialMyName={threadGrounding?.myName || ""}
                            initialTheirName={threadGrounding?.theirName || ""}
                            initialVibeNotes={threadGrounding?.vibeNotes || ""}
                            autoAliases={threadGrounding?.autoAliases || []}
                            pending={groundingRecord.pending}
                            onSave={saveGrounding}
                          />
                        ),
                      },
                      {
                        id: "identity",
                        label: "Identity",
                        content: (
                          <IdentityCorrectionForm
                            key={`inspector:${selectedThreadId}:${(contactMemoryFacts?.facts || [])
                              .filter((fact) => fact.factKey === "profile_gender_override" || fact.factKey === "inferred_gender")
                              .map((fact) => `${fact.factKey}:${fact.factValue}`)
                              .join("|")}`}
                            facts={contactMemoryFacts?.facts || []}
                            loading={contactMemoryFacts === undefined}
                            pending={identityCorrectionRecord.pending}
                            onSaveGender={saveIdentityCorrection}
                          />
                        ),
                      },
                    ]}
                  />
                ) : null}
              </details>

              <details className="conversation-inspector-section">
                <summary>Diagnostics</summary>
                <dl className="conversation-inspector-list">
                  <div>
                    <dt>Tool events</dt>
                    <dd>{threadToolEvents?.length ?? 0}</dd>
                  </div>
                  <div>
                    <dt>Unmatched</dt>
                    <dd>{toolEventSummary.unmatchedEvents.length}</dd>
                  </div>
                  <div>
                    <dt>Topic lanes</dt>
                    <dd>{laneSummary || "None"}</dd>
                  </div>
                </dl>
                {thread.checkInDiagnostics ? (
                  <p className="queue-meta">
                    Check-ins: prompts {thread.checkInDiagnostics.promptDetectionsRecent || 0} · responses{" "}
                    {thread.checkInDiagnostics.responseDetectionsRecent || 0} · mutual{" "}
                    {thread.checkInDiagnostics.mutualUpdatesRecent || 0}
                  </p>
                ) : null}
              </details>
            </>
          ) : threadLoading ? (
            <LoadingBlock label="Loading details..." rows={4} compact />
          ) : (
            <p className="empty-line">Select a conversation to see context.</p>
          )}
        </aside>
      ) : null}
    </section>
  );
}

export function LiveConversations({ initialThreadId }: LiveConversationsProps) {
  return <ConversationsContent initialThreadId={initialThreadId} />;
}
