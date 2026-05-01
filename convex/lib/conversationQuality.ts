import type { Id } from "../_generated/dataModel";

export const CONVERSATION_QUALITY_MAX_EXCERPT_CHARS = 520;
export const CONVERSATION_QUALITY_MAX_PROMPT_CHARS = 6_000;

export type QualityMessageSnapshot = {
  messageId: Id<"messages">;
  threadId: Id<"threads">;
  direction: "inbound" | "outbound";
  senderJid: string;
  text: string;
  toolRunId?: string;
  messageAt: number;
  messageType?: string;
  isStatus?: boolean;
};

export type QualityThreadCandidate = {
  threadId: Id<"threads">;
  title: string;
  provider?: "whatsapp" | "instagram" | "imessage" | "telegram";
  lastMessageAt: number;
  messages: QualityMessageSnapshot[];
  negativeFeedbackCount: number;
};

export type QualityThreadSample = {
  threadId: Id<"threads">;
  title: string;
  provider?: "whatsapp" | "instagram" | "imessage" | "telegram";
  lastMessageAt: number;
  score: number;
  autoOutboundCount: number;
  manualInterventionCount: number;
  negativeFeedbackCount: number;
  turnCount: number;
  excerpts: Array<{
    messageId: Id<"messages">;
    messageAt: number;
    speaker: "system" | "contact";
    text: string;
    automatedOutbound: boolean;
  }>;
};

export type AnalyzerEvidence = {
  threadId?: Id<"threads">;
  threadTitle?: string;
  messageId?: Id<"messages">;
  messageAt?: number;
  excerpt: string;
};

export type AnalyzerFinding = {
  category: string;
  severity: "low" | "medium" | "high";
  title: string;
  problemStatement: string;
  evidenceSummary: string;
  evidence: AnalyzerEvidence[];
  suggestedFixPrompt: string;
};

function normalizeSpace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function clipConversationQualityText(value: string, maxChars = CONVERSATION_QUALITY_MAX_EXCERPT_CHARS) {
  const normalized = normalizeSpace(value || "");
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

export function normalizeConversationQualityKey(value: string) {
  return normalizeSpace(value.toLowerCase())
    .replace(/[^a-z0-9\s:_-]/g, "")
    .slice(0, 180);
}

export function buildConversationQualityDedupeKey(finding: Pick<AnalyzerFinding, "category" | "title" | "evidenceSummary">) {
  const category = normalizeConversationQualityKey(finding.category || "general");
  const title = normalizeConversationQualityKey(finding.title || "untitled");
  const evidence = normalizeConversationQualityKey(finding.evidenceSummary || "").slice(0, 90);
  return `${category}:${title}:${evidence}`.slice(0, 260);
}

export function isAutomatedOutboundMessage(message: Pick<QualityMessageSnapshot, "direction" | "senderJid" | "toolRunId">) {
  return message.direction === "outbound" && message.senderJid === "me" && Boolean(message.toolRunId?.trim());
}

export function isManualOutboundMessage(message: Pick<QualityMessageSnapshot, "direction" | "senderJid" | "toolRunId">) {
  return message.direction === "outbound" && message.senderJid === "me" && !message.toolRunId?.trim();
}

export function scoreConversationQualityCandidate(candidate: QualityThreadCandidate) {
  const messages = candidate.messages.filter((message) => !message.isStatus && message.messageType !== "reaction");
  const autoOutboundCount = messages.filter(isAutomatedOutboundMessage).length;
  const manualInterventionCount = messages.filter(isManualOutboundMessage).length;
  if (autoOutboundCount === 0) {
    return {
      eligible: false,
      score: 0,
      autoOutboundCount,
      manualInterventionCount,
      turnCount: messages.length,
    };
  }

  const inboundCount = messages.filter((message) => message.direction === "inbound").length;
  const score =
    autoOutboundCount * 8 +
    Math.min(messages.length, 40) +
    Math.min(inboundCount, 20) * 2 +
    manualInterventionCount * 6 +
    candidate.negativeFeedbackCount * 7;

  return {
    eligible: true,
    score,
    autoOutboundCount,
    manualInterventionCount,
    turnCount: messages.length,
  };
}

export function buildConversationQualityThreadSample(candidate: QualityThreadCandidate): QualityThreadSample | null {
  const scored = scoreConversationQualityCandidate(candidate);
  if (!scored.eligible) {
    return null;
  }

  const messages = candidate.messages
    .filter((message) => !message.isStatus && message.messageType !== "reaction")
    .sort((a, b) => a.messageAt - b.messageAt);
  const selectedIndexes = new Set<number>();
  messages.forEach((message, index) => {
    if (!isAutomatedOutboundMessage(message)) {
      return;
    }
    for (let offset = -2; offset <= 2; offset += 1) {
      const selectedIndex = index + offset;
      if (selectedIndex >= 0 && selectedIndex < messages.length) {
        selectedIndexes.add(selectedIndex);
      }
    }
  });

  const excerpts = Array.from(selectedIndexes)
    .sort((a, b) => a - b)
    .slice(0, 24)
    .map((index) => {
      const message = messages[index]!;
      return {
        messageId: message.messageId,
        messageAt: message.messageAt,
        speaker: message.direction === "outbound" ? ("system" as const) : ("contact" as const),
        text: clipConversationQualityText(message.text),
        automatedOutbound: isAutomatedOutboundMessage(message),
      };
    })
    .filter((entry) => entry.text);

  if (excerpts.length === 0) {
    return null;
  }

  return {
    threadId: candidate.threadId,
    title: candidate.title,
    ...(candidate.provider ? { provider: candidate.provider } : {}),
    lastMessageAt: candidate.lastMessageAt,
    score: scored.score,
    autoOutboundCount: scored.autoOutboundCount,
    manualInterventionCount: scored.manualInterventionCount,
    negativeFeedbackCount: candidate.negativeFeedbackCount,
    turnCount: scored.turnCount,
    excerpts,
  };
}

export function sanitizeAnalyzerFinding(raw: Partial<AnalyzerFinding>): AnalyzerFinding | null {
  const title = clipConversationQualityText(raw.title || "", 140);
  const category = clipConversationQualityText(raw.category || "conversation_quality", 80);
  const problemStatement = clipConversationQualityText(raw.problemStatement || "", 900);
  const evidenceSummary = clipConversationQualityText(raw.evidenceSummary || "", 700);
  const suggestedFixPrompt = clipConversationQualityText(
    raw.suggestedFixPrompt || "",
    CONVERSATION_QUALITY_MAX_PROMPT_CHARS,
  );
  const severity = raw.severity === "high" || raw.severity === "medium" || raw.severity === "low" ? raw.severity : "medium";
  const evidence = Array.isArray(raw.evidence)
    ? raw.evidence
        .map((entry) => ({
          threadId: entry.threadId,
          threadTitle: entry.threadTitle ? clipConversationQualityText(entry.threadTitle, 160) : undefined,
          messageId: entry.messageId,
          messageAt: typeof entry.messageAt === "number" && Number.isFinite(entry.messageAt) ? entry.messageAt : undefined,
          excerpt: clipConversationQualityText(entry.excerpt || ""),
        }))
        .filter((entry) => entry.excerpt)
        .slice(0, 6)
    : [];

  if (!title || !problemStatement || !evidenceSummary || !suggestedFixPrompt || evidence.length === 0) {
    return null;
  }

  return {
    category,
    severity,
    title,
    problemStatement,
    evidenceSummary,
    evidence,
    suggestedFixPrompt,
  };
}
