import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

export type CommitmentKind = "promise" | "request" | "plan";
export type CommitmentDirection = "inbound" | "outbound";

export type CommitmentCandidate = {
  kind: CommitmentKind;
  direction: CommitmentDirection;
  reason: string;
  dueAt: number;
  confidence: number;
  normalizedKey: string;
  sourceSnippet: string;
};

export type CommitmentDetection =
  | {
      outcome: "actionable";
      candidate: CommitmentCandidate;
    }
  | {
      outcome: "non_actionable";
      reason: string;
      sourceSnippet: string;
      normalizedKey: string;
    }
  | {
      outcome: "none";
    };

const ACTION_VERB_REGEX =
  /\b(send|share|call|text|reply|update|follow[\s-]?up|check|confirm|review|deliver|pay|transfer|book|schedule|remind|bring|drop|submit)\b/i;
const OUTBOUND_INTENT_REGEX = /\b(i(?:'|’)ll|i will|let me|i can|i(?:'|’)m going to)\b/i;
const INBOUND_REQUEST_REGEX = /\b(can you|could you|will you|would you|please|don(?:'|’)t forget|remember to|make sure you)\b/i;
const PLAN_REGEX = /\b(let(?:'|’)s|lets)\b/i;
const VAGUE_FUTURE_REGEX = /\b(soon|later|sometime|eventually|next time)\b/i;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function startOfDay(ms: number) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function startOfNextWeek(ms: number) {
  const d = new Date(ms);
  const day = d.getDay();
  const daysUntilMonday = day === 0 ? 1 : 8 - day;
  d.setDate(d.getDate() + daysUntilMonday);
  d.setHours(10, 0, 0, 0);
  return d.getTime();
}

function nextWeekday(ms: number, targetWeekday: number) {
  const d = new Date(ms);
  const day = d.getDay();
  let delta = (targetWeekday - day + 7) % 7;
  if (delta === 0) {
    delta = 7;
  }
  d.setDate(d.getDate() + delta);
  d.setHours(10, 0, 0, 0);
  return d.getTime();
}

function parseDueAt(text: string, now: number): null | { dueAt: number; label: string } {
  const normalized = text.toLowerCase();

  const inHours = normalized.match(/\bin\s+(\d{1,2})\s+hours?\b/i);
  if (inHours) {
    const value = Number(inHours[1]);
    if (Number.isFinite(value) && value > 0) {
      return {
        dueAt: now + value * 60 * 60 * 1000,
        label: `in ${value} hour${value === 1 ? "" : "s"}`,
      };
    }
  }

  const inDays = normalized.match(/\bin\s+(\d{1,2})\s+days?\b/i);
  if (inDays) {
    const value = Number(inDays[1]);
    if (Number.isFinite(value) && value > 0) {
      return {
        dueAt: now + value * 24 * 60 * 60 * 1000,
        label: `in ${value} day${value === 1 ? "" : "s"}`,
      };
    }
  }

  if (/\b(later today|today)\b/i.test(normalized)) {
    return {
      dueAt: now + 4 * 60 * 60 * 1000,
      label: "today",
    };
  }

  if (/\b(tonight|this evening)\b/i.test(normalized)) {
    const dueAt = startOfDay(now) + 20 * 60 * 60 * 1000;
    return {
      dueAt: dueAt <= now ? now + 3 * 60 * 60 * 1000 : dueAt,
      label: "tonight",
    };
  }

  if (/\btomorrow\b/i.test(normalized)) {
    return {
      dueAt: startOfDay(now + 24 * 60 * 60 * 1000) + 10 * 60 * 60 * 1000,
      label: "tomorrow",
    };
  }

  if (/\bnext week\b/i.test(normalized)) {
    return {
      dueAt: startOfNextWeek(now),
      label: "next week",
    };
  }

  if (/\bweekend\b/i.test(normalized)) {
    return {
      dueAt: nextWeekday(now, 6),
      label: "this weekend",
    };
  }

  const weekdayMap: Array<{ day: number; regex: RegExp; label: string }> = [
    { day: 1, regex: /\b(next\s+)?monday\b/i, label: "Monday" },
    { day: 2, regex: /\b(next\s+)?tuesday\b/i, label: "Tuesday" },
    { day: 3, regex: /\b(next\s+)?wednesday\b/i, label: "Wednesday" },
    { day: 4, regex: /\b(next\s+)?thursday\b/i, label: "Thursday" },
    { day: 5, regex: /\b(next\s+)?friday\b/i, label: "Friday" },
    { day: 6, regex: /\b(next\s+)?saturday\b/i, label: "Saturday" },
    { day: 0, regex: /\b(next\s+)?sunday\b/i, label: "Sunday" },
  ];

  for (const weekday of weekdayMap) {
    if (weekday.regex.test(normalized)) {
      return {
        dueAt: nextWeekday(now, weekday.day),
        label: weekday.label,
      };
    }
  }

  return null;
}

function normalizeKey(text: string) {
  const compact = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const stopwords = new Set([
    "i",
    "ill",
    "i'll",
    "iwill",
    "will",
    "you",
    "can",
    "could",
    "would",
    "please",
    "the",
    "a",
    "an",
    "to",
    "for",
    "this",
    "that",
    "it",
    "me",
    "we",
    "lets",
    "let",
    "soon",
    "later",
    "today",
    "tomorrow",
    "next",
    "week",
    "weekend",
  ]);

  const tokens = compact
    .split(" ")
    .filter(Boolean)
    .filter((token) => !stopwords.has(token))
    .slice(0, 9);

  return tokens.join(" ").slice(0, 90);
}

function trimmedSnippet(text: string) {
  return text.trim().replace(/\s+/g, " ").slice(0, 180);
}

function classifyKind(args: {
  direction: CommitmentDirection;
  hasOutboundIntent: boolean;
  hasInboundRequest: boolean;
  hasPlan: boolean;
}): CommitmentKind {
  if (args.hasPlan) {
    return "plan";
  }
  if (args.direction === "outbound" || args.hasOutboundIntent) {
    return "promise";
  }
  if (args.hasInboundRequest) {
    return "request";
  }
  return "plan";
}

function makeReason(args: { kind: CommitmentKind; direction: CommitmentDirection; dueLabel: string }) {
  if (args.direction === "outbound") {
    if (args.kind === "plan") {
      return `You planned to follow up ${args.dueLabel}.`;
    }
    return `You promised to follow up ${args.dueLabel}.`;
  }

  if (args.kind === "plan") {
    return `Shared plan to follow up ${args.dueLabel}.`;
  }
  return `They requested a follow-up ${args.dueLabel}.`;
}

export function detectFutureCommitment(args: {
  text: string;
  direction: CommitmentDirection;
  now?: number;
}): CommitmentDetection {
  const now = args.now ?? Date.now();
  const text = args.text.trim();
  if (!text || text.length < 8) {
    return { outcome: "none" };
  }

  const hasActionVerb = ACTION_VERB_REGEX.test(text);
  const hasOutboundIntent = OUTBOUND_INTENT_REGEX.test(text);
  const hasInboundRequest = INBOUND_REQUEST_REGEX.test(text);
  const hasPlan = PLAN_REGEX.test(text);
  const due = parseDueAt(text, now);

  const hasFutureSignal = Boolean(due) || VAGUE_FUTURE_REGEX.test(text);
  if (!hasFutureSignal || !hasActionVerb) {
    return { outcome: "none" };
  }

  const key = normalizeKey(text);
  if (!key) {
    return { outcome: "none" };
  }

  if (!due) {
    return {
      outcome: "non_actionable",
      reason: "Future language is too vague to schedule.",
      sourceSnippet: trimmedSnippet(text),
      normalizedKey: key,
    };
  }

  if (args.direction === "outbound" && !hasOutboundIntent && !hasPlan) {
    return { outcome: "none" };
  }

  if (args.direction === "inbound" && !hasInboundRequest && !hasPlan) {
    return { outcome: "none" };
  }

  let confidence = 0.58;
  if (hasActionVerb) {
    confidence += 0.1;
  }
  if (hasOutboundIntent || hasInboundRequest) {
    confidence += 0.16;
  }
  if (hasPlan) {
    confidence += 0.1;
  }
  if (due) {
    confidence += 0.1;
  }
  if (text.length > 250) {
    confidence -= 0.06;
  }

  confidence = clamp(confidence, 0, 0.99);
  if (confidence < 0.72) {
    return { outcome: "none" };
  }

  const kind = classifyKind({
    direction: args.direction,
    hasOutboundIntent,
    hasInboundRequest,
    hasPlan,
  });

  return {
    outcome: "actionable",
    candidate: {
      kind,
      direction: args.direction,
      reason: makeReason({
        kind,
        direction: args.direction,
        dueLabel: due.label,
      }),
      dueAt: due.dueAt,
      confidence,
      normalizedKey: key,
      sourceSnippet: trimmedSnippet(text),
    },
  };
}

export async function hasRecentFollowupDuplicate(
  ctx: MutationCtx,
  args: {
    threadId: Id<"threads">;
    normalizedKey: string;
    dueAt: number;
    now?: number;
  },
) {
  const now = args.now ?? Date.now();
  const dedupeWindowMs = 14 * 24 * 60 * 60 * 1000;
  const dueBucketMs = 12 * 60 * 60 * 1000;
  const candidateBucket = Math.floor(args.dueAt / dueBucketMs);

  const recent = await ctx.db
    .query("followUps")
    .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
    .order("desc")
    .take(80);

  return recent.some((row) => {
    if ((row.createdAt || 0) < now - dedupeWindowMs) {
      return false;
    }
    if (!row.normalizedKey || row.normalizedKey !== args.normalizedKey) {
      return false;
    }
    const existingBucket = Math.floor(row.dueAt / dueBucketMs);
    return existingBucket === candidateBucket;
  });
}

