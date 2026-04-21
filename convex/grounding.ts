import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, mutation, query } from "./_generated/server";
import { dedupeAliases } from "./lib/aliasNormalization";

const CLEANUP_AUTO_ALIASES_BATCH_SIZE = 50;

function normalizeName(value: string | undefined) {
  const trimmed = value?.trim() || "";
  if (!trimmed) {
    return undefined;
  }
  return trimmed.slice(0, 80);
}

function normalizeAliases(values: string[]) {
  return dedupeAliases(values, 20);
}

export const getThreadGrounding = query({
  args: {
    threadId: v.id("threads"),
  },
  handler: async (ctx, args) => {
    const grounding = await ctx.db
      .query("threadGrounding")
      .withIndex("by_threadId", (q) => q.eq("threadId", args.threadId))
      .first();

    return (
      grounding || {
        threadId: args.threadId,
        myName: "",
        theirName: "",
        autoAliases: [],
        vibeNotes: "",
        createdAt: 0,
        updatedAt: 0,
      }
    );
  },
});

export const saveThreadGrounding = mutation({
  args: {
    threadId: v.id("threads"),
    myName: v.optional(v.string()),
    theirName: v.optional(v.string()),
    autoAliases: v.optional(v.array(v.string())),
    vibeNotes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("threadGrounding")
      .withIndex("by_threadId", (q) => q.eq("threadId", args.threadId))
      .first();

    const payload = {
      myName: normalizeName(args.myName),
      theirName: normalizeName(args.theirName),
      autoAliases: normalizeAliases(args.autoAliases || existing?.autoAliases || []),
      vibeNotes: normalizeName(args.vibeNotes),
      updatedAt: now,
    };

    if (existing) {
      await ctx.db.patch(existing._id, payload);
      return existing._id;
    }

    return await ctx.db.insert("threadGrounding", {
      threadId: args.threadId,
      createdAt: now,
      ...payload,
    });
  },
});

export const cleanupAutoAliases = mutation({
  args: {
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const result: {
      dryRun: boolean;
      scanned: number;
      updated: number;
      removed: number;
      isDone: boolean;
    } = await ctx.runMutation(internal.grounding.cleanupAutoAliasesBatch, {
      dryRun: args.dryRun ?? false,
      cursor: null,
      scanned: 0,
      updated: 0,
      removed: 0,
    });
    return result;
  },
});

export const cleanupAutoAliasesBatch = internalMutation({
  args: {
    dryRun: v.boolean(),
    cursor: v.union(v.string(), v.null()),
    scanned: v.number(),
    updated: v.number(),
    removed: v.number(),
  },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("threadGrounding")
      .order("asc")
      .paginate({ numItems: CLEANUP_AUTO_ALIASES_BATCH_SIZE, cursor: args.cursor });
    const now = Date.now();
    let scanned = args.scanned;
    let updated = args.updated;
    let removed = args.removed;

    for (const row of page.page) {
      scanned += 1;
      const currentAliases = row.autoAliases || [];
      const cleanedAliases = normalizeAliases(currentAliases);
      if (
        cleanedAliases.length === currentAliases.length &&
        cleanedAliases.every((value, index) => value === currentAliases[index])
      ) {
        continue;
      }
      updated += 1;
      removed += Math.max(0, currentAliases.length - cleanedAliases.length);
      if (!args.dryRun) {
        await ctx.db.patch(row._id, {
          autoAliases: cleanedAliases,
          updatedAt: now,
        });
      }
    }

    if (!args.dryRun && !page.isDone) {
      await ctx.scheduler.runAfter(0, internal.grounding.cleanupAutoAliasesBatch, {
        dryRun: false,
        cursor: page.continueCursor,
        scanned,
        updated,
        removed,
      });
    }

    if (!args.dryRun && page.isDone && updated > 0) {
      await ctx.db.insert("systemEvents", {
        source: "convex",
        eventType: "grounding.autoAliases.cleanup",
        detail: `Cleaned autoAliases on ${updated}/${scanned} thread grounding rows; removed ${removed} aliases.`,
        createdAt: now,
      });
    }

    return {
      dryRun: args.dryRun,
      scanned,
      updated,
      removed,
      isDone: page.isDone,
    } as const;
  },
});
