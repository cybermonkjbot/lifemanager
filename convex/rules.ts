import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { classifyThreadKind, directIgnoreContactKey, directIgnoreRuleCandidates } from "./lib/threadEligibility";

const IGNORE_CONTACT_FALLBACK_SCAN_LIMIT = 2000;

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
    targetType: v.optional(v.union(v.literal("contact"), v.literal("group"), v.literal("keyword"))),
    threadId: v.optional(v.id("threads")),
    targetValue: v.optional(v.string()),
    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    let targetType = args.targetType;
    let targetValue = args.targetValue?.trim() || "";

    if (args.threadId) {
      const thread = await ctx.db.get(args.threadId);
      if (!thread) {
        throw new Error("Thread not found.");
      }
      const threadKind = thread.threadKind || classifyThreadKind({ jid: thread.jid, isGroupHint: thread.isGroup });
      targetType = threadKind === "group" ? "group" : "contact";
      if (!targetValue) {
        targetValue = thread.jid;
      }
    } else if (!targetType) {
      const inferredThreadKind = classifyThreadKind({ jid: targetValue });
      targetType = inferredThreadKind === "group" ? "group" : "contact";
    }

    if (!targetType) {
      throw new Error("targetType is required.");
    }
    if (!targetValue) {
      throw new Error("targetValue is required.");
    }

    const now = Date.now();
    const targets =
      targetType === "contact"
        ? directIgnoreRuleCandidates({ jid: targetValue, provider: "whatsapp" })
        : [targetValue];

    let firstRuleId: string | null = null;
    for (const value of new Set(targets)) {
      const existing = await ctx.db
        .query("ignoreRules")
        .withIndex("by_target", (q) => q.eq("targetType", targetType).eq("targetValue", value))
        .first();

      if (existing) {
        await ctx.db.patch(existing._id, {
          enabled: args.enabled,
          updatedAt: now,
        });
        firstRuleId = firstRuleId || existing._id;
      } else {
        const inserted = await ctx.db.insert("ignoreRules", {
          targetType,
          targetValue: value,
          enabled: args.enabled,
          createdAt: now,
          updatedAt: now,
        });
        firstRuleId = firstRuleId || inserted;
      }
    }

    if (targetType === "contact") {
      const lookupKey = directIgnoreContactKey({ jid: targetValue, provider: "whatsapp" });
      if (lookupKey) {
        const directThreads = await ctx.db
          .query("threads")
          .withIndex("by_threadKind_and_lastMessageAt", (q) => q.eq("threadKind", "direct"))
          .order("desc")
          .take(IGNORE_CONTACT_FALLBACK_SCAN_LIMIT);
        for (const thread of directThreads) {
          if ((thread.provider || "whatsapp") !== "whatsapp") {
            continue;
          }
          const threadLookupKey = directIgnoreContactKey({ jid: thread.jid, provider: "whatsapp" });
          if (!threadLookupKey || threadLookupKey !== lookupKey) {
            continue;
          }
          await ctx.db.patch(thread._id, {
            isIgnored: args.enabled,
            updatedAt: now,
          });
        }
      }
    }

    return firstRuleId;
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
