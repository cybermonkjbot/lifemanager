import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { internalMutation, mutation, query } from "./_generated/server";
import { isQueueDraftStale, isTodoCandidateStale } from "./lib/staleness";

export const list = query({
  args: {
    provider: v.optional(v.union(v.literal("whatsapp"), v.literal("instagram"), v.literal("all"))),
    draftLimit: v.optional(v.number()),
    followupLimit: v.optional(v.number()),
    todoLimit: v.optional(v.number()),
    guardrailLimit: v.optional(v.number()),
    includeResolvedGuardrails: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const messageProvider = args.provider || "all";
    const draftLimit = Math.min(args.draftLimit ?? 40, 100);
    const followupLimit = Math.min(args.followupLimit ?? 40, 100);
    const todoLimit = Math.min(args.todoLimit ?? 40, 100);
    const guardrailLimit = Math.min(args.guardrailLimit ?? 20, 100);
    const includeResolvedGuardrails = Boolean(args.includeResolvedGuardrails);

    const pendingDrafts =
      messageProvider === "all"
        ? await ctx.db
            .query("replyDrafts")
            .withIndex("by_status", (q) => q.eq("status", "pending"))
            .order("desc")
            .take(draftLimit)
        : await ctx.db
            .query("replyDrafts")
            .withIndex("by_messageProvider_and_status", (q) => q.eq("messageProvider", messageProvider).eq("status", "pending"))
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
        kind: "sticker" | "meme" | "image" | "video" | "audio" | "document";
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
        const stale = await isQueueDraftStale({
          ctx,
          draft,
          thread,
          sourceMessage,
          now,
        });
        const draftMediaPreview = await loadMediaPreview(draft.mediaAssetId);
        const sourceMediaPreview = await loadMediaPreview(sourceMessage?.mediaAssetId);
        return {
          ...draft,
          stale,
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

    const enrichedFollowups = (
      await Promise.all(
        followupConfirmations.map(async (followup) => {
          const [thread, sourceMessage] = await Promise.all([
            ctx.db.get(followup.threadId),
            ctx.db.get(followup.sourceMessageId),
          ]);
          return {
            ...followup,
            thread,
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
      )
    ).filter((item) => (messageProvider === "all" ? true : (item.thread?.provider || "whatsapp") === messageProvider));

    const enrichedTodoCandidates = await Promise.all(
      todoCandidates.map(async (candidate) => {
        const [thread, sourceMessage] = await Promise.all([
          ctx.db.get(candidate.threadId),
          ctx.db.get(candidate.sourceMessageId),
        ]);
        const stale = await isTodoCandidateStale({
          ctx,
          candidate,
          thread,
          sourceMessage,
          now,
        });
        return {
          ...candidate,
          stale,
          thread,
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
    );

    const enrichedGuardrailFlags = await Promise.all(
      guardrailFlags.map(async (item) => {
        const thread = item.threadId ? await ctx.db.get(item.threadId) : null;
        return {
          ...item,
          thread,
        };
      }),
    );

    return {
      needsReply:
        messageProvider === "all"
          ? enrichedDrafts.filter((draft) => !draft.stale)
          : enrichedDrafts.filter(
              (draft) =>
                !draft.stale && (draft.thread?.provider || draft.messageProvider || "whatsapp") === messageProvider,
            ),
      followupConfirmations: enrichedFollowups,
      todoCandidates:
        messageProvider === "all"
          ? enrichedTodoCandidates.filter((item) => !item.stale)
          : enrichedTodoCandidates.filter(
              (item) => !item.stale && (item.thread?.provider || "whatsapp") === messageProvider,
            ),
      guardrailFlags:
        messageProvider === "all"
          ? enrichedGuardrailFlags
          : enrichedGuardrailFlags.filter((item) => (item.thread?.provider || "whatsapp") === messageProvider),
    };
  },
});

export const removeStaleQueueEntries = internalMutation({
  args: {
    draftLimit: v.optional(v.number()),
    todoLimit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const draftLimit = Math.min(Math.max(5, Math.round(args.draftLimit ?? 40)), 200);
    const todoLimit = Math.min(Math.max(5, Math.round(args.todoLimit ?? 40)), 200);

    const [pendingDrafts, suggestedTodos] = await Promise.all([
      ctx.db
        .query("replyDrafts")
        .withIndex("by_status", (q) => q.eq("status", "pending"))
        .order("desc")
        .take(draftLimit),
      ctx.db
        .query("todoCandidates")
        .withIndex("by_status", (q) => q.eq("status", "suggested"))
        .order("desc")
        .take(todoLimit),
    ]);

    let staleDrafts = 0;
    let staleTodoCandidates = 0;
    const touchedThreads = new Set<Id<"threads">>();

    for (const draft of pendingDrafts) {
      const [thread, sourceMessage] = await Promise.all([ctx.db.get(draft.threadId), ctx.db.get(draft.sourceMessageId)]);
      const stale = await isQueueDraftStale({
        ctx,
        draft,
        thread,
        sourceMessage,
        now,
      });
      if (!stale) {
        continue;
      }
      await ctx.db.patch(draft._id, {
        status: "rejected",
        reason: draft.reason || "Auto-removed as stale from queue.",
        updatedAt: now,
      });
      staleDrafts += 1;
      touchedThreads.add(draft.threadId);
    }

    for (const candidate of suggestedTodos) {
      const [thread, sourceMessage] = await Promise.all([ctx.db.get(candidate.threadId), ctx.db.get(candidate.sourceMessageId)]);
      const stale = await isTodoCandidateStale({
        ctx,
        candidate,
        thread,
        sourceMessage,
        now,
      });
      if (!stale) {
        continue;
      }
      await ctx.db.patch(candidate._id, {
        status: "dismissed",
        updatedAt: now,
      });
      staleTodoCandidates += 1;
      touchedThreads.add(candidate.threadId);
    }

    for (const threadId of touchedThreads) {
      await ctx.scheduler.runAfter(0, internal.backlog.refreshThread, {
        threadId,
      });
    }

    const removed = staleDrafts + staleTodoCandidates;
    if (removed > 0) {
      await ctx.db.insert("systemEvents", {
        source: "convex",
        eventType: "queue.stale.cleaned",
        detail: `Auto-removed ${staleDrafts} stale draft(s) and ${staleTodoCandidates} stale TODO candidate(s).`,
        createdAt: now,
      });
    }

    return {
      staleDrafts,
      staleTodoCandidates,
      removed,
      scannedDrafts: pendingDrafts.length,
      scannedTodoCandidates: suggestedTodos.length,
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

export const clearAllGuardrails = mutation({
  args: {
    limit: v.optional(v.number()),
    closeDraft: v.optional(v.boolean()),
    resolutionNote: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const batchSize = Math.min(Math.max(5, Math.round(args.limit ?? 80)), 200);
    const closeDraft = args.closeDraft !== false;
    const resolutionNote = args.resolutionNote?.trim() || "Bulk resolved from queue.";

    const rows = await ctx.db
      .query("guardrailEvents")
      .withIndex("by_resolvedAt_and_createdAt", (q) => q.eq("resolvedAt", undefined))
      .order("desc")
      .take(batchSize);

    let closedDrafts = 0;
    for (const row of rows) {
      await ctx.db.patch(row._id, {
        resolvedAt: now,
        resolvedBy: "dashboard",
        resolutionNote,
      });

      if (closeDraft && row.draftId) {
        const draft = await ctx.db.get(row.draftId);
        if (draft && draft.status === "pending") {
          await ctx.db.patch(draft._id, {
            status: "rejected",
            updatedAt: now,
            reason: draft.reason || "Closed during bulk guardrail clear.",
          });
          closedDrafts += 1;
        }
      }
    }

    if (rows.length > 0) {
      await ctx.db.insert("systemEvents", {
        source: "dashboard",
        eventType: "guardrail.cleared",
        detail: `Bulk resolved ${rows.length} guardrail event(s); closed ${closedDrafts} draft(s).`,
        createdAt: now,
      });
    }

    return {
      cleared: rows.length,
      closedDrafts,
      hasMore: rows.length === batchSize,
    };
  },
});
