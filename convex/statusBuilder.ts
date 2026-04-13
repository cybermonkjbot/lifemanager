import { internalMutation, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { getConfig } from "./lib/config";
import { classifyThreadKind } from "./lib/threadEligibility";

const STATUS_JID = "status@broadcast";
const AI_STATUS_PLACEHOLDER = "__SLM_AI_STATUS__";
const STATUS_OUTREACH_WINDOW_MS = 24 * 60 * 60 * 1000;
const STATUS_PENDING_REVIEW_BLOCK_MS = 2 * 60 * 60 * 1000;
const MAX_TREND_THREADS = 36;
const MAX_KEYWORDS = 8;

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
  "was",
  "with",
  "na",
  "dey",
  "abi",
  "sha",
]);

function normalizeSpace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function compactSafeText(value: string, maxChars: number) {
  if (maxChars <= 0) {
    return "";
  }
  const normalized = normalizeSpace(value);
  if (!normalized) {
    return "";
  }
  const compacted: string[] = [];
  for (const char of normalized) {
    if (compacted.length >= maxChars) {
      break;
    }
    const codePoint = char.codePointAt(0);
    if (codePoint === undefined) {
      continue;
    }
    // Drop lone surrogates and control characters that can poison JSON/event logs.
    if ((codePoint >= 0xd800 && codePoint <= 0xdfff) || (codePoint < 0x20 && codePoint !== 0x09 && codePoint !== 0x0a && codePoint !== 0x0d)) {
      continue;
    }
    compacted.push(char);
  }
  return compacted.join("");
}

export function stableHash(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

export function stableUnitRandom(seed: string) {
  let hash = stableHash(seed) >>> 0;
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b);
  hash ^= hash >>> 16;
  return (hash >>> 0) / 0x100000000;
}

export function isWithinHourWindow(hour: number, startHour: number, endHour: number) {
  if (startHour === endHour) {
    return false;
  }
  if (startHour < endHour) {
    return hour >= startHour && hour < endHour;
  }
  return hour >= startHour || hour < endHour;
}

export function relationshipLabel(value?: string) {
  if (!value) {
    return "mixed";
  }
  if (value === "business") {
    return "business";
  }
  if (value === "family") {
    return "family";
  }
  if (value === "girlfriend" || value === "relationship") {
    return "romance";
  }
  if (value === "friendship" || value === "casual") {
    return "social";
  }
  return "mixed";
}

export function extractKeywords(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 3 && !STOPWORDS.has(word));
}

async function ensureStatusThread(args: { ctx: MutationCtx; now: number }) {
  const existing = await args.ctx.db
    .query("threads")
    .withIndex("by_provider_and_jid", (q) => q.eq("provider", "whatsapp").eq("jid", STATUS_JID))
    .first();

  if (existing) {
    await args.ctx.db.patch(existing._id, {
      provider: existing.provider || "whatsapp",
      title: existing.title || "My Status",
      isGroup: false,
      isIgnored: false,
      threadKind: "broadcast_or_system",
      isArchived: false,
      archivedAt: undefined,
      lastMessageAt: Math.max(existing.lastMessageAt || 0, args.now),
      updatedAt: args.now,
    });
    return existing._id as Id<"threads">;
  }

  return (await args.ctx.db.insert("threads", {
    provider: "whatsapp",
    jid: STATUS_JID,
    title: "My Status",
    isGroup: false,
    isIgnored: false,
    threadKind: "broadcast_or_system",
    isArchived: false,
    archivedAt: undefined,
    ghostedUntil: undefined,
    nightPausedUntil: undefined,
    lastMessageAt: args.now,
    createdAt: args.now,
    updatedAt: args.now,
  })) as Id<"threads">;
}

export const run = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const config = await getConfig(ctx);
    const nowHour = new Date(now).getHours();
    const shouldLogSkip = async (reason: string) => {
      const recentEvents = await ctx.db
        .query("systemEvents")
        .withIndex("by_createdAt")
        .order("desc")
        .take(50);
      const alreadyLogged = recentEvents.some(
        (event) =>
          event.eventType === "status_builder.skipped" &&
          event.detail.startsWith(`reason=${reason}`) &&
          event.createdAt >= now - 90 * 60 * 1000,
      );
      if (alreadyLogged) {
        return;
      }
      await ctx.db.insert("systemEvents", {
        source: "convex",
        eventType: "status_builder.skipped",
        detail: `reason=${reason}`,
        createdAt: now,
      });
    };

    if (!config.statusBuilderEnabled) {
      await shouldLogSkip("status_builder_disabled");
      return { queued: false, reason: "status_builder_disabled" as const };
    }
    if (config.autonomyPaused) {
      await shouldLogSkip("autonomy_paused");
      return { queued: false, reason: "autonomy_paused" as const };
    }
    if (
      config.quietHoursEnabled &&
      isWithinHourWindow(nowHour, config.quietHoursStartHour, config.quietHoursEndHour)
    ) {
      await shouldLogSkip("quiet_hours");
      return { queued: false, reason: "quiet_hours" as const };
    }

    const statusThreadId = await ensureStatusThread({ ctx, now });
    const statusThread = await ctx.db.get(statusThreadId);
    if (!statusThread) {
      return { queued: false, reason: "status_thread_missing" as const };
    }

    const existingPending = await ctx.db
      .query("outbox")
      .withIndex("by_thread_and_status", (q) => q.eq("threadId", statusThreadId).eq("status", "pending"))
      .first();
    if (existingPending?.isStatusPost) {
      await shouldLogSkip("already_queued_pending");
      return { queued: false, reason: "already_queued_pending" as const };
    }
    const existingClaimed = await ctx.db
      .query("outbox")
      .withIndex("by_thread_and_status", (q) => q.eq("threadId", statusThreadId).eq("status", "claimed"))
      .first();
    if (existingClaimed?.isStatusPost) {
      await shouldLogSkip("already_queued_claimed");
      return { queued: false, reason: "already_queued_claimed" as const };
    }
    const recentStatusDrafts = await ctx.db
      .query("replyDrafts")
      .withIndex("by_thread", (q) => q.eq("threadId", statusThreadId))
      .order("desc")
      .take(40);
    const hasPendingReviewStatusDraft = recentStatusDrafts.some(
      (draft) =>
        draft.isStatusPost === true &&
        draft.status === "pending" &&
        draft.createdAt >= now - STATUS_PENDING_REVIEW_BLOCK_MS,
    );
    if (hasPendingReviewStatusDraft) {
      await shouldLogSkip("awaiting_review_pending_draft");
      return { queued: false, reason: "awaiting_review_pending_draft" as const };
    }

    const recentStatusMessages = await ctx.db
      .query("messages")
      .withIndex("by_thread_messageAt", (q) => q.eq("threadId", statusThreadId))
      .order("desc")
      .take(80);
    const recentOutboundStatus = recentStatusMessages.filter((message) => message.direction === "outbound" && message.isStatus);
    const dailyCount = recentOutboundStatus.filter((message) => message.messageAt >= now - STATUS_OUTREACH_WINDOW_MS).length;

    if (dailyCount >= config.statusBuilderDailyMaxPosts) {
      await shouldLogSkip("daily_limit");
      return { queued: false, reason: "daily_limit" as const, dailyCount };
    }

    const lastStatusAt = recentOutboundStatus[0]?.messageAt || 0;
    const cadenceMs = Math.max(60_000, Math.round(config.statusBuilderCadenceHours * 60 * 60 * 1000));
    if (lastStatusAt > 0 && now - lastStatusAt < cadenceMs) {
      await shouldLogSkip("too_soon");
      return { queued: false, reason: "too_soon" as const, waitMs: cadenceMs - (now - lastStatusAt) };
    }

    let audienceJids = [] as string[];
    const indexedDirectThreads = await ctx.db
      .query("threads")
      .withIndex("by_provider_and_threadKind_and_lastMessageAt", (q) => q.eq("provider", "whatsapp").eq("threadKind", "direct"))
      .order("desc")
      .take(260);
    const directThreads = [...indexedDirectThreads];
    if (directThreads.length < 40) {
      const fallbackScan = await ctx.db
        .query("threads")
        .withIndex("by_lastMessageAt")
        .order("desc")
        .take(700);
      const seen = new Set(directThreads.map((thread) => thread._id));
      for (const thread of fallbackScan) {
        if (seen.has(thread._id)) {
          continue;
        }
        const kind = thread.threadKind || classifyThreadKind({ jid: thread.jid, isGroupHint: thread.isGroup });
        if (kind !== "direct") {
          continue;
        }
        directThreads.push(thread);
        seen.add(thread._id);
        if (directThreads.length >= 260) {
          break;
        }
      }
    }

    if (audienceJids.length === 0) {
      audienceJids = directThreads
        .filter((thread) => !thread.isIgnored && !thread.isArchived && thread.jid.endsWith("@s.whatsapp.net"))
        .map((thread) => thread.jid)
        .slice(0, config.statusBuilderAudienceSampleSize);
    }

    audienceJids = [...new Set(audienceJids)].slice(0, config.statusBuilderAudienceSampleSize);
    const relationshipRows = await ctx.db
      .query("backlogThreadState")
      .withIndex("by_updatedAt")
      .order("desc")
      .take(420);
    const relationshipByThread = new Map(relationshipRows.map((row) => [row.threadId, row.relationship]));

    const trendThreads = directThreads
      .filter((thread) => !thread.isIgnored && !thread.isArchived)
      .slice(0, MAX_TREND_THREADS);

    const keywordCounts = new Map<string, number>();
    const relationshipCounts = new Map<string, number>();
    const sampleLines: string[] = [];

    for (const thread of trendThreads) {
      const relationship = relationshipLabel(relationshipByThread.get(thread._id));
      relationshipCounts.set(relationship, (relationshipCounts.get(relationship) || 0) + 1);

      const messages = await ctx.db
        .query("messages")
        .withIndex("by_thread_messageAt", (q) => q.eq("threadId", thread._id))
        .order("desc")
        .take(4);
      for (const message of messages) {
        if (message.direction !== "inbound" || message.isStatus) {
          continue;
        }
        const text = normalizeSpace(message.text || "");
        if (!text) {
          continue;
        }
        sampleLines.push(compactSafeText(text, 180));
        for (const keyword of extractKeywords(text)) {
          keywordCounts.set(keyword, (keywordCounts.get(keyword) || 0) + 1);
        }
      }
    }

    const topKeywords = [...keywordCounts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, MAX_KEYWORDS)
      .map(([keyword]) => keyword);

    const dominantRelationship = [...relationshipCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "mixed";
    const trendTheme = topKeywords.length > 0 ? topKeywords.slice(0, 3).join(", ") : "daily life, motivation, and fun";
    const trendSnippet = compactSafeText(sampleLines.slice(0, 5).join(" | "), 120);

    const cadenceBucket = Math.floor(now / cadenceMs);
    const seed = `${trendTheme}|${dominantRelationship}|${audienceJids.length}|${cadenceBucket}`;
    const formatRoll = stableUnitRandom(`status-format|${seed}`);
    const useTextPost = formatRoll < config.statusBuilderTextPostRatio;
    const statusFormat: "text" | "meme" = useTextPost ? "text" : "meme";
    const sendKind: "text" | "meme" = useTextPost ? "text" : "meme";
    const reviewRoll = stableUnitRandom(`status-review|${seed}`);
    const requiresReview = reviewRoll < config.statusBuilderReviewRatio;

    const sourceMessageId = await ctx.db.insert("messages", {
      threadId: statusThreadId,
      direction: "inbound",
      origin: "live",
      isStatus: true,
      senderJid: "status-builder",
      text: `Status seed (${dominantRelationship}): ${trendTheme}`,
      messageType: "text",
      messageAt: now,
      createdAt: now,
    });

    const draftId = await ctx.db.insert("replyDrafts", {
      threadId: statusThreadId,
      sourceMessageId,
      text: AI_STATUS_PLACEHOLDER,
      sendKind,
      isStatusPost: true,
      statusAudienceJids: audienceJids.length > 0 ? audienceJids : undefined,
      statusTrendTheme: trendTheme,
      statusDemographicHint: dominantRelationship,
      statusFormat,
      status: "approved",
      confidence: config.aiFallbackConfidence,
      provider: "heuristic",
      delayMs: 800,
      typingMs: 0,
      reason: `Auto status (${statusFormat}) · trend=${trendTheme} · review=${requiresReview ? "sampled" : "auto"}`,
      createdAt: now,
      updatedAt: now,
    });

    const outboxId = await ctx.db.insert("outbox", {
      messageProvider: "whatsapp",
      threadId: statusThreadId,
      draftId,
      messageText: AI_STATUS_PLACEHOLDER,
      sendKind,
      isStatusPost: true,
      statusAudienceJids: audienceJids.length > 0 ? audienceJids : undefined,
      statusTrendTheme: trendTheme,
      statusDemographicHint: dominantRelationship,
      statusFormat,
      statusReviewRequired: requiresReview,
      sendAt: now + 1200,
      status: "pending",
      attempts: 0,
      idempotencyKey: `status-builder-${cadenceBucket}-${statusFormat}`,
      provider: "heuristic",
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("systemEvents", {
      source: "convex",
      eventType: "status_builder.queued",
      threadId: statusThreadId,
      outboxId,
      detail: `Queued ${statusFormat} status for default status privacy audience. review=${requiresReview ? "sampled" : "auto"}. trend=${trendTheme}. demographic=${dominantRelationship}. context=${trendSnippet}`,
      createdAt: now,
    });

    return {
      queued: true,
      statusFormat,
      requiresReview,
      outboxId,
      audienceCount: audienceJids.length,
      trendTheme,
      demographic: dominantRelationship,
      sampleKeywords: topKeywords,
    };
  },
});
