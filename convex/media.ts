import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";

const mediaKindValidator = v.union(
  v.literal("sticker"),
  v.literal("meme"),
  v.literal("image"),
  v.literal("video"),
  v.literal("audio"),
  v.literal("document"),
);

const stickerOrMemeKindValidator = v.union(v.literal("sticker"), v.literal("meme"));

const dashboardFilterValidator = v.union(
  v.literal("all"),
  v.literal("stickers"),
  v.literal("memes"),
  v.literal("images"),
  v.literal("video"),
  v.literal("audio"),
  v.literal("documents"),
);

function clampInt(value: number | undefined, fallback: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.round(Math.max(min, Math.min(max, value as number)));
}

type MediaKind = Doc<"mediaAssets">["kind"];

function matchesDashboardFilter(kind: MediaKind, filter: "all" | "stickers" | "memes" | "images" | "video" | "audio" | "documents") {
  if (filter === "all") {
    return true;
  }
  if (filter === "stickers") {
    return kind === "sticker";
  }
  if (filter === "memes") {
    return kind === "meme";
  }
  if (filter === "images") {
    return kind === "image";
  }
  if (filter === "video") {
    return kind === "video";
  }
  if (filter === "audio") {
    return kind === "audio";
  }
  return kind === "document";
}

function normalizeTags(tags: string[]) {
  const deduped = new Set(
    tags
      .map((tag) => tag.trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 20),
  );
  return [...deduped];
}

function normalizeContextPhrases(values?: string[]) {
  if (!Array.isArray(values)) {
    return undefined;
  }
  const deduped = new Set(
    values
      .map((value) => value.trim())
      .filter(Boolean)
      .slice(0, 20),
  );
  const normalized = [...deduped];
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeLabel(value: string, fallback: string) {
  const normalized = value.trim().slice(0, 120);
  return normalized || fallback;
}

function mergeContextSummary(primary?: string, secondary?: string) {
  const left = primary?.trim() || "";
  const right = secondary?.trim() || "";
  if (!left && !right) {
    return undefined;
  }
  if (!left) {
    return right.slice(0, 240);
  }
  if (!right) {
    return left.slice(0, 240);
  }
  if (left.toLowerCase() === right.toLowerCase()) {
    return left.slice(0, 240);
  }
  return `${left} | ${right}`.slice(0, 240);
}

type AssetReferenceRewriteResult = {
  messagesUpdated: number;
  draftsUpdated: number;
  outboxUpdated: number;
  activeOutboxReferences: number;
};

async function rewriteAssetReferences(
  ctx: MutationCtx,
  args: {
    fromAssetId: Id<"mediaAssets">;
    toAssetId?: Id<"mediaAssets">;
    blockOnActiveOutbox: boolean;
  },
): Promise<AssetReferenceRewriteResult> {
  let messagesUpdated = 0;
  for await (const message of ctx.db.query("messages").withIndex("by_mediaAssetId", (q) => q.eq("mediaAssetId", args.fromAssetId))) {
    await ctx.db.patch(message._id, {
      mediaAssetId: args.toAssetId,
    });
    messagesUpdated += 1;
  }

  let draftsUpdated = 0;
  for await (const draft of ctx.db.query("replyDrafts").withIndex("by_mediaAssetId", (q) => q.eq("mediaAssetId", args.fromAssetId))) {
    await ctx.db.patch(draft._id, {
      mediaAssetId: args.toAssetId,
      updatedAt: Date.now(),
    });
    draftsUpdated += 1;
  }

  let outboxUpdated = 0;
  let activeOutboxReferences = 0;
  for await (const item of ctx.db.query("outbox").withIndex("by_mediaAssetId", (q) => q.eq("mediaAssetId", args.fromAssetId))) {
    const isActive = item.status === "pending" || item.status === "claimed";
    if (!args.toAssetId && args.blockOnActiveOutbox && isActive) {
      activeOutboxReferences += 1;
      continue;
    }
    await ctx.db.patch(item._id, {
      mediaAssetId: args.toAssetId,
      updatedAt: Date.now(),
    });
    outboxUpdated += 1;
  }

  return {
    messagesUpdated,
    draftsUpdated,
    outboxUpdated,
    activeOutboxReferences,
  };
}

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});

export const registerAsset = mutation({
  args: {
    kind: mediaKindValidator,
    label: v.string(),
    tags: v.array(v.string()),
    fileId: v.id("_storage"),
    mimeType: v.string(),
    contentHash: v.optional(v.string()),
    source: v.optional(v.union(v.literal("uploaded"), v.literal("generated"), v.literal("captured"))),
    threadId: v.optional(v.id("threads")),
    generationPromptHash: v.optional(v.string()),
    generationContextSnippet: v.optional(v.string()),
    enabled: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("mediaAssets", {
      kind: args.kind,
      label: args.label.trim().slice(0, 120) || args.kind,
      tags: normalizeTags(args.tags),
      source: args.source || "uploaded",
      threadId: args.threadId,
      fileId: args.fileId,
      mimeType: args.mimeType.trim(),
      contentHash: args.contentHash?.trim() || undefined,
      generationPromptHash: args.generationPromptHash?.trim() || undefined,
      generationContextSnippet: args.generationContextSnippet?.trim().slice(0, 400) || undefined,
      enabled: args.enabled ?? true,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const findAssetByContentHash = query({
  args: {
    kind: mediaKindValidator,
    contentHash: v.string(),
  },
  handler: async (ctx, args) => {
    const normalized = args.contentHash.trim();
    if (!normalized) {
      return null;
    }
    return await ctx.db
      .query("mediaAssets")
      .withIndex("by_kind_and_contentHash", (q) => q.eq("kind", args.kind).eq("contentHash", normalized))
      .first();
  },
});

export const registerAssetIfMissing = mutation({
  args: {
    kind: mediaKindValidator,
    label: v.string(),
    tags: v.array(v.string()),
    fileId: v.id("_storage"),
    mimeType: v.string(),
    contentHash: v.string(),
    source: v.optional(v.union(v.literal("uploaded"), v.literal("generated"), v.literal("captured"))),
    threadId: v.optional(v.id("threads")),
    generationPromptHash: v.optional(v.string()),
    generationContextSnippet: v.optional(v.string()),
    enabled: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const normalizedHash = args.contentHash.trim();
    const existing = await ctx.db
      .query("mediaAssets")
      .withIndex("by_kind_and_contentHash", (q) => q.eq("kind", args.kind).eq("contentHash", normalizedHash))
      .first();
    if (existing) {
      await ctx.storage.delete(args.fileId);
      return existing._id;
    }

    const now = Date.now();
    return await ctx.db.insert("mediaAssets", {
      kind: args.kind,
      label: args.label.trim().slice(0, 120) || args.kind,
      tags: normalizeTags(args.tags),
      source: args.source || "uploaded",
      threadId: args.threadId,
      fileId: args.fileId,
      mimeType: args.mimeType.trim(),
      contentHash: normalizedHash,
      generationPromptHash: args.generationPromptHash?.trim() || undefined,
      generationContextSnippet: args.generationContextSnippet?.trim().slice(0, 400) || undefined,
      enabled: args.enabled ?? true,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const upsertAssetContext = mutation({
  args: {
    assetId: v.id("mediaAssets"),
    contextSummary: v.string(),
    contextTags: v.array(v.string()),
    contextTriggers: v.array(v.string()),
    contextAvoid: v.array(v.string()),
    contextConfidence: v.number(),
    contextSource: v.union(v.literal("vision_ai"), v.literal("heuristic")),
  },
  handler: async (ctx, args) => {
    const asset = await ctx.db.get(args.assetId);
    if (!asset) {
      return null;
    }
    const now = Date.now();
    await ctx.db.patch(asset._id, {
      contextSummary: args.contextSummary.trim().slice(0, 240),
      contextTags: normalizeContextPhrases(args.contextTags),
      contextTriggers: normalizeContextPhrases(args.contextTriggers),
      contextAvoid: normalizeContextPhrases(args.contextAvoid),
      contextConfidence: Math.max(0, Math.min(1, args.contextConfidence)),
      contextSource: args.contextSource,
      contextUpdatedAt: now,
      updatedAt: now,
    });
    return asset._id;
  },
});

export const listStickerAssetsNeedingContext = query({
  args: {
    limit: v.optional(v.number()),
    staleAfterMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(args.limit ?? 20, 100));
    const staleAfterMs = Math.max(60_000, Math.min(args.staleAfterMs ?? 30 * 24 * 60 * 60 * 1000, 365 * 24 * 60 * 60 * 1000));
    const cutoff = Date.now() - staleAfterMs;
    const assets = await ctx.db
      .query("mediaAssets")
      .withIndex("by_kind", (q) => q.eq("kind", "sticker"))
      .order("desc")
      .take(300);

    return assets
      .filter((asset) => asset.enabled && (!asset.contextUpdatedAt || asset.contextUpdatedAt < cutoff))
      .slice(0, limit)
      .map((asset) => ({
        _id: asset._id,
        kind: asset.kind,
        label: asset.label,
        mimeType: asset.mimeType,
        contextUpdatedAt: asset.contextUpdatedAt,
      }));
  },
});

export const listAssets = query({
  args: {
    kind: v.optional(mediaKindValidator),
    enabledOnly: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const limit = 200;
    let assets = args.kind
      ? await ctx.db
          .query("mediaAssets")
          .withIndex("by_kind", (q) => q.eq("kind", args.kind!))
          .order("desc")
          .take(limit)
      : await ctx.db.query("mediaAssets").order("desc").take(limit);

    if (args.enabledOnly) {
      assets = assets.filter((asset) => asset.enabled);
    }

    return await Promise.all(
      assets.map(async (asset) => {
        const fileUrl = await ctx.storage.getUrl(asset.fileId);
        return {
          ...asset,
          fileUrl,
        };
      }),
    );
  },
});

export const listUnifiedMedia = query({
  args: {
    filter: v.optional(dashboardFilterValidator),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const filter = args.filter || "all";
    const limit = Math.max(20, Math.min(args.limit ?? 240, 400));
    const messageScanLimit = Math.min(Math.max(limit * 4, 300), 1500);
    const assetScanLimit = Math.min(Math.max(limit * 4, 300), 1500);

    const [recentMessages, recentAssets] = await Promise.all([
      ctx.db.query("messages").withIndex("by_createdAt").order("desc").take(messageScanLimit),
      ctx.db.query("mediaAssets").order("desc").take(assetScanLimit),
    ]);

    const messagesWithMedia = recentMessages.filter((message) => Boolean(message.mediaAssetId));
    const messageAssetIds = [
      ...new Set(
        messagesWithMedia
          .map((message) => message.mediaAssetId)
          .filter((assetId): assetId is Id<"mediaAssets"> => Boolean(assetId)),
      ),
    ];

    const allAssetIds = [...new Set([...messageAssetIds, ...recentAssets.map((asset) => asset._id)])];
    const assetById = new Map<Id<"mediaAssets">, Doc<"mediaAssets">>();
    await Promise.all(
      allAssetIds.map(async (assetId) => {
        const asset = await ctx.db.get(assetId);
        if (asset) {
          assetById.set(assetId, asset);
        }
      }),
    );

    const threadIds = [
      ...new Set(
        [...messagesWithMedia.map((message) => message.threadId), ...recentAssets.map((asset) => asset.threadId)].filter(
          (threadId): threadId is Id<"threads"> => Boolean(threadId),
        ),
      ),
    ];
    const threadById = new Map<
      Id<"threads">,
      {
        _id: Id<"threads">;
        jid: string;
        title?: string;
      }
    >();
    await Promise.all(
      threadIds.map(async (threadId) => {
        const thread = await ctx.db.get(threadId);
        if (!thread) {
          return;
        }
        threadById.set(threadId, {
          _id: thread._id,
          jid: thread.jid,
          title: thread.title,
        });
      }),
    );

    const assetUrlById = new Map<Id<"mediaAssets">, string | null>();
    await Promise.all(
      [...assetById.values()].map(async (asset) => {
        const url = await ctx.storage.getUrl(asset.fileId);
        assetUrlById.set(asset._id, url);
      }),
    );

    const messageItems = messagesWithMedia
      .map((message) => {
        const assetId = message.mediaAssetId;
        if (!assetId) {
          return null;
        }
        const asset = assetById.get(assetId);
        if (!asset || !matchesDashboardFilter(asset.kind, filter)) {
          return null;
        }
        const thread = threadById.get(message.threadId) || null;
        return {
          id: `message:${message._id}`,
          assetId: asset._id,
          source: "message" as const,
          createdAt: message.messageAt,
          kind: asset.kind,
          mimeType: asset.mimeType,
          label: asset.label,
          url: assetUrlById.get(asset._id) || null,
          enabled: asset.enabled,
          tags: asset.tags,
          contextSummary: asset.contextSummary,
          contextTags: asset.contextTags,
          contextTriggers: asset.contextTriggers,
          contextAvoid: asset.contextAvoid,
          contextConfidence: asset.contextConfidence,
          thread,
          message: {
            _id: message._id,
            direction: message.direction,
            text: message.text,
            messageType: message.messageType || "text",
            mediaCaption: message.mediaCaption,
            messageAt: message.messageAt,
          },
        };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item));

    const usedAssetIds = new Set(messageItems.map((item) => item.assetId));
    const libraryItems = recentAssets
      .filter((asset) => !usedAssetIds.has(asset._id) && matchesDashboardFilter(asset.kind, filter))
      .map((asset) => ({
        id: `asset:${asset._id}`,
        assetId: asset._id,
        source: "library" as const,
        createdAt: asset.createdAt,
        kind: asset.kind,
        mimeType: asset.mimeType,
        label: asset.label,
        url: assetUrlById.get(asset._id) || null,
        enabled: asset.enabled,
        tags: asset.tags,
        contextSummary: asset.contextSummary,
        contextTags: asset.contextTags,
        contextTriggers: asset.contextTriggers,
        contextAvoid: asset.contextAvoid,
        contextConfidence: asset.contextConfidence,
        thread: asset.threadId ? threadById.get(asset.threadId) || null : null,
        message: null,
      }));

    return [...messageItems, ...libraryItems].sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
  },
});

export const cleanupStatusRetention = mutation({
  args: {
    olderThanMs: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const olderThanMs = Math.max(5 * 60 * 1000, Math.min(args.olderThanMs ?? 40 * 60 * 1000, 24 * 60 * 60 * 1000));
    const limit = Math.max(10, Math.min(args.limit ?? 120, 400));
    const cutoff = Date.now() - olderThanMs;

    const staleStatusMessages = await ctx.db
      .query("messages")
      .withIndex("by_isStatus_and_messageAt", (q) => q.eq("isStatus", true).lte("messageAt", cutoff))
      .take(limit);

    const candidateAssetIds = new Set<Id<"mediaAssets">>();
    for (const message of staleStatusMessages) {
      if (message.mediaAssetId) {
        candidateAssetIds.add(message.mediaAssetId);
      }
      await ctx.db.delete(message._id);
    }

    let deletedAssets = 0;
    for (const assetId of candidateAssetIds) {
      const remainingReferences = await ctx.db
        .query("messages")
        .withIndex("by_mediaAssetId", (q) => q.eq("mediaAssetId", assetId))
        .take(1);
      if (remainingReferences.length > 0) {
        continue;
      }

      const asset = await ctx.db.get(assetId);
      if (!asset) {
        continue;
      }
      await ctx.db.delete(asset._id);
      await ctx.storage.delete(asset.fileId as Id<"_storage">);
      deletedAssets += 1;
    }

    const hasMore = (
      await ctx.db
        .query("messages")
        .withIndex("by_isStatus_and_messageAt", (q) => q.eq("isStatus", true).lte("messageAt", cutoff))
        .take(1)
    ).length > 0;

    return {
      deletedMessages: staleStatusMessages.length,
      deletedAssets,
      hasMore,
      cutoff,
    };
  },
});

export const compactContextWindows = mutation({
  args: {
    statusKeepPerThread: v.optional(v.number()),
    groupKeepPerThread: v.optional(v.number()),
    groupThreadJids: v.optional(v.array(v.string())),
    maxThreads: v.optional(v.number()),
    maxDeletes: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const statusKeepPerThread = clampInt(args.statusKeepPerThread, 24, 8, 120);
    const groupKeepPerThread = clampInt(args.groupKeepPerThread, 24, 8, 120);
    const maxThreads = clampInt(args.maxThreads, 20, 2, 80);
    const maxDeletes = clampInt(args.maxDeletes, 240, 20, 800);

    const deletionQueue: Id<"messages">[] = [];
    const candidateAssetIds = new Set<Id<"mediaAssets">>();
    const enqueueMessageDelete = (message: Doc<"messages">) => {
      if (deletionQueue.length >= maxDeletes) {
        return false;
      }
      deletionQueue.push(message._id);
      if (message.mediaAssetId) {
        candidateAssetIds.add(message.mediaAssetId);
      }
      return true;
    };

    const statusRecent = await ctx.db
      .query("messages")
      .withIndex("by_isStatus_and_messageAt", (q) => q.eq("isStatus", true))
      .order("desc")
      .take(Math.min(maxThreads * 40, 1200));
    const statusThreadIds = [...new Set(statusRecent.map((row) => row.threadId))].slice(0, maxThreads);
    for (const threadId of statusThreadIds) {
      if (deletionQueue.length >= maxDeletes) {
        break;
      }
      const rows = await ctx.db
        .query("messages")
        .withIndex("by_thread_messageAt", (q) => q.eq("threadId", threadId))
        .order("desc")
        .take(Math.min(statusKeepPerThread + maxDeletes, 1200));
      const statusRows = rows.filter((row) => row.isStatus);
      for (const stale of statusRows.slice(statusKeepPerThread)) {
        if (!enqueueMessageDelete(stale)) {
          break;
        }
      }
    }

    const targetGroupThreadIds = new Set<Id<"threads">>();
    const configuredGroupJids = (args.groupThreadJids || []).map((jid) => jid.trim()).filter(Boolean);
    if (configuredGroupJids.length > 0) {
      for (const jid of configuredGroupJids.slice(0, maxThreads)) {
        const thread = await ctx.db
          .query("threads")
          .withIndex("by_jid", (q) => q.eq("jid", jid))
          .first();
        if (thread && (thread.threadKind === "group" || thread.isGroup)) {
          targetGroupThreadIds.add(thread._id);
        }
      }
    } else {
      const recentGroups = await ctx.db
        .query("threads")
        .withIndex("by_threadKind_and_lastMessageAt", (q) => q.eq("threadKind", "group"))
        .order("desc")
        .take(maxThreads);
      for (const thread of recentGroups) {
        targetGroupThreadIds.add(thread._id);
      }
    }

    for (const threadId of targetGroupThreadIds) {
      if (deletionQueue.length >= maxDeletes) {
        break;
      }
      const rows = await ctx.db
        .query("messages")
        .withIndex("by_thread_messageAt", (q) => q.eq("threadId", threadId))
        .order("desc")
        .take(Math.min(groupKeepPerThread + maxDeletes, 1500));
      for (const stale of rows.slice(groupKeepPerThread)) {
        if (!enqueueMessageDelete(stale)) {
          break;
        }
      }
    }

    if (deletionQueue.length === 0) {
      return {
        deletedMessages: 0,
        deletedAssets: 0,
        hitDeleteLimit: false,
      };
    }

    for (const messageId of deletionQueue) {
      await ctx.db.delete(messageId);
    }

    let deletedAssets = 0;
    for (const assetId of candidateAssetIds) {
      const stillReferenced = await ctx.db
        .query("messages")
        .withIndex("by_mediaAssetId", (q) => q.eq("mediaAssetId", assetId))
        .take(1);
      if (stillReferenced.length > 0) {
        continue;
      }
      const asset = await ctx.db.get(assetId);
      if (!asset) {
        continue;
      }
      await ctx.db.delete(asset._id);
      await ctx.storage.delete(asset.fileId as Id<"_storage">);
      deletedAssets += 1;
    }

    return {
      deletedMessages: deletionQueue.length,
      deletedAssets,
      hitDeleteLimit: deletionQueue.length >= maxDeletes,
    };
  },
});

export const getEnabledByKind = query({
  args: {
    kind: stickerOrMemeKindValidator,
  },
  handler: async (ctx, args) => {
    const assets = await ctx.db
      .query("mediaAssets")
      .withIndex("by_kind_and_enabled", (q) => q.eq("kind", args.kind).eq("enabled", true))
      .order("desc")
      .take(100);

    return assets;
  },
});

export const getBestGeneratedMemeForThread = query({
  args: {
    threadId: v.id("threads"),
    cooldownMs: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const cooldownMs = Math.max(0, Math.min(args.cooldownMs ?? 0, 7 * 24 * 60 * 60 * 1000));
    const limit = Math.max(1, Math.min(args.limit ?? 30, 80));
    const now = Date.now();
    const cutoff = now - cooldownMs;

    const rows = await ctx.db
      .query("mediaAssets")
      .withIndex("by_kind_and_source_and_threadId_and_enabled", (q) =>
        q.eq("kind", "meme").eq("source", "generated").eq("threadId", args.threadId).eq("enabled", true),
      )
      .order("desc")
      .take(limit);

    const eligible = rows.filter((row) => !row.lastUsedAt || row.lastUsedAt <= cutoff);
    if (eligible.length === 0) {
      return null;
    }

    const picked = [...eligible].sort((left, right) => {
      const leftUsedAt = left.lastUsedAt || 0;
      const rightUsedAt = right.lastUsedAt || 0;
      if (leftUsedAt !== rightUsedAt) {
        return leftUsedAt - rightUsedAt;
      }
      return right._creationTime - left._creationTime;
    })[0];

    return {
      assetId: picked._id,
      generationContextSnippet: picked.generationContextSnippet,
      lastUsedAt: picked.lastUsedAt,
      createdAt: picked._creationTime,
    };
  },
});

export const getBestUploadedMemeFallback = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("mediaAssets")
      .withIndex("by_kind_and_enabled", (q) => q.eq("kind", "meme").eq("enabled", true))
      .order("desc")
      .take(120);

    const picked = rows.find((row) => {
      const source = row.source || "uploaded";
      if (source !== "uploaded") {
        return false;
      }
      return !row.threadId;
    });

    return picked ? { assetId: picked._id } : null;
  },
});

export const markAssetUsed = mutation({
  args: {
    assetId: v.id("mediaAssets"),
  },
  handler: async (ctx, args) => {
    const asset = await ctx.db.get(args.assetId);
    if (!asset) {
      return null;
    }
    const now = Date.now();
    await ctx.db.patch(asset._id, {
      lastUsedAt: now,
      updatedAt: now,
    });
    return asset._id;
  },
});

export const getAssetDownloadUrl = query({
  args: {
    assetId: v.id("mediaAssets"),
  },
  handler: async (ctx, args) => {
    const asset = await ctx.db.get(args.assetId);
    if (!asset || !asset.enabled) {
      return null;
    }

    const url = await ctx.storage.getUrl(asset.fileId);
    if (!url) {
      return null;
    }

    return {
      assetId: asset._id,
      kind: asset.kind,
      mimeType: asset.mimeType,
      label: asset.label,
      contextSummary: asset.contextSummary,
      contextTags: asset.contextTags,
      contextTriggers: asset.contextTriggers,
      contextAvoid: asset.contextAvoid,
      contextConfidence: asset.contextConfidence,
      contextUpdatedAt: asset.contextUpdatedAt,
      url,
    };
  },
});

export const toggleAsset = mutation({
  args: {
    assetId: v.id("mediaAssets"),
    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    const asset = await ctx.db.get(args.assetId);
    if (!asset) {
      return null;
    }
    await ctx.db.patch(asset._id, {
      enabled: args.enabled,
      updatedAt: Date.now(),
    });
    return asset._id;
  },
});

export const updateAssetMetadata = mutation({
  args: {
    assetId: v.id("mediaAssets"),
    label: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    enabled: v.optional(v.boolean()),
    contextSummary: v.optional(v.union(v.string(), v.null())),
    contextTags: v.optional(v.union(v.array(v.string()), v.null())),
    contextTriggers: v.optional(v.union(v.array(v.string()), v.null())),
    contextAvoid: v.optional(v.union(v.array(v.string()), v.null())),
    contextConfidence: v.optional(v.union(v.number(), v.null())),
    contextSource: v.optional(v.union(v.literal("vision_ai"), v.literal("heuristic"))),
  },
  handler: async (ctx, args) => {
    const asset = await ctx.db.get(args.assetId);
    if (!asset) {
      return null;
    }

    const now = Date.now();
    const patch: {
      label?: string;
      tags?: string[];
      enabled?: boolean;
      contextSummary?: string;
      contextTags?: string[];
      contextTriggers?: string[];
      contextAvoid?: string[];
      contextConfidence?: number;
      contextSource?: "vision_ai" | "heuristic";
      contextUpdatedAt?: number;
      updatedAt: number;
    } = {
      updatedAt: now,
    };
    let contextTouched = false;

    if (args.label !== undefined) {
      patch.label = normalizeLabel(args.label, asset.kind);
    }
    if (args.tags !== undefined) {
      patch.tags = normalizeTags(args.tags);
    }
    if (args.enabled !== undefined) {
      patch.enabled = args.enabled;
    }
    if (args.contextSummary !== undefined) {
      patch.contextSummary = args.contextSummary?.trim().slice(0, 240) || undefined;
      contextTouched = true;
    }
    if (args.contextTags !== undefined) {
      patch.contextTags = args.contextTags === null ? undefined : normalizeContextPhrases(args.contextTags);
      contextTouched = true;
    }
    if (args.contextTriggers !== undefined) {
      patch.contextTriggers = args.contextTriggers === null ? undefined : normalizeContextPhrases(args.contextTriggers);
      contextTouched = true;
    }
    if (args.contextAvoid !== undefined) {
      patch.contextAvoid = args.contextAvoid === null ? undefined : normalizeContextPhrases(args.contextAvoid);
      contextTouched = true;
    }
    if (args.contextConfidence !== undefined) {
      patch.contextConfidence =
        args.contextConfidence === null ? undefined : Math.max(0, Math.min(1, args.contextConfidence));
      contextTouched = true;
    }

    if (contextTouched) {
      patch.contextUpdatedAt = now;
      patch.contextSource = args.contextSource || asset.contextSource || "heuristic";
    } else if (args.contextSource) {
      patch.contextSource = args.contextSource;
    }

    await ctx.db.patch(asset._id, patch);
    return asset._id;
  },
});

export const mergeAssets = mutation({
  args: {
    sourceAssetId: v.id("mediaAssets"),
    targetAssetId: v.id("mediaAssets"),
  },
  handler: async (ctx, args) => {
    if (args.sourceAssetId === args.targetAssetId) {
      throw new Error("Source and target must be different assets.");
    }

    const [source, target] = await Promise.all([ctx.db.get(args.sourceAssetId), ctx.db.get(args.targetAssetId)]);
    if (!source || !target) {
      throw new Error("Both source and target assets must exist.");
    }
    if (source.kind !== target.kind) {
      throw new Error("You can only merge assets of the same kind.");
    }

    const referenceRewrite = await rewriteAssetReferences(ctx, {
      fromAssetId: source._id,
      toAssetId: target._id,
      blockOnActiveOutbox: false,
    });

    const now = Date.now();
    const mergedTags = normalizeTags([...(target.tags || []), ...(source.tags || [])]);
    const mergedSummary = mergeContextSummary(target.contextSummary, source.contextSummary);
    const mergedContextTags = normalizeContextPhrases([...(target.contextTags || []), ...(source.contextTags || [])]);
    const mergedContextTriggers = normalizeContextPhrases([...(target.contextTriggers || []), ...(source.contextTriggers || [])]);
    const mergedContextAvoid = normalizeContextPhrases([...(target.contextAvoid || []), ...(source.contextAvoid || [])]);
    const mergedContextConfidence =
      target.contextConfidence !== undefined || source.contextConfidence !== undefined
        ? Math.max(target.contextConfidence || 0, source.contextConfidence || 0)
        : undefined;

    await ctx.db.patch(target._id, {
      label: normalizeLabel(target.label, source.label || target.kind),
      tags: mergedTags,
      enabled: target.enabled || source.enabled,
      generationContextSnippet: target.generationContextSnippet || source.generationContextSnippet,
      contextSummary: mergedSummary,
      contextTags: mergedContextTags,
      contextTriggers: mergedContextTriggers,
      contextAvoid: mergedContextAvoid,
      contextConfidence: mergedContextConfidence,
      contextSource: target.contextSource || source.contextSource,
      contextUpdatedAt:
        mergedSummary || mergedContextTags || mergedContextTriggers || mergedContextAvoid || mergedContextConfidence !== undefined
          ? now
          : target.contextUpdatedAt,
      updatedAt: now,
    });

    await ctx.db.delete(source._id);
    if (source.fileId !== target.fileId) {
      await ctx.storage.delete(source.fileId as Id<"_storage">);
    }

    return {
      sourceAssetId: source._id,
      targetAssetId: target._id,
      kind: target.kind,
      movedReferences: referenceRewrite,
    };
  },
});

export const deleteAsset = mutation({
  args: {
    assetId: v.id("mediaAssets"),
    replacementAssetId: v.optional(v.id("mediaAssets")),
  },
  handler: async (ctx, args) => {
    const asset = await ctx.db.get(args.assetId);
    if (!asset) {
      return null;
    }

    let replacement: Doc<"mediaAssets"> | null = null;
    if (args.replacementAssetId) {
      replacement = await ctx.db.get(args.replacementAssetId);
      if (!replacement) {
        throw new Error("Replacement asset not found.");
      }
      if (replacement._id === asset._id) {
        throw new Error("Replacement asset must be different from the asset being deleted.");
      }
      if (replacement.kind !== asset.kind) {
        throw new Error("Replacement asset must match the asset kind.");
      }
    }

    const referenceRewrite = await rewriteAssetReferences(ctx, {
      fromAssetId: asset._id,
      toAssetId: replacement?._id,
      blockOnActiveOutbox: !replacement,
    });
    if (!replacement && referenceRewrite.activeOutboxReferences > 0) {
      throw new Error(
        `Cannot delete this asset because ${referenceRewrite.activeOutboxReferences} pending outbox item(s) still depend on it. Merge first or provide a replacement.`,
      );
    }

    await ctx.db.delete(asset._id);
    if (!replacement || replacement.fileId !== asset.fileId) {
      await ctx.storage.delete(asset.fileId as Id<"_storage">);
    }
    return {
      deletedAssetId: asset._id,
      replacementAssetId: replacement?._id,
      rewrittenReferences: referenceRewrite,
    };
  },
});
