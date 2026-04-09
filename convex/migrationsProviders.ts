import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";

const PROVIDER_DEFAULT = "whatsapp" as const;

export const backfillProvidersBatch = internalMutation({
  args: {
    limitPerTable: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(args.limitPerTable ?? 50, 200));
    let patched = 0;

    const threadRows = await ctx.db.query("threads").withIndex("by_lastMessageAt").order("desc").take(limit * 5);
    for (const row of threadRows) {
      if (row.provider) {
        continue;
      }
      await ctx.db.patch(row._id, { provider: PROVIDER_DEFAULT, updatedAt: Date.now() });
      patched += 1;
      if (patched >= limit) break;
    }

    const messageRows = await ctx.db.query("messages").withIndex("by_createdAt").order("desc").take(limit * 8);
    for (const row of messageRows) {
      const patch: { provider?: "whatsapp" | "instagram"; providerMessageId?: string } = {};
      if (!row.provider) {
        patch.provider = PROVIDER_DEFAULT;
      }
      if (!row.providerMessageId && row.whatsappMessageId) {
        patch.providerMessageId = row.whatsappMessageId;
      }
      if (Object.keys(patch).length === 0) {
        continue;
      }
      await ctx.db.patch(row._id, patch);
      patched += 1;
      if (patched >= limit * 2) break;
    }

    const draftStatuses = ["pending", "approved", "sent", "rejected", "snoozed"] as const;
    for (const status of draftStatuses) {
      const draftRows = await ctx.db
        .query("replyDrafts")
        .withIndex("by_status", (q) => q.eq("status", status))
        .take(limit * 4);
      for (const row of draftRows) {
        if (row.messageProvider) {
          continue;
        }
        const thread = await ctx.db.get(row.threadId);
        await ctx.db.patch(row._id, { messageProvider: thread?.provider || PROVIDER_DEFAULT, updatedAt: Date.now() });
        patched += 1;
        if (patched >= limit * 3) break;
      }
      if (patched >= limit * 3) {
        break;
      }
    }

    const outboxStatuses = ["pending", "claimed", "sent", "failed"] as const;
    for (const status of outboxStatuses) {
      const outboxRows = await ctx.db
        .query("outbox")
        .withIndex("by_status_sendAt", (q) => q.eq("status", status))
        .take(limit * 4);
      for (const row of outboxRows) {
        const patch: {
          messageProvider?: "whatsapp" | "instagram";
          reactionTargetProviderMessageId?: string;
          replyTargetProviderMessageId?: string;
        } = {};
        if (!row.messageProvider) {
          const thread = await ctx.db.get(row.threadId);
          patch.messageProvider = thread?.provider || PROVIDER_DEFAULT;
        }
        if (!row.reactionTargetProviderMessageId && row.reactionTargetWhatsAppMessageId) {
          patch.reactionTargetProviderMessageId = row.reactionTargetWhatsAppMessageId;
        }
        if (Object.keys(patch).length === 0) {
          continue;
        }
        await ctx.db.patch(row._id, { ...patch, updatedAt: Date.now() });
        patched += 1;
        if (patched >= limit * 4) break;
      }
      if (patched >= limit * 4) {
        break;
      }
    }

    const reactionRows = await ctx.db.query("messageReactions").withIndex("by_threadId").take(limit * 3);
    for (const row of reactionRows) {
      const patch: { provider?: "whatsapp" | "instagram"; providerMessageId?: string } = {};
      if (!row.provider) {
        patch.provider = PROVIDER_DEFAULT;
      }
      if (!row.providerMessageId && row.whatsappMessageId) {
        patch.providerMessageId = row.whatsappMessageId;
      }
      if (Object.keys(patch).length === 0) {
        continue;
      }
      await ctx.db.patch(row._id, patch);
      patched += 1;
      if (patched >= limit * 5) break;
    }

    const setupRows = await ctx.db.query("setupRuntime").withIndex("by_key").take(limit);
    for (const row of setupRows) {
      if (row.provider) {
        continue;
      }
      const provider = row.key === "instagram" ? "instagram" : "whatsapp";
      await ctx.db.patch(row._id, { provider, key: provider, updatedAt: Date.now() });
      patched += 1;
    }

    return { patched };
  },
});

export const verifyProvidersBackfill = query({
  args: {},
  handler: async (ctx) => {
    const threadsMissing = (await ctx.db.query("threads").withIndex("by_lastMessageAt").order("desc").take(500)).filter(
      (row) => !row.provider,
    ).length;
    const messagesWindow = await ctx.db.query("messages").withIndex("by_createdAt").order("desc").take(1200);
    const messagesMissingProvider = messagesWindow.filter((row) => !row.provider).length;
    const messagesMissingProviderMessageId = messagesWindow.filter(
      (row) => !row.providerMessageId && Boolean(row.whatsappMessageId),
    ).length;
    const draftStatuses = ["pending", "approved", "sent", "rejected", "snoozed"] as const;
    let draftsMissingProvider = 0;
    for (const status of draftStatuses) {
      const rows = await ctx.db.query("replyDrafts").withIndex("by_status", (q) => q.eq("status", status)).take(250);
      draftsMissingProvider += rows.filter((row) => !row.messageProvider).length;
    }

    const outboxStatuses = ["pending", "claimed", "sent", "failed"] as const;
    let outboxMissingProvider = 0;
    for (const status of outboxStatuses) {
      const rows = await ctx.db.query("outbox").withIndex("by_status_sendAt", (q) => q.eq("status", status)).take(250);
      outboxMissingProvider += rows.filter((row) => !row.messageProvider).length;
    }
    const setupMissingProvider = (await ctx.db.query("setupRuntime").withIndex("by_key").take(20)).filter(
      (row) => !row.provider,
    ).length;

    return {
      complete:
        threadsMissing === 0 &&
        messagesMissingProvider === 0 &&
        messagesMissingProviderMessageId === 0 &&
        draftsMissingProvider === 0 &&
        outboxMissingProvider === 0 &&
        setupMissingProvider === 0,
      sampleWindow: {
        threadsMissing,
        messagesMissingProvider,
        messagesMissingProviderMessageId,
        draftsMissingProvider,
        outboxMissingProvider,
        setupMissingProvider,
      },
    };
  },
});
