"use client";

import { UIModal } from "@/components/ui-modal";
import { publicDashboardNavItems } from "@/lib/ui/dashboard-nav";
import { usePathname, useRouter } from "next/navigation";
import { type FormEvent, type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";

type CommandFeedback = {
  kind: "idle" | "success" | "error";
  message: string;
};

type ManagerArtifact =
  | {
      kind: "people_list";
      title: string;
      description: string;
      display?: {
        showGender?: boolean;
        showRomanticFit?: boolean;
        showMatchFactors?: boolean;
        showConfidence?: boolean;
        showLastSeen?: boolean;
        showProvider?: boolean;
      };
      people: Array<{
        threadId?: string;
        title: string;
        provider?: string;
        lastMessageAt?: number;
        reason: string;
        confidence?: number;
        matchFactors?: string[];
        genderCue?: "male" | "female" | "nonbinary" | "unknown";
        genderConfidence?: number;
        romanticFit?: "likely" | "unlikely" | "unknown";
        romanticFitReason?: string;
      }>;
    }
  | {
      kind: "communication_preview";
      title: string;
      description: string;
      previews: Array<{
        threadId?: string;
        title: string;
        messageIntent: string;
        previewText: string;
        requiresConfirmation: true;
      }>;
    }
  | {
      kind: "campaign_plan";
      title: string;
      description: string;
      objective: string;
      audienceSummary: string;
      estimatedRecipients: number;
      contentType: "text" | "meme" | "status" | "mixed";
      channels: string[];
      steps: Array<{
        label: string;
        detail: string;
        status: "ready" | "needs_review" | "blocked";
      }>;
      safetyNotes: string[];
      nextPrompts: string[];
    };

type ChatMessage = {
  id: string;
  role: "assistant" | "user";
  text: string;
  kind?: CommandFeedback["kind"];
  toolSummaries?: string[];
  artifacts?: ManagerArtifact[];
};

type InlineAction = {
  label: string;
  prompt?: string;
  href?: string;
  operation?: "send_previews";
  tone?: "primary" | "secondary";
};

type InlineOperation = {
  messageId: string;
  kind: "send_previews";
  status: "running" | "done" | "error";
  phase: "queueing" | "sending";
  current: number;
  total: number;
  queued?: number;
  sent?: number;
  failed?: number;
  label: string;
  detail: string;
};

type OutboxStatusRow = {
  outboxId: string;
  title?: string;
  status: "pending" | "claimed" | "sent" | "failed" | "missing" | string;
  error?: string;
};

type QuietHoursPolicy = {
  enabled: boolean;
  active: boolean;
  startHour: number;
  endHour: number;
  nextAllowedAt: number | null;
};

const starterPrompts = [
  "What needs my attention right now?",
  "Find people I have not replied to in a while.",
  "Find stalled talking stages and explain the evidence.",
  "Scan my chats for follow-ups that need review.",
  "Plan a meme campaign for people I have not spoken to in a while.",
];

const workingPrompts = ["Scanning chats...", "Checking thread state...", "Building review lists...", "Checking available tools..."];

const errorPrompts = [
  "Try again with a smaller scan.",
  "Check system health and tell me what failed.",
  "Diagnose the failure here.",
  "Show me what tools are available here.",
];

const commandPrefixes = ["go to ", "go ", "open ", "navigate to ", "navigate ", "take me to ", "nav "];
const HOME_AI_SESSION_STORAGE_KEY = "slm.home.ask_odogwu_session.v1";
const defaultRobotSceneUrl = "https://my.spline.design/interactiveaiassistant-1MceEbo4oJdzWd3AQPZq9CSB/";
const emptyStateIntro =
  "I can read your chats, draft replies in your style, show what needs approval, and keep conversations moving when you allow it.";

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9/\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function makeMessage(
  role: ChatMessage["role"],
  text: string,
  kind: CommandFeedback["kind"] = "idle",
  toolSummaries?: string[],
  artifacts?: ManagerArtifact[],
): ChatMessage {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    text,
    kind,
    ...(toolSummaries && toolSummaries.length ? { toolSummaries } : {}),
    ...(artifacts && artifacts.length ? { artifacts } : {}),
  };
}

function isManagerArtifact(value: unknown): value is ManagerArtifact {
  if (!value || typeof value !== "object") {
    return false;
  }
  const artifact = value as { kind?: unknown; people?: unknown; previews?: unknown; steps?: unknown };
  return (
    (artifact.kind === "people_list" && Array.isArray(artifact.people)) ||
    (artifact.kind === "communication_preview" && Array.isArray(artifact.previews)) ||
    (artifact.kind === "campaign_plan" && Array.isArray(artifact.steps))
  );
}

function commandFeedbackKind(value: unknown): CommandFeedback["kind"] | undefined {
  return value === "idle" || value === "success" || value === "error" ? value : undefined;
}

function normalizeStoredMessage(value: unknown): ChatMessage | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const row = value as Record<string, unknown>;
  const role = row.role === "assistant" || row.role === "user" ? row.role : null;
  const id = typeof row.id === "string" && row.id.trim() ? row.id : "";
  const text = typeof row.text === "string" ? row.text : "";
  if (!role || !id || !text) {
    return null;
  }
  const kind = commandFeedbackKind(row.kind);
  const toolSummaries = Array.isArray(row.toolSummaries)
    ? row.toolSummaries.filter((item): item is string => typeof item === "string" && item.trim().length > 0).slice(0, 20)
    : undefined;
  const artifacts = Array.isArray(row.artifacts) ? row.artifacts.filter(isManagerArtifact).slice(0, 8) : undefined;
  return {
    id,
    role,
    text,
    ...(kind ? { kind } : {}),
    ...(toolSummaries?.length ? { toolSummaries } : {}),
    ...(artifacts?.length ? { artifacts } : {}),
  };
}

function readStoredHomeSession() {
  if (typeof window === "undefined") {
    return { messages: [] as ChatMessage[], input: "" };
  }
  try {
    const raw = window.localStorage.getItem(HOME_AI_SESSION_STORAGE_KEY);
    if (!raw) {
      return { messages: [] as ChatMessage[], input: "" };
    }
    const payload = JSON.parse(raw) as { messages?: unknown; input?: unknown };
    const messages = Array.isArray(payload.messages)
      ? payload.messages.map(normalizeStoredMessage).filter((message): message is ChatMessage => Boolean(message)).slice(-40)
      : [];
    const input = typeof payload.input === "string" ? payload.input.slice(0, 8000) : "";
    return { messages, input };
  } catch {
    window.localStorage.removeItem(HOME_AI_SESSION_STORAGE_KEY);
    return { messages: [] as ChatMessage[], input: "" };
  }
}

function writeStoredHomeSession(messages: ChatMessage[], input: string) {
  if (typeof window === "undefined") {
    return;
  }
  const hasSession = messages.length > 0 || input.trim().length > 0;
  if (!hasSession) {
    window.localStorage.removeItem(HOME_AI_SESSION_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(
    HOME_AI_SESSION_STORAGE_KEY,
    JSON.stringify({
      messages: messages.slice(-40),
      input,
      savedAt: Date.now(),
    }),
  );
}

function formatLastSeen(value?: number) {
  if (!value) {
    return "No timestamp";
  }
  const days = Math.max(0, Math.round((Date.now() - value) / 86_400_000));
  if (days === 0) {
    return "Today";
  }
  if (days === 1) {
    return "1 day ago";
  }
  if (days < 60) {
    return `${days} days ago`;
  }
  const months = Math.round(days / 30);
  return `${months} month${months === 1 ? "" : "s"} ago`;
}

function confidenceLabel(value?: number) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%`;
}

function genderCueLabel(value?: string, confidence?: number) {
  if (!value || value === "unknown") {
    return null;
  }
  const confidenceText = confidenceLabel(confidence);
  return confidenceText ? `${value} ${confidenceText}` : value;
}

function toolSummaryParts(summary: string) {
  const match = summary.match(/^([^()]+)\s+\(([^)]+)\):\s*([\s\S]+)$/);
  if (!match) {
    return { rawTool: "", tool: "Manager result", status: "", body: summary };
  }
  const rawTool = match[1]?.trim() || "";
  return {
    rawTool,
    tool: rawTool.replace(/_/g, " ").trim() || "Manager result",
    status: match[2]?.trim() || "",
    body: match[3]?.trim() || summary,
  };
}

function buildInlineActions(primaryTool: ReturnType<typeof toolSummaryParts> | null, artifacts?: ManagerArtifact[]): InlineAction[] {
  const hasCampaignPlan = Boolean(artifacts?.some((artifact) => artifact.kind === "campaign_plan"));
  const hasPeopleList = Boolean(artifacts?.some((artifact) => artifact.kind === "people_list" && artifact.people.length > 0));
  const hasPreviews = Boolean(artifacts?.some((artifact) => artifact.kind === "communication_preview" && artifact.previews.length > 0));
  if (hasCampaignPlan) {
    return [
      { label: "Build Audience", prompt: "Build the editable audience for this campaign here and show who should be included or excluded.", tone: "primary" },
      { label: "Draft Campaign", prompt: "Draft personalized campaign previews for this audience here. Do not send anything yet." },
      { label: "Find Memes", prompt: "Find suitable memes from my media library for this campaign and show the best options here." },
      { label: "Safety Check", prompt: "Run a safety and appropriateness check on this campaign before drafting or sending." },
    ];
  }
  if (hasPreviews) {
    return [
      { label: "Send Approved", operation: "send_previews", tone: "primary" },
      { label: "Rewrite Warmer", prompt: "Rewrite these previews to sound warmer." },
      { label: "Narrow To 5", prompt: "Narrow these previews to the safest 5 people." },
      { label: "Set Reminders", prompt: "Turn these previews into follow-up reminder tasks instead." },
    ];
  }
  if (hasPeopleList) {
    return [
      { label: "Draft Previews", prompt: "Draft careful message previews for these people.", tone: "primary" },
      { label: "Find Context", prompt: "Find stronger context from chat history for this list." },
      { label: "Set Reminders", prompt: "Turn the strongest matches into follow-up tasks." },
    ];
  }

  if (!primaryTool) {
    return [];
  }

  if (primaryTool.rawTool === "queue_snapshot") {
    return [
      { label: "Review Here", prompt: "Show the pending queue items here with what each one needs and recommended next actions.", tone: "primary" },
      { label: "Prioritize", prompt: "Prioritize the queue by urgency and explain the ordering here." },
      { label: "Draft Replies", prompt: "Draft careful reply previews for the pending queue items here before anything is sent." },
    ];
  }
  if (primaryTool.rawTool === "followups_snapshot") {
    return [
      { label: "Review Here", prompt: "Show the overdue follow-ups here, grouped by urgency, with the next recommended action for each one.", tone: "primary" },
      { label: "Draft Check-Ins", prompt: "Draft personalized check-in previews for the overdue follow-ups here." },
      { label: "Review Only", prompt: "Show only follow-ups needing review here and hide everything already safe or routine." },
    ];
  }
  if (primaryTool.rawTool === "system_health") {
    return [
      { label: "Diagnose Here", prompt: "Diagnose the system health issues here and rank the exact next fixes.", tone: "primary" },
      { label: "Check Stuck Sends", prompt: "Check what is stuck in the outbox or worker pipeline and tell me what action to take next." },
      { label: "Explain Issues", prompt: "Explain the system health issues and what to fix first." },
    ];
  }
  if (primaryTool.rawTool === "todos_snapshot") {
    return [
      { label: "Review Here", prompt: "Show the strongest task suggestions here with why each one matters.", tone: "primary" },
      { label: "Create Tasks", prompt: "Turn the strongest task suggestions into tasks and show me a confirmation preview first." },
    ];
  }
  return [];
}

function previewFineTuneActions(preview: Extract<ManagerArtifact, { kind: "communication_preview" }>["previews"][number]): InlineAction[] {
  return [
    { label: "Warmer", prompt: `Make the preview for ${preview.title} warmer while keeping it natural.` },
    { label: "Shorter", prompt: `Make the preview for ${preview.title} shorter and easier to send.` },
    { label: "Safer", prompt: `Make the preview for ${preview.title} safer and lower-pressure.` },
    { label: "More Me", prompt: `Rewrite the preview for ${preview.title} to sound more like my usual style.` },
  ];
}

function personFineTuneActions(person: Extract<ManagerArtifact, { kind: "people_list" }>["people"][number]): InlineAction[] {
  return [
    { label: "Draft", prompt: `Draft a careful message preview for ${person.title}.` },
    { label: "Context", prompt: `Find stronger chat context for ${person.title} before acting.` },
    { label: "Why", prompt: `Explain why ${person.title} is on this list.` },
    { label: "Exclude Similar", prompt: `Narrow this list by excluding contacts like ${person.title}.` },
  ];
}

function sendablePreviews(artifacts?: ManagerArtifact[]) {
  return (
    artifacts
      ?.flatMap((artifact) => (artifact.kind === "communication_preview" ? artifact.previews : []))
      .filter((preview) => Boolean(preview.threadId && preview.previewText.trim())) || []
  );
}

function artifactCountLabel(artifact: ManagerArtifact) {
  if (artifact.kind === "people_list") return String(artifact.people.length);
  if (artifact.kind === "communication_preview") return String(artifact.previews.length);
  return String(artifact.estimatedRecipients);
}

function InlineOperationProgress({ operation }: { operation: InlineOperation }) {
  const boundedTotal = Math.max(1, operation.total);
  const boundedCurrent = Math.max(0, Math.min(operation.current, boundedTotal));
  const percent = Math.round((boundedCurrent / boundedTotal) * 100);
  const queued = operation.queued ?? 0;
  const sent = operation.sent ?? 0;
  const failed = operation.failed ?? 0;
  const statusText =
    operation.status === "running"
      ? `${operation.label} ${boundedCurrent} of ${operation.total}`
      : operation.status === "done"
        ? failed > 0
          ? `Completed with ${failed} issue${failed === 1 ? "" : "s"}`
          : `Completed ${operation.total} of ${operation.total}`
        : `Stopped at ${boundedCurrent} of ${operation.total}`;

  return (
    <div className={`home-ai-send-progress home-ai-send-progress-${operation.status}`} role="status" aria-live="polite">
      <div className="home-ai-send-progress-topline">
        <strong>{statusText}</strong>
        <span>{percent}%</span>
      </div>
      <div className="home-ai-send-progress-track" aria-hidden="true">
        <span style={{ width: `${percent}%` }} />
      </div>
      <div className="home-ai-send-progress-stats" aria-label="Send status breakdown">
        <span>{queued} queued</span>
        <span>{sent} sent</span>
        <span>{failed} failed</span>
      </div>
      <p>{operation.detail}</p>
    </div>
  );
}

function firstNumberBefore(text: string, word: string) {
  const match = text.match(new RegExp(`(\\d+)\\s+${word}`, "i"));
  return match ? Number(match[1]) : 0;
}

function scoreToolSummary(summary: string) {
  const normalized = summary.toLowerCase();
  let score = 0;
  score += firstNumberBefore(normalized, "overdue") * 100;
  score += firstNumberBefore(normalized, "needing review") * 80;
  score += firstNumberBefore(normalized, "replies") * 70;
  score += firstNumberBefore(normalized, "task suggestions") * 60;
  score += firstNumberBefore(normalized, "safety flags") * 90;
  score += firstNumberBefore(normalized, "alert") * 90;
  score += firstNumberBefore(normalized, "provider errors") * 25;
  if (normalized.includes("followups_snapshot") || normalized.includes("follow-ups")) score += 40;
  if (normalized.includes("queue_snapshot") || normalized.includes("queue:")) score += 30;
  if (normalized.includes("system_health") || normalized.includes("system:")) score += 20;
  if (normalized.includes("communication") || normalized.includes("preview")) score += 25;
  if (normalized.includes("failed") || normalized.includes("error")) score += 120;
  return score;
}

function splitToolSummaries(summaries?: string[]) {
  const clean = (summaries || []).filter((summary) => summary.trim().length > 0);
  if (!clean.length) {
    return { primary: null as string | null, rest: [] as string[] };
  }
  const ranked = clean
    .map((summary, index) => ({ summary, index, score: scoreToolSummary(summary) }))
    .sort((left, right) => right.score - left.score || left.index - right.index);
  const primary = ranked[0]?.summary || clean[0];
  return {
    primary,
    rest: clean.filter((summary) => summary !== primary),
  };
}

function artifactContextText(artifacts?: ManagerArtifact[]) {
  if (!artifacts?.length) {
    return "";
  }
  const lines = artifacts.flatMap((artifact) => {
    if (artifact.kind === "people_list") {
      return [
        `People list: ${artifact.title} (${artifact.people.length})`,
        artifact.description,
        ...artifact.people.slice(0, 12).map((person, index) => {
          const parts = [
            `${index + 1}. ${person.title}`,
            person.threadId ? `threadId=${person.threadId}` : "",
            person.provider ? `provider=${person.provider}` : "",
            person.reason ? `reason=${person.reason}` : "",
          ].filter(Boolean);
          return parts.join(" | ");
        }),
      ];
    }
    if (artifact.kind === "communication_preview") {
      return [
      `Communication previews: ${artifact.title} (${artifact.previews.length})`,
      artifact.description,
      ...artifact.previews.slice(0, 8).map((preview, index) => {
        const parts = [
          `${index + 1}. ${preview.title}`,
          preview.threadId ? `threadId=${preview.threadId}` : "",
          `intent=${preview.messageIntent}`,
          `preview=${preview.previewText}`,
        ].filter(Boolean);
        return parts.join(" | ");
      }),
      ];
    }
    return [
      `Campaign plan: ${artifact.title} (${artifact.estimatedRecipients} estimated recipients)`,
      artifact.description,
      `objective=${artifact.objective}`,
      `audience=${artifact.audienceSummary}`,
      `content=${artifact.contentType}`,
      `channels=${artifact.channels.join(", ")}`,
      ...artifact.steps.slice(0, 5).map((step, index) => `${index + 1}. ${step.label} | ${step.status} | ${step.detail}`),
    ];
  });
  return lines.filter(Boolean).join("\n");
}

function messageTextForHistory(message: ChatMessage) {
  const artifactContext = artifactContextText(message.artifacts);
  return artifactContext ? `${message.text}\n\nVisible result context:\n${artifactContext}` : message.text;
}

function latestAssistantMessage(messages: ChatMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "assistant") {
      return messages[index];
    }
  }
  return null;
}

function latestVisibleArtifacts(messages: ChatMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const artifacts = messages[index]?.artifacts || [];
    if (artifacts.length) {
      return artifacts;
    }
  }
  return [];
}

function uniqueSuggestions(values: string[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const normalized = value.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) {
      return false;
    }
    seen.add(normalized);
    return true;
  });
}

function buildScreenSuggestions(messages: ChatMessage[], isWorking: boolean) {
  if (isWorking) {
    return workingPrompts;
  }

  const latest = latestAssistantMessage(messages);
  if (!latest) {
    return starterPrompts;
  }

  if (latest.kind === "error") {
    return errorPrompts;
  }

  const artifacts = latest.artifacts || [];
  const hasCampaignPlan = artifacts.some((artifact) => artifact.kind === "campaign_plan");
  const hasCommunicationPreview = artifacts.some((artifact) => artifact.kind === "communication_preview" && artifact.previews.length > 0);
  const peopleLists = artifacts.filter((artifact): artifact is Extract<ManagerArtifact, { kind: "people_list" }> => artifact.kind === "people_list");
  const totalPeople = peopleLists.reduce((sum, artifact) => sum + artifact.people.length, 0);
  const titles = peopleLists.map((artifact) => artifact.title.toLowerCase()).join(" ");
  const summaries = (latest.toolSummaries || []).join(" ").toLowerCase();

  if (hasCampaignPlan) {
    return uniqueSuggestions([
      "Build the editable audience for this campaign here.",
      "Draft personalized campaign previews for this audience.",
      "Find suitable memes from my media library for this campaign.",
      "Run a safety check before drafting or sending.",
    ]);
  }

  if (hasCommunicationPreview) {
    return uniqueSuggestions([
      "Rewrite these previews to sound warmer.",
      "Narrow this list to the safest 5 people.",
      "Turn these into reminder tasks instead.",
      "Find stronger evidence before messaging.",
    ]);
  }

  if (totalPeople > 0) {
    return uniqueSuggestions([
      titles.includes("dormant") ? "Draft gentle check-in previews for these dormant contacts." : "Draft careful message previews for these people.",
      titles.includes("talking-stage") ? "Explain which talking stages are worth reviving." : "Filter this list to people I have not messaged in 90 days.",
      "Find more context from chat history for this list.",
      "Turn the strongest matches into follow-up tasks.",
    ]);
  }

  if (summaries.includes("queue")) {
    return uniqueSuggestions([
      "Prioritize the queue by urgency.",
      "Show only drafts that need approval.",
      "Find the riskiest pending replies.",
      "Draft reply previews for the pending queue items here.",
    ]);
  }

  if (summaries.includes("follow-ups")) {
    return uniqueSuggestions([
      "Show overdue follow-ups first.",
      "Draft previews for today’s follow-ups.",
      "Turn weak follow-ups into reminders.",
      "Group these follow-ups by who needs action today.",
    ]);
  }

  if (summaries.includes("system")) {
    return uniqueSuggestions([
      "Explain the system health issues.",
      "Check what is stuck in outbox.",
      "Diagnose the worker pipeline here.",
      "Check worker status.",
    ]);
  }

  return uniqueSuggestions([
    "Find people I have not spoken to in a while.",
    "Search my chats for something specific.",
    "Build a message plan with approval previews.",
    "What should I review next?",
  ]);
}

async function readApiError(response: Response) {
  try {
    const payload = (await response.json()) as { error?: unknown };
    if (typeof payload.error === "string" && payload.error.trim()) {
      return payload.error.trim();
    }
  } catch {
    // ignore non-JSON responses
  }
  return `Request failed (${response.status}).`;
}

function wait(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function fetchOutboxStatuses(outboxIds: string[]) {
  const response = await fetch("/api/orchestrator/send-previews/status", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ outboxIds }),
  });
  if (!response.ok) {
    throw new Error(await readApiError(response));
  }
  const payload = (await response.json()) as { rows?: OutboxStatusRow[] };
  return Array.isArray(payload.rows) ? payload.rows : [];
}

async function fetchSendPolicy() {
  const response = await fetch("/api/orchestrator/send-previews", {
    method: "GET",
  });
  if (!response.ok) {
    throw new Error(await readApiError(response));
  }
  const payload = (await response.json()) as { quietHours?: QuietHoursPolicy };
  return payload.quietHours || null;
}

function formatTime(value: number | null) {
  if (!value) {
    return "";
  }
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function getCommandTarget(command: string) {
  const normalized = normalizeText(command);
  if (!normalized) {
    return { mode: "empty" as const };
  }
  if (normalized === "help" || normalized === "commands") {
    return { mode: "help" as const };
  }

  let target = normalized;
  for (const prefix of commandPrefixes) {
    if (target.startsWith(prefix)) {
      target = target.slice(prefix.length).trim();
      break;
    }
  }

  if (!target) {
    return { mode: "invalid" as const };
  }

  if (target.startsWith("/")) {
    return { mode: "route" as const, href: target };
  }

  const navWithAliases = publicDashboardNavItems.map((item) => ({
    item,
    aliases: [normalizeText(item.label), normalizeText(item.href.replace(/^\//, ""))].filter((alias) => alias.length > 0),
  }));

  const exact = navWithAliases.find((entry) => entry.aliases.includes(target));
  if (exact) {
    return { mode: "route" as const, href: exact.item.href, label: exact.item.label };
  }

  const contains = navWithAliases.find((entry) =>
    entry.aliases.some((alias) => alias.length >= 2 && target.length >= 3 && (alias.includes(target) || target.includes(alias))),
  );

  if (contains) {
    return { mode: "route" as const, href: contains.item.href, label: contains.item.label };
  }

  return { mode: "unknown" as const, target };
}

export function HomeScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const [input, setInput] = useState("");
  const [feedback, setFeedback] = useState<CommandFeedback>({
    kind: "idle",
    message: "Ready",
  });
  const [isAwaitingOrchestrator, setIsAwaitingOrchestrator] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [doneConfirmOpen, setDoneConfirmOpen] = useState(false);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [inlineOperation, setInlineOperation] = useState<InlineOperation | null>(null);
  const robotSceneUrl = process.env.NEXT_PUBLIC_SPLINE_ACTIVITY_SCENE_URL || defaultRobotSceneUrl;
  const isInlineOperationRunning = inlineOperation?.status === "running";
  const screenSuggestions = useMemo(
    () => buildScreenSuggestions(messages, isAwaitingOrchestrator || isInlineOperationRunning),
    [messages, isAwaitingOrchestrator, isInlineOperationRunning],
  );

  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const stored = readStoredHomeSession();
    setMessages(stored.messages);
    setInput(stored.input);
    setFeedback({
      kind: "idle",
      message: stored.messages.length ? "Session restored" : "Ready",
    });
    setSessionLoaded(true);
  }, []);

  useEffect(() => {
    if (!sessionLoaded) {
      return;
    }
    writeStoredHomeSession(messages, input);
  }, [input, messages, sessionLoaded]);

  useEffect(() => {
    if (!transcriptRef.current) {
      return;
    }
    transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
  }, [messages, isAwaitingOrchestrator, inlineOperation]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTyping =
        target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
        return;
      }
      if (event.key === "/" && !isTyping) {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const appendMessage = (message: ChatMessage) => {
    setMessages((previous) => [...previous, message]);
  };

  const runPrompt = async (prompt: string) => {
    const normalizedPrompt = prompt.trim();
    if (!normalizedPrompt) {
      const message = "Type a message first.";
      setFeedback({ kind: "error", message });
      return;
    }

    const nextUserMessage = makeMessage("user", normalizedPrompt);
    const nextHistory = [...messages, nextUserMessage];
    setMessages(nextHistory);
    setInput("");

    const result = getCommandTarget(normalizedPrompt);
    const currentArtifacts = latestVisibleArtifacts(messages);

    if (result.mode === "help") {
      const message = "Ask what needs attention, tell me to draft or inspect something, or type a direct command like open queue.";
      setFeedback({ kind: "idle", message });
      appendMessage(makeMessage("assistant", message));
      return;
    }

    if (result.mode === "route") {
      if (pathname === result.href) {
        const message = `You are already on ${result.label || result.href}.`;
        setFeedback({ kind: "idle", message });
        appendMessage(makeMessage("assistant", message));
        return;
      }
      const message = `Opening ${result.label || result.href}.`;
      setFeedback({ kind: "success", message });
      appendMessage(makeMessage("assistant", message, "success"));
      router.push(result.href);
      return;
    }

    setIsAwaitingOrchestrator(true);
    setFeedback({ kind: "idle", message: "Checking the system..." });
    try {
      const response = await fetch("/api/orchestrator/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: normalizedPrompt,
          history: nextHistory.slice(-12).map((messageItem) => ({
            role: messageItem.role,
            text: messageTextForHistory(messageItem),
          })),
          currentArtifacts,
        }),
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      const payload = (await response.json()) as {
        replyText?: string;
        guardrailBlocked?: boolean;
        guardrailReason?: string;
        manager?: {
          toolResults?: Array<{
            tool?: string;
            status?: string;
            summary?: string;
          }>;
          artifacts?: unknown[];
        };
      };
      if (payload.guardrailBlocked) {
        const guardrailMessage = payload.guardrailReason?.trim() || "This request is blocked by a safety rule.";
        setFeedback({ kind: "error", message: guardrailMessage });
        appendMessage(makeMessage("assistant", guardrailMessage, "error"));
        return;
      }
      const replyText = typeof payload.replyText === "string" ? payload.replyText.trim() : "";
      if (!replyText) {
        throw new Error("No response received.");
      }
      const toolSummaries =
        payload.manager?.toolResults
          ?.map((result) => {
            const tool = typeof result.tool === "string" ? result.tool : "tool";
            const status = typeof result.status === "string" ? result.status : "unknown";
            const summary = typeof result.summary === "string" ? result.summary : "";
            return `${tool} (${status}): ${summary}`;
          })
          .filter((summary) => summary.trim().length > 0) || [];
      const artifacts = payload.manager?.artifacts?.filter(isManagerArtifact) || [];
      setFeedback({ kind: "success", message: "Response ready" });
      appendMessage(makeMessage("assistant", replyText, "success", toolSummaries, artifacts));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not get a response.";
      setFeedback({ kind: "error", message });
      appendMessage(makeMessage("assistant", message, "error"));
    } finally {
      setIsAwaitingOrchestrator(false);
    }
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void runPrompt(input);
  };

  const onInputKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void runPrompt(input);
    }
  };

  const runSendPreviews = async (messageId: string, artifacts?: ManagerArtifact[]) => {
    if (inlineOperation?.messageId === messageId && inlineOperation.status === "done") {
      setFeedback({ kind: "success", message: "Those previews have already been processed." });
      return;
    }
    const previews = sendablePreviews(artifacts);
    if (!previews.length) {
      setFeedback({ kind: "error", message: "There are no sendable previews with thread context here." });
      return;
    }

    const quietHours = await fetchSendPolicy().catch(() => null);
    const confirmed = window.confirm(`Send ${previews.length} approved preview${previews.length === 1 ? "" : "s"}?`);
    if (!confirmed) {
      return;
    }
    const ignoreQuietHours =
      quietHours?.active === true
        ? window.confirm(
            `Quiet hours are active until ${formatTime(quietHours.nextAllowedAt) || "the configured end time"}.\n\nPress OK to ignore quiet hours and send now.\nPress Cancel to respect quiet hours and schedule after they end.`,
          )
        : false;
    const quietHoursModeText =
      quietHours?.active === true
        ? ignoreQuietHours
          ? "Quiet hours are active; you chose to send now anyway."
          : `Quiet hours are active; delivery will wait until ${formatTime(quietHours.nextAllowedAt) || "they end"}.`
        : "Quiet hours are not active.";

    setFeedback({ kind: "idle", message: `Sending 0 of ${previews.length}` });
    setInlineOperation({
      messageId,
      kind: "send_previews",
      status: "running",
      phase: "queueing",
      current: 0,
      total: previews.length,
      queued: 0,
      sent: 0,
      failed: 0,
      label: "Queueing",
      detail: `Preparing approved previews for delivery. ${quietHoursModeText}`,
    });

    try {
      const queuedOutboxIds: string[] = [];
      for (const [index, preview] of previews.entries()) {
        const current = index + 1;
        setInlineOperation({
          messageId,
          kind: "send_previews",
          status: "running",
          phase: "queueing",
          current: index,
          total: previews.length,
          queued: index,
          sent: 0,
          failed: 0,
          label: "Queueing",
          detail: `Queueing ${preview.title} for delivery. ${quietHoursModeText}`,
        });

        const response = await fetch("/api/orchestrator/send-previews", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            threadId: preview.threadId,
            title: preview.title,
            previewText: preview.previewText,
            messageIntent: preview.messageIntent,
            ignoreQuietHours,
          }),
        });
        if (!response.ok) {
          throw new Error(await readApiError(response));
        }
        const payload = (await response.json()) as { result?: { outboxId?: string } };
        if (payload.result?.outboxId) {
          queuedOutboxIds.push(payload.result.outboxId);
        }
        setFeedback({ kind: "idle", message: `Sending ${current} of ${previews.length}` });
        setInlineOperation({
          messageId,
          kind: "send_previews",
          status: "running",
          phase: "queueing",
          current,
          total: previews.length,
          queued: current,
          sent: 0,
          failed: 0,
          label: "Queueing",
          detail: `${preview.title} is in the outbox. ${quietHoursModeText}`,
        });
      }

      const deliveryIds = queuedOutboxIds.slice(0, previews.length);
      if (deliveryIds.length) {
        const deadlineAt = Date.now() + 120_000;
        let latestRows: OutboxStatusRow[] = [];
        while (Date.now() < deadlineAt) {
          latestRows = await fetchOutboxStatuses(deliveryIds);
          const sent = latestRows.filter((row) => row.status === "sent").length;
          const failed = latestRows.filter((row) => row.status === "failed" || row.status === "missing").length;
          const completed = sent + failed;
          const active = latestRows.find((row) => row.status === "claimed");
          const nextWaiting = latestRows.find((row) => row.status === "pending") || active;

          setInlineOperation({
            messageId,
            kind: "send_previews",
            status: "running",
            phase: "sending",
            current: completed,
            total: deliveryIds.length,
            queued: deliveryIds.length,
            sent,
            failed,
            label: "Sending",
            detail:
              completed >= deliveryIds.length
                ? "Delivery checks are complete."
                : active
                  ? `Sending ${active.title || "the current preview"} now...`
                  : quietHours?.active && !ignoreQuietHours
                    ? `Scheduled after quiet hours. Waiting until ${formatTime(quietHours.nextAllowedAt) || "the configured end time"}...`
                    : `Waiting for worker to pick up ${nextWaiting?.title || "the next preview"}...`,
          });

          if (completed >= deliveryIds.length) {
            break;
          }
          await wait(1_500);
        }

        const sent = latestRows.filter((row) => row.status === "sent").length;
        const failedRows = latestRows.filter((row) => row.status === "failed" || row.status === "missing");
        const failed = failedRows.length;
        const completed = sent + failed;
        if (completed < deliveryIds.length) {
          setInlineOperation({
            messageId,
            kind: "send_previews",
            status: "done",
            phase: "sending",
            current: completed,
            total: deliveryIds.length,
            queued: deliveryIds.length,
            sent,
            failed,
            label: "Sending",
            detail:
              quietHours?.active && !ignoreQuietHours
                ? `${sent} sent. ${deliveryIds.length - completed} scheduled after quiet hours.`
                : `${sent} sent. ${deliveryIds.length - completed} still pending in outbox, so delivery will continue in the background.`,
          });
          setFeedback({ kind: "success", message: `${sent} sent; ${deliveryIds.length - completed} still pending.` });
          return;
        }
        if (failed > 0) {
          const firstError = failedRows.find((row) => row.error)?.error || "Check outbox for details.";
          setInlineOperation({
            messageId,
            kind: "send_previews",
            status: "error",
            phase: "sending",
            current: completed,
            total: deliveryIds.length,
            queued: deliveryIds.length,
            sent,
            failed,
            label: "Sending",
            detail: `${sent} sent, ${failed} failed. ${firstError}`,
          });
          setFeedback({ kind: "error", message: `${failed} preview${failed === 1 ? "" : "s"} failed to send.` });
          return;
        }
      }

      setInlineOperation({
        messageId,
        kind: "send_previews",
        status: "done",
        phase: "sending",
        current: previews.length,
        total: previews.length,
        queued: previews.length,
        sent: previews.length,
        failed: 0,
        label: "Sending",
        detail: "All approved previews were sent.",
      });
      setFeedback({ kind: "success", message: `Sent ${previews.length} approved preview${previews.length === 1 ? "" : "s"}.` });
      appendMessage(
        makeMessage(
          "assistant",
          `Sent ${previews.length} approved preview${previews.length === 1 ? "" : "s"}. You can keep refining this thread or click Done when the process is complete.`,
          "success",
        ),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not send these previews.";
      setInlineOperation((previous) =>
        previous
          ? {
              ...previous,
              status: "error",
              detail: message,
            }
          : {
              messageId,
              kind: "send_previews",
              status: "error",
              phase: "sending",
              current: 0,
              total: previews.length,
              queued: 0,
              sent: 0,
              failed: 1,
              label: "Sending",
              detail: message,
            },
      );
      setFeedback({ kind: "error", message });
    }
  };

  const runInlineAction = (action: InlineAction, messageId: string, artifacts?: ManagerArtifact[]) => {
    if (action.href) {
      router.push(action.href);
      return;
    }
    if (action.operation === "send_previews") {
      void runSendPreviews(messageId, artifacts);
      return;
    }
    if (action.prompt) {
      void runPrompt(action.prompt);
    }
  };

  const confirmDone = () => {
    setDoneConfirmOpen(false);
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(HOME_AI_SESSION_STORAGE_KEY);
    }
    setMessages([]);
    setInput("");
    setInlineOperation(null);
    setFeedback({ kind: "idle", message: "Ready" });
    inputRef.current?.focus();
  };

  const canFinishSession = messages.length > 0 && !isAwaitingOrchestrator && !isInlineOperationRunning;

  return (
    <section className="home-shell home-ai-shell" aria-label="AI chat with Odogwu HQ">
      <div className="home-ai-chat">
        <header className="home-ai-header">
          <div className="home-ai-header-actions">
            <p className={`home-ai-status home-command-${feedback.kind}`}>{feedback.message}</p>
            {canFinishSession ? (
              <button type="button" className="home-ai-done-button" onClick={() => setDoneConfirmOpen(true)}>
                Done
              </button>
            ) : null}
          </div>
        </header>

        <div ref={transcriptRef} className="home-ai-transcript" role="log" aria-live="polite">
          {messages.length === 0 ? (
            <section className="home-ai-empty" aria-label="Odogwu HQ introduction">
              <div className="home-ai-empty-copy">
                <span className="home-ai-message-role">Odogwu HQ</span>
                <p>{emptyStateIntro}</p>
              </div>
              <div className="home-ai-robot" aria-hidden="true">
                <iframe title="3D Odogwu HQ assistant" src={robotSceneUrl} loading="lazy" />
              </div>
            </section>
          ) : null}

          {messages.map((message) => (
            (() => {
              const toolSummarySplit = splitToolSummaries(message.toolSummaries);
              const primaryTool = toolSummarySplit.primary ? toolSummaryParts(toolSummarySplit.primary) : null;
              const inlineActions = buildInlineActions(primaryTool, message.artifacts);
              const sendFinishedForMessage = inlineOperation?.messageId === message.id && inlineOperation.status === "done";
              const activeSendOperationForMessage = inlineOperation?.messageId === message.id && inlineOperation.kind === "send_previews";
              return (
                <article key={message.id} className={`home-ai-message home-ai-message-${message.role} home-ai-message-${message.kind || "idle"}`}>
                  <span className="home-ai-message-role">{message.role === "user" ? "You" : "Odogwu HQ"}</span>
                  <p>{message.text}</p>
                  {primaryTool ? (
                    <div className="home-ai-primary-tool" aria-label="Primary manager result">
                      <div>
                        <span>{primaryTool.tool}</span>
                        <strong>{primaryTool.body}</strong>
                      </div>
                      {primaryTool.status ? <em>{primaryTool.status}</em> : null}
                      {inlineActions.length ? (
                        <div className="home-ai-inline-actions" aria-label="Next actions">
	                          {inlineActions.map((action) => (
	                            <button
	                              key={`${message.id}:${action.label}`}
	                              type="button"
	                              className={action.tone === "primary" ? "home-ai-inline-action primary" : "home-ai-inline-action"}
	                              onClick={() => runInlineAction(action, message.id, message.artifacts)}
	                              disabled={isAwaitingOrchestrator || isInlineOperationRunning || (action.operation === "send_previews" && sendFinishedForMessage)}
	                            >
	                              {action.label}
	                            </button>
	                          ))}
	                        </div>
	                      ) : null}
	                      {inlineOperation?.messageId === message.id ? <InlineOperationProgress operation={inlineOperation} /> : null}
	                    </div>
	                  ) : null}
                  {message.artifacts?.length && !activeSendOperationForMessage ? (
                    <div className="home-ai-artifacts" aria-label="Manager results">
                      {message.artifacts.map((artifact, artifactIndex) => (
                        <section
                          key={`${message.id}-${artifact.kind}-${artifactIndex}`}
                          className={`home-ai-artifact home-ai-artifact-${artifact.kind}`}
                        >
                          <div className="home-ai-artifact-header">
                            <div>
                              <h2>{artifact.title}</h2>
                              <span>{artifact.description}</span>
                            </div>
                            <strong>{artifactCountLabel(artifact)}</strong>
                          </div>

                          {artifact.kind === "campaign_plan" ? (
                            <div className="home-ai-campaign-plan">
                              <div className="home-ai-campaign-grid">
                                <div>
                                  <span>Objective</span>
                                  <p>{artifact.objective}</p>
                                </div>
                                <div>
                                  <span>Audience</span>
                                  <p>{artifact.audienceSummary}</p>
                                </div>
                                <div>
                                  <span>Creative</span>
                                  <p>{artifact.contentType} across {artifact.channels.join(", ")}</p>
                                </div>
                              </div>
                              <div className="home-ai-campaign-steps">
                                {artifact.steps.map((step) => (
                                  <article key={step.label} className={`home-ai-campaign-step ${step.status}`}>
                                    <strong>{step.label}</strong>
                                    <p>{step.detail}</p>
                                  </article>
                                ))}
                              </div>
                              <div className="home-ai-campaign-notes">
                                {artifact.safetyNotes.slice(0, 3).map((note) => (
                                  <span key={note}>{note}</span>
                                ))}
                              </div>
                              <div className="home-ai-fine-tune-actions" aria-label="Campaign next actions">
                                {artifact.nextPrompts.slice(0, 4).map((prompt) => (
                                  <button
                                    key={prompt}
                                    type="button"
                                    onClick={() =>
                                      runInlineAction(
                                        {
                                          label: prompt,
                                          prompt,
                                        },
                                        message.id,
                                        message.artifacts,
                                      )
                                    }
                                    disabled={isAwaitingOrchestrator || isInlineOperationRunning}
                                  >
                                    {prompt.replace(/\.$/, "")}
                                  </button>
                                ))}
                              </div>
                            </div>
                          ) : artifact.kind === "people_list" ? (
                            <div className="home-ai-person-list">
                              {artifact.people.slice(0, 10).map((person, personIndex) => {
                                const display = artifact.display || {};
                                const showGender = display.showGender === true;
                                const showRomanticFit = display.showRomanticFit === true;
                                const showMatchFactors = display.showMatchFactors !== false;
                                const showConfidence = display.showConfidence !== false;
                                const showLastSeen = display.showLastSeen !== false;
                                const showProvider = display.showProvider !== false;
                                const confidence = confidenceLabel(person.confidence);
                                const genderCue = showGender ? genderCueLabel(person.genderCue, person.genderConfidence) : null;
                                const fineTuneActions = personFineTuneActions(person);
                                return (
                                  <article key={`${person.threadId || person.title}-${personIndex}`} className="home-ai-person-row">
                                    <div>
                                      <h3>{person.title}</h3>
                                      <span>{showRomanticFit ? person.romanticFitReason || person.reason : person.reason}</span>
                                      {showMatchFactors && person.matchFactors?.length ? (
                                        <small className="home-ai-match-factors">{person.matchFactors.slice(0, 3).join(" / ")}</small>
                                      ) : null}
                                      <div className="home-ai-fine-tune-actions" aria-label={`Fine tune actions for ${person.title}`}>
                                        {fineTuneActions.map((action) => (
                                          <button
	                                            key={`${person.threadId || person.title}:${action.label}`}
	                                            type="button"
	                                            onClick={() => runInlineAction(action, message.id, message.artifacts)}
	                                            disabled={isAwaitingOrchestrator || isInlineOperationRunning}
	                                          >
	                                            {action.label}
                                          </button>
                                        ))}
                                      </div>
                                    </div>
                                    <div className="home-ai-person-meta">
                                      {showProvider && person.provider ? <span>{person.provider}</span> : null}
                                      {genderCue ? <span>{genderCue}</span> : null}
                                      {showRomanticFit && person.romanticFit && person.romanticFit !== "unknown" ? <span>{person.romanticFit} fit</span> : null}
                                      {showLastSeen ? <span>{formatLastSeen(person.lastMessageAt)}</span> : null}
                                      {showConfidence && confidence ? <span>{confidence}</span> : null}
                                    </div>
                                  </article>
                                );
                              })}
                            </div>
                          ) : (
                            <div className="home-ai-preview-list">
                              {artifact.previews.slice(0, 8).map((preview, previewIndex) => (
                                <article key={`${preview.threadId || preview.title}-${previewIndex}`} className="home-ai-preview-row">
                                  <div className="home-ai-preview-topline">
                                    <h3>{preview.title}</h3>
                                    <span>Needs approval</span>
                                  </div>
                                  <p>{preview.previewText}</p>
                                  <small>{preview.messageIntent}</small>
                                  <div className="home-ai-fine-tune-actions" aria-label={`Fine tune preview for ${preview.title}`}>
                                    {previewFineTuneActions(preview).map((action) => (
                                      <button
	                                        key={`${preview.threadId || preview.title}:${action.label}`}
	                                        type="button"
	                                        onClick={() => runInlineAction(action, message.id, message.artifacts)}
	                                        disabled={isAwaitingOrchestrator || isInlineOperationRunning}
	                                      >
	                                        {action.label}
                                      </button>
                                    ))}
                                  </div>
                                </article>
                              ))}
                            </div>
                          )}
                        </section>
                      ))}
                    </div>
                  ) : null}
                  {toolSummarySplit.rest.length ? (
                    <details className="home-ai-tool-details">
                      <summary>Other manager tools ({toolSummarySplit.rest.length})</summary>
                      <ul>
                        {toolSummarySplit.rest.map((summary) => (
                          <li key={summary}>{summary}</li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                </article>
              );
            })()
          ))}

          {isAwaitingOrchestrator ? (
            <article className="home-ai-message home-ai-message-assistant home-ai-thinking">
              <span className="home-ai-message-role">Odogwu HQ</span>
              <p>Checking chats, tools, and review queues...</p>
            </article>
          ) : null}
        </div>

        <div className="home-ai-starters" aria-label="Contextual prompt suggestions">
          {screenSuggestions.map((prompt) => (
	            <button key={prompt} type="button" onClick={() => runPrompt(prompt)} disabled={isAwaitingOrchestrator || isInlineOperationRunning}>
	              {prompt}
	            </button>
          ))}
        </div>

        <form className="home-ai-composer" onSubmit={onSubmit}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder="Ask it who needs a reply, what to say, or what it can handle for you..."
            aria-label="Message Odogwu HQ"
	            disabled={isAwaitingOrchestrator || isInlineOperationRunning}
	            rows={1}
	          />
	          <button type="submit" disabled={isAwaitingOrchestrator || isInlineOperationRunning || !input.trim()}>
	            {isAwaitingOrchestrator || isInlineOperationRunning ? "Working" : "Send"}
	          </button>
        </form>

        <UIModal
          open={doneConfirmOpen}
          onClose={() => setDoneConfirmOpen(false)}
          title="Finish This Session?"
          description="This clears the current chat transcript and returns to the empty state for a new conversation."
        >
          <div className="home-ai-done-confirm">
            <p>Are you sure you are done with this process?</p>
            <div className="home-ai-done-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setDoneConfirmOpen(false)}>
                Keep Working
              </button>
              <button type="button" className="btn btn-primary home-ai-confirm-done" onClick={confirmDone}>
                Yes, I&apos;m Done
              </button>
            </div>
          </div>
        </UIModal>
      </div>
    </section>
  );
}
