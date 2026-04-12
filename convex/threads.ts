import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { internalQuery, mutation, query } from "./_generated/server";
import { getConfig } from "./lib/config";
import {
  classifyThreadKind,
  directIgnoreContactKey,
  directIgnoreRuleCandidates,
  eligibilityReasonLabel,
  resolveThreadEligibility,
} from "./lib/threadEligibility";

function clampInt(value: number | undefined, fallback: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.round(Math.max(min, Math.min(max, value as number)));
}

function compactDetail(value: string, maxChars: number) {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxChars - 3))}...`;
}

function safeJsonParse(raw: string | undefined) {
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

const IGNORE_CONTACT_FALLBACK_SCAN_LIMIT = 1000;

async function findExplicitIgnoreRule(args: {
  ctx: QueryCtx;
  threadKind: "direct" | "group" | "broadcast_or_system";
  jid: string;
  provider?: "whatsapp" | "instagram";
}) {
  if (args.threadKind === "group") {
    return await args.ctx.db
      .query("ignoreRules")
      .withIndex("by_target", (q) => q.eq("targetType", "group").eq("targetValue", args.jid))
      .first();
  }

  if (args.threadKind !== "direct") {
    return null;
  }

  for (const candidateJid of directIgnoreRuleCandidates({ jid: args.jid, provider: args.provider })) {
    const rule = await args.ctx.db
      .query("ignoreRules")
      .withIndex("by_target", (q) => q.eq("targetType", "contact").eq("targetValue", candidateJid))
      .first();
    if (rule) {
      return rule;
    }
  }

  const lookupKey = directIgnoreContactKey({
    jid: args.jid,
    provider: args.provider,
  });
  if (!lookupKey) {
    return null;
  }

  const contactRules = await args.ctx.db
    .query("ignoreRules")
    .withIndex("by_type", (q) => q.eq("targetType", "contact"))
    .take(IGNORE_CONTACT_FALLBACK_SCAN_LIMIT);
  for (const rule of contactRules) {
    if (
      directIgnoreContactKey({
        jid: rule.targetValue,
        provider: args.provider,
      }) === lookupKey
    ) {
      return rule;
    }
  }
  return null;
}

export const list = query({
  args: {
    limit: v.optional(v.number()),
    provider: v.optional(v.union(v.literal("whatsapp"), v.literal("instagram"), v.literal("all"))),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 30, 100);
    const provider = args.provider || "all";
    const threads =
      provider === "all"
        ? await ctx.db
            .query("threads")
            .withIndex("by_lastMessageAt")
            .order("desc")
            .take(limit)
        : await ctx.db
            .query("threads")
            .withIndex("by_provider_and_lastMessageAt", (q) => q.eq("provider", provider))
            .order("desc")
            .take(limit);

    return await Promise.all(
      threads.map(async (thread) => {
        const threadKind =
          thread.threadKind || classifyThreadKind({ jid: thread.jid, isGroupHint: thread.isGroup, provider: thread.provider });
        const drafts = await ctx.db
          .query("replyDrafts")
          .withIndex("by_thread", (q) => q.eq("threadId", thread._id))
          .order("desc")
          .take(1);

        return {
          ...thread,
          isGroup: threadKind === "group",
          threadKind,
          latestDraft: drafts[0] ?? null,
        };
      }),
    );
  },
});

export const listContacts = query({
  args: {
    limit: v.optional(v.number()),
    provider: v.optional(v.union(v.literal("whatsapp"), v.literal("instagram"), v.literal("all"))),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 200, 500);
    const provider = args.provider || "all";
    const directCandidates =
      provider === "all"
        ? await ctx.db
            .query("threads")
            .withIndex("by_threadKind_and_lastMessageAt", (q) => q.eq("threadKind", "direct"))
            .order("desc")
            .take(limit)
        : await ctx.db
            .query("threads")
            .withIndex("by_provider_and_threadKind_and_lastMessageAt", (q) =>
              q.eq("provider", provider).eq("threadKind", "direct"),
            )
            .order("desc")
            .take(limit);
    const directThreads = directCandidates.filter((thread) => {
      const kind = thread.threadKind || classifyThreadKind({ jid: thread.jid, isGroupHint: thread.isGroup, provider: thread.provider });
      return kind === "direct";
    });

    if (directThreads.length >= limit) {
      return directThreads.map((thread) => ({
        _id: thread._id,
        provider: thread.provider || "whatsapp",
        jid: thread.jid,
        title: thread.title,
        lastMessageAt: thread.lastMessageAt,
        isIgnored: thread.isIgnored,
        isArchived: thread.isArchived || false,
        isGroup: false,
        threadKind: "direct" as const,
      }));
    }

    const legacyScanLimit = Math.min(limit * 4, 2000);
    const legacyThreads =
      provider === "all"
        ? await ctx.db
            .query("threads")
            .withIndex("by_lastMessageAt")
            .order("desc")
            .take(legacyScanLimit)
        : await ctx.db
            .query("threads")
            .withIndex("by_provider_and_lastMessageAt", (q) => q.eq("provider", provider))
            .order("desc")
            .take(legacyScanLimit);

    const seen = new Set(directThreads.map((thread) => thread._id));
    const merged = [...directThreads];

    for (const thread of legacyThreads) {
      if (seen.has(thread._id)) {
        continue;
      }
      const kind = thread.threadKind || classifyThreadKind({ jid: thread.jid, isGroupHint: thread.isGroup, provider: thread.provider });
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
        provider: thread.provider || "whatsapp",
        jid: thread.jid,
        title: thread.title,
        lastMessageAt: thread.lastMessageAt,
        isIgnored: thread.isIgnored,
        isArchived: thread.isArchived || false,
        isGroup: false,
        threadKind: "direct" as const,
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
    const threadKind =
      thread.threadKind || classifyThreadKind({ jid: thread.jid, isGroupHint: thread.isGroup, provider: thread.provider });
    const explicitIgnore = await findExplicitIgnoreRule({
      ctx,
      threadKind,
      jid: thread.jid,
      provider: thread.provider,
    });

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
      groupRuleEnabled: threadKind === "group" ? explicitIgnore?.enabled : undefined,
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

export const getEligibilityByJid = query({
  args: {
    provider: v.optional(v.union(v.literal("whatsapp"), v.literal("instagram"))),
    threadJid: v.string(),
    isGroup: v.optional(v.boolean()),
    threadKind: v.optional(v.union(v.literal("direct"), v.literal("group"), v.literal("broadcast_or_system"))),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const provider = args.provider || "whatsapp";
    const config = await getConfig(ctx);
    const directJidCandidates = directIgnoreRuleCandidates({
      jid: args.threadJid,
      provider,
    });

    let thread = await ctx.db
      .query("threads")
      .withIndex("by_provider_and_jid", (q) => q.eq("provider", provider).eq("jid", args.threadJid))
      .first();
    if (!thread) {
      thread = await ctx.db
        .query("threads")
        .withIndex("by_jid", (q) => q.eq("jid", args.threadJid))
        .first();
    }

    const threadKind =
      thread?.threadKind ||
      args.threadKind ||
      classifyThreadKind({ jid: args.threadJid, isGroupHint: args.isGroup, provider });

    if (!thread && threadKind === "direct") {
      for (const candidateJid of directJidCandidates) {
        if (candidateJid === args.threadJid) {
          continue;
        }
        thread = await ctx.db
          .query("threads")
          .withIndex("by_provider_and_jid", (q) => q.eq("provider", provider).eq("jid", candidateJid))
          .first();
        if (thread) {
          break;
        }
      }
    }

    const explicitIgnore = await findExplicitIgnoreRule({
      ctx,
      threadKind,
      jid: args.threadJid,
      provider,
    });

    const eligibility = resolveThreadEligibility({
      thread: {
        jid: args.threadJid,
        isIgnored: thread?.isIgnored || false,
        isArchived: thread?.isArchived || false,
        threadKind,
        ghostedUntil: thread?.ghostedUntil,
      },
      ignoreGroupsByDefault: config.ignoreGroupsByDefault,
      explicitIgnoreEnabled: Boolean(explicitIgnore?.enabled),
      groupRuleEnabled: threadKind === "group" ? explicitIgnore?.enabled : undefined,
      nowMs: now,
    });

    return {
      ...eligibility,
      threadKind,
      isArchived: thread?.isArchived || false,
      detail: eligibility.allowed ? "allowed" : eligibilityReasonLabel(eligibility.reason),
    };
  },
});

export const upsertMetadata = mutation({
  args: {
    provider: v.optional(v.union(v.literal("whatsapp"), v.literal("instagram"))),
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
    const provider = args.provider || "whatsapp";
    const config = await getConfig(ctx);
    const threadKind = args.threadKind || classifyThreadKind({
      jid: args.threadJid,
      isGroupHint: args.isGroup,
      provider,
    });
    const normalizedArchivedAt = args.archivedAt && args.archivedAt > 0 ? args.archivedAt : now;
    const lastMessageAt = Math.max(args.lastMessageAt ?? now, 0);

    let existing = await ctx.db
      .query("threads")
      .withIndex("by_provider_and_jid", (q) => q.eq("provider", provider).eq("jid", args.threadJid))
      .first();
    if (!existing) {
      existing = await ctx.db
        .query("threads")
        .withIndex("by_jid", (q) => q.eq("jid", args.threadJid))
        .first();
    }

    if (!existing) {
      return await ctx.db.insert("threads", {
        provider,
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
      provider: existing.provider || provider,
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
        provider: thread.provider,
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

export const backfillLastMessageAtFromNonStatus = mutation({
  args: {
    cursorJid: v.optional(v.string()),
    limit: v.optional(v.number()),
    maxMessagesPerThread: v.optional(v.number()),
    includeBroadcastThreads: v.optional(v.boolean()),
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const limit = clampInt(args.limit, 120, 1, 300);
    const maxMessagesPerThread = clampInt(args.maxMessagesPerThread, 1000, 50, 10_000);
    const includeBroadcastThreads = args.includeBroadcastThreads === true;
    const dryRun = args.dryRun === true;

    const threads = await (args.cursorJid
      ? ctx.db
          .query("threads")
          .withIndex("by_jid", (q) => q.gt("jid", args.cursorJid as string))
          .take(limit)
      : ctx.db.query("threads").withIndex("by_jid").take(limit));

    const now = Date.now();
    let updated = 0;
    let unchanged = 0;
    let skippedBroadcast = 0;
    let skippedScanLimit = 0;
    let scannedMessages = 0;

    for (const thread of threads) {
      const threadKind =
        thread.threadKind || classifyThreadKind({ jid: thread.jid, isGroupHint: thread.isGroup, provider: thread.provider });

      if (threadKind === "broadcast_or_system" && !includeBroadcastThreads) {
        skippedBroadcast += 1;
        continue;
      }

      let inspectedForThread = 0;
      let newestNonStatusMessageAt: number | undefined;

      const messages = ctx.db
        .query("messages")
        .withIndex("by_thread", (q) => q.eq("threadId", thread._id))
        .order("desc");
      for await (const message of messages) {
        inspectedForThread += 1;
        scannedMessages += 1;

        if (!message.isStatus) {
          newestNonStatusMessageAt = message.messageAt;
          break;
        }
        if (inspectedForThread >= maxMessagesPerThread) {
          skippedScanLimit += 1;
          break;
        }
      }

      const resolvedLastMessageAt = Math.max(0, newestNonStatusMessageAt ?? 0);
      if (thread.lastMessageAt === resolvedLastMessageAt) {
        unchanged += 1;
        continue;
      }

      if (!dryRun) {
        await ctx.db.patch(thread._id, {
          lastMessageAt: resolvedLastMessageAt,
          updatedAt: now,
        });
      }
      updated += 1;
    }

    const last = threads[threads.length - 1];
    const done = threads.length < limit;
    return {
      scannedThreads: threads.length,
      scannedMessages,
      updated,
      unchanged,
      skippedBroadcast,
      skippedScanLimit,
      done,
      dryRun,
      nextCursorJid: done ? undefined : last?.jid,
    };
  },
});

export const get = query({
  args: {
    threadId: v.id("threads"),
    includeStatusMessages: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const thread = await ctx.db.get(args.threadId);
    if (!thread) {
      return null;
    }
    const threadKind =
      thread.threadKind || classifyThreadKind({ jid: thread.jid, isGroupHint: thread.isGroup, provider: thread.provider });

    const messages = await ctx.db
      .query("messages")
      .withIndex("by_thread_messageAt", (q) => q.eq("threadId", args.threadId))
      .order("desc")
      .take(80);
    const includeStatusMessages = args.includeStatusMessages === true;
    const visibleMessages =
      includeStatusMessages || threadKind === "broadcast_or_system"
        ? messages
        : messages.filter((message) => !message.isStatus);

    const draftRows = await ctx.db
      .query("replyDrafts")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .order("desc")
      .take(220);
    const pendingDrafts = draftRows.filter((draft) => draft.status === "pending").slice(0, 40);

    const followupRows = await ctx.db
      .query("followUps")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .take(220);
    const followupConfirmations = followupRows
      .filter((row) => row.status === "suggested")
      .sort((left, right) => left.dueAt - right.dueAt)
      .slice(0, 40);

    const todoRows = await ctx.db
      .query("todoCandidates")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .take(220);
    const todoCandidates = todoRows
      .filter((row) => row.status === "suggested")
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(0, 40);

    const unresolvedGuardrails = await ctx.db
      .query("guardrailEvents")
      .withIndex("by_resolvedAt_and_createdAt", (q) => q.eq("resolvedAt", undefined))
      .order("desc")
      .take(260);

    const draftById = new Map<Id<"replyDrafts">, (typeof draftRows)[number]>();
    for (const draft of draftRows) {
      draftById.set(draft._id, draft);
    }

    const getDraftById = async (draftId: Id<"replyDrafts">) => {
      const cached = draftById.get(draftId);
      if (cached) {
        return cached;
      }
      const loaded = await ctx.db.get(draftId);
      if (loaded) {
        draftById.set(loaded._id, loaded);
      }
      return loaded;
    };

    const guardrailFlags: Array<{
      _id: Id<"guardrailEvents">;
      severity: "low" | "medium" | "high";
      reason: string;
      draftId?: Id<"replyDrafts">;
      sourceMessageId?: Id<"messages">;
      createdAt: number;
    }> = [];

    for (const row of unresolvedGuardrails) {
      let include = row.threadId === args.threadId;
      let sourceMessageId: Id<"messages"> | undefined;

      if (row.draftId) {
        const draft = await getDraftById(row.draftId);
        if (draft?.threadId === args.threadId) {
          include = true;
          sourceMessageId = draft.sourceMessageId;
        }
      }

      if (!include) {
        continue;
      }

      guardrailFlags.push({
        _id: row._id,
        severity: row.severity,
        reason: row.reason,
        draftId: row.draftId,
        sourceMessageId,
        createdAt: row.createdAt,
      });

      if (guardrailFlags.length >= 24) {
        break;
      }
    }

    const sourceMessageIds = new Set<Id<"messages">>();
    for (const draft of pendingDrafts) {
      sourceMessageIds.add(draft.sourceMessageId);
    }
    for (const followup of followupConfirmations) {
      sourceMessageIds.add(followup.sourceMessageId);
    }
    for (const todo of todoCandidates) {
      sourceMessageIds.add(todo.sourceMessageId);
    }
    for (const guardrail of guardrailFlags) {
      if (guardrail.sourceMessageId) {
        sourceMessageIds.add(guardrail.sourceMessageId);
      }
    }

    const sourceMessages = await Promise.all(
      [...sourceMessageIds].map(async (messageId) => {
        const row = await ctx.db.get(messageId);
        return row ? ([messageId, row] as const) : null;
      }),
    );
    const sourceMessageById = new Map<Id<"messages">, (typeof messages)[number]>();
    for (const pair of sourceMessages) {
      if (!pair) {
        continue;
      }
      sourceMessageById.set(pair[0], pair[1]);
    }

    const mediaById = new Map<
      Id<"mediaAssets">,
      {
        assetId: Id<"mediaAssets">;
        kind: "sticker" | "meme" | "image" | "video" | "audio" | "document";
        mimeType: string;
        label: string;
        url: string | null;
      }
    >();
    const mediaAssetIds = new Set<Id<"mediaAssets">>();
    for (const message of visibleMessages) {
      if (message.mediaAssetId) {
        mediaAssetIds.add(message.mediaAssetId);
      }
    }
    for (const draft of pendingDrafts) {
      if (draft.mediaAssetId) {
        mediaAssetIds.add(draft.mediaAssetId);
      }
    }
    for (const sourceMessage of sourceMessageById.values()) {
      if (sourceMessage.mediaAssetId) {
        mediaAssetIds.add(sourceMessage.mediaAssetId);
      }
    }

    await Promise.all(
      [...mediaAssetIds].map(async (assetId) => {
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

    const messageIds = visibleMessages.map((message) => message._id);
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

    const reviewQueue = {
      needsReply: pendingDrafts.map((draft) => {
        const sourceMessage = sourceMessageById.get(draft.sourceMessageId);
        return {
          ...draft,
          mediaPreview: draft.mediaAssetId ? mediaById.get(draft.mediaAssetId) || null : null,
          sourceMessageId: draft.sourceMessageId,
          sourceMessage: sourceMessage
            ? {
                ...sourceMessage,
                mediaPreview: sourceMessage.mediaAssetId ? mediaById.get(sourceMessage.mediaAssetId) || null : null,
              }
            : null,
        };
      }),
      followupConfirmations: followupConfirmations.map((item) => {
        const sourceMessage = sourceMessageById.get(item.sourceMessageId);
        return {
          ...item,
          sourceMessageId: item.sourceMessageId,
          sourceMessage: sourceMessage
            ? {
                _id: sourceMessage._id,
                text: sourceMessage.text,
                messageAt: sourceMessage.messageAt,
                direction: sourceMessage.direction,
                mediaAssetId: sourceMessage.mediaAssetId,
                mediaCaption: sourceMessage.mediaCaption,
                mediaPreview: sourceMessage.mediaAssetId ? mediaById.get(sourceMessage.mediaAssetId) || null : null,
              }
            : null,
        };
      }),
      todoCandidates: todoCandidates.map((item) => {
        const sourceMessage = sourceMessageById.get(item.sourceMessageId);
        return {
          ...item,
          sourceMessageId: item.sourceMessageId,
          sourceMessage: sourceMessage
            ? {
                _id: sourceMessage._id,
                text: sourceMessage.text,
                messageAt: sourceMessage.messageAt,
                direction: sourceMessage.direction,
              }
            : null,
        };
      }),
      guardrailFlags: guardrailFlags.map((item) => {
        const sourceMessage = item.sourceMessageId ? sourceMessageById.get(item.sourceMessageId) : null;
        return {
          ...item,
          sourceMessage: sourceMessage
            ? {
                _id: sourceMessage._id,
                text: sourceMessage.text,
                messageAt: sourceMessage.messageAt,
                direction: sourceMessage.direction,
              }
            : null,
        };
      }),
    };

    return {
      thread: {
        ...thread,
        isGroup: threadKind === "group",
        threadKind,
      },
      messages: visibleMessages
        .reverse()
        .map((message) => ({
          ...message,
          mediaPreview: message.mediaAssetId ? mediaById.get(message.mediaAssetId) || null : null,
        })),
      reactions,
      memory,
      grounding: grounding || null,
      reviewQueue,
    };
  },
});

export const getToolEvents = query({
  args: {
    threadId: v.id("threads"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const thread = await ctx.db.get(args.threadId);
    if (!thread) {
      return [];
    }

    const limit = clampInt(args.limit, 220, 30, 500);
    const toolRuns = await ctx.db
      .query("toolRuns")
      .withIndex("by_threadId_and_createdAt", (q) => q.eq("threadId", args.threadId))
      .order("desc")
      .take(limit);
    const events = await ctx.db
      .query("systemEvents")
      .withIndex("by_threadId_and_createdAt", (q) => q.eq("threadId", args.threadId))
      .order("desc")
      .take(limit);

    const structuredToolItems = toolRuns.map((run) => {
      const detailParts = [
        `${run.toolName} ${run.latencyMs}ms`,
        run.outputSummary ? `summary=${run.outputSummary}` : "",
        run.errorCode ? `errorCode=${run.errorCode}` : "",
        run.errorMessage ? `error=${run.errorMessage}` : "",
      ].filter(Boolean);
      const parsedOutput = safeJsonParse(run.outputSummary);
      return {
        _id: run._id,
        createdAt: run.createdAt,
        eventType: `ai.context.tool.${run.toolName}`,
        source: "ai" as const,
        toolRunId: run.toolRunId,
        phase: run.toolRunId?.startsWith("outreach_") ? ("outreach" as const) : ("reply" as const),
        kind: "tool_call" as const,
        toolName: run.toolName,
        latencyMs: Number.isFinite(run.latencyMs) ? run.latencyMs : 0,
        inputText: run.inputSize !== undefined ? `inputSize=${run.inputSize}` : undefined,
        outputText: run.outputSummary || undefined,
        parsedInput: null,
        parsedOutput,
        status: run.status,
        errorCode: run.errorCode,
        detail: compactDetail(detailParts.join(" | "), 900),
      };
    });

    const structuredToolKey = (toolRunId: string | undefined, toolName: string) => `${toolRunId || ""}:${toolName}`;
    const structuredToolKeys = new Set(toolRuns.map((run) => structuredToolKey(run.toolRunId, run.toolName)));
    const filtered = events.filter((event) => {
      if (event.eventType.startsWith("ai.context.tool.") || event.eventType.startsWith("outreach.ai.context.tool.")) {
        const toolName = event.eventType.split(".tool.")[1] || "unknown";
        const duplicateStructuredEvent = structuredToolKeys.has(structuredToolKey(event.toolRunId, toolName));
        if (duplicateStructuredEvent) {
          return false;
        }
      }
      return (
        event.eventType.startsWith("ai.context.tool.") ||
        event.eventType.startsWith("outreach.ai.context.tool.") ||
        event.eventType === "ai.context.window" ||
        event.eventType === "outreach.ai.context.window" ||
        event.eventType === "ai.style_guardrail.passed" ||
        event.eventType === "ai.style_guardrail.failed"
      );
    });

    const legacyItems = filtered.map((event) => {
      if (event.eventType.startsWith("ai.context.tool.") || event.eventType.startsWith("outreach.ai.context.tool.")) {
        const detailMatch = event.detail.match(/^([a-zA-Z0-9._-]+)\s+([0-9]+)ms\s+input=([\s\S]*?)\s+output=([\s\S]*)$/);
        const toolNameFromType = event.eventType.split(".tool.")[1] || "unknown";
        const toolName = detailMatch?.[1] || toolNameFromType;
        const latencyMs = Number(detailMatch?.[2] || 0);
        const inputText = detailMatch?.[3];
        const outputText = detailMatch?.[4];
        const parsedInput = safeJsonParse(inputText);
        const parsedOutput = safeJsonParse(outputText);
        return {
          _id: event._id,
          createdAt: event.createdAt,
          eventType: event.eventType,
          source: event.source,
          toolRunId: event.toolRunId,
          phase: event.eventType.startsWith("outreach.") ? "outreach" : "reply",
          kind: "tool_call" as const,
          toolName,
          latencyMs: Number.isFinite(latencyMs) ? latencyMs : 0,
          inputText: inputText ? compactDetail(inputText, 900) : undefined,
          outputText: outputText ? compactDetail(outputText, 900) : undefined,
          parsedInput,
          parsedOutput,
          detail: compactDetail(event.detail, 900),
        };
      }

      if (event.eventType === "ai.context.window" || event.eventType === "outreach.ai.context.window") {
        return {
          _id: event._id,
          createdAt: event.createdAt,
          eventType: event.eventType,
          source: event.source,
          toolRunId: event.toolRunId,
          phase: event.eventType.startsWith("outreach.") ? "outreach" : "reply",
          kind: "context_window" as const,
          detail: compactDetail(event.detail, 900),
        };
      }

      const detailMatch = event.detail.match(/score=([0-9.]+)\s+threshold=([0-9.]+)\s+hints=([\s\S]*)/);
      const score = Number(detailMatch?.[1] || 0);
      const threshold = Number(detailMatch?.[2] || 0);
      const hintsRaw = detailMatch?.[3] || "";
      const hints = hintsRaw
        .split("|")
        .map((hint) => hint.trim())
        .filter(Boolean)
        .slice(0, 8);

      return {
        _id: event._id,
        createdAt: event.createdAt,
        eventType: event.eventType,
        source: event.source,
        toolRunId: event.toolRunId,
        phase: "reply" as const,
        kind: "style_guardrail" as const,
        passed: event.eventType.endsWith(".passed"),
        score: Number.isFinite(score) ? score : 0,
        threshold: Number.isFinite(threshold) ? threshold : 0,
        hints,
        detail: compactDetail(event.detail, 900),
      };
    });

    return [...structuredToolItems, ...legacyItems]
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(0, limit);
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

    const threadKind =
      thread.threadKind || classifyThreadKind({ jid: thread.jid, isGroupHint: thread.isGroup, provider: thread.provider });
    const config = await getConfig(ctx);
    const explicitIgnore = await findExplicitIgnoreRule({
      ctx,
      threadKind,
      jid: thread.jid,
      provider: thread.provider,
    });
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
      groupRuleEnabled: threadKind === "group" ? explicitIgnore?.enabled : undefined,
      nowMs: Date.now(),
    });
    if (!eligibility.allowed && eligibility.reason === "explicit_ignore") {
      return null;
    }

    const messages = await ctx.db
      .query("messages")
      .withIndex("by_thread_messageAt", (q) => q.eq("threadId", args.threadId))
      .order("desc")
      .take(20);
    const recentMessages =
      threadKind === "broadcast_or_system" ? messages : messages.filter((message) => !message.isStatus);

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
      recentMessages: recentMessages.reverse(),
      styleProfile: profile,
      grounding: grounding || null,
    };
  },
});
