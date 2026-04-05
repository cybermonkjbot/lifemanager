import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action, mutation, query } from "./_generated/server";
import { DEFAULT_MIMICRY_LEVEL } from "./lib/constants";

export const getProfile = query({
  args: {},
  handler: async (ctx) => {
    const profile = await ctx.db
      .query("styleProfiles")
      .withIndex("by_scope", (q) => q.eq("scope", "global"))
      .first();

    if (profile) {
      return profile;
    }

    return {
      scope: "global" as const,
      mimicryLevel: DEFAULT_MIMICRY_LEVEL,
      commonPhrases: [],
      punctuationStyle: [],
      humorNotes: [],
      spellingNotes: [],
      updatedAt: Date.now(),
    };
  },
});

export const setMimicry = mutation({
  args: {
    mimicryLevel: v.number(),
  },
  handler: async (ctx, args) => {
    const bounded = Math.max(0, Math.min(args.mimicryLevel, 1));
    const existing = await ctx.db
      .query("styleProfiles")
      .withIndex("by_scope", (q) => q.eq("scope", "global"))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        mimicryLevel: bounded,
        updatedAt: Date.now(),
      });
      return existing._id;
    }

    return await ctx.db.insert("styleProfiles", {
      scope: "global",
      mimicryLevel: bounded,
      commonPhrases: [],
      punctuationStyle: [],
      humorNotes: [],
      spellingNotes: [],
      updatedAt: Date.now(),
    });
  },
});

export const update = action({
  args: {},
  handler: async (ctx) => {
    const outgoing = await ctx.runQuery(internal.threads.list, { limit: 20 });
    const phrases: string[] = [];

    for (const thread of outgoing) {
      if (!thread.latestDraft?.text) {
        continue;
      }
      const words = thread.latestDraft.text
        .split(/\s+/)
        .filter((w) => w.length > 4)
        .slice(0, 3);
      phrases.push(...words);
    }

    await ctx.runMutation(internal.style.setMimicry, { mimicryLevel: 0.75 });

    return {
      learnedPhrases: [...new Set(phrases)].slice(0, 15),
    };
  },
});
