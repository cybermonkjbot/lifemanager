import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const list = query({
  args: {
    ignoreRuleLimit: v.optional(v.number()),
    configLimit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const ignoreRuleLimit = Math.min(args.ignoreRuleLimit ?? 200, 500);
    const configLimit = Math.min(args.configLimit ?? 20, 50);
    const ignoreRules = await ctx.db.query("ignoreRules").take(ignoreRuleLimit);
    const appConfig = await ctx.db.query("appConfig").take(configLimit);
    return {
      ignoreRules,
      appConfig,
    };
  },
});

export const upsertIgnoreRule = mutation({
  args: {
    targetType: v.union(v.literal("contact"), v.literal("group"), v.literal("keyword")),
    targetValue: v.string(),
    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("ignoreRules")
      .withIndex("by_target", (q) => q.eq("targetType", args.targetType).eq("targetValue", args.targetValue))
      .first();

    const now = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, {
        enabled: args.enabled,
        updatedAt: now,
      });
      return existing._id;
    }

    return await ctx.db.insert("ignoreRules", {
      ...args,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const setIgnoreRuleEnabled = mutation({
  args: {
    ruleId: v.id("ignoreRules"),
    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.ruleId);
    if (!row) {
      throw new Error("Rule not found.");
    }
    await ctx.db.patch(row._id, {
      enabled: args.enabled,
      updatedAt: Date.now(),
    });
    return row._id;
  },
});

export const deleteIgnoreRule = mutation({
  args: {
    ruleId: v.id("ignoreRules"),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.ruleId);
    if (!row) {
      return null;
    }
    await ctx.db.delete(row._id);
    return row._id;
  },
});
