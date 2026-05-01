import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { internalMutation, mutation, query } from "./_generated/server";
import { assertTenantBillingActive, assertThreadTenantBillingActive } from "./lib/billingAccess";
import { isQueueDraftStale, isTodoCandidateStale } from "./lib/staleness";
import { resolveTenantForQuery } from "./lib/tenantSecurity";

const UNSENT_DRAFT_CLEANUP_MIN_AGE_MS = 20 * 60 * 1000;
const GUARDRAIL_REASON_PATTERNS = [
  /guardrail/i,
  /manual review/i,
  /blocked/i,
  /hard\s*stop/i,
  /do not text/i,
  /leave (it )?here/i,
];

function looksLikeUnsentHardStopOrGuardrailDraft(args: {
  reason?: string;
  text?: string;
}) {
  const haystack = `${args.reason || ""}\n${args.text || ""}`.trim();
  if (!haystack) {
    return false;
  }
  return GUARDRAIL_REASON_PATTERNS.some((pattern) => pattern.test(haystack));
}

export const list = query({
  args: {
    tenantId: v.optional(v.id("tenantAccounts")),
    connectorTokenHash: v.optional(v.string()),
    provider: v.optional(v.union(v.literal("whatsapp"), v.literal("instagram"), v.literal("imessage"), v.literal("telegram"), v.literal("all"))),
    draftLimit: v.optional(v.number()),
    followupLimit: v.optional(v.number()),
    todoLimit: v.optional(v.number()),
    guardrailLimit: v.optional(v.number()),
    socialActionLimit: v.optional(v.number()),
    includeResolvedGuardrails: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const tenantId = await resolveTenantForQuery(ctx, args);
    const messageProvider = args.provider || "all";
    const draftLimit = Math.min(args.draftLimit ?? 40, 100);
    const followupLimit = Math.min(args.followupLimit ?? 40, 100);
    const todoLimit = Math.min(args.todoLimit ?? 40, 100);
    const guardrailLimit = Math.min(args.guardrailLimit ?? 20, 100);
    const socialActionLimit = Math.min(args.socialActionLimit ?? 30, 100);
    const includeResolvedGuardrails = Boolean(args.includeResolvedGuardrails);

    const pendingDrafts = tenantId
      ? (
          await ctx.db
            .query("replyDrafts")
            .withIndex("by_tenantId_and_status", (q) => q.eq("tenantId", tenantId).eq("status", "pending"))
            .order("desc")
            .take(Math.max(draftLimit, 100))
        )
          .filter((draft) => messageProvider === "all" || draft.messageProvider === messageProvider)
          .slice(0, draftLimit)
      : messageProvider === "all"
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

    const followupConfirmations = tenantId
      ? await ctx.db
          .query("followUps")
          .withIndex("by_tenantId_and_status_and_dueAt", (q) => q.eq("tenantId", tenantId).eq("status", "suggested"))
          .order("asc")
          .take(followupLimit)
      : await ctx.db
          .query("followUps")
          .withIndex("by_status_dueAt", (q) => q.eq("status", "suggested"))
          .order("asc")
          .take(followupLimit);

    const todoCandidates = tenantId
      ? await ctx.db
          .query("todoCandidates")
          .withIndex("by_tenantId_and_status", (q) => q.eq("tenantId", tenantId).eq("status", "suggested"))
          .order("desc")
          .take(todoLimit)
      : await ctx.db
          .query("todoCandidates")
          .withIndex("by_status", (q) => q.eq("status", "suggested"))
          .order("desc")
          .take(todoLimit);

    const guardrailFlagWindow = includeResolvedGuardrails
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
    const guardrailFlags = tenantId
      ? (
          await Promise.all(
            guardrailFlagWindow.map(async (event) => {
              if (!event.threadId) {
                return null;
              }
              const thread = await ctx.db.get(event.threadId);
              return thread?.tenantId === tenantId ? event : null;
            }),
          )
        ).filter((event): event is (typeof guardrailFlagWindow)[number] => Boolean(event))
      : guardrailFlagWindow;

    const pendingSocialActions =
      messageProvider === "instagram" || messageProvider === "all"
        ? tenantId
          ? await ctx.db
              .query("instagramSocialActions")
              .withIndex("by_tenantId_and_status_and_createdAt", (q) =>
                q.eq("tenantId", tenantId).eq("status", "pending_review"),
              )
              .order("desc")
              .take(socialActionLimit)
          : await ctx.db
              .query("instagramSocialActions")
              .withIndex("by_status_and_createdAt", (q) => q.eq("status", "pending_review"))
              .order("desc")
              .take(socialActionLimit)
        : [];

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
      socialActions: pendingSocialActions,
    };
  },
});

export const removeStaleQueueEntries = internalMutation({
  args: {
    tenantId: v.optional(v.id("tenantAccounts")),
    draftLimit: v.optional(v.number()),
    todoLimit: v.optional(v.number()),
    guardrailLimit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    await assertTenantBillingActive(ctx, args.tenantId, now);
    const draftLimit = Math.min(Math.max(5, Math.round(args.draftLimit ?? 40)), 200);
    const todoLimit = Math.min(Math.max(5, Math.round(args.todoLimit ?? 40)), 200);
    const guardrailLimit = Math.min(Math.max(10, Math.round(args.guardrailLimit ?? 80)), 240);

    const [pendingDrafts, suggestedTodos, unresolvedGuardrails] = await Promise.all([
      args.tenantId
        ? ctx.db
            .query("replyDrafts")
            .withIndex("by_tenantId_and_status", (q) => q.eq("tenantId", args.tenantId).eq("status", "pending"))
            .order("desc")
            .take(draftLimit)
        : ctx.db
            .query("replyDrafts")
            .withIndex("by_status", (q) => q.eq("status", "pending"))
            .order("desc")
            .take(draftLimit),
      args.tenantId
        ? ctx.db
            .query("todoCandidates")
            .withIndex("by_tenantId_and_status", (q) => q.eq("tenantId", args.tenantId).eq("status", "suggested"))
            .order("desc")
            .take(todoLimit)
        : ctx.db
            .query("todoCandidates")
            .withIndex("by_status", (q) => q.eq("status", "suggested"))
            .order("desc")
            .take(todoLimit),
      ctx.db
        .query("guardrailEvents")
        .withIndex("by_resolvedAt_and_createdAt", (q) => q.eq("resolvedAt", undefined))
        .order("desc")
        .take(guardrailLimit),
    ]);

    let staleDrafts = 0;
    let staleTodoCandidates = 0;
    let cleanedUnsentDrafts = 0;
    let resolvedGuardrailEvents = 0;
    const touchedThreads = new Set<Id<"threads">>();
    const touchedDrafts = new Set<Id<"replyDrafts">>();

    for (const draft of pendingDrafts) {
      const [thread, sourceMessage] = await Promise.all([ctx.db.get(draft.threadId), ctx.db.get(draft.sourceMessageId)]);
      try {
        await assertTenantBillingActive(ctx, draft.tenantId || thread?.tenantId, now);
      } catch {
        continue;
      }
      const stale = await isQueueDraftStale({
        ctx,
        draft,
        thread,
        sourceMessage,
        now,
      });
      if (stale) {
        await ctx.db.patch(draft._id, {
          status: "rejected",
          reason: draft.reason || "Auto-removed as stale from queue.",
          updatedAt: now,
        });
        staleDrafts += 1;
        touchedThreads.add(draft.threadId);
        touchedDrafts.add(draft._id);
        continue;
      }

      const draftAgeMs = now - Math.max(draft.updatedAt || 0, draft.createdAt || 0);
      if (
        draftAgeMs >= UNSENT_DRAFT_CLEANUP_MIN_AGE_MS &&
        looksLikeUnsentHardStopOrGuardrailDraft({
          reason: draft.reason,
          text: draft.text,
        })
      ) {
        await ctx.db.patch(draft._id, {
          status: "rejected",
          reason: draft.reason || "Auto-cleaned: generated but intentionally unsent.",
          updatedAt: now,
        });
        cleanedUnsentDrafts += 1;
        touchedThreads.add(draft.threadId);
        touchedDrafts.add(draft._id);
      }
    }

    for (const candidate of suggestedTodos) {
      const [thread, sourceMessage] = await Promise.all([ctx.db.get(candidate.threadId), ctx.db.get(candidate.sourceMessageId)]);
      try {
        await assertTenantBillingActive(ctx, candidate.tenantId || thread?.tenantId, now);
      } catch {
        continue;
      }
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

    for (const event of unresolvedGuardrails) {
      if (!event.draftId) {
        continue;
      }
      const draft = await ctx.db.get(event.draftId);
      if (args.tenantId) {
        if (event.threadId) {
          const thread = await ctx.db.get(event.threadId);
          if (thread?.tenantId !== args.tenantId) {
            continue;
          }
        } else if (draft?.tenantId !== args.tenantId) {
          continue;
        }
      }
      if (event.threadId) {
        try {
          await assertThreadTenantBillingActive(ctx, event.threadId, now);
        } catch {
          continue;
        }
      } else if (draft) {
        try {
          await assertTenantBillingActive(ctx, draft.tenantId, now);
        } catch {
          continue;
        }
      }
      const eventAgeMs = now - Math.max(event.createdAt || 0, 0);
      const draftStillActionable = Boolean(draft && draft.status === "pending");
      if (draftStillActionable && eventAgeMs < UNSENT_DRAFT_CLEANUP_MIN_AGE_MS) {
        continue;
      }
      if (draft && !touchedDrafts.has(draft._id) && draft.status === "pending") {
        continue;
      }
      await ctx.db.patch(event._id, {
        resolvedAt: now,
        resolvedBy: "system",
        resolutionNote: "Auto-resolved after unsent draft cleanup.",
      });
      resolvedGuardrailEvents += 1;
      if (event.threadId) {
        touchedThreads.add(event.threadId);
      }
    }

    for (const threadId of touchedThreads) {
      await ctx.scheduler.runAfter(0, internal.backlog.refreshThread, {
        threadId,
      });
    }

    const removed = staleDrafts + cleanedUnsentDrafts + staleTodoCandidates;
    if (removed > 0 || resolvedGuardrailEvents > 0) {
      await ctx.db.insert("systemEvents", {
        source: "convex",
        eventType: "queue.stale.cleaned",
        detail: `Auto-removed ${staleDrafts} stale draft(s), ${cleanedUnsentDrafts} unsent guardrail/hard-stop draft(s), ${staleTodoCandidates} stale TODO candidate(s), and resolved ${resolvedGuardrailEvents} guardrail event(s).`,
        createdAt: now,
      });
    }

    return {
      staleDrafts,
      cleanedUnsentDrafts,
      staleTodoCandidates,
      resolvedGuardrailEvents,
      removed,
      scannedDrafts: pendingDrafts.length,
      scannedTodoCandidates: suggestedTodos.length,
      scannedGuardrailEvents: unresolvedGuardrails.length,
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
    if (row.threadId) {
      await assertThreadTenantBillingActive(ctx, row.threadId, now);
    } else if (row.draftId) {
      const draft = await ctx.db.get(row.draftId);
      await assertTenantBillingActive(ctx, draft?.tenantId, now);
    }
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
    tenantId: v.optional(v.id("tenantAccounts")),
    limit: v.optional(v.number()),
    closeDraft: v.optional(v.boolean()),
    resolutionNote: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    await assertTenantBillingActive(ctx, args.tenantId, now);
    const batchSize = Math.min(Math.max(5, Math.round(args.limit ?? 80)), 200);
    const closeDraft = args.closeDraft !== false;
    const resolutionNote = args.resolutionNote?.trim() || "Bulk resolved from queue.";

    const rows = await ctx.db
      .query("guardrailEvents")
      .withIndex("by_resolvedAt_and_createdAt", (q) => q.eq("resolvedAt", undefined))
      .order("desc")
      .take(batchSize);

    const scopedRows = args.tenantId
      ? (
          await Promise.all(
            rows.map(async (row) => {
              if (row.threadId) {
                const thread = await ctx.db.get(row.threadId);
                return thread?.tenantId === args.tenantId ? row : null;
              }
              if (row.draftId) {
                const draft = await ctx.db.get(row.draftId);
                return draft?.tenantId === args.tenantId ? row : null;
              }
              return null;
            }),
          )
        ).filter((row): row is (typeof rows)[number] => Boolean(row))
      : rows;

    let closedDrafts = 0;
    for (const row of scopedRows) {
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

    if (scopedRows.length > 0) {
      await ctx.db.insert("systemEvents", {
        source: "dashboard",
        eventType: "guardrail.cleared",
        detail: `Bulk resolved ${scopedRows.length} guardrail event(s); closed ${closedDrafts} draft(s).`,
        createdAt: now,
      });
    }

    return {
      cleared: scopedRows.length,
      closedDrafts,
      hasMore: rows.length === batchSize,
    };
  },
});
