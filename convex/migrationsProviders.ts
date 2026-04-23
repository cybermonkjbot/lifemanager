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

export const backfillContactMemoryFactLifecycleBatch = internalMutation({
  args: {
    limit: v.optional(v.number()),
    minUpdatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(args.limit ?? 200, 1000));
    const minUpdatedAt = Math.max(0, Math.round(args.minUpdatedAt ?? 0));
    const rows = await ctx.db
      .query("contactMemoryFacts")
      .withIndex("by_updatedAt", (q) => q.gte("updatedAt", minUpdatedAt))
      .order("asc")
      .take(limit);

    let patched = 0;
    let lastUpdatedAt = minUpdatedAt;
    const now = Date.now();

    for (const row of rows) {
      lastUpdatedAt = Math.max(lastUpdatedAt, Number(row.updatedAt || 0));
      const status = (row as unknown as { factStatus?: string }).factStatus;
      const expiresAtExisting = (row as unknown as { expiresAt?: number }).expiresAt;

      const ttlMs =
        row.factType === "schedule"
          ? 14 * 24 * 60 * 60 * 1000
          : row.factType === "profile" && row.factKey === "profile_location"
            ? 45 * 24 * 60 * 60 * 1000
            : undefined;
      const expiresAt = Number.isFinite(expiresAtExisting) ? expiresAtExisting : ttlMs === undefined ? undefined : (row.updatedAt || now) + ttlMs;
      const factStatus =
        status ||
        (Number.isFinite(expiresAt) && (expiresAt as number) <= now ? "expired" : Number(row.confidence || 0) < 0.5 ? "quarantined" : "active");

      const patch: {
        factStatus?: "active" | "superseded" | "expired" | "quarantined";
        expiresAt?: number;
      } = {};
      if (!status) {
        patch.factStatus = factStatus as "active" | "superseded" | "expired" | "quarantined";
      }
      if (!Number.isFinite(expiresAtExisting) && Number.isFinite(expiresAt)) {
        patch.expiresAt = expiresAt as number;
      }
      if (Object.keys(patch).length === 0) {
        continue;
      }
      await ctx.db.patch(row._id, patch);
      patched += 1;
    }

    const done = rows.length < limit;
    return {
      patched,
      scanned: rows.length,
      done,
      nextMinUpdatedAt: done ? null : lastUpdatedAt + 1,
    };
  },
});

export const verifyContactMemoryFactLifecycle = query({
  args: {
    sampleLimit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const sampleLimit = Math.max(50, Math.min(args.sampleLimit ?? 1000, 5000));
    const rows = await ctx.db.query("contactMemoryFacts").withIndex("by_updatedAt").order("desc").take(sampleLimit);
    const missingStatus = rows.filter((row) => !(row as unknown as { factStatus?: string }).factStatus).length;
    const missingExpiresAtForTtlTypes = rows.filter((row) => {
      const needsTtl = row.factType === "schedule" || (row.factType === "profile" && row.factKey === "profile_location");
      if (!needsTtl) {
        return false;
      }
      return !Number.isFinite((row as unknown as { expiresAt?: number }).expiresAt);
    }).length;
    return {
      complete: missingStatus === 0 && missingExpiresAtForTtlTypes === 0,
      sampleWindow: {
        sampleLimit,
        missingStatus,
        missingExpiresAtForTtlTypes,
      },
    };
  },
});
