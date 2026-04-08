import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { action, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { DEFAULT_MIMICRY_LEVEL } from "./lib/constants";
import { classifyThreadKind } from "./lib/threadEligibility";
import { hasPidginRecallCue, hasPidginStyleCue } from "../shared/pidgin-lexicon";

const refIngestHistorical = makeFunctionReference<"mutation">("inbound:ingestHistorical");
const refMemorySearch = makeFunctionReference<"query">("chatTools:memorySearch");
const refConversationRecallQuery = makeFunctionReference<"query">("chatTools:conversationRecallQuery");
const refGetThreadStyleProfile = makeFunctionReference<"query">("chatTools:getThreadStyleProfile");
const refContactMemoryFactsList = makeFunctionReference<"query">("chatTools:contactMemoryFactsList");
const refExternalWebSearch = makeFunctionReference<"action">("chatTools:externalWebSearch");
const refPersonalConnectorsSearch = makeFunctionReference<"action">("chatTools:personalConnectorsSearch");
const refReplyStyleGuardrailCheck = makeFunctionReference<"query">("chatTools:replyStyleGuardrailCheck");
const refPersonalConnectorsInternalSearch = makeFunctionReference<"query">("chatTools:personalConnectorsInternalSearch");
const refExtractContactMemoryFacts = makeFunctionReference<"mutation">("chatTools:extractContactMemoryFacts");
const refStyleGetEmojiProfile = makeFunctionReference<"query">("style:getEmojiProfile");

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "been",
  "but",
  "by",
  "for",
  "from",
  "have",
  "hi",
  "hey",
  "i",
  "im",
  "in",
  "is",
  "it",
  "its",
  "just",
  "me",
  "my",
  "of",
  "on",
  "or",
  "so",
  "that",
  "the",
  "this",
  "to",
  "we",
  "you",
  "your",
]);

const LOW_VALUE_REPLY_PATTERNS = [
  /^sounds good[.!]?\s*i(?:'|\u2019)ll handle it and update you soon[.!]?$/i,
  /^noted[.!]?\s*i(?:'|\u2019)m on it and i(?:'|\u2019)ll circle back soon[.!]?$/i,
  /^got it[,]?\s*i(?:'|\u2019)m on it[.!]?$/i,
  /^(sounds good|noted|got it|understood)[.!]?$/i,
];

const LOW_VALUE_GENERIC_PHRASE_PATTERNS = [
  /\b(?:sounds good|noted|got it|understood|i hear you)\b/i,
  /\bi(?:'|’)ll (?:handle|sort|check|look into|get (?:this )?done|circle back|follow up|update you)\b/i,
  /\bcircle back (?:soon|later|shortly)\b/i,
  /\b(?:update|details?) (?:soon|shortly)\b/i,
  /\blet me (?:sort|check|look into|get back)\b/i,
  /\b(?:please|kindly|abeg)\s+(?:just\s+)?(?:allow|pardon)\s+me(?:\s+small)?\b/i,
  /\b(?:allow|pardon)\s+me\s+small\b/i,
];

type ThreadRow = Doc<"threads">;

type MemorySearchHit = {
  messageId: Id<"messages">;
  threadId: Id<"threads">;
  threadJid: string;
  threadTitle?: string;
  direction: "inbound" | "outbound";
  text: string;
  snippet: string;
  messageAt: number;
  origin?: "live" | "history_sync" | "history_fetch";
  score: number;
  overlapScore: number;
  recencyScore: number;
};

function withEmojiLearningHints<T extends Record<string, unknown>>(
  profile: T,
  learnedEmojiProfile: { topEmojis?: string[]; categoryHints?: string[] } | null | undefined,
) {
  return {
    ...profile,
    learnedEmojiAllowlist: (learnedEmojiProfile?.topEmojis || []).slice(0, 12),
    learnedEmojiCategoryHints: (learnedEmojiProfile?.categoryHints || []).slice(0, 6),
  };
}

type MemorySearchCoreResult = {
  hits: MemorySearchHit[];
  candidateCount: number;
  appliedFilters: {
    threadId?: string;
    contactJid?: string;
    direction?: "inbound" | "outbound";
    fromMessageAt?: number;
    toMessageAt?: number;
  };
  queryKeywords: string[];
};

type ThreadStyleProfilePayload = {
  scope: "global" | "thread";
  threadId?: Id<"threads">;
  mimicryLevel: number;
  commonPhrases: string[];
  punctuationStyle: string[];
  humorNotes: string[];
  spellingNotes: string[];
  updatedAt: number;
};

type ContactMemoryFactType = "preference" | "profile" | "schedule" | "relationship" | "promise" | "other";

type ParsedExportEntry = {
  senderName: string;
  text: string;
  messageAt?: number;
  direction: "inbound" | "outbound";
};

type RouterStep = {
  id: string;
  tool: RouterToolName;
  reason: string;
  readOnly: boolean;
  requiresTool?: RouterToolName;
};

type RouterToolName =
  | "conversation_recall.query"
  | "memory.search"
  | "thread_style.profile"
  | "contact_memory.extract"
  | "contact_memory.facts"
  | "external_search.web"
  | "personal_connectors.search"
  | "reply_style_guardrail.check";

type RouterExecutionStatus = "success" | "error" | "timeout" | "skipped";

type RouterStepEnvelope = {
  stepId: string;
  tool: RouterToolName;
  status: RouterExecutionStatus;
  latencyMs: number;
  output: unknown;
  outputSize: number;
  outputSummary: string;
  errorCode?: string;
  error?: string;
};

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(value, max));
}

function clampRound(value: number | undefined, fallback: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.round(clamp(value as number, min, max));
}

function normalizeSpace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function isManualSelfAuthoredMessage(message: Pick<Doc<"messages">, "direction" | "senderJid" | "toolRunId">) {
  return message.direction === "outbound" && message.senderJid === "me" && !message.toolRunId;
}

function compactText(value: string, maxChars: number) {
  const normalized = normalizeSpace(value);
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxChars - 3)).trim()}...`;
}

const READ_ONLY_ROUTER_TOOLS = new Set<RouterToolName>([
  "conversation_recall.query",
  "memory.search",
  "thread_style.profile",
  "contact_memory.facts",
  "external_search.web",
  "personal_connectors.search",
  "reply_style_guardrail.check",
]);

const HINT_ALLOWLIST_TOOLS = new Set<RouterToolName>([
  "conversation_recall.query",
  "memory.search",
  "thread_style.profile",
  "contact_memory.facts",
  "external_search.web",
  "personal_connectors.search",
  "reply_style_guardrail.check",
]);

function isReadOnlyRouterTool(tool: RouterToolName) {
  return READ_ONLY_ROUTER_TOOLS.has(tool);
}

function parseRouterHint(value: string): RouterToolName | null {
  const normalized = normalizeSpace(value).toLowerCase();
  const aliases: Record<string, RouterToolName> = {
    "conversation_recall.query": "conversation_recall.query",
    "conversation_recall": "conversation_recall.query",
    recall: "conversation_recall.query",
    "memory.search": "memory.search",
    memory: "memory.search",
    "thread_style.profile": "thread_style.profile",
    style: "thread_style.profile",
    "contact_memory.facts": "contact_memory.facts",
    facts: "contact_memory.facts",
    "external_search.web": "external_search.web",
    web: "external_search.web",
    search: "external_search.web",
    "personal_connectors.search": "personal_connectors.search",
    connectors: "personal_connectors.search",
    "reply_style_guardrail.check": "reply_style_guardrail.check",
    guardrail: "reply_style_guardrail.check",
  };
  return aliases[normalized] || null;
}

function classifyRouterError(error: unknown): { code: string; message: string } {
  const message = error instanceof Error ? error.message : String(error || "Unknown error");
  const lower = message.toLowerCase();
  if (lower.includes("timeout") || lower.includes("timed out") || lower.includes("deadline")) {
    return { code: "timeout", message };
  }
  if (/http\s+5\d{2}/i.test(message) || /(502|503|504)/.test(message)) {
    return { code: "upstream_5xx", message };
  }
  if (/(invalid|required|cannot|must|not found|threadid|contactjid)/i.test(message)) {
    return { code: "validation", message };
  }
  if (/(empty|no results|no clear|no strong evidence)/i.test(message)) {
    return { code: "empty_result", message };
  }
  return { code: "error", message };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
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

function summarizeRouterOutput(output: unknown) {
  const asJson = JSON.stringify(output ?? null);
  const outputSize = asJson.length;
  const outputSummary = compactText(asJson, 260);
  if (outputSize <= 12_000) {
    return {
      output,
      outputSize,
      outputSummary,
    };
  }
  return {
    output: {
      truncated: true,
      outputSize,
      preview: compactText(asJson, 1200),
    },
    outputSize,
    outputSummary: `output_truncated size=${outputSize}`,
  };
}

type PlannedRouterResult = {
  steps: RouterStep[];
  plannerSource: "deterministic" | "hybrid";
  plannerConfidence: number;
  hintApplied: boolean;
};

export function planToolRouterSteps(args: {
  task: string;
  candidateReply?: string;
  threadIdProvided: boolean;
  plannerMode: "deterministic" | "hybrid";
  modelHints?: string[];
  includeExtraction: boolean;
  maxToolsPerRun: number;
}): PlannedRouterResult {
  const task = normalizeSpace(args.task).slice(0, 320);
  const deterministicSteps: RouterStep[] = [];
  const pushStep = (step: RouterStep) => {
    deterministicSteps.push({
      ...step,
      readOnly: isReadOnlyRouterTool(step.tool),
    });
  };

  const wantsRecall = /(before|earlier|previous|discuss|discussed|remember|recall|mentioned)/i.test(task) || hasPidginRecallCue(task);
  const wantsWeb = /(search|google|web|news|latest|price|weather|stock|crypto|market)/i.test(task);
  const wantsStyle = /(style|tone|voice|sound like me|how i talk)/i.test(task) || hasPidginStyleCue(task);
  const wantsFacts = /(fact|birthday|prefer|likes|call me|remember about|profile)/i.test(task);
  const wantsConnectors = /(notes|calendar|email|docs|document|personal)/i.test(task);

  if (wantsRecall) {
    pushStep({ id: "recall", tool: "conversation_recall.query", reason: "Check if this was discussed before.", readOnly: true });
    pushStep({ id: "memory", tool: "memory.search", reason: "Pull concrete evidence snippets.", readOnly: true });
  }

  if (wantsFacts) {
    if (args.includeExtraction && args.threadIdProvided) {
      pushStep({
        id: "facts_extract",
        tool: "contact_memory.extract",
        reason: "Refresh contact memory facts from recent inbound messages.",
        readOnly: false,
      });
    }
    pushStep({
      id: "facts",
      tool: "contact_memory.facts",
      reason: "Load remembered contact facts.",
      readOnly: true,
      requiresTool: args.includeExtraction && args.threadIdProvided ? "contact_memory.extract" : undefined,
    });
  }

  if (wantsStyle) {
    pushStep({ id: "style", tool: "thread_style.profile", reason: "Use thread-specific writing style.", readOnly: true });
    if (args.candidateReply) {
      pushStep({
        id: "guardrail",
        tool: "reply_style_guardrail.check",
        reason: "Validate that draft sounds like you for this chat.",
        readOnly: true,
      });
    }
  }

  if (wantsWeb) {
    pushStep({ id: "web", tool: "external_search.web", reason: "Fetch up-to-date external info.", readOnly: true });
  }

  if (wantsConnectors) {
    pushStep({
      id: "connectors",
      tool: "personal_connectors.search",
      reason: "Search internal and connector sources.",
      readOnly: true,
    });
  }

  if (deterministicSteps.length === 0) {
    pushStep({ id: "memory", tool: "memory.search", reason: "Default retrieval for chat context.", readOnly: true });
  }

  const deduped: RouterStep[] = [];
  const seenTools = new Set<string>();
  for (const step of deterministicSteps) {
    if (seenTools.has(step.tool)) {
      continue;
    }
    seenTools.add(step.tool);
    deduped.push(step);
  }

  const hintTools =
    args.plannerMode === "hybrid"
      ? (args.modelHints || []).map(parseRouterHint).filter((tool): tool is RouterToolName => Boolean(tool))
      : [];
  const hintAllowlisted = hintTools.filter((tool) => HINT_ALLOWLIST_TOOLS.has(tool)).slice(0, 6);
  const merged = [...deduped];
  for (const hintTool of hintAllowlisted) {
    if (merged.some((step) => step.tool === hintTool)) {
      continue;
    }
    if (merged.length >= args.maxToolsPerRun) {
      break;
    }
    merged.push({
      id: `hint_${hintTool.replace(/[^\w]+/g, "_")}`,
      tool: hintTool,
      reason: "Model hint suggested this retrieval.",
      readOnly: true,
    });
  }

  const hintPriority = new Map(hintAllowlisted.map((tool, index) => [tool, index]));
  const mergedSorted = merged
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
    args.plannerMode === "hybrid" && mergedSorted.some((step, index) => deduped[index]?.tool !== step.tool);
  const signalCount = [wantsRecall, wantsWeb, wantsStyle, wantsFacts, wantsConnectors].filter(Boolean).length;
  const plannerConfidence = clamp(0.54 + signalCount * 0.08 + (hintApplied ? 0.04 : 0), 0.5, 0.96);
  return {
    steps: mergedSorted,
    plannerSource: hintApplied ? "hybrid" : "deterministic",
    plannerConfidence,
    hintApplied,
  };
}

function extractKeywords(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 2 && !STOPWORDS.has(word));
}

function wordCount(text: string) {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function escapeRegex(input: string) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function slugify(input: string, fallback = "item") {
  const normalized = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
  return normalized || fallback;
}

function parseDisplayDateToMs(value: string) {
  const cleaned = normalizeSpace(value.replace(/\u200e/g, "")).replace(",", "");
  const parts = cleaned.match(/^(\d{1,4})[\/-](\d{1,2})[\/-](\d{1,4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([APMapm]{2})?$/);
  if (!parts) {
    return undefined;
  }

  const first = Number(parts[1]);
  const second = Number(parts[2]);
  const third = Number(parts[3]);
  let year = third;
  let month = second;
  let day = first;

  if (parts[1].length === 4) {
    year = first;
    month = second;
    day = third;
  } else {
    if (third < 100) {
      year = third >= 70 ? 1900 + third : 2000 + third;
    }
    if (first <= 12 && second > 12) {
      month = first;
      day = second;
    } else if (first > 12 && second <= 12) {
      day = first;
      month = second;
    } else {
      day = first;
      month = second;
    }
  }

  let hour = Number(parts[4]);
  const minute = Number(parts[5]);
  const secondPart = Number(parts[6] || 0);
  const meridiem = (parts[7] || "").toUpperCase();

  if (meridiem === "PM" && hour < 12) {
    hour += 12;
  }
  if (meridiem === "AM" && hour === 12) {
    hour = 0;
  }

  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || secondPart > 59) {
    return undefined;
  }

  const ts = new Date(year, month - 1, day, hour, minute, secondPart).getTime();
  if (!Number.isFinite(ts)) {
    return undefined;
  }
  return ts;
}

function parseWhatsAppExportText(args: {
  text: string;
  ownerAliases: string[];
}): ParsedExportEntry[] {
  const lines = args.text.replace(/\r\n/g, "\n").split("\n");
  const ownerSet = new Set(args.ownerAliases.map((name) => normalizeSpace(name).toLowerCase()).filter(Boolean));

  const entries: ParsedExportEntry[] = [];
  let current: ParsedExportEntry | null = null;

  const pushCurrent = () => {
    if (!current) {
      return;
    }
    const cleanedText = current.text.trim();
    if (cleanedText) {
      entries.push({
        ...current,
        text: cleanedText,
      });
    }
    current = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\u200e/g, "").trimEnd();
    const bracketMatch = line.match(/^\[([^\]]+)\]\s([^:]{1,120}):\s([\s\S]*)$/);
    const dashMatch = line.match(/^([^\-]{6,50})\s-\s([^:]{1,120}):\s([\s\S]*)$/);

    if (bracketMatch || dashMatch) {
      const dateText = bracketMatch ? bracketMatch[1] : dashMatch?.[1] || "";
      const senderName = normalizeSpace((bracketMatch ? bracketMatch[2] : dashMatch?.[2]) || "Unknown");
      const body = (bracketMatch ? bracketMatch[3] : dashMatch?.[3]) || "";

      if (/(messages and calls are end-to-end encrypted|security code changed)/i.test(body)) {
        continue;
      }

      pushCurrent();

      const senderKey = senderName.toLowerCase();
      const direction = ownerSet.has(senderKey) ? "outbound" : "inbound";
      current = {
        senderName,
        text: body,
        messageAt: parseDisplayDateToMs(dateText),
        direction,
      };
      continue;
    }

    if (!current) {
      continue;
    }

    if (line.trim()) {
      current.text = `${current.text}\n${line}`;
    }
  }

  pushCurrent();
  return entries;
}

function buildSenderJid(args: {
  direction: "inbound" | "outbound";
  threadJid: string;
  senderJid?: string;
  senderName?: string;
  isGroup: boolean;
}) {
  if (args.senderJid) {
    return args.senderJid;
  }
  if (args.direction === "outbound") {
    return "me@s.whatsapp.net";
  }
  if (!args.isGroup) {
    return args.threadJid;
  }
  const nameToken = slugify(args.senderName || "participant", "participant");
  return `${nameToken}@s.whatsapp.net`;
}

async function resolveThreadByFilters(
  ctx: QueryCtx | MutationCtx,
  args: { threadId?: Id<"threads">; contactJid?: string },
): Promise<{ thread: ThreadRow | null; mismatch: boolean }> {
  let threadFromId: ThreadRow | null = null;
  if (args.threadId) {
    threadFromId = await ctx.db.get(args.threadId);
  }

  let threadFromJid: ThreadRow | null = null;
  if (args.contactJid) {
    threadFromJid = await ctx.db
      .query("threads")
      .withIndex("by_jid", (q) => q.eq("jid", args.contactJid as string))
      .first();
  }

  if (threadFromId && threadFromJid && threadFromId._id !== threadFromJid._id) {
    return { thread: null, mismatch: true };
  }

  return {
    thread: threadFromId || threadFromJid,
    mismatch: false,
  };
}

async function runMemorySearchCore(
  ctx: QueryCtx,
  args: {
    query: string;
    threadId?: Id<"threads">;
    contactJid?: string;
    direction?: "inbound" | "outbound";
    fromMessageAt?: number;
    toMessageAt?: number;
    limit?: number;
  },
): Promise<MemorySearchCoreResult> {
  const limit = clampRound(args.limit, 8, 1, 40);
  const queryText = normalizeSpace(args.query).slice(0, 280);
  const queryKeywords = Array.from(new Set(extractKeywords(queryText))).slice(0, 20);

  if (!queryText) {
    return {
      hits: [],
      candidateCount: 0,
      appliedFilters: {
        ...(args.threadId ? { threadId: args.threadId } : {}),
        ...(args.contactJid ? { contactJid: args.contactJid } : {}),
        ...(args.direction ? { direction: args.direction } : {}),
        ...(args.fromMessageAt ? { fromMessageAt: args.fromMessageAt } : {}),
        ...(args.toMessageAt ? { toMessageAt: args.toMessageAt } : {}),
      },
      queryKeywords,
    };
  }

  const resolved = await resolveThreadByFilters(ctx, {
    threadId: args.threadId,
    contactJid: args.contactJid,
  });
  if (resolved.mismatch) {
    return {
      hits: [],
      candidateCount: 0,
      appliedFilters: {
        ...(args.threadId ? { threadId: args.threadId } : {}),
        ...(args.contactJid ? { contactJid: args.contactJid } : {}),
      },
      queryKeywords,
    };
  }

  const candidateLimit = clampRound(limit * 8, 80, 20, 300);
  const sourceRows = resolved.thread
    ? await ctx.db
        .query("messages")
        .withSearchIndex("search_text", (q) => q.search("text", queryText).eq("threadId", resolved.thread!._id))
        .take(candidateLimit)
    : await ctx.db
        .query("messages")
        .withSearchIndex("search_text", (q) => q.search("text", queryText))
        .take(candidateLimit);

  const fromMessageAt = args.fromMessageAt;
  const toMessageAt = args.toMessageAt;
  const filteredRows = sourceRows.filter((row) => {
    if (args.direction && row.direction !== args.direction) {
      return false;
    }
    if (fromMessageAt !== undefined && row.messageAt < fromMessageAt) {
      return false;
    }
    if (toMessageAt !== undefined && row.messageAt > toMessageAt) {
      return false;
    }
    return true;
  });

  const candidateThreadIds = [...new Set(filteredRows.map((row) => row.threadId))].slice(0, 200);
  const threadRows = await Promise.all(candidateThreadIds.map(async (threadId) => await ctx.db.get(threadId)));
  const threadById = new Map<string, ThreadRow>();
  for (const thread of threadRows) {
    if (thread) {
      threadById.set(thread._id, thread);
    }
  }

  const newestAt = filteredRows.reduce((acc, row) => Math.max(acc, row.messageAt), 0);
  const hits = filteredRows
    .map((row) => {
      const rowKeywords = new Set(extractKeywords(row.text || ""));
      let overlap = 0;
      for (const keyword of queryKeywords) {
        if (rowKeywords.has(keyword)) {
          overlap += 1;
        }
      }
      const overlapScore = queryKeywords.length > 0 ? overlap / queryKeywords.length : 0;
      const recencyScore = newestAt > 0 ? row.messageAt / newestAt : 0;
      const score = overlapScore * 0.8 + recencyScore * 0.2;
      const thread = threadById.get(row.threadId);
      return {
        messageId: row._id,
        threadId: row.threadId,
        threadJid: thread?.jid || "",
        threadTitle: thread?.title,
        direction: row.direction,
        text: row.text,
        snippet: compactText(row.text, 220),
        messageAt: row.messageAt,
        origin: row.origin,
        score,
        overlapScore,
        recencyScore,
      } satisfies MemorySearchHit;
    })
    .sort((a, b) => b.score - a.score || b.messageAt - a.messageAt)
    .slice(0, limit);

  return {
    hits,
    candidateCount: filteredRows.length,
    appliedFilters: {
      ...(resolved.thread ? { threadId: resolved.thread._id, contactJid: resolved.thread.jid } : {}),
      ...(args.direction ? { direction: args.direction } : {}),
      ...(fromMessageAt ? { fromMessageAt } : {}),
      ...(toMessageAt ? { toMessageAt } : {}),
    },
    queryKeywords,
  };
}

async function resolveStyleProfileCore(
  ctx: QueryCtx | MutationCtx,
  args: {
    threadId?: Id<"threads">;
    contactJid?: string;
    fallbackToGlobal?: boolean;
  },
) {
  const fallbackToGlobal = args.fallbackToGlobal ?? true;
  const learnedEmojiProfile = (await ctx
    .runQuery(refStyleGetEmojiProfile, {})
    .catch(() => null)) as { topEmojis?: string[]; categoryHints?: string[] } | null;
  const resolved = await resolveThreadByFilters(ctx, args);
  if (resolved.mismatch) {
    throw new Error("threadId and contactJid point to different threads.");
  }

  if (resolved.thread) {
    const threadProfile = await ctx.db
      .query("styleProfiles")
      .withIndex("by_thread", (q) => q.eq("threadId", resolved.thread!._id))
      .first();
    if (threadProfile && threadProfile.scope === "thread") {
      return {
        source: "thread" as const,
        threadId: resolved.thread._id,
        threadJid: resolved.thread.jid,
        profile: withEmojiLearningHints(threadProfile, learnedEmojiProfile),
      };
    }
  }

  const globalProfile = await ctx.db
    .query("styleProfiles")
    .withIndex("by_scope", (q) => q.eq("scope", "global"))
    .first();

  if (globalProfile && fallbackToGlobal) {
    return {
      source: "global" as const,
      threadId: resolved.thread?._id,
      threadJid: resolved.thread?.jid,
      profile: withEmojiLearningHints(globalProfile, learnedEmojiProfile),
    };
  }

  return {
    source: "default" as const,
    threadId: resolved.thread?._id,
    threadJid: resolved.thread?.jid,
    profile: withEmojiLearningHints({
      scope: resolved.thread ? "thread" : "global",
      threadId: resolved.thread?._id,
      mimicryLevel: DEFAULT_MIMICRY_LEVEL,
      commonPhrases: [],
      punctuationStyle: [],
      humorNotes: [],
      spellingNotes: [],
      updatedAt: Date.now(),
    }, learnedEmojiProfile),
  };
}

function extractNgrams(text: string, minN = 2, maxN = 3) {
  const words = normalizeSpace(text.toLowerCase())
    .replace(/[^a-z0-9\s']/g, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 3 && !STOPWORDS.has(word));

  const ngrams: string[] = [];
  for (let n = minN; n <= maxN; n += 1) {
    for (let index = 0; index + n <= words.length; index += 1) {
      const gram = words.slice(index, index + n).join(" ");
      if (gram.length >= 8) {
        ngrams.push(gram);
      }
    }
  }
  return ngrams;
}

function isLowValuePhrase(phrase: string) {
  return LOW_VALUE_GENERIC_PHRASE_PATTERNS.some((pattern) => pattern.test(phrase));
}

function buildThreadStyleProfileFromMessages(args: {
  threadId: Id<"threads">;
  texts: string[];
}) {
  const cleanedTexts = args.texts.map((text) => normalizeSpace(text)).filter(Boolean);
  if (cleanedTexts.length === 0) {
    return {
      scope: "thread" as const,
      threadId: args.threadId,
      mimicryLevel: DEFAULT_MIMICRY_LEVEL,
      commonPhrases: [] as string[],
      punctuationStyle: ["Prefers short, practical messages."],
      humorNotes: [] as string[],
      spellingNotes: [] as string[],
      updatedAt: Date.now(),
    };
  }

  const wordsPerMessage = cleanedTexts.map((text) => wordCount(text));
  const avgWords = wordsPerMessage.reduce((sum, count) => sum + count, 0) / Math.max(wordsPerMessage.length, 1);
  const questionRate = cleanedTexts.filter((text) => text.includes("?")).length / cleanedTexts.length;
  const exclamationRate = cleanedTexts.filter((text) => text.includes("!")).length / cleanedTexts.length;
  const shortRate = wordsPerMessage.filter((count) => count <= 8).length / cleanedTexts.length;
  const contractionRate =
    cleanedTexts.filter((text) => /\b(i'm|don't|can't|won't|it's|you're|we're|that's|i'll|we'll|didn't)\b/i.test(text)).length /
    cleanedTexts.length;

  const phraseCounts = new Map<string, number>();
  for (const text of cleanedTexts) {
    for (const gram of extractNgrams(text)) {
      if (isLowValuePhrase(gram)) {
        continue;
      }
      phraseCounts.set(gram, (phraseCounts.get(gram) || 0) + 1);
    }
  }

  const commonPhrases = [...phraseCounts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, 12)
    .map(([phrase]) => phrase);

  const punctuationStyle: string[] = [];
  if (questionRate >= 0.3) {
    punctuationStyle.push("Often uses short follow-up questions.");
  }
  if (exclamationRate >= 0.18) {
    punctuationStyle.push("Uses occasional exclamation for emphasis.");
  }
  if (shortRate >= 0.55) {
    punctuationStyle.push("Keeps replies brief and direct.");
  }
  if (avgWords > 16) {
    punctuationStyle.push("Comfortable with longer explanations when needed.");
  }
  if (punctuationStyle.length === 0) {
    punctuationStyle.push("Prefers concise, plain punctuation.");
  }

  const humorNotes: string[] = [];
  if (cleanedTexts.some((text) => /\b(lol|haha|lmao|banter|joke|meme|dead)\b/i.test(text))) {
    humorNotes.push("Natural humor is fine when context is playful.");
  }
  if (cleanedTexts.some((text) => /[😂🤣😅😄😁]/u.test(text))) {
    humorNotes.push("Sometimes signals humor with laughter-style emoji.");
  }

  const spellingNotes: string[] = [];
  if (contractionRate >= 0.3) {
    spellingNotes.push("Uses contractions heavily.");
  } else {
    spellingNotes.push("Uses cleaner full-word spelling.");
  }
  if (cleanedTexts.some((text) => /\bu\b/i.test(text))) {
    spellingNotes.push("Sometimes uses short-form texting abbreviations.");
  }

  const mimicryLevel = clamp(0.58 + shortRate * 0.14 + contractionRate * 0.1 + (humorNotes.length > 0 ? 0.04 : 0), 0.45, 0.82);

  return {
    scope: "thread" as const,
    threadId: args.threadId,
    mimicryLevel,
    commonPhrases,
    punctuationStyle,
    humorNotes,
    spellingNotes,
    updatedAt: Date.now(),
  };
}

function extractFactsFromText(text: string) {
  const normalized = normalizeSpace(text);
  const facts: Array<{ key: string; value: string; type: ContactMemoryFactType; confidence: number }> = [];

  const birthday = normalized.match(/\bmy birthday is\s+([^.!,\n]{3,60})/i);
  if (birthday) {
    facts.push({
      key: "profile_birthday",
      value: birthday[1].trim(),
      type: "profile",
      confidence: 0.78,
    });
  }

  const preferredName = normalized.match(/\bcall me\s+([a-z][a-z0-9_'-]{1,30})/i);
  if (preferredName) {
    facts.push({
      key: "profile_preferred_name",
      value: preferredName[1].trim(),
      type: "profile",
      confidence: 0.86,
    });
  }

  const likes = normalized.match(/\bi\s+(?:really\s+)?(?:like|love|prefer)\s+([^.!,\n]{3,80})/i);
  if (likes) {
    const value = likes[1].trim();
    facts.push({
      key: `preference_${slugify(value, "item")}`,
      value,
      type: "preference",
      confidence: 0.66,
    });
  }

  const workAt = normalized.match(/\bi\s+(?:work at|work with|am at|m at)\s+([^.!,\n]{2,80})/i);
  if (workAt) {
    facts.push({
      key: "profile_work",
      value: workAt[1].trim(),
      type: "profile",
      confidence: 0.62,
    });
  }

  const livesIn = normalized.match(/\bi\s+(?:live in|am in|m in)\s+([^.!,\n]{2,80})/i);
  if (livesIn) {
    facts.push({
      key: "profile_location",
      value: livesIn[1].trim(),
      type: "profile",
      confidence: 0.62,
    });
  }

  const schedule = normalized.match(/\bi\s*(?:am|'m)?\s*(?:free|busy)\s+(?:on|after|before|around)\s+([^.!,\n]{2,80})/i);
  if (schedule) {
    facts.push({
      key: `schedule_${slugify(schedule[1], "window")}`,
      value: schedule[1].trim(),
      type: "schedule",
      confidence: 0.6,
    });
  }

  return facts;
}

async function fetchJsonWithTimeout(url: string, timeoutMs: number, init?: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers || {}),
      },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function runExternalWebSearchCore(args: { query: string; maxResults: number }) {
  const query = normalizeSpace(args.query);
  const maxResults = clampRound(args.maxResults, 5, 1, 10);
  const results: Array<{
    title: string;
    snippet: string;
    url: string;
    source: string;
    confidence: number;
  }> = [];
  const warnings: string[] = [];
  const seenUrls = new Set<string>();

  const addResult = (item: { title?: string; snippet?: string; url?: string; source: string; confidence: number }) => {
    const title = normalizeSpace(item.title || "");
    const snippet = compactText(item.snippet || "", 260);
    const url = (item.url || "").trim();
    if (!title || !url || seenUrls.has(url)) {
      return;
    }
    seenUrls.add(url);
    results.push({
      title,
      snippet,
      url,
      source: item.source,
      confidence: clamp(item.confidence, 0, 1),
    });
  };

  const serpApiKey = process.env.SERPAPI_API_KEY?.trim();
  if (serpApiKey) {
    try {
      const data = (await fetchJsonWithTimeout(
        `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(query)}&num=${maxResults}&api_key=${encodeURIComponent(serpApiKey)}`,
        10_000,
      )) as {
        organic_results?: Array<{ title?: string; snippet?: string; link?: string }>;
      };

      for (const row of data.organic_results || []) {
        addResult({
          title: row.title,
          snippet: row.snippet,
          url: row.link,
          source: "serpapi",
          confidence: 0.74,
        });
      }
    } catch (error) {
      warnings.push(`serpapi_failed:${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (results.length < maxResults) {
    try {
      const ddg = (await fetchJsonWithTimeout(
        `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&no_redirect=1&skip_disambig=1`,
        8_000,
      )) as {
        Heading?: string;
        AbstractText?: string;
        AbstractURL?: string;
        RelatedTopics?: Array<{ Text?: string; FirstURL?: string; Topics?: Array<{ Text?: string; FirstURL?: string }> }>;
      };

      if (ddg.AbstractText && ddg.AbstractURL) {
        addResult({
          title: ddg.Heading || query,
          snippet: ddg.AbstractText,
          url: ddg.AbstractURL,
          source: "duckduckgo",
          confidence: 0.61,
        });
      }

      const flattenedTopics: Array<{ Text?: string; FirstURL?: string }> = [];
      for (const topic of ddg.RelatedTopics || []) {
        if (Array.isArray(topic.Topics)) {
          flattenedTopics.push(...topic.Topics);
        } else {
          flattenedTopics.push(topic);
        }
      }
      for (const topic of flattenedTopics.slice(0, maxResults * 2)) {
        addResult({
          title: topic.Text,
          snippet: topic.Text,
          url: topic.FirstURL,
          source: "duckduckgo",
          confidence: 0.54,
        });
      }
    } catch (error) {
      warnings.push(`duckduckgo_failed:${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (results.length < maxResults) {
    try {
      const wiki = (await fetchJsonWithTimeout(
        `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=${maxResults}&namespace=0&format=json`,
        8_000,
      )) as [string, string[], string[], string[]];
      const titles = Array.isArray(wiki?.[1]) ? wiki[1] : [];
      const descriptions = Array.isArray(wiki?.[2]) ? wiki[2] : [];
      const urls = Array.isArray(wiki?.[3]) ? wiki[3] : [];

      for (let index = 0; index < titles.length; index += 1) {
        addResult({
          title: titles[index],
          snippet: descriptions[index],
          url: urls[index],
          source: "wikipedia",
          confidence: 0.58,
        });
      }
    } catch (error) {
      warnings.push(`wikipedia_failed:${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    provider: serpApiKey ? "serpapi+fallback" : "public_fallback",
    results: results.slice(0, maxResults),
    warnings,
  };
}

export const historyBackfillImport = action({
  args: {
    threadJid: v.string(),
    isGroup: v.optional(v.boolean()),
    ownerAliases: v.optional(v.array(v.string())),
    exportText: v.optional(v.string()),
    entries: v.optional(
      v.array(
        v.object({
          threadJid: v.optional(v.string()),
          senderJid: v.optional(v.string()),
          senderTitle: v.optional(v.string()),
          text: v.string(),
          messageAt: v.optional(v.number()),
          direction: v.optional(v.union(v.literal("inbound"), v.literal("outbound"))),
          whatsappMessageId: v.optional(v.string()),
        }),
      ),
    ),
    maxEntries: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const isGroup = args.isGroup ?? args.threadJid.endsWith("@g.us");
    const ownerAliases = ["me", ...(args.ownerAliases || [])]
      .map((value) => normalizeSpace(value).toLowerCase())
      .filter(Boolean)
      .slice(0, 20);

    const parsedRows = args.exportText
      ? parseWhatsAppExportText({
          text: args.exportText,
          ownerAliases,
        })
      : [];

    const entryRows = (args.entries || []).map((entry) => ({
      threadJid: entry.threadJid || args.threadJid,
      senderJid: entry.senderJid,
      senderTitle: entry.senderTitle,
      text: entry.text,
      messageAt: entry.messageAt,
      direction: entry.direction || "inbound",
      whatsappMessageId: entry.whatsappMessageId,
    }));

    const combinedRows = [
      ...parsedRows.map((row) => ({
        threadJid: args.threadJid,
        senderJid: undefined,
        senderTitle: row.senderName,
        text: row.text,
        messageAt: row.messageAt,
        direction: row.direction,
        whatsappMessageId: undefined,
      })),
      ...entryRows,
    ].filter((row) => normalizeSpace(row.text).length > 0);

    const maxEntries = clampRound(args.maxEntries, 120, 1, 400);
    const selected = combinedRows.slice(0, maxEntries);

    let inserted = 0;
    let duplicates = 0;
    const failures: string[] = [];
    let firstMessageAt: number | null = null;
    let lastMessageAt: number | null = null;

    for (const row of selected) {
      const targetThreadJid = row.threadJid || args.threadJid;
      const senderJid = buildSenderJid({
        direction: row.direction,
        threadJid: targetThreadJid,
        senderJid: row.senderJid,
        senderName: row.senderTitle,
        isGroup,
      });

      try {
        const result = (await ctx.runMutation(refIngestHistorical, {
          ingestMode: "history_sync",
          direction: row.direction,
          threadJid: targetThreadJid,
          senderJid,
          senderTitle: row.senderTitle,
          text: row.text,
          isGroup,
          threadKind: classifyThreadKind({
            jid: targetThreadJid,
            isGroupHint: isGroup,
          }),
          whatsappMessageId: row.whatsappMessageId,
          messageAt: row.messageAt,
        })) as { duplicate: boolean };

        if (result.duplicate) {
          duplicates += 1;
        } else {
          inserted += 1;
        }

        if (row.messageAt) {
          firstMessageAt = firstMessageAt === null ? row.messageAt : Math.min(firstMessageAt, row.messageAt);
          lastMessageAt = lastMessageAt === null ? row.messageAt : Math.max(lastMessageAt, row.messageAt);
        }
      } catch (error) {
        failures.push(error instanceof Error ? error.message.slice(0, 180) : String(error).slice(0, 180));
      }
    }

    return {
      imported: inserted,
      duplicates,
      failed: failures.length,
      failureSamples: failures.slice(0, 8),
      parsedFromExport: parsedRows.length,
      submittedEntries: entryRows.length,
      processedEntries: selected.length,
      remainingEntries: Math.max(0, combinedRows.length - selected.length),
      firstMessageAt,
      lastMessageAt,
    };
  },
});

export const memorySearch = query({
  args: {
    query: v.string(),
    threadId: v.optional(v.id("threads")),
    contactJid: v.optional(v.string()),
    direction: v.optional(v.union(v.literal("inbound"), v.literal("outbound"))),
    fromMessageAt: v.optional(v.number()),
    toMessageAt: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const result = await runMemorySearchCore(ctx, args);
    return {
      ...result,
      tool: "memory.search",
    };
  },
});

export const getThreadStyleProfile = query({
  args: {
    threadId: v.optional(v.id("threads")),
    contactJid: v.optional(v.string()),
    fallbackToGlobal: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    return await resolveStyleProfileCore(ctx, args);
  },
});

export const rebuildThreadStyleProfile = mutation({
  args: {
    threadId: v.id("threads"),
    lookbackMessages: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const thread = await ctx.db.get(args.threadId);
    if (!thread) {
      throw new Error("Thread not found.");
    }

    const lookback = clampRound(args.lookbackMessages, 180, 20, 400);
    const rows = await ctx.db
      .query("messages")
      .withIndex("by_thread_messageAt", (q) => q.eq("threadId", args.threadId))
      .order("desc")
      .take(lookback);

    const outboundTexts = rows
      .filter((row) => isManualSelfAuthoredMessage(row))
      .map((row) => row.text)
      .filter(Boolean);

    const profile = buildThreadStyleProfileFromMessages({
      threadId: args.threadId,
      texts: outboundTexts,
    });

    const existing = await ctx.db
      .query("styleProfiles")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .first();

    const now = Date.now();
    if (existing && existing.scope === "thread") {
      await ctx.db.insert("styleProfileHistory", {
        scope: existing.scope,
        threadId: existing.threadId,
        mimicryLevel: existing.mimicryLevel,
        commonPhrases: existing.commonPhrases || [],
        punctuationStyle: existing.punctuationStyle || [],
        humorNotes: existing.humorNotes || [],
        spellingNotes: existing.spellingNotes || [],
        reason: "pre-thread-style-rebuild",
        createdAt: now,
      });
      await ctx.db.patch(existing._id, {
        mimicryLevel: profile.mimicryLevel,
        commonPhrases: profile.commonPhrases,
        punctuationStyle: profile.punctuationStyle,
        humorNotes: profile.humorNotes,
        spellingNotes: profile.spellingNotes,
        updatedAt: now,
      });
      return {
        threadId: thread._id,
        threadJid: thread.jid,
        profile: {
          ...profile,
          updatedAt: now,
        },
      };
    }

    await ctx.db.insert("styleProfiles", {
      ...profile,
      scope: "thread",
      updatedAt: now,
    });

    return {
      threadId: thread._id,
      threadJid: thread.jid,
      profile: {
        ...profile,
        updatedAt: now,
      },
    };
  },
});

export const contactMemoryFactsList = query({
  args: {
    threadId: v.optional(v.id("threads")),
    contactJid: v.optional(v.string()),
    factType: v.optional(
      v.union(
        v.literal("preference"),
        v.literal("profile"),
        v.literal("schedule"),
        v.literal("relationship"),
        v.literal("promise"),
        v.literal("other"),
      ),
    ),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const resolved = await resolveThreadByFilters(ctx, args);
    if (resolved.mismatch) {
      throw new Error("threadId and contactJid point to different threads.");
    }
    if (!resolved.thread) {
      return {
        tool: "contact_memory.facts",
        facts: [],
      };
    }

    const limit = clampRound(args.limit, 60, 1, 200);
    const rows = args.factType
      ? await ctx.db
          .query("contactMemoryFacts")
          .withIndex("by_thread_and_type_and_updatedAt", (q) => q.eq("threadId", resolved.thread!._id).eq("factType", args.factType!))
          .order("desc")
          .take(limit)
      : await ctx.db
          .query("contactMemoryFacts")
          .withIndex("by_thread_and_updatedAt", (q) => q.eq("threadId", resolved.thread!._id))
          .order("desc")
          .take(limit);

    return {
      tool: "contact_memory.facts",
      threadId: resolved.thread._id,
      threadJid: resolved.thread.jid,
      facts: rows,
    };
  },
});

export const upsertContactMemoryFact = mutation({
  args: {
    threadId: v.optional(v.id("threads")),
    contactJid: v.optional(v.string()),
    factKey: v.string(),
    factValue: v.string(),
    factType: v.union(
      v.literal("preference"),
      v.literal("profile"),
      v.literal("schedule"),
      v.literal("relationship"),
      v.literal("promise"),
      v.literal("other"),
    ),
    confidence: v.optional(v.number()),
    sourceMessageId: v.optional(v.id("messages")),
    sourceMessageAt: v.optional(v.number()),
    sourceExcerpt: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const resolved = await resolveThreadByFilters(ctx, args);
    if (resolved.mismatch) {
      throw new Error("threadId and contactJid point to different threads.");
    }
    if (!resolved.thread) {
      throw new Error("Could not resolve thread for contact memory fact.");
    }

    const factKey = slugify(args.factKey, "fact");
    const factValue = normalizeSpace(args.factValue).slice(0, 320);
    if (!factValue) {
      throw new Error("factValue cannot be empty.");
    }

    const now = Date.now();
    const confidence = clamp(args.confidence ?? 0.6, 0, 1);
    const existing = await ctx.db
      .query("contactMemoryFacts")
      .withIndex("by_thread_and_key", (q) => q.eq("threadId", resolved.thread!._id).eq("factKey", factKey))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        factValue,
        factType: args.factType,
        confidence,
        sourceMessageId: args.sourceMessageId,
        sourceMessageAt: args.sourceMessageAt,
        sourceExcerpt: args.sourceExcerpt ? compactText(args.sourceExcerpt, 220) : existing.sourceExcerpt,
        updatedAt: now,
      });
      return existing._id;
    }

    return await ctx.db.insert("contactMemoryFacts", {
      threadId: resolved.thread._id,
      factKey,
      factValue,
      factType: args.factType,
      confidence,
      sourceMessageId: args.sourceMessageId,
      sourceMessageAt: args.sourceMessageAt,
      sourceExcerpt: args.sourceExcerpt ? compactText(args.sourceExcerpt, 220) : undefined,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const extractContactMemoryFacts = mutation({
  args: {
    threadId: v.id("threads"),
    lookbackMessages: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const thread = await ctx.db.get(args.threadId);
    if (!thread) {
      throw new Error("Thread not found.");
    }

    const lookback = clampRound(args.lookbackMessages, 120, 20, 300);
    const rows = await ctx.db
      .query("messages")
      .withIndex("by_thread_messageAt", (q) => q.eq("threadId", args.threadId))
      .order("desc")
      .take(lookback);

    let inserted = 0;
    let updated = 0;

    for (const row of rows) {
      if (row.direction !== "inbound") {
        continue;
      }
      const facts = extractFactsFromText(row.text || "");
      for (const fact of facts) {
        const existing = await ctx.db
          .query("contactMemoryFacts")
          .withIndex("by_thread_and_key", (q) => q.eq("threadId", args.threadId).eq("factKey", fact.key))
          .first();

        const patch = {
          factValue: fact.value,
          factType: fact.type,
          confidence: fact.confidence,
          sourceMessageId: row._id,
          sourceMessageAt: row.messageAt,
          sourceExcerpt: compactText(row.text || "", 220),
          updatedAt: Date.now(),
        };

        if (existing) {
          await ctx.db.patch(existing._id, patch);
          updated += 1;
        } else {
          await ctx.db.insert("contactMemoryFacts", {
            threadId: args.threadId,
            factKey: fact.key,
            ...patch,
            createdAt: Date.now(),
          });
          inserted += 1;
        }
      }
    }

    return {
      threadId: thread._id,
      threadJid: thread.jid,
      inserted,
      updated,
    };
  },
});

export const conversationRecallQuery = query({
  args: {
    query: v.string(),
    threadId: v.optional(v.id("threads")),
    contactJid: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = clampRound(args.limit, 6, 1, 12);
    const result = await runMemorySearchCore(ctx, {
      query: args.query,
      threadId: args.threadId,
      contactJid: args.contactJid,
      limit,
    });

    const top = result.hits[0];
    const confidence = top ? clamp(top.score, 0, 1) : 0;
    const hasStrongEvidence = confidence >= 0.35;
    const hasWeakEvidence = confidence >= 0.18;

    const answer = !top
      ? "No clear prior discussion found in the available chat history."
      : hasStrongEvidence
        ? "Yes, this looks like something you discussed before."
        : hasWeakEvidence
          ? "Possibly. There are related mentions, but evidence is moderate."
          : "No strong evidence yet. I found only weakly related mentions.";

    const includesPreActivation = result.hits.some((hit) => hit.origin === "history_fetch" || hit.origin === "history_sync");

    return {
      tool: "conversation_recall.query",
      answer,
      confidence,
      includesPreActivation,
      evidence: result.hits.slice(0, limit).map((hit) => ({
        messageId: hit.messageId,
        threadId: hit.threadId,
        threadJid: hit.threadJid,
        threadTitle: hit.threadTitle,
        speaker: hit.direction === "inbound" ? "Them" : "Me",
        text: hit.snippet,
        messageAt: hit.messageAt,
        origin: hit.origin,
        score: hit.score,
      })),
      queryKeywords: result.queryKeywords,
      candidateCount: result.candidateCount,
    };
  },
});

export const externalWebSearch = action({
  args: {
    query: v.string(),
    maxResults: v.optional(v.number()),
  },
  handler: async (_ctx, args) => {
    const query = normalizeSpace(args.query).slice(0, 240);
    if (!query) {
      return {
        tool: "external_search.web",
        provider: "none",
        results: [],
        warnings: ["empty_query"],
      };
    }

    const search = await runExternalWebSearchCore({
      query,
      maxResults: clampRound(args.maxResults, 5, 1, 10),
    });

    return {
      tool: "external_search.web",
      query,
      ...search,
    };
  },
});

export const personalConnectorsInternalSearch = query({
  args: {
    query: v.string(),
    maxResults: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const query = normalizeSpace(args.query).slice(0, 240);
    const keywords = extractKeywords(query);
    const maxResults = clampRound(args.maxResults, 12, 1, 30);

    const todos = await ctx.db
      .query("todos")
      .withIndex("by_status", (q) => q.eq("status", "open"))
      .take(180);
    const followups = await ctx.db
      .query("followUps")
      .withIndex("by_dueAt")
      .order("desc")
      .take(180);
    const threadMemory = await ctx.db.query("threadMemory").take(140);
    const facts = await ctx.db
      .query("contactMemoryFacts")
      .withIndex("by_updatedAt")
      .order("desc")
      .take(180);

    const scored: Array<{
      source: "todos" | "followups" | "thread_memory" | "contact_facts";
      id: string;
      title: string;
      snippet: string;
      score: number;
      threadId?: Id<"threads">;
      updatedAt?: number;
    }> = [];

    const scoreText = (text: string, boost = 0) => {
      const normalized = normalizeSpace(text).toLowerCase();
      const tokenSet = new Set(extractKeywords(normalized));
      let overlap = 0;
      for (const keyword of keywords) {
        if (tokenSet.has(keyword)) {
          overlap += 1;
        }
      }
      const overlapScore = keywords.length > 0 ? overlap / keywords.length : 0;
      const includesRaw = normalized.includes(query.toLowerCase()) ? 0.25 : 0;
      return overlapScore + includesRaw + boost;
    };

    for (const todo of todos) {
      const score = scoreText(todo.title || "");
      if (score <= 0) {
        continue;
      }
      scored.push({
        source: "todos",
        id: String(todo._id),
        title: todo.title,
        snippet: compactText(todo.title, 180),
        score,
        threadId: todo.threadId,
        updatedAt: todo.updatedAt,
      });
    }

    for (const followup of followups) {
      const score = scoreText(`${followup.reason} ${followup.draftText}`);
      if (score <= 0) {
        continue;
      }
      scored.push({
        source: "followups",
        id: String(followup._id),
        title: followup.reason,
        snippet: compactText(followup.draftText || followup.reason, 180),
        score,
        threadId: followup.threadId,
        updatedAt: followup.updatedAt,
      });
    }

    for (const memory of threadMemory) {
      const score = scoreText(`${memory.summary} ${(memory.styleNotes || []).join(" ")}`);
      if (score <= 0) {
        continue;
      }
      scored.push({
        source: "thread_memory",
        id: String(memory._id),
        title: "Thread memory",
        snippet: compactText(memory.summary || (memory.styleNotes || []).join(" | "), 180),
        score,
        threadId: memory.threadId,
        updatedAt: memory.updatedAt,
      });
    }

    for (const fact of facts) {
      const score = scoreText(`${fact.factKey} ${fact.factValue}`);
      if (score <= 0) {
        continue;
      }
      scored.push({
        source: "contact_facts",
        id: String(fact._id),
        title: fact.factKey,
        snippet: compactText(fact.factValue, 180),
        score,
        threadId: fact.threadId,
        updatedAt: fact.updatedAt,
      });
    }

    const hits = scored
      .sort((a, b) => b.score - a.score || (b.updatedAt || 0) - (a.updatedAt || 0))
      .slice(0, maxResults);

    return {
      tool: "personal_connectors.search",
      query,
      hits,
    };
  },
});

export const personalConnectorsSearch = action({
  args: {
    query: v.string(),
    maxResults: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const query = normalizeSpace(args.query).slice(0, 240);
    const maxResults = clampRound(args.maxResults, 12, 1, 30);
    const internal = (await ctx.runQuery(refPersonalConnectorsInternalSearch, {
      query,
      maxResults,
    })) as {
      hits: Array<{
        source: string;
        id: string;
        title: string;
        snippet: string;
        score: number;
        threadId?: string;
        updatedAt?: number;
      }>;
    };

    const endpointEnv = process.env.PERSONAL_CONNECTOR_ENDPOINTS || "";
    const endpoints = endpointEnv
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 5);

    const externalHits: Array<{
      source: string;
      title: string;
      snippet: string;
      url?: string;
      score: number;
    }> = [];
    const endpointErrors: string[] = [];

    for (const endpoint of endpoints) {
      try {
        const payload = (await fetchJsonWithTimeout(endpoint, 8_000, {
          method: "POST",
          body: JSON.stringify({ query, maxResults: Math.max(2, Math.min(maxResults, 8)) }),
        })) as { hits?: Array<{ title?: string; snippet?: string; url?: string; score?: number }> };

        for (const hit of payload.hits || []) {
          if (!hit.title) {
            continue;
          }
          externalHits.push({
            source: endpoint,
            title: normalizeSpace(hit.title),
            snippet: compactText(hit.snippet || "", 220),
            url: hit.url,
            score: clamp(hit.score ?? 0.5, 0, 1),
          });
        }
      } catch (error) {
        endpointErrors.push(`${endpoint}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return {
      tool: "personal_connectors.search",
      query,
      internalHits: (internal.hits || []).slice(0, maxResults),
      externalHits: externalHits.sort((a, b) => b.score - a.score).slice(0, maxResults),
      endpointErrors: endpointErrors.slice(0, 8),
    };
  },
});

export const replyStyleGuardrailCheck = query({
  args: {
    threadId: v.optional(v.id("threads")),
    candidateReply: v.string(),
    inboundText: v.optional(v.string()),
    strictness: v.optional(v.union(v.literal("strict"), v.literal("balanced"), v.literal("relaxed"))),
  },
  handler: async (ctx, args) => {
    const strictness = args.strictness || "balanced";
    const candidate = normalizeSpace(args.candidateReply).slice(0, 600);
    const inbound = normalizeSpace(args.inboundText || "");

    const profileBundle = await resolveStyleProfileCore(ctx, {
      threadId: args.threadId,
      fallbackToGlobal: true,
    });
    const profile = profileBundle.profile as ThreadStyleProfilePayload;

    const recentOutbound = args.threadId
      ? await ctx.db
          .query("messages")
          .withIndex("by_thread_messageAt", (q) => q.eq("threadId", args.threadId as Id<"threads">))
          .order("desc")
          .take(24)
      : [];

    const outboundTexts = recentOutbound
      .filter((row) => isManualSelfAuthoredMessage(row))
      .map((row) => normalizeSpace(row.text))
      .filter(Boolean);
    const avgOutboundWords =
      outboundTexts.length > 0
        ? outboundTexts.reduce((sum, text) => sum + wordCount(text), 0) / outboundTexts.length
        : 10;

    const phraseMatches = (profile.commonPhrases || []).filter((phrase) =>
      new RegExp(`\\b${escapeRegex(phrase)}\\b`, "i").test(candidate),
    ).length;
    const phraseAlignment = profile.commonPhrases?.length ? clamp(phraseMatches / Math.min(profile.commonPhrases.length, 3), 0, 1) : 0.7;

    const candidateWords = wordCount(candidate);
    const lengthFit = clamp(1 - Math.abs(candidateWords - avgOutboundWords) / Math.max(avgOutboundWords, 8), 0, 1);

    const candidateKeywordSet = new Set(extractKeywords(candidate));
    const inboundKeywordSet = new Set(extractKeywords(inbound));
    let sharedWithInbound = 0;
    for (const token of candidateKeywordSet) {
      if (inboundKeywordSet.has(token)) {
        sharedWithInbound += 1;
      }
    }
    const contextSpecificity = inboundKeywordSet.size > 0 ? clamp(sharedWithInbound / Math.max(1, Math.min(inboundKeywordSet.size, 4)), 0, 1) : 0.72;

    let lexicalSimilarity = 0;
    for (const text of outboundTexts.slice(0, 8)) {
      const textTokens = new Set(extractKeywords(text));
      let intersection = 0;
      for (const token of candidateKeywordSet) {
        if (textTokens.has(token)) {
          intersection += 1;
        }
      }
      const unionSize = new Set([...candidateKeywordSet, ...textTokens]).size;
      const similarity = unionSize > 0 ? intersection / unionSize : 0;
      lexicalSimilarity = Math.max(lexicalSimilarity, similarity);
    }

    const lowValuePenalty =
      LOW_VALUE_REPLY_PATTERNS.some((pattern) => pattern.test(candidate)) ||
      LOW_VALUE_GENERIC_PHRASE_PATTERNS.some((pattern) => pattern.test(candidate))
        ? 1
        : 0;
    const antiGeneric = lowValuePenalty ? 0.08 : 1;

    const score = clamp(
      phraseAlignment * 0.24 +
        contextSpecificity * 0.24 +
        lengthFit * 0.2 +
        lexicalSimilarity * 0.2 +
        antiGeneric * 0.12,
      0,
      1,
    );

    const threshold = strictness === "strict" ? 0.74 : strictness === "relaxed" ? 0.5 : 0.62;
    const passed = score >= threshold;

    const rewriteHints: string[] = [];
    if (antiGeneric < 0.2) {
      rewriteHints.push("Avoid canned wording; use a concrete detail from the latest message.");
    }
    if (lengthFit < 0.45) {
      rewriteHints.push("Match typical length for this chat (usually shorter and direct).");
    }
    if (contextSpecificity < 0.45) {
      rewriteHints.push("Reference the exact topic or request from the inbound message.");
    }
    if (phraseAlignment < 0.25 && (profile.commonPhrases || []).length > 0) {
      rewriteHints.push("Use one natural phrase common to this thread without forcing it.");
    }

    return {
      tool: "reply_style_guardrail.check",
      passed,
      score,
      threshold,
      strictness,
      sourceProfile: profileBundle.source,
      checks: {
        phraseAlignment,
        contextSpecificity,
        lengthFit,
        lexicalSimilarity,
        antiGeneric,
      },
      rewriteHints,
    };
  },
});

export const toolRouterPlan = action({
  args: {
    task: v.string(),
    threadId: v.optional(v.id("threads")),
    contactJid: v.optional(v.string()),
    candidateReply: v.optional(v.string()),
    execute: v.optional(v.boolean()),
    plannerMode: v.optional(v.union(v.literal("deterministic"), v.literal("hybrid"))),
    modelHints: v.optional(v.array(v.string())),
    allowSideEffects: v.optional(v.boolean()),
    includeExtraction: v.optional(v.boolean()),
    maxToolsPerRun: v.optional(v.number()),
    timeoutMs: v.optional(v.number()),
    maxResults: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const task = normalizeSpace(args.task).slice(0, 320);
    const plannerMode = args.plannerMode === "deterministic" ? "deterministic" : "hybrid";
    const allowSideEffects = Boolean(args.allowSideEffects);
    const includeExtraction = Boolean(args.includeExtraction);
    const maxToolsPerRun = clampRound(args.maxToolsPerRun, 6, 1, 12);
    const timeoutMs = clampRound(args.timeoutMs, 8_000, 500, 30_000);
    const maxResults = clampRound(args.maxResults, 8, 1, 40);
    const planned = planToolRouterSteps({
      task,
      candidateReply: args.candidateReply,
      threadIdProvided: Boolean(args.threadId),
      plannerMode,
      modelHints: args.modelHints,
      includeExtraction,
      maxToolsPerRun,
    });
    const mergedSorted = planned.steps;
    const hintApplied = planned.hintApplied;
    const plannerConfidence = planned.plannerConfidence;
    const execute = args.execute ?? false;
    if (!execute) {
      return {
        tool: "tool_router.plan",
        task,
        plannerSource: planned.plannerSource,
        plannerConfidence,
        hintApplied,
        steps: mergedSorted,
        toolBudgets: {
          timeoutMs,
          maxToolsPerRun,
          maxResults,
          allowSideEffects,
        },
      };
    }

    const deadlineAt = Date.now() + timeoutMs * Math.max(1, mergedSorted.length) + 1_500;
    const outputs: RouterStepEnvelope[] = [];
    const completedTools = new Set<RouterToolName>();
    const pending = [...mergedSorted];

    const executeOne = async (step: RouterStep): Promise<RouterStepEnvelope> => {
      const startedAt = Date.now();
      if (step.requiresTool && !completedTools.has(step.requiresTool)) {
        return {
          stepId: step.id,
          tool: step.tool,
          status: "skipped",
          latencyMs: Date.now() - startedAt,
          output: null,
          outputSize: 0,
          outputSummary: `Skipped: requires ${step.requiresTool}`,
          errorCode: "dependency_missing",
        };
      }

      if (!allowSideEffects && !step.readOnly) {
        return {
          stepId: step.id,
          tool: step.tool,
          status: "skipped",
          latencyMs: Date.now() - startedAt,
          output: null,
          outputSize: 0,
          outputSummary: "Skipped: side effects disabled.",
          errorCode: "side_effects_disabled",
        };
      }

      if (Date.now() >= deadlineAt) {
        return {
          stepId: step.id,
          tool: step.tool,
          status: "timeout",
          latencyMs: Date.now() - startedAt,
          output: null,
          outputSize: 0,
          outputSummary: "Skipped: global deadline exceeded.",
          errorCode: "timeout",
        };
      }

      try {
        const perStepTimeout = Math.max(250, Math.min(timeoutMs, deadlineAt - Date.now()));
        let output: unknown = null;

        if (step.tool === "conversation_recall.query") {
          output = await withTimeout(
            ctx.runQuery(refConversationRecallQuery, {
              query: task,
              threadId: args.threadId,
              contactJid: args.contactJid,
              limit: Math.max(1, Math.min(maxResults, 12)),
            }),
            perStepTimeout,
          );
        } else if (step.tool === "memory.search") {
          output = await withTimeout(
            ctx.runQuery(refMemorySearch, {
              query: task,
              threadId: args.threadId,
              contactJid: args.contactJid,
              limit: maxResults,
            }),
            perStepTimeout,
          );
        } else if (step.tool === "thread_style.profile") {
          output = await withTimeout(
            ctx.runQuery(refGetThreadStyleProfile, {
              threadId: args.threadId,
              contactJid: args.contactJid,
              fallbackToGlobal: true,
            }),
            perStepTimeout,
          );
        } else if (step.tool === "contact_memory.extract") {
          if (!args.threadId) {
            output = { skipped: true, reason: "threadId_missing" };
          } else {
            output = await withTimeout(
              ctx.runMutation(refExtractContactMemoryFacts, {
                threadId: args.threadId,
                lookbackMessages: 120,
              }),
              perStepTimeout,
            );
          }
        } else if (step.tool === "contact_memory.facts") {
          output = await withTimeout(
            ctx.runQuery(refContactMemoryFactsList, {
              threadId: args.threadId,
              contactJid: args.contactJid,
              limit: Math.max(1, Math.min(maxResults * 5, 200)),
            }),
            perStepTimeout,
          );
        } else if (step.tool === "external_search.web") {
          output = await withTimeout(
            ctx.runAction(refExternalWebSearch, {
              query: task,
              maxResults: Math.max(1, Math.min(maxResults, 10)),
            }),
            perStepTimeout,
          );
        } else if (step.tool === "personal_connectors.search") {
          output = await withTimeout(
            ctx.runAction(refPersonalConnectorsSearch, {
              query: task,
              maxResults,
            }),
            perStepTimeout,
          );
        } else if (step.tool === "reply_style_guardrail.check") {
          output = await withTimeout(
            ctx.runQuery(refReplyStyleGuardrailCheck, {
              threadId: args.threadId,
              candidateReply: args.candidateReply || "",
              inboundText: task,
              strictness: "balanced",
            }),
            perStepTimeout,
          );
        }

        const summarized = summarizeRouterOutput(output);
        return {
          stepId: step.id,
          tool: step.tool,
          status: "success",
          latencyMs: Date.now() - startedAt,
          ...summarized,
        };
      } catch (error) {
        const classified = classifyRouterError(error);
        return {
          stepId: step.id,
          tool: step.tool,
          status: classified.code === "timeout" ? "timeout" : "error",
          latencyMs: Date.now() - startedAt,
          output: null,
          outputSize: 0,
          outputSummary: `error:${classified.code}`,
          errorCode: classified.code,
          error: compactText(classified.message, 280),
        };
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
        for (const envelope of settled) {
          outputs.push(envelope);
          if (envelope.status === "success") {
            completedTools.add(envelope.tool);
          }
        }
        continue;
      }

      const step = pending.shift();
      if (!step) {
        break;
      }
      const envelope = await executeOne(step);
      outputs.push(envelope);
      if (envelope.status === "success") {
        completedTools.add(step.tool);
      }
    }

    return {
      tool: "tool_router.plan",
      task,
      plannerSource: planned.plannerSource,
      plannerConfidence,
      hintApplied,
      steps: mergedSorted,
      executed: true,
      outputs,
      toolBudgets: {
        timeoutMs,
        maxToolsPerRun,
        maxResults,
        allowSideEffects,
      },
    };
  },
});
