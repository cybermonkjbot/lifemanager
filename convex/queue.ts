import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";

export const list = query({
  args: {
    draftLimit: v.optional(v.number()),
    followupLimit: v.optional(v.number()),
    todoLimit: v.optional(v.number()),
    guardrailLimit: v.optional(v.number()),
    includeResolvedGuardrails: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const draftLimit = Math.min(args.draftLimit ?? 40, 100);
    const followupLimit = Math.min(args.followupLimit ?? 40, 100);
    const todoLimit = Math.min(args.todoLimit ?? 40, 100);
    const guardrailLimit = Math.min(args.guardrailLimit ?? 20, 100);
    const includeResolvedGuardrails = Boolean(args.includeResolvedGuardrails);

    const pendingDrafts = await ctx.db
      .query("replyDrafts")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .order("desc")
      .take(draftLimit);

    const followupConfirmations = await ctx.db
      .query("followUps")
      .withIndex("by_status_dueAt", (q) => q.eq("status", "suggested"))
      .order("asc")
      .take(followupLimit);

    const todoCandidates = await ctx.db
      .query("todoCandidates")
      .withIndex("by_status", (q) => q.eq("status", "suggested"))
      .order("desc")
      .take(todoLimit);

    const guardrailFlags = includeResolvedGuardrails
      ? await ctx.db
          .query("guardrailEvents")
          .withIndex("by_createdAt")
          .order("desc")
          .take(guardrailLimit)
      : await ctx.db
          .query("guardrailEvents")
          .withIndex("by_resolvedAt_and_createdAt", (q) => q.eq("resolvedAt", undefined))
          .order("desc")
          .take(guardrailLimit);

    const mediaPreviewCache = new Map<
      Id<"mediaAssets">,
      Promise<{
        assetId: Id<"mediaAssets">;
        kind: "sticker" | "meme";
        mimeType: string;
        label: string;
        url: string | null;
      } | null>
    >();

    const loadMediaPreview = async (assetId?: Id<"mediaAssets">) => {
      if (!assetId) {
        return null;
      }
      let previewPromise = mediaPreviewCache.get(assetId);
      if (!previewPromise) {
        previewPromise = (async () => {
          const asset = await ctx.db.get(assetId);
          if (!asset) {
            return null;
          }
          const url = await ctx.storage.getUrl(asset.fileId);
          return {
            assetId,
            kind: asset.kind,
            mimeType: asset.mimeType,
            label: asset.label,
            url,
          };
        })();
        mediaPreviewCache.set(assetId, previewPromise);
      }
      return await previewPromise;
    };

    const enrichedDrafts = await Promise.all(
      pendingDrafts.map(async (draft) => {
        const thread = await ctx.db.get(draft.threadId);
        const sourceMessage = await ctx.db.get(draft.sourceMessageId);
        const draftMediaPreview = await loadMediaPreview(draft.mediaAssetId);
        const sourceMediaPreview = await loadMediaPreview(sourceMessage?.mediaAssetId);
        return {
          ...draft,
          thread,
          mediaPreview: draftMediaPreview,
          sourceMessage: sourceMessage
            ? {
                ...sourceMessage,
                mediaPreview: sourceMediaPreview,
              }
            : null,
        };
      }),
    );

    return {
      needsReply: enrichedDrafts,
      followupConfirmations,
      todoCandidates,
      guardrailFlags,
    };
  },
});

export const resolveGuardrail = mutation({
  args: {
    guardrailEventId: v.id("guardrailEvents"),
    resolutionNote: v.optional(v.string()),
    closeDraft: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.guardrailEventId);
    if (!row) {
      throw new Error("Guardrail event not found.");
    }

    const now = Date.now();
    await ctx.db.patch(row._id, {
      resolvedAt: now,
      resolvedBy: "dashboard",
      resolutionNote: args.resolutionNote?.trim() || "Resolved from queue.",
    });

    if (args.closeDraft !== false && row.draftId) {
      const draft = await ctx.db.get(row.draftId);
      if (draft && draft.status === "pending") {
        await ctx.db.patch(draft._id, {
          status: "rejected",
          updatedAt: now,
          reason: draft.reason || "Guardrail reviewed and closed without send.",
        });
      }
    }

    await ctx.db.insert("systemEvents", {
      source: "dashboard",
      eventType: "guardrail.resolved",
      threadId: row.threadId,
      detail: (args.resolutionNote?.trim() || "Guardrail resolved.").slice(0, 240),
      createdAt: now,
    });

    return row._id;
  },
});
