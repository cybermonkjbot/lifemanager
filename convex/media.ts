import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";

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
    kind: v.union(v.literal("sticker"), v.literal("meme")),
    label: v.string(),
    tags: v.array(v.string()),
    fileId: v.id("_storage"),
    mimeType: v.string(),
    contentHash: v.optional(v.string()),
    source: v.optional(v.union(v.literal("uploaded"), v.literal("generated"))),
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
    kind: v.union(v.literal("sticker"), v.literal("meme")),
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
    kind: v.union(v.literal("sticker"), v.literal("meme")),
    label: v.string(),
    tags: v.array(v.string()),
    fileId: v.id("_storage"),
    mimeType: v.string(),
    contentHash: v.string(),
    source: v.optional(v.union(v.literal("uploaded"), v.literal("generated"))),
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
    kind: v.optional(v.union(v.literal("sticker"), v.literal("meme"))),
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

export const getEnabledByKind = query({
  args: {
    kind: v.union(v.literal("sticker"), v.literal("meme")),
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
