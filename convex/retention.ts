import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import { internalAction, internalMutation } from "./_generated/server";

const DEFAULT_IMAGE_RETENTION_DAYS = 21;
const BATCH_SIZE = 100;
const MAX_BATCHES_PER_RUN = 10;

export const run = internalAction({
  args: {
    olderThan: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const olderThan = args.olderThan ?? Date.now() - DEFAULT_IMAGE_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    let deletedMessages = 0;
    let deletedAssets = 0;
    let lastBatchDeletedMessages = 0;

    for (let i = 0; i < MAX_BATCHES_PER_RUN; i += 1) {
      const result = (await ctx.runMutation(internal.retention.deleteBatch, {
        olderThan,
        limit: BATCH_SIZE,
      })) as { deletedMessages: number; deletedAssets: number };

      deletedMessages += result.deletedMessages;
      deletedAssets += result.deletedAssets;
      lastBatchDeletedMessages = result.deletedMessages;

      if (result.deletedMessages < BATCH_SIZE) {
        break;
      }
    }

    const continuationScheduled = lastBatchDeletedMessages === BATCH_SIZE;
    if (continuationScheduled) {
      await ctx.scheduler.runAfter(0, internal.retention.run, { olderThan });
    }

    if (deletedMessages > 0 || deletedAssets > 0) {
      await ctx.runMutation(api.system.recordEvent, {
        source: "convex",
        eventType: "retention.image.cleanup",
        detail: `Deleted ${deletedMessages} image message(s) and ${deletedAssets} image asset(s) older than ${new Date(olderThan).toISOString()}.`,
      });
    }

    return {
      deletedMessages,
      deletedAssets,
      continuationScheduled,
    };
  },
});

export const deleteBatch = internalMutation({
  args: {
    olderThan: v.number(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? BATCH_SIZE, 500);
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_messageType_and_createdAt", (q) => q.eq("messageType", "image").lt("createdAt", args.olderThan))
      .take(limit);

    const candidateAssetIds = new Set<(typeof messages)[number]["mediaAssetId"]>();
    for (const message of messages) {
      if (message.mediaAssetId) {
        candidateAssetIds.add(message.mediaAssetId);
      }
      await ctx.db.delete(message._id);
    }

    let deletedAssets = 0;
    for (const assetId of candidateAssetIds) {
      if (!assetId) {
        continue;
      }
      const remainingReferences = await ctx.db
        .query("messages")
        .withIndex("by_mediaAssetId", (q) => q.eq("mediaAssetId", assetId))
        .take(1);
      if (remainingReferences.length > 0) {
        continue;
      }

      const asset = await ctx.db.get(assetId);
      if (!asset || asset.kind !== "image") {
        continue;
      }
      await ctx.db.delete(asset._id);
      await ctx.storage.delete(asset.fileId);
      deletedAssets += 1;
    }

    return {
      deletedMessages: messages.length,
      deletedAssets,
    };
  },
});
