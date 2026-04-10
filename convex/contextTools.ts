import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";

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

function extractKeywords(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 2 && !STOPWORDS.has(word));
}

function compactText(value: string, maxChars: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxChars - 3)).trim()}...`;
}

function estimateTokenCount(text: string) {
  const compact = text.replace(/\s+/g, " ").trim();
  if (!compact) {
    return 0;
  }
  return Math.ceil(compact.length / 4);
}

export const conversationHistorySearch = query({
  args: {
    threadId: v.id("threads"),
    query: v.string(),
    limit: v.optional(v.number()),
    lexicalLimit: v.optional(v.number()),
    beforeMessageAt: v.optional(v.number()),
    afterMessageAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.round(Math.max(1, Math.min(args.limit ?? 12, 80)));
    const lexicalLimit = Math.round(Math.max(limit, Math.min(args.lexicalLimit ?? 120, 300)));
    const queryText = (args.query || "").trim();
    const queryKeywords = new Set(extractKeywords(queryText));

    const sourceRows =
      queryText.length >= 2
        ? await ctx.db
            .query("messages")
            .withSearchIndex("search_text", (q) => q.search("text", queryText).eq("threadId", args.threadId))
            .take(lexicalLimit)
        : await ctx.db
            .query("messages")
            .withIndex("by_thread_messageAt", (q) => q.eq("threadId", args.threadId))
            .order("desc")
            .take(lexicalLimit);

    const before = args.beforeMessageAt;
    const after = args.afterMessageAt;
    const filtered = sourceRows.filter((row) => {
      if (before !== undefined && row.messageAt >= before) {
        return false;
      }
      if (after !== undefined && row.messageAt <= after) {
        return false;
      }
      return true;
    });

    const newestMessageAt = filtered.reduce((acc, row) => Math.max(acc, row.messageAt || 0), 0);
    const ranked = filtered
      .map((row) => {
        const messageKeywords = new Set(extractKeywords(row.text || ""));
        let overlap = 0;
        for (const keyword of queryKeywords) {
          if (messageKeywords.has(keyword)) {
            overlap += 1;
          }
        }
        const lexicalScore = queryKeywords.size > 0 ? overlap / queryKeywords.size : 0;
        const recencyScore = newestMessageAt > 0 ? row.messageAt / newestMessageAt : 0;
        const score = lexicalScore * 0.8 + recencyScore * 0.2;
        return {
          messageId: row._id,
          direction: row.direction,
          text: row.text,
          snippet: compactText(row.text, 220),
          messageAt: row.messageAt,
          origin: row.origin || "live",
          lexicalScore,
          score,
          retrievalStage: "lexical" as const,
        };
      })
      .sort((a, b) => b.score - a.score || b.messageAt - a.messageAt)
      .slice(0, limit);

    return {
      hits: ranked,
      candidateCount: filtered.length,
      retrievalStage: "lexical",
    };
  },
});

export const getMessageEmbeddings = query({
  args: {
    messageIds: v.array(v.id("messages")),
    modelVersion: v.string(),
  },
  handler: async (ctx, args) => {
    const limitedIds = [...new Set(args.messageIds)].slice(0, 200);
    const rows = await Promise.all(
      limitedIds.map(async (messageId) => {
        return await ctx.db
          .query("messageEmbeddings")
          .withIndex("by_message_and_modelVersion", (q) => q.eq("messageId", messageId).eq("modelVersion", args.modelVersion))
          .first();
      }),
    );
    return rows.filter(Boolean);
  },
});

export const upsertMessageEmbeddings = mutation({
  args: {
    entries: v.array(
      v.object({
        threadId: v.id("threads"),
        messageId: v.id("messages"),
        modelVersion: v.string(),
        contentHash: v.string(),
        vector: v.array(v.number()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    let inserted = 0;
    let updated = 0;

    for (const entry of args.entries.slice(0, 120)) {
      const existing = await ctx.db
        .query("messageEmbeddings")
        .withIndex("by_message_and_modelVersion", (q) =>
          q.eq("messageId", entry.messageId).eq("modelVersion", entry.modelVersion),
        )
        .first();

      if (existing) {
        if (existing.contentHash !== entry.contentHash || existing.vector.length !== entry.vector.length) {
          await ctx.db.patch(existing._id, {
            contentHash: entry.contentHash,
            vector: entry.vector,
            updatedAt: now,
          });
          updated += 1;
        }
        continue;
      }

      await ctx.db.insert("messageEmbeddings", {
        threadId: entry.threadId,
        messageId: entry.messageId,
        modelVersion: entry.modelVersion,
        contentHash: entry.contentHash,
        vector: entry.vector,
        createdAt: now,
        updatedAt: now,
      });
      inserted += 1;
    }

    return {
      inserted,
      updated,
    };
  },
});

export const contextWindowDetection = query({
  args: {
    prompt: v.string(),
    maxContextTokens: v.optional(v.number()),
    reserveOutputTokens: v.optional(v.number()),
    usedHistoryLines: v.optional(v.number()),
    relevantHistoryLines: v.optional(v.number()),
  },
  handler: async (_ctx, args) => {
    const maxContextTokens = Math.max(512, Math.min(args.maxContextTokens ?? 1_000_000, 1_000_000));
    const reserveOutputTokens = Math.max(
      64,
      Math.min(args.reserveOutputTokens ?? 220, Math.floor(maxContextTokens * 0.5)),
    );
    const availablePromptTokens = Math.max(128, maxContextTokens - reserveOutputTokens);
    const estimatedPromptTokens = estimateTokenCount(args.prompt);
    const overflowTokens = Math.max(0, estimatedPromptTokens - availablePromptTokens);

    return {
      estimatedPromptTokens,
      availablePromptTokens,
      maxContextTokens,
      reserveOutputTokens,
      overflowTokens,
      usedHistoryLines: Math.max(0, Math.round(args.usedHistoryLines ?? 0)),
      relevantHistoryLines: Math.max(0, Math.round(args.relevantHistoryLines ?? 0)),
    };
  },
});

export const contextWindowCleaning = query({
  args: {
    historyLines: v.array(v.string()),
    historyLineLimit: v.optional(v.number()),
    maxLineChars: v.optional(v.number()),
  },
  handler: async (_ctx, args) => {
    const historyLineLimit = Math.round(Math.max(4, Math.min(args.historyLineLimit ?? 14, 40)));
    const maxLineChars = Math.round(Math.max(80, Math.min(args.maxLineChars ?? 220, 800)));
    const cappedLimit = Math.round(Math.max(4, Math.min(historyLineLimit * 3, 120)));
    const dedupe = new Set<string>();
    const cleanedReversed: string[] = [];

    for (let index = args.historyLines.length - 1; index >= 0; index -= 1) {
      const line = compactText((args.historyLines[index] || "").replace(/\s+/g, " ").trim(), maxLineChars);
      if (!line) {
        continue;
      }
      const normalized = line.toLowerCase();
      if (dedupe.has(normalized)) {
        continue;
      }
      dedupe.add(normalized);
      cleanedReversed.push(line);
      if (cleanedReversed.length >= cappedLimit) {
        break;
      }
    }

    const cleaned = cleanedReversed.reverse();
    return {
      cleanedHistoryLines: cleaned,
      removedCount: Math.max(0, args.historyLines.length - cleaned.length),
    };
  },
});

export const getThreadOldestMessageForFetch = query({
  args: {
    threadId: v.id("threads"),
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("messages")
      .withIndex("by_thread_messageAt", (q) => q.eq("threadId", args.threadId))
      .take(1);
    const oldest = rows[0];
    if (!oldest || !oldest.whatsappMessageId) {
      return null;
    }
    return {
      messageId: oldest._id as Id<"messages">,
      whatsappMessageId: oldest.whatsappMessageId,
      direction: oldest.direction,
      senderJid: oldest.senderJid,
      messageAt: oldest.messageAt,
    };
  },
});
