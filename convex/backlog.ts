import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { internalMutation, mutation, query } from "./_generated/server";
import { detectPromiseOrPlan, detectTodoCandidate, estimateHumanTiming, evaluateGuardrail, looksLikeQuestion } from "./lib/heuristics";
import { classifyThreadKind } from "./lib/threadEligibility";

type RelationshipKind = "girlfriend" | "relationship" | "friendship" | "casual" | "family" | "business";
type ImportanceKind = "critical" | "high" | "medium" | "low";
type RecommendationKind = "answer" | "answer_with_ack" | "restart" | "already_queued";

type ThreadLike = Pick<Doc<"threads">, "_id" | "jid" | "title" | "isIgnored" | "lastMessageAt" | "isGroup" | "threadKind">;

type LiveSignals = {
  unresolvedCount: number;
  pendingSince?: number;
  latestUnresolvedAt?: number;
  latestUnresolvedMessageId?: Id<"messages">;
  latestUnresolvedText?: string;
  lastInboundAt?: number;
  lastOutboundAt?: number;
  relationship: RelationshipKind;
  importance: ImportanceKind;
  recommendation: RecommendationKind;
  score: number;
};

const RELATIONSHIP_VALUES = ["girlfriend", "relationship", "friendship", "casual", "family", "business"] as const;
const relationshipValidator = v.union(
  v.literal("girlfriend"),
  v.literal("relationship"),
  v.literal("friendship"),
  v.literal("casual"),
  v.literal("family"),
  v.literal("business"),
);

const importanceValidator = v.union(v.literal("critical"), v.literal("high"), v.literal("medium"), v.literal("low"));
const recommendationValidator = v.union(
  v.literal("answer"),
  v.literal("answer_with_ack"),
  v.literal("restart"),
  v.literal("already_queued"),
);

const relationshipOrAllValidator = v.union(v.literal("all"), relationshipValidator);
const importanceOrAllValidator = v.union(v.literal("all"), importanceValidator);
const recommendationOrAllValidator = v.union(v.literal("all"), recommendationValidator);

const scopeValidator = v.union(v.literal("active"), v.literal("snoozed"), v.literal("all"));
const sortValidator = v.union(
  v.literal("importance"),
  v.literal("oldest"),
  v.literal("newest"),
  v.literal("relationship"),
  v.literal("activity"),
);

const RELATIONSHIP_WEIGHT: Record<RelationshipKind, number> = {
  girlfriend: 36,
  relationship: 32,
  family: 30,
  friendship: 24,
  business: 18,
  casual: 14,
};

const IMPORTANCE_WEIGHT: Record<ImportanceKind, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function msToHours(ms: number) {
  return ms / (60 * 60 * 1000);
}

function resolveThreadKind(thread: Pick<Doc<"threads">, "jid" | "isGroup" | "threadKind">) {
  return thread.threadKind || classifyThreadKind({ jid: thread.jid, isGroupHint: thread.isGroup });
}

function resolveIgnoreTargetType(thread: Pick<Doc<"threads">, "jid" | "isGroup" | "threadKind">): "contact" | "group" {
  return resolveThreadKind(thread) === "group" ? "group" : "contact";
}

function resolveRelationship(args: {
  override?: RelationshipKind;
  profileSlug?: string;
}): RelationshipKind {
  if (args.override && RELATIONSHIP_VALUES.includes(args.override)) {
    return args.override;
  }

  if (args.profileSlug === "girlfriend") {
    return "girlfriend";
  }
  if (args.profileSlug === "relationship") {
    return "relationship";
  }
  if (args.profileSlug === "friendship") {
    return "friendship";
  }

  return "casual";
}

function scoreToImportance(score: number): ImportanceKind {
  if (score >= 80) {
    return "critical";
  }
  if (score >= 58) {
    return "high";
  }
  if (score >= 34) {
    return "medium";
  }
  return "low";
}

function computeScore(args: {
  relationship: RelationshipKind;
  pendingAgeMs: number;
  unresolvedCount: number;
  latestText: string;
  ignored: boolean;
  hasPendingOutbox: boolean;
}) {
  const pendingHours = msToHours(args.pendingAgeMs);
  const guardrail = evaluateGuardrail(args.latestText || "");
  const hasQuestion = looksLikeQuestion(args.latestText);
  const hasPromise = Boolean(detectPromiseOrPlan(args.latestText));
  const hasTodo = Boolean(detectTodoCandidate(args.latestText));

  let score = RELATIONSHIP_WEIGHT[args.relationship];

  if (pendingHours >= 24 * 14) {
    score += 40;
  } else if (pendingHours >= 24 * 7) {
    score += 32;
  } else if (pendingHours >= 24 * 3) {
    score += 24;
  } else if (pendingHours >= 24) {
    score += 14;
  } else if (pendingHours >= 6) {
    score += 7;
  } else {
    score += 3;
  }

  score += Math.min(args.unresolvedCount * 4, 18);

  if (hasQuestion) {
    score += 9;
  }
  if (hasPromise) {
    score += 10;
  }
  if (hasTodo) {
    score += 7;
  }

  if (guardrail.severity === "high") {
    score += 14;
  } else if (guardrail.severity === "medium") {
    score += 8;
  }

  if (args.hasPendingOutbox) {
    score -= 14;
  }

  if (args.ignored) {
    score -= 26;
  }

  return clamp(Math.round(score), 0, 100);
}

function recommendAction(args: {
  relationship: RelationshipKind;
  pendingAgeMs: number;
  latestText: string;
  unresolvedCount: number;
  hasPendingOutbox: boolean;
}): RecommendationKind {
  if (args.hasPendingOutbox) {
    return "already_queued";
  }

  const pendingHours = msToHours(args.pendingAgeMs);
  const hasQuestion = looksLikeQuestion(args.latestText);
  const hasPromise = Boolean(detectPromiseOrPlan(args.latestText));
  const hasTodo = Boolean(detectTodoCandidate(args.latestText));

  if (pendingHours <= 24) {
    return "answer";
  }

  if (pendingHours <= 24 * 5) {
    return "answer_with_ack";
  }

  const closeRelationship =
    args.relationship === "girlfriend" || args.relationship === "relationship" || args.relationship === "family";

  if (closeRelationship && pendingHours <= 24 * 14) {
    return "answer_with_ack";
  }

  if (hasQuestion || hasPromise || hasTodo) {
    return "answer_with_ack";
  }

  if (args.unresolvedCount >= 4) {
    return "answer_with_ack";
  }

  if (pendingHours >= 24 * 10) {
    return "restart";
  }

  return "answer_with_ack";
}

async function computeLiveSignals(
  ctx: QueryCtx | MutationCtx,
  thread: ThreadLike,
  existing?: Doc<"backlogThreadState"> | null,
): Promise<LiveSignals> {
  const messages = await ctx.db
    .query("messages")
    .withIndex("by_thread_messageAt", (q) => q.eq("threadId", thread._id))
    .order("desc")
    .take(140);

  if (messages.length === 0) {
    const relationship = resolveRelationship({
      override: existing?.relationshipOverride,
      profileSlug: undefined,
    });

    return {
      unresolvedCount: 0,
      relationship,
      importance: existing?.importanceOverride || "low",
      recommendation: "answer",
      score: 0,
    };
  }

  const latestInbound = messages.find((message) => message.direction === "inbound");
  const latestOutbound = messages.find((message) => message.direction === "outbound");

  const lastOutboundAt = latestOutbound?.messageAt;
  const unresolved = messages.filter((message) => {
    if (message.direction !== "inbound") {
      return false;
    }
    if (!lastOutboundAt) {
      return true;
    }
    return message.messageAt > lastOutboundAt;
  });

  const unresolvedCount = unresolved.length;
  const latestUnresolved = unresolved[0];
  const oldestUnresolved = unresolved[unresolved.length - 1];

  const hasPendingOutbox = Boolean(
    await ctx.db
      .query("outbox")
      .withIndex("by_thread_and_status", (q) => q.eq("threadId", thread._id).eq("status", "pending"))
      .first(),
  );

  const hasClaimedOutbox = Boolean(
    await ctx.db
      .query("outbox")
      .withIndex("by_thread_and_status", (q) => q.eq("threadId", thread._id).eq("status", "claimed"))
      .first(),
  );

  const setting = await ctx.db
    .query("threadPersonalitySettings")
    .withIndex("by_thread", (q) => q.eq("threadId", thread._id))
    .first();

  const relationship = resolveRelationship({
    override: existing?.relationshipOverride,
    profileSlug: setting?.profileSlug,
  });

  if (!oldestUnresolved || !latestUnresolved) {
    const fallbackImportance = existing?.importanceOverride || "low";
    return {
      unresolvedCount: 0,
      relationship,
      importance: fallbackImportance,
      recommendation: "answer",
      score: 0,
      lastInboundAt: latestInbound?.messageAt,
      lastOutboundAt,
    };
  }

  const pendingAgeMs = Date.now() - oldestUnresolved.messageAt;
  const score = computeScore({
    relationship,
    pendingAgeMs,
    unresolvedCount,
    latestText: latestUnresolved.text || "",
    ignored: thread.isIgnored,
    hasPendingOutbox: hasPendingOutbox || hasClaimedOutbox,
  });

  const autoImportance = scoreToImportance(score);
  const importance = existing?.importanceOverride || autoImportance;

  const recommendation = recommendAction({
    relationship,
    pendingAgeMs,
    latestText: latestUnresolved.text || "",
    unresolvedCount,
    hasPendingOutbox: hasPendingOutbox || hasClaimedOutbox,
  });

  return {
    unresolvedCount,
    pendingSince: oldestUnresolved.messageAt,
    latestUnresolvedAt: latestUnresolved.messageAt,
    latestUnresolvedMessageId: latestUnresolved._id,
    latestUnresolvedText: latestUnresolved.text,
    lastInboundAt: latestInbound?.messageAt,
    lastOutboundAt,
    relationship,
    importance,
    recommendation,
    score,
  };
}

async function upsertThreadState(
  ctx: MutationCtx,
  args: {
    thread: ThreadLike;
    existing?: Doc<"backlogThreadState"> | null;
    signals: LiveSignals;
  },
) {
  const payload = {
    unresolvedCount: args.signals.unresolvedCount,
    pendingSince: args.signals.pendingSince,
    latestUnresolvedAt: args.signals.latestUnresolvedAt,
    latestUnresolvedMessageId: args.signals.latestUnresolvedMessageId,
    latestUnresolvedText: args.signals.latestUnresolvedText,
    lastInboundAt: args.signals.lastInboundAt,
    lastOutboundAt: args.signals.lastOutboundAt,
    relationship: args.signals.relationship,
    importance: args.signals.importance,
    recommendation: args.signals.recommendation,
    score: args.signals.score,
  };

  if (args.existing) {
    const hasSignalChanges =
      args.existing.unresolvedCount !== payload.unresolvedCount ||
      args.existing.pendingSince !== payload.pendingSince ||
      args.existing.latestUnresolvedAt !== payload.latestUnresolvedAt ||
      args.existing.latestUnresolvedMessageId !== payload.latestUnresolvedMessageId ||
      args.existing.latestUnresolvedText !== payload.latestUnresolvedText ||
      args.existing.lastInboundAt !== payload.lastInboundAt ||
      args.existing.lastOutboundAt !== payload.lastOutboundAt ||
      args.existing.relationship !== payload.relationship ||
      args.existing.importance !== payload.importance ||
      args.existing.recommendation !== payload.recommendation ||
      args.existing.score !== payload.score;

    if (!hasSignalChanges) {
      return args.existing;
    }

    const now = Date.now();
    await ctx.db.patch(args.existing._id, {
      ...payload,
      lastEvaluatedAt: now,
      updatedAt: now,
    });
    return {
      ...args.existing,
      ...payload,
      lastEvaluatedAt: now,
      updatedAt: now,
    };
  }

  const now = Date.now();
  const id = await ctx.db.insert("backlogThreadState", {
    threadId: args.thread._id,
    importanceOverride: undefined,
    relationshipOverride: undefined,
    snoozedUntil: undefined,
    snoozeReason: undefined,
    unresolvedCount: payload.unresolvedCount,
    pendingSince: payload.pendingSince,
    latestUnresolvedAt: payload.latestUnresolvedAt,
    latestUnresolvedMessageId: payload.latestUnresolvedMessageId,
    latestUnresolvedText: payload.latestUnresolvedText,
    lastInboundAt: payload.lastInboundAt,
    lastOutboundAt: payload.lastOutboundAt,
    relationship: payload.relationship,
    importance: payload.importance,
    recommendation: payload.recommendation,
    score: payload.score,
    lastActionAt: undefined,
    lastActionType: undefined,
    lastEvaluatedAt: now,
    createdAt: now,
    updatedAt: now,
  });

  const inserted = await ctx.db.get(id);
  if (!inserted) {
    throw new Error("Failed to create backlog thread state.");
  }
  return inserted;
}

async function refreshThreadSnapshot(ctx: MutationCtx, threadId: Id<"threads">) {
  const thread = await ctx.db.get(threadId);
  if (!thread) {
    return null;
  }

  const existing = await ctx.db
    .query("backlogThreadState")
    .withIndex("by_threadId", (q) => q.eq("threadId", thread._id))
    .first();

  const signals = await computeLiveSignals(ctx, thread, existing);

  return await upsertThreadState(ctx, {
    thread,
    existing,
    signals,
  });
}

function recommendationMatches(value: RecommendationKind, filter: "all" | RecommendationKind) {
  if (filter === "all") {
    return true;
  }
  return value === filter;
}

function relationshipMatches(value: RelationshipKind, filter: "all" | RelationshipKind) {
  if (filter === "all") {
    return true;
  }
  return value === filter;
}

function importanceMatches(value: ImportanceKind, filter: "all" | ImportanceKind) {
  if (filter === "all") {
    return true;
  }
  return value === filter;
}

function formatDelayAcknowledgement(relationship: RelationshipKind, pendingAgeHours: number) {
  if (pendingAgeHours < 24) {
    return "";
  }

  if (relationship === "girlfriend" || relationship === "relationship") {
    return "Sorry I went quiet for a bit. ";
  }

  if (relationship === "family") {
    return "Sorry for the delayed reply. ";
  }

  if (pendingAgeHours >= 24 * 7) {
    return "Sorry for the late reply, I was catching up on messages. ";
  }

  return "Sorry for the delay. ";
}

function firstNameFromThread(thread: { title?: string; jid: string }) {
  const title = thread.title?.trim();
  if (title) {
    return title.split(/\s+/)[0] || title;
  }
  return thread.jid.replace(/@s\.whatsapp\.net$/i, "").slice(0, 16);
}

function buildAnswerDraftText(args: {
  sourceText: string;
  relationship: RelationshipKind;
  pendingAgeHours: number;
}) {
  const ack = formatDelayAcknowledgement(args.relationship, args.pendingAgeHours);
  const source = args.sourceText.trim();
  if (!source) {
    return `${ack}Just seeing this now. I wanted to reply and check in with you.`.trim();
  }

  if (looksLikeQuestion(source)) {
    if (args.relationship === "girlfriend" || args.relationship === "relationship") {
      return `${ack}I just saw this. Yes, that works for me and I’m here now if you still want to talk through it.`.trim();
    }
    return `${ack}I just saw this. Yes, that works for me. If you still need anything on it, I’m here.`.trim();
  }

  if (args.relationship === "girlfriend" || args.relationship === "relationship") {
    return `${ack}I just caught this and wanted to respond properly. I appreciate you reaching out.`.trim();
  }

  return `${ack}I just caught this and wanted to reply properly.`.trim();
}

function buildRestartDraftText(args: {
  thread: { title?: string; jid: string };
  relationship: RelationshipKind;
  pendingAgeHours: number;
}) {
  const firstName = firstNameFromThread(args.thread);
  const ack = formatDelayAcknowledgement(args.relationship, args.pendingAgeHours);

  if (args.relationship === "girlfriend" || args.relationship === "relationship") {
    return `${ack}Hey ${firstName}, I’ve been meaning to reconnect with you. How have you been feeling lately?`.trim();
  }

  if (args.relationship === "family") {
    return `${ack}Hey ${firstName}, just checking in and making sure you’re good. How have things been on your side?`.trim();
  }

  if (args.relationship === "business") {
    return `${ack}Hi ${firstName}, circling back here. Hope you’re doing well this week.`.trim();
  }

  return `${ack}Hey ${firstName}, circling back here after being off-grid for a bit. How have you been?`.trim();
}

export const list = query({
  args: {
    limit: v.optional(v.number()),
    importance: v.optional(importanceOrAllValidator),
    recommendation: v.optional(recommendationOrAllValidator),
    relationship: v.optional(relationshipOrAllValidator),
    scope: v.optional(scopeValidator),
    sort: v.optional(sortValidator),
    includeIgnored: v.optional(v.boolean()),
    search: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const limit = clamp(Math.round(args.limit ?? 80), 1, 200);
    const importanceFilter = args.importance || "all";
    const recommendationFilter = args.recommendation || "all";
    const relationshipFilter = args.relationship || "all";
    const scope = args.scope || "active";
    const sort = args.sort || "importance";
    const includeIgnored = Boolean(args.includeIgnored);
    const search = (args.search || "").trim().toLowerCase();

    const stateRows = await ctx.db
      .query("backlogThreadState")
      .withIndex("by_unresolvedCount_and_updatedAt", (q) => q.gte("unresolvedCount", 1))
      .order("desc")
      .take(Math.min(limit * 8, 800));

    const now = Date.now();
    const rows = await Promise.all(
      stateRows.map(async (state) => {
        const thread = await ctx.db.get(state.threadId);
        if (!thread || resolveThreadKind(thread) === "group") {
          return null;
        }

        const isSnoozed = Boolean(state.snoozedUntil && state.snoozedUntil > now);

        if (!includeIgnored && thread.isIgnored) {
          return null;
        }

        if (scope === "active" && isSnoozed) {
          return null;
        }

        if (scope === "snoozed" && !isSnoozed) {
          return null;
        }

        if (!importanceMatches(state.importance, importanceFilter)) {
          return null;
        }

        if (!recommendationMatches(state.recommendation, recommendationFilter)) {
          return null;
        }

        if (!relationshipMatches(state.relationship, relationshipFilter)) {
          return null;
        }

        if (search) {
          const haystack = `${thread.title || ""}\n${thread.jid}\n${state.latestUnresolvedText || ""}`.toLowerCase();
          if (!haystack.includes(search)) {
            return null;
          }
        }

        return {
          threadId: thread._id,
          stateId: state._id,
          title: thread.title,
          jid: thread.jid,
          isIgnored: thread.isIgnored,
          unresolvedCount: state.unresolvedCount,
          pendingSince: state.pendingSince,
          latestUnresolvedAt: state.latestUnresolvedAt,
          latestUnresolvedText: state.latestUnresolvedText || "",
          latestUnresolvedMessageId: state.latestUnresolvedMessageId,
          lastInboundAt: state.lastInboundAt,
          lastOutboundAt: state.lastOutboundAt,
          relationship: state.relationship,
          relationshipOverride: state.relationshipOverride,
          importance: state.importance,
          importanceOverride: state.importanceOverride,
          recommendation: state.recommendation,
          score: state.score,
          snoozedUntil: state.snoozedUntil,
          snoozeReason: state.snoozeReason,
          isSnoozed,
          lastActionAt: state.lastActionAt,
          lastActionType: state.lastActionType,
          updatedAt: state.updatedAt,
          pendingAgeMs: state.pendingSince ? now - state.pendingSince : 0,
          lastMessageAt: thread.lastMessageAt,
        };
      }),
    );

    const filtered = rows.filter((row) => Boolean(row));

    filtered.sort((a, b) => {
      if (!a || !b) {
        return 0;
      }

      if (sort === "oldest") {
        return (a.pendingSince || Number.MAX_SAFE_INTEGER) - (b.pendingSince || Number.MAX_SAFE_INTEGER);
      }

      if (sort === "newest") {
        return (b.pendingSince || 0) - (a.pendingSince || 0);
      }

      if (sort === "relationship") {
        const relationshipDelta = RELATIONSHIP_WEIGHT[b.relationship] - RELATIONSHIP_WEIGHT[a.relationship];
        if (relationshipDelta !== 0) {
          return relationshipDelta;
        }
      }

      if (sort === "activity") {
        return b.lastMessageAt - a.lastMessageAt;
      }

      const importanceDelta = IMPORTANCE_WEIGHT[b.importance] - IMPORTANCE_WEIGHT[a.importance];
      if (importanceDelta !== 0) {
        return importanceDelta;
      }

      const scoreDelta = b.score - a.score;
      if (scoreDelta !== 0) {
        return scoreDelta;
      }

      return (a.pendingSince || Number.MAX_SAFE_INTEGER) - (b.pendingSince || Number.MAX_SAFE_INTEGER);
    });

    return filtered.slice(0, limit);
  },
});

export const setImportanceOverride = mutation({
  args: {
    threadId: v.id("threads"),
    importance: v.optional(importanceValidator),
  },
  handler: async (ctx, args) => {
    const thread = await ctx.db.get(args.threadId);
    if (!thread) {
      throw new Error("Thread not found");
    }

    const existing = await ctx.db
      .query("backlogThreadState")
      .withIndex("by_threadId", (q) => q.eq("threadId", args.threadId))
      .first();

    const now = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, {
        importanceOverride: args.importance,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("backlogThreadState", {
        threadId: args.threadId,
        importanceOverride: args.importance,
        relationshipOverride: undefined,
        snoozedUntil: undefined,
        snoozeReason: undefined,
        unresolvedCount: 0,
        pendingSince: undefined,
        latestUnresolvedAt: undefined,
        latestUnresolvedMessageId: undefined,
        latestUnresolvedText: undefined,
        lastInboundAt: undefined,
        lastOutboundAt: undefined,
        relationship: "casual",
        importance: args.importance || "low",
        recommendation: "answer",
        score: 0,
        lastActionAt: undefined,
        lastActionType: undefined,
        lastEvaluatedAt: 0,
        createdAt: now,
        updatedAt: now,
      });
    }

    await refreshThreadSnapshot(ctx, args.threadId);
    return args.threadId;
  },
});

export const setRelationshipOverride = mutation({
  args: {
    threadId: v.id("threads"),
    relationship: v.optional(relationshipValidator),
  },
  handler: async (ctx, args) => {
    const thread = await ctx.db.get(args.threadId);
    if (!thread) {
      throw new Error("Thread not found");
    }

    const existing = await ctx.db
      .query("backlogThreadState")
      .withIndex("by_threadId", (q) => q.eq("threadId", args.threadId))
      .first();

    const now = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, {
        relationshipOverride: args.relationship,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("backlogThreadState", {
        threadId: args.threadId,
        importanceOverride: undefined,
        relationshipOverride: args.relationship,
        snoozedUntil: undefined,
        snoozeReason: undefined,
        unresolvedCount: 0,
        pendingSince: undefined,
        latestUnresolvedAt: undefined,
        latestUnresolvedMessageId: undefined,
        latestUnresolvedText: undefined,
        lastInboundAt: undefined,
        lastOutboundAt: undefined,
        relationship: args.relationship || "casual",
        importance: "low",
        recommendation: "answer",
        score: 0,
        lastActionAt: undefined,
        lastActionType: undefined,
        lastEvaluatedAt: 0,
        createdAt: now,
        updatedAt: now,
      });
    }

    await refreshThreadSnapshot(ctx, args.threadId);
    return args.threadId;
  },
});

export const snooze = mutation({
  args: {
    threadId: v.id("threads"),
    minutes: v.optional(v.number()),
    until: v.optional(v.number()),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const thread = await ctx.db.get(args.threadId);
    if (!thread) {
      throw new Error("Thread not found");
    }

    const now = Date.now();
    const snoozedUntil = args.until || now + Math.max(5, Math.round(args.minutes ?? 24 * 60)) * 60 * 1000;

    const existing = await ctx.db
      .query("backlogThreadState")
      .withIndex("by_threadId", (q) => q.eq("threadId", args.threadId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        snoozedUntil,
        snoozeReason: args.reason?.trim() || undefined,
        lastActionAt: now,
        lastActionType: "snoozed",
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("backlogThreadState", {
        threadId: args.threadId,
        importanceOverride: undefined,
        relationshipOverride: undefined,
        snoozedUntil,
        snoozeReason: args.reason?.trim() || undefined,
        unresolvedCount: 0,
        pendingSince: undefined,
        latestUnresolvedAt: undefined,
        latestUnresolvedMessageId: undefined,
        latestUnresolvedText: undefined,
        lastInboundAt: undefined,
        lastOutboundAt: undefined,
        relationship: "casual",
        importance: "low",
        recommendation: "answer",
        score: 0,
        lastActionAt: now,
        lastActionType: "snoozed",
        lastEvaluatedAt: 0,
        createdAt: now,
        updatedAt: now,
      });
    }

    await ctx.db.insert("systemEvents", {
      source: "dashboard",
      eventType: "backlog.snoozed",
      threadId: args.threadId,
      detail: `${thread.jid} snoozed until ${new Date(snoozedUntil).toISOString()}`,
      createdAt: now,
    });

    return args.threadId;
  },
});

export const unsnooze = mutation({
  args: {
    threadId: v.id("threads"),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("backlogThreadState")
      .withIndex("by_threadId", (q) => q.eq("threadId", args.threadId))
      .first();

    if (!existing) {
      return args.threadId;
    }

    const now = Date.now();
    await ctx.db.patch(existing._id, {
      snoozedUntil: undefined,
      snoozeReason: undefined,
      lastActionAt: now,
      lastActionType: "unsnoozed",
      updatedAt: now,
    });

    return args.threadId;
  },
});

export const ignoreThread = mutation({
  args: {
    threadId: v.id("threads"),
    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    const thread = await ctx.db.get(args.threadId);
    if (!thread) {
      throw new Error("Thread not found");
    }

    const now = Date.now();
    await ctx.db.patch(thread._id, {
      isIgnored: args.enabled,
      updatedAt: now,
    });

    const targetType = resolveIgnoreTargetType(thread);
    const existingRule = await ctx.db
      .query("ignoreRules")
      .withIndex("by_target", (q) => q.eq("targetType", targetType).eq("targetValue", thread.jid))
      .first();

    if (existingRule) {
      await ctx.db.patch(existingRule._id, {
        enabled: args.enabled,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("ignoreRules", {
        targetType,
        targetValue: thread.jid,
        enabled: args.enabled,
        createdAt: now,
        updatedAt: now,
      });
    }

    const state = await ctx.db
      .query("backlogThreadState")
      .withIndex("by_threadId", (q) => q.eq("threadId", args.threadId))
      .first();

    if (state) {
      await ctx.db.patch(state._id, {
        lastActionAt: now,
        lastActionType: "ignored",
        updatedAt: now,
      });
    }

    await ctx.scheduler.runAfter(0, internal.backlog.refreshThread, {
      threadId: args.threadId,
    });

    return args.threadId;
  },
});

export const createDraft = mutation({
  args: {
    threadId: v.id("threads"),
    mode: v.union(v.literal("answer"), v.literal("restart")),
  },
  handler: async (ctx, args) => {
    const state = await refreshThreadSnapshot(ctx, args.threadId);
    const thread = await ctx.db.get(args.threadId);

    if (!thread || !state) {
      throw new Error("Thread not found");
    }

    if (state.unresolvedCount < 1 || !state.latestUnresolvedMessageId) {
      throw new Error("No unresolved inbound messages to draft from.");
    }

    const source = await ctx.db.get(state.latestUnresolvedMessageId);
    if (!source) {
      throw new Error("Source message not found.");
    }

    const now = Date.now();
    const pendingAgeHours = state.pendingSince ? msToHours(now - state.pendingSince) : 0;

    const text =
      args.mode === "restart"
        ? buildRestartDraftText({
            thread: {
              title: thread.title,
              jid: thread.jid,
            },
            relationship: state.relationship,
            pendingAgeHours,
          })
        : buildAnswerDraftText({
            sourceText: source.text,
            relationship: state.relationship,
            pendingAgeHours,
          });

    const timing = estimateHumanTiming(text);

    const draftId = await ctx.db.insert("replyDrafts", {
      threadId: thread._id,
      sourceMessageId: source._id,
      text,
      sendKind: "text",
      status: "pending",
      confidence: args.mode === "restart" ? 0.56 : 0.64,
      provider: "heuristic",
      delayMs: timing.delayMs,
      typingMs: timing.typingMs,
      reason: `Backlog ${args.mode} draft (${state.relationship}, ${state.importance})`,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.patch(state._id, {
      lastActionAt: now,
      lastActionType: args.mode === "restart" ? "restart_draft" : "answer_draft",
      updatedAt: now,
    });

    await ctx.db.insert("systemEvents", {
      source: "dashboard",
      eventType: args.mode === "restart" ? "backlog.draft.restart" : "backlog.draft.answer",
      threadId: thread._id,
      detail: text.slice(0, 240),
      createdAt: now,
    });

    await ctx.scheduler.runAfter(0, internal.backlog.refreshThread, {
      threadId: args.threadId,
    });

    return draftId;
  },
});

export const refreshRecent = mutation({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = clamp(Math.round(args.limit ?? 220), 10, 450);

    const threads = await ctx.db
      .query("threads")
      .withIndex("by_lastMessageAt")
      .order("desc")
      .take(limit);

    let refreshed = 0;
    for (const thread of threads) {
      if (resolveThreadKind(thread) === "group") {
        continue;
      }
      await refreshThreadSnapshot(ctx, thread._id);
      refreshed += 1;
    }

    return {
      refreshed,
      scanned: threads.length,
    };
  },
});

export const refreshThread = internalMutation({
  args: {
    threadId: v.id("threads"),
  },
  handler: async (ctx, args) => {
    const state = await refreshThreadSnapshot(ctx, args.threadId);

    if (!state) {
      return {
        refreshed: false,
      };
    }

    return {
      refreshed: true,
      unresolvedCount: state.unresolvedCount,
      importance: state.importance,
      recommendation: state.recommendation,
    };
  },
});

export const refreshRecentInternal = internalMutation({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = clamp(Math.round(args.limit ?? 280), 10, 500);
    const threads = await ctx.db
      .query("threads")
      .withIndex("by_lastMessageAt")
      .order("desc")
      .take(limit);

    let refreshed = 0;
    for (const thread of threads) {
      if (resolveThreadKind(thread) === "group") {
        continue;
      }
      await refreshThreadSnapshot(ctx, thread._id);
      refreshed += 1;
    }

    return {
      refreshed,
      scanned: threads.length,
    };
  },
});
