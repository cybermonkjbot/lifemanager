import { v } from "convex/values";
import { internalQuery, mutation, query } from "./_generated/server";
import { getConfig } from "./lib/config";
import {
  classifyThreadKind,
  eligibilityReasonLabel,
  resolveThreadEligibility,
} from "./lib/threadEligibility";

export const list = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 30, 100);
    const threads = await ctx.db
      .query("threads")
      .withIndex("by_lastMessageAt")
      .order("desc")
      .take(limit);

    return await Promise.all(
      threads.map(async (thread) => {
        const drafts = await ctx.db
          .query("replyDrafts")
          .withIndex("by_thread", (q) => q.eq("threadId", thread._id))
          .order("desc")
          .take(1);

        return {
          ...thread,
          latestDraft: drafts[0] ?? null,
        };
      }),
    );
  },
});

export const listContacts = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 200, 500);
    const directThreads = await ctx.db
      .query("threads")
      .withIndex("by_threadKind_and_lastMessageAt", (q) => q.eq("threadKind", "direct"))
      .order("desc")
      .take(limit);

    if (directThreads.length >= limit) {
      return directThreads.map((thread) => ({
        _id: thread._id,
        jid: thread.jid,
        title: thread.title,
        lastMessageAt: thread.lastMessageAt,
        isIgnored: thread.isIgnored,
        isArchived: thread.isArchived || false,
      }));
    }

    const legacyScanLimit = Math.min(limit * 4, 2000);
    const legacyThreads = await ctx.db
      .query("threads")
      .withIndex("by_lastMessageAt")
      .order("desc")
      .take(legacyScanLimit);

    const seen = new Set(directThreads.map((thread) => thread._id));
    const merged = [...directThreads];

    for (const thread of legacyThreads) {
      if (seen.has(thread._id)) {
        continue;
      }
      const kind = thread.threadKind || classifyThreadKind({ jid: thread.jid, isGroupHint: thread.isGroup });
      if (kind !== "direct") {
        continue;
      }
      merged.push(thread);
      seen.add(thread._id);
      if (merged.length >= limit) {
        break;
      }
    }

    return merged
      .slice(0, limit)
      .map((thread) => ({
        _id: thread._id,
        jid: thread.jid,
        title: thread.title,
        lastMessageAt: thread.lastMessageAt,
        isIgnored: thread.isIgnored,
        isArchived: thread.isArchived || false,
      }));
  },
});

export const getEligibility = query({
  args: {
    threadId: v.id("threads"),
  },
  handler: async (ctx, args) => {
    const thread = await ctx.db.get(args.threadId);
    if (!thread) {
      return {
        allowed: false,
        reason: "explicit_ignore" as const,
        detail: "thread not found",
      };
    }

    const config = await getConfig(ctx);
    const threadKind = thread.threadKind || classifyThreadKind({ jid: thread.jid, isGroupHint: thread.isGroup });
    const explicitIgnore = await ctx.db
      .query("ignoreRules")
      .withIndex("by_target", (q) =>
        q.eq("targetType", threadKind === "group" ? "group" : "contact").eq("targetValue", thread.jid),
      )
      .first();

    const eligibility = resolveThreadEligibility({
      thread: {
        jid: thread.jid,
        isIgnored: thread.isIgnored,
        isArchived: thread.isArchived,
        threadKind,
        ghostedUntil: thread.ghostedUntil,
      },
      ignoreGroupsByDefault: config.ignoreGroupsByDefault,
      explicitIgnoreEnabled: Boolean(explicitIgnore?.enabled),
      nowMs: Date.now(),
    });

    return {
      ...eligibility,
      threadKind,
      isArchived: thread.isArchived || false,
      detail: eligibility.allowed ? "allowed" : eligibilityReasonLabel(eligibility.reason),
    };
  },
});

export const upsertMetadata = mutation({
  args: {
    threadJid: v.string(),
    title: v.optional(v.string()),
    isGroup: v.optional(v.boolean()),
    threadKind: v.optional(v.union(v.literal("direct"), v.literal("group"), v.literal("broadcast_or_system"))),
    isArchived: v.optional(v.boolean()),
    archivedAt: v.optional(v.number()),
    lastMessageAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const config = await getConfig(ctx);
    const threadKind = args.threadKind || classifyThreadKind({
      jid: args.threadJid,
      isGroupHint: args.isGroup,
    });
    const normalizedArchivedAt = args.archivedAt && args.archivedAt > 0 ? args.archivedAt : now;
    const lastMessageAt = Math.max(args.lastMessageAt ?? now, 0);

    const existing = await ctx.db
      .query("threads")
      .withIndex("by_jid", (q) => q.eq("jid", args.threadJid))
      .first();

    if (!existing) {
      return await ctx.db.insert("threads", {
        jid: args.threadJid,
        title: args.title,
        isGroup: threadKind === "group",
        isIgnored: threadKind === "group" ? config.ignoreGroupsByDefault : false,
        threadKind,
        isArchived: args.isArchived || false,
        archivedAt: args.isArchived ? normalizedArchivedAt : undefined,
        lastMessageAt,
        createdAt: now,
        updatedAt: now,
      });
    }

    await ctx.db.patch(existing._id, {
      title: args.title ?? existing.title,
      isGroup: threadKind === "group",
      threadKind,
      isArchived: args.isArchived === undefined ? existing.isArchived : args.isArchived,
      archivedAt:
        args.isArchived === undefined
          ? existing.archivedAt
          : args.isArchived
            ? normalizedArchivedAt
            : undefined,
      lastMessageAt: Math.max(existing.lastMessageAt, lastMessageAt),
      updatedAt: now,
    });

    return existing._id;
  },
});

export const setNightPause = mutation({
  args: {
    threadId: v.id("threads"),
    pauseUntil: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const thread = await ctx.db.get(args.threadId);
    if (!thread) {
      return null;
    }

    const now = Date.now();
    const nextPauseUntil = args.pauseUntil && args.pauseUntil > now ? args.pauseUntil : undefined;
    const previousPauseUntil = thread.nightPausedUntil && thread.nightPausedUntil > now ? thread.nightPausedUntil : undefined;

    if ((previousPauseUntil || 0) === (nextPauseUntil || 0)) {
      return thread._id;
    }

    await ctx.db.patch(thread._id, {
      nightPausedUntil: nextPauseUntil,
      updatedAt: now,
    });

    await ctx.db.insert("systemEvents", {
      source: "worker",
      eventType: nextPauseUntil ? "thread.night_pause.set" : "thread.night_pause.cleared",
      threadId: thread._id,
      detail: nextPauseUntil
        ? `Night pause active until ${new Date(nextPauseUntil).toISOString()}.`
        : "Night pause cleared.",
      createdAt: now,
    });

    return thread._id;
  },
});

export const backfillEligibilityFields = mutation({
  args: {
    cursorJid: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.round(Math.max(1, Math.min(args.limit ?? 200, 500)));
    const threads = await (args.cursorJid
      ? ctx.db
          .query("threads")
          .withIndex("by_jid", (q) => q.gt("jid", args.cursorJid as string))
          .take(limit)
      : ctx.db.query("threads").withIndex("by_jid").take(limit));

    const now = Date.now();
    let updated = 0;
    for (const thread of threads) {
      const computedKind = classifyThreadKind({
        jid: thread.jid,
        isGroupHint: thread.isGroup,
      });
      const patch: {
        threadKind?: "direct" | "group" | "broadcast_or_system";
        isArchived?: boolean;
        updatedAt?: number;
      } = {};

      if (thread.threadKind !== computedKind) {
        patch.threadKind = computedKind;
      }
      if (thread.isArchived === undefined) {
        patch.isArchived = false;
      }

      if (patch.threadKind !== undefined || patch.isArchived !== undefined) {
        patch.updatedAt = now;
        await ctx.db.patch(thread._id, patch);
        updated += 1;
      }
    }

    const last = threads[threads.length - 1];
    const done = threads.length < limit;
    return {
      scanned: threads.length,
      updated,
      done,
      nextCursorJid: done ? undefined : last?.jid,
    };
  },
});

export const get = query({
  args: {
    threadId: v.id("threads"),
  },
  handler: async (ctx, args) => {
    const thread = await ctx.db.get(args.threadId);
    if (!thread) {
      return null;
    }

    const messages = await ctx.db
      .query("messages")
      .withIndex("by_thread_messageAt", (q) => q.eq("threadId", args.threadId))
      .order("desc")
      .take(80);

    const mediaAssetIds = [
      ...new Set(messages.map((message) => message.mediaAssetId).filter((assetId): assetId is NonNullable<typeof assetId> => Boolean(assetId))),
    ];
    const mediaById = new Map<
      string,
      {
        assetId: string;
        kind: "sticker" | "meme";
        mimeType: string;
        label: string;
        url: string | null;
      }
    >();
    await Promise.all(
      mediaAssetIds.map(async (assetId) => {
        const asset = await ctx.db.get(assetId);
        if (!asset) {
          return;
        }
        const url = await ctx.storage.getUrl(asset.fileId);
        mediaById.set(assetId, {
          assetId,
          kind: asset.kind,
          mimeType: asset.mimeType,
          label: asset.label,
          url,
        });
      }),
    );

    const messageIds = messages.map((message) => message._id);
    let reactions: Array<{
      messageId: string;
      actorJid: string;
      emoji: string;
      direction: "inbound" | "outbound";
    }> = [];

    if (messageIds.length > 0) {
      const reactionRows = await ctx.db
        .query("messageReactions")
        .withIndex("by_threadId", (q) => q.eq("threadId", args.threadId))
        .take(300);
      reactions = reactionRows
        .filter((reaction) => messageIds.includes(reaction.messageId))
        .map((reaction) => ({
          messageId: reaction.messageId,
          actorJid: reaction.actorJid,
          emoji: reaction.emoji,
          direction: reaction.direction,
        }));
    }

    const memory = await ctx.db
      .query("threadMemory")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .first();

    const grounding = await ctx.db
      .query("threadGrounding")
      .withIndex("by_threadId", (q) => q.eq("threadId", args.threadId))
      .first();

    return {
      thread,
      messages: messages
        .reverse()
        .map((message) => ({
          ...message,
          mediaPreview: message.mediaAssetId ? mediaById.get(message.mediaAssetId) || null : null,
        })),
      reactions,
      memory,
      grounding: grounding || null,
    };
  },
});

export const getGenerationContext = internalQuery({
  args: {
    threadId: v.id("threads"),
    sourceMessageId: v.id("messages"),
  },
  handler: async (ctx, args) => {
    const thread = await ctx.db.get(args.threadId);
    const sourceMessage = await ctx.db.get(args.sourceMessageId);

    if (!thread || !sourceMessage) {
      return null;
    }

    const messages = await ctx.db
      .query("messages")
      .withIndex("by_thread_messageAt", (q) => q.eq("threadId", args.threadId))
      .order("desc")
      .take(20);

    const profile = await ctx.db
      .query("styleProfiles")
      .withIndex("by_scope", (q) => q.eq("scope", "global"))
      .first();

    const grounding = await ctx.db
      .query("threadGrounding")
      .withIndex("by_threadId", (q) => q.eq("threadId", args.threadId))
      .first();

    return {
      thread,
      sourceMessage,
      recentMessages: messages.reverse(),
      styleProfile: profile,
      grounding: grounding || null,
    };
  },
});
