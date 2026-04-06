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
    enabled: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("mediaAssets", {
      kind: args.kind,
      label: args.label.trim().slice(0, 120) || args.kind,
      tags: normalizeTags(args.tags),
      fileId: args.fileId,
      mimeType: args.mimeType.trim(),
      enabled: args.enabled ?? true,
      createdAt: now,
      updatedAt: now,
    });
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
