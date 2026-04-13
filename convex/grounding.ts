import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { dedupeAliases } from "./lib/aliasNormalization";

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
    const dryRun = args.dryRun ?? false;
    const rows = await ctx.db.query("threadGrounding").collect();
    const now = Date.now();
    let scanned = 0;
    let updated = 0;
    let removed = 0;

    for (const row of rows) {
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
      if (!dryRun) {
        await ctx.db.patch(row._id, {
          autoAliases: cleanedAliases,
          updatedAt: now,
        });
      }
    }

    if (!dryRun && updated > 0) {
      await ctx.db.insert("systemEvents", {
        source: "convex",
        eventType: "grounding.autoAliases.cleanup",
        detail: `Cleaned autoAliases on ${updated}/${scanned} thread grounding rows; removed ${removed} aliases.`,
        createdAt: now,
      });
    }

    return {
      dryRun,
      scanned,
      updated,
      removed,
    } as const;
  },
});
