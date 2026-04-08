import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";

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

export const deleteAsset = mutation({
  args: {
    assetId: v.id("mediaAssets"),
  },
  handler: async (ctx, args) => {
    const asset = await ctx.db.get(args.assetId);
    if (!asset) {
      return null;
    }

    const id = asset._id;
    await ctx.db.delete(id);
    await ctx.storage.delete(asset.fileId as Id<"_storage">);
    return id;
  },
});
