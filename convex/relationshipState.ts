import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";

type PriorityTier = "romantic" | "professional" | "general";

export function resolvePriorityTier(profileSlug?: string): PriorityTier {
  const slug = (profileSlug || "").trim().toLowerCase();
  if (slug === "girlfriend" || slug === "relationship") {
    return "romantic";
  }
  if (slug === "professional") {
    return "professional";
  }
  return "general";
}

export function computeNextThreadRelationshipState(args: {
  previous: Doc<"relationshipThreadState"> | null;
  profileSlug?: string;
  trustScore: number;
  warmthTrend: -1 | 0 | 1;
  conflictFlag: boolean;
  responsivenessMismatch: boolean;
  repairNeeded: boolean;
  reason?: string;
  inboundAt?: number;
  now: number;
}) {
  const previousTrust = args.previous?.trustScore ?? args.trustScore;
  const blendedTrust = Math.max(0, Math.min(1, previousTrust * 0.55 + args.trustScore * 0.45));
  const priorityTier = resolvePriorityTier(args.profileSlug || args.previous?.profileSlug);

  return {
    profileSlug: args.profileSlug || args.previous?.profileSlug,
    priorityTier,
    trustScore: blendedTrust,
    warmthTrend: args.warmthTrend,
    conflictFlag: args.conflictFlag,
    responsivenessMismatch: args.responsivenessMismatch,
    repairNeeded: args.repairNeeded,
    lastReason: args.reason?.trim() || args.previous?.lastReason,
    lastInboundAt: Number.isFinite(args.inboundAt) && (args.inboundAt || 0) > 0 ? Math.round(args.inboundAt as number) : args.previous?.lastInboundAt,
    updatedAt: args.now,
    createdAt: args.previous?.createdAt || args.now,
  };
}

export const getThreadState = query({
  args: {
    threadId: v.id("threads"),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("relationshipThreadState")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .first();
  },
});

export const upsertFromSignals = mutation({
  args: {
    threadId: v.id("threads"),
    profileSlug: v.optional(v.string()),
    trustScore: v.number(),
    warmthTrend: v.union(v.literal(-1), v.literal(0), v.literal(1)),
    conflictFlag: v.boolean(),
    responsivenessMismatch: v.boolean(),
    repairNeeded: v.boolean(),
    reason: v.optional(v.string()),
    inboundAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("relationshipThreadState")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .first();

    const next = computeNextThreadRelationshipState({
      previous: existing,
      profileSlug: args.profileSlug,
      trustScore: args.trustScore,
      warmthTrend: args.warmthTrend,
      conflictFlag: args.conflictFlag,
      responsivenessMismatch: args.responsivenessMismatch,
      repairNeeded: args.repairNeeded,
      reason: args.reason,
      inboundAt: args.inboundAt,
      now,
    });

    if (existing) {
      await ctx.db.patch(existing._id, next);
      return existing._id;
    }

    return await ctx.db.insert("relationshipThreadState", {
      threadId: args.threadId,
      ...next,
    });
  },
});

export const listByPriorityTier = query({
  args: {
    priorityTier: v.union(v.literal("romantic"), v.literal("professional"), v.literal("general")),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(Math.round(args.limit || 30), 200));
    return await ctx.db
      .query("relationshipThreadState")
      .withIndex("by_priorityTier_and_updatedAt", (q) => q.eq("priorityTier", args.priorityTier))
      .order("desc")
      .take(limit);
  },
});
