import { randomUUID } from "node:crypto";
import type { AiAttempt } from "@/worker/ai";

export const MAX_GATEWAY_INBOUND_CHARS = 8000;
const MAX_HISTORY_LINE_CHARS = 1200;

type OpenAiRole = "system" | "developer" | "user" | "assistant" | "tool";

type NormalizedMessage = {
  role: OpenAiRole;
  text: string;
};

type OpenAiErrorType = "invalid_request_error" | "authentication_error" | "api_error";

function clampText(value: string, maxChars: number) {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxChars - 3))}...`;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isOpenAiRole(value: unknown): value is OpenAiRole {
  return value === "system" || value === "developer" || value === "user" || value === "assistant" || value === "tool";
}

function coerceContentPartToText(part: unknown): string {
  if (typeof part === "string") {
    return part;
  }
  if (!isObjectRecord(part)) {
    return "";
  }
  if (typeof part.text === "string") {
    return part.text;
  }
  if (isObjectRecord(part.text) && typeof part.text.value === "string") {
    return part.text.value;
  }
  if (typeof part.content === "string") {
    return part.content;
  }
  if (isObjectRecord(part.content) && typeof part.content.text === "string") {
    return part.content.text;
  }
  return "";
}

export function openAiContentToText(content: unknown): string {
  if (typeof content === "string") {
    return content.trim();
  }
  if (!Array.isArray(content)) {
    return "";
  }
  const parts = content
    .map(coerceContentPartToText)
    .map((item) => item.trim())
    .filter(Boolean);
  return parts.join("\n").trim();
}

function roleToHistoryPrefix(role: OpenAiRole) {
  if (role === "assistant") {
    return "Me";
  }
  if (role === "user") {
    return "Them";
  }
  return "System";
}

export function mapOpenAiMessagesToInboundAndHistory(messages: unknown): {
  inboundText: string;
  historyLines: string[];
} {
  if (!Array.isArray(messages)) {
    throw new Error("`messages` must be an array.");
  }

  const normalized: NormalizedMessage[] = [];
  for (const rawMessage of messages) {
    if (!isObjectRecord(rawMessage) || !isOpenAiRole(rawMessage.role)) {
      continue;
    }
    const text = openAiContentToText(rawMessage.content);
    if (!text) {
      continue;
    }
    normalized.push({
      role: rawMessage.role,
      text,
    });
  }

  if (normalized.length === 0) {
    throw new Error("No usable text content found in `messages`.");
  }

  let inboundIndex = -1;
  for (let index = normalized.length - 1; index >= 0; index -= 1) {
    if (normalized[index]?.role === "user") {
      inboundIndex = index;
      break;
    }
  }
  if (inboundIndex === -1) {
    inboundIndex = normalized.length - 1;
  }

  const inboundText = normalized[inboundIndex]?.text?.trim() || "";
  if (!inboundText) {
    throw new Error("Inbound message content cannot be empty.");
  }

  const historyLines = normalized
    .filter((_, index) => index !== inboundIndex)
    .map((message) => `${roleToHistoryPrefix(message.role)}: ${clampText(message.text, MAX_HISTORY_LINE_CHARS)}`);

  return {
    inboundText: clampText(inboundText, MAX_GATEWAY_INBOUND_CHARS),
    historyLines,
  };
}

function coerceThreadId(value: unknown) {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function resolveGatewayThreadId(payload: {
  threadId?: unknown;
  thread_id?: unknown;
  user?: unknown;
  metadata?: unknown;
}) {
  const directThreadId = coerceThreadId(payload.threadId) || coerceThreadId(payload.thread_id);
  if (directThreadId) {
    return directThreadId;
  }

  if (isObjectRecord(payload.metadata)) {
    const metadataThreadId =
      coerceThreadId(payload.metadata.threadId) ||
      coerceThreadId(payload.metadata.thread_id) ||
      coerceThreadId(payload.metadata.slmThreadId) ||
      coerceThreadId(payload.metadata.slm_thread_id);
    if (metadataThreadId) {
      return metadataThreadId;
    }
  }

  if (typeof payload.user === "string") {
    const userText = payload.user.trim();
    if (userText.toLowerCase().startsWith("thread:")) {
      const fromUser = userText.slice("thread:".length).trim();
      return fromUser || undefined;
    }
  }

  return undefined;
}

function isGatewayAliasModel(model: string) {
  return /^slm[-_:]/i.test(model) || /^gateway[-_:]/i.test(model);
}

export function resolveGatewayRuntimeModel(model: unknown) {
  if (typeof model !== "string") {
    return undefined;
  }
  const trimmed = model.trim();
  if (!trimmed || isGatewayAliasModel(trimmed)) {
    return undefined;
  }
  return trimmed;
}

export function usageFromAttempts(attempts: AiAttempt[]) {
  const promptTokens = attempts.reduce((sum, attempt) => sum + (attempt.inputTokens || 0), 0);
  const completionTokens = attempts.reduce((sum, attempt) => sum + (attempt.outputTokens || 0), 0);
  const totalTokens =
    attempts.reduce((sum, attempt) => sum + (attempt.totalTokens || 0), 0) || promptTokens + completionTokens;
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: totalTokens,
  };
}

export function buildOpenAiChatCompletion(args: {
  text: string;
  model: string;
  attempts: AiAttempt[];
  createdAtMs?: number;
  finishReason?: "stop" | "content_filter";
}) {
  const createdAtMs = args.createdAtMs || Date.now();
  return {
    id: `chatcmpl_${randomUUID().replace(/-/g, "")}`,
    object: "chat.completion",
    created: Math.floor(createdAtMs / 1000),
    model: args.model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: args.text,
        },
        finish_reason: args.finishReason || "stop",
      },
    ],
    usage: usageFromAttempts(args.attempts),
  };
}

export function buildOpenAiErrorBody(message: string, type: OpenAiErrorType, code?: string) {
  return {
    error: {
      message,
      type,
      param: null,
      ...(code ? { code } : {}),
    },
  };
}
