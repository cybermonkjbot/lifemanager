import { v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import type { Doc } from "./_generated/dataModel";
import { action, mutation, query, type MutationCtx } from "./_generated/server";
import { DEFAULT_MIMICRY_LEVEL } from "./lib/constants";
import { getConfig } from "./lib/config";

const refThreadsList = makeFunctionReference<"query">("threads:list");
const refSetMimicry = makeFunctionReference<"mutation">("style:setMimicry");
const HUMOR_SIGNAL_PATTERN = /\b(lol|lmao|rofl|haha|hehe|banter|joke|meme|funny|dead)\b/i;
const STATUS_BANTER_PATTERN = /\b(status|story|update)\b/i;
const LAUGH_REACTION_EMOJIS = new Set(["😂", "🤣", "😹", "😆", "😄", "😁", "😅"]);
const LEARNED_TRAIT_LIMITS = {
  commonPhrases: 40,
  punctuationStyle: 30,
  humorNotes: 30,
  spellingNotes: 30,
} as const;
type LearnedTraitField = keyof typeof LEARNED_TRAIT_LIMITS;

function mergeLimited(base: string[], additions: string[], limit: number) {
  const merged = [...new Set([...base, ...additions].map((item) => item.trim()).filter(Boolean))];
  return merged.slice(0, limit);
}

function normalizeTraitValue(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeTraitList(values: string[], limit: number) {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const value of values) {
    const clean = normalizeTraitValue(value);
    const key = clean.toLowerCase();
    if (!clean || seen.has(key)) {
      continue;
    }
    seen.add(key);
    normalized.push(clean);
    if (normalized.length >= limit) {
      break;
    }
  }
  return normalized;
}

function arrayEquals(left: string[], right: string[]) {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

function getTraitValues(profile: Doc<"styleProfiles">, trait: LearnedTraitField) {
  switch (trait) {
    case "commonPhrases":
      return profile.commonPhrases || [];
    case "punctuationStyle":
      return profile.punctuationStyle || [];
    case "humorNotes":
      return profile.humorNotes || [];
    case "spellingNotes":
      return profile.spellingNotes || [];
  }
}

function makeTraitPatch(trait: LearnedTraitField, values: string[]) {
  switch (trait) {
    case "commonPhrases":
      return { commonPhrases: values };
    case "punctuationStyle":
      return { punctuationStyle: values };
    case "humorNotes":
      return { humorNotes: values };
    case "spellingNotes":
      return { spellingNotes: values };
  }
}

async function snapshotProfile(ctx: MutationCtx, profile: Doc<"styleProfiles">, reason: string, createdAt: number) {
  await ctx.db.insert("styleProfileHistory", {
    scope: profile.scope,
    threadId: profile.threadId,
    mimicryLevel: profile.mimicryLevel,
    commonPhrases: profile.commonPhrases || [],
    punctuationStyle: profile.punctuationStyle || [],
    humorNotes: profile.humorNotes || [],
    spellingNotes: profile.spellingNotes || [],
    reason,
    createdAt,
  });
}

function extractReusablePhrases(text: string) {
  const cleaned = text
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) {
    return [];
  }

  const words = cleaned
    .split(" ")
    .map((word) => word.trim())
    .filter((word) => word.length >= 3 && !/^\d+$/.test(word));
  const phrases: string[] = [];

  for (let i = 0; i < words.length; i += 1) {
    const trio = words.slice(i, i + 3).join(" ");
    if (trio.split(" ").length === 3) {
      phrases.push(trio);
    }
    const pair = words.slice(i, i + 2).join(" ");
    if (pair.split(" ").length === 2) {
      phrases.push(pair);
    }
  }

  return [...new Set(phrases)].slice(0, 6);
}

function inferHumorNotes(args: {
  inboundText: string;
  reactionEmoji?: string;
  outboundText: string;
  funnyKeywords: string[];
  funnyEmojis: string[];
}) {
  const notes: string[] = ["Warm, playful replies are welcome when the moment is light."];
  const inbound = args.inboundText.trim();
  const outbound = args.outboundText.trim();

  const hasConfiguredSignal = args.funnyKeywords.some((keyword) => new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(inbound));
  const hasConfiguredEmoji = args.funnyEmojis.some((emoji) => emoji && inbound.includes(emoji));
  if (HUMOR_SIGNAL_PATTERN.test(inbound) || /\p{Extended_Pictographic}/u.test(inbound) || hasConfiguredSignal || hasConfiguredEmoji) {
    notes.push("Lean into light jokes when they start with laughter or playful language.");
  }
  if (STATUS_BANTER_PATTERN.test(inbound)) {
    notes.push("Status/story banter can be playful and witty, but stay respectful.");
  }
  if (args.reactionEmoji && LAUGH_REACTION_EMOJIS.has(args.reactionEmoji)) {
    notes.push("Laugh reactions are a positive signal that the humor landed.");
  }
  if (/\b(lol|haha|lmao)\b/i.test(outbound) || /[😂🤣😅😄😁]/u.test(outbound)) {
    notes.push("Use concise one-liner humor with a human tone, not forced jokes.");
  }

  return [...new Set(notes)];
}

function hasHumorSignal(args: {
  inboundText: string;
  signalKind: "text" | "reaction";
  reactionEmoji?: string;
  funnyKeywords: string[];
  funnyEmojis: string[];
}) {
  if (args.signalKind === "reaction") {
    return Boolean(
      (args.reactionEmoji && LAUGH_REACTION_EMOJIS.has(args.reactionEmoji)) ||
        (args.reactionEmoji && args.funnyEmojis.includes(args.reactionEmoji)),
    );
  }
  const hasKeyword = args.funnyKeywords.some((keyword) => new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(args.inboundText));
  const hasEmoji = args.funnyEmojis.some((emoji) => emoji && args.inboundText.includes(emoji));
  return HUMOR_SIGNAL_PATTERN.test(args.inboundText) || /[😂🤣😹😆😄😁😅]/u.test(args.inboundText) || hasKeyword || hasEmoji;
}

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
      if (Math.abs(existing.mimicryLevel - bounded) >= 0.0001) {
        await snapshotProfile(ctx, existing, "pre-mimicry-update", Date.now());
      }
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

export const listHistory = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(Math.round(args.limit ?? 20), 100));
    return await ctx.db
      .query("styleProfileHistory")
      .withIndex("by_scope_and_createdAt", (q) => q.eq("scope", "global"))
      .order("desc")
      .take(limit);
  },
});

export const rollbackHistory = mutation({
  args: {
    historyId: v.id("styleProfileHistory"),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.historyId);
    if (!row) {
      throw new Error("History entry not found.");
    }

    const existing = await ctx.db
      .query("styleProfiles")
      .withIndex("by_scope", (q) => q.eq("scope", row.scope))
      .first();
    const now = Date.now();

    if (existing) {
      await snapshotProfile(ctx, existing, "pre-rollback-snapshot", now);

      await ctx.db.patch(existing._id, {
        mimicryLevel: row.mimicryLevel,
        commonPhrases: row.commonPhrases,
        punctuationStyle: row.punctuationStyle,
        humorNotes: row.humorNotes,
        spellingNotes: row.spellingNotes,
        updatedAt: now,
      });
      return existing._id;
    }

    return await ctx.db.insert("styleProfiles", {
      scope: row.scope,
      threadId: row.threadId,
      mimicryLevel: row.mimicryLevel,
      commonPhrases: row.commonPhrases,
      punctuationStyle: row.punctuationStyle,
      humorNotes: row.humorNotes,
      spellingNotes: row.spellingNotes,
      updatedAt: now,
    });
  },
});

export const updateLearnedTrait = mutation({
  args: {
    trait: v.union(v.literal("commonPhrases"), v.literal("punctuationStyle"), v.literal("humorNotes"), v.literal("spellingNotes")),
    value: v.string(),
    previousValue: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const trait = args.trait as LearnedTraitField;
    const limit = LEARNED_TRAIT_LIMITS[trait];
    const nextValue = normalizeTraitValue(args.value);
    if (!nextValue) {
      throw new Error("Trait value cannot be empty.");
    }

    const profile = await ctx.db
      .query("styleProfiles")
      .withIndex("by_scope", (q) => q.eq("scope", "global"))
      .first();
    const now = Date.now();

    if (!profile) {
      const seedValues = normalizeTraitList([nextValue], limit);
      const patch = makeTraitPatch(trait, seedValues);
      return await ctx.db.insert("styleProfiles", {
        scope: "global",
        mimicryLevel: DEFAULT_MIMICRY_LEVEL,
        commonPhrases: patch.commonPhrases || [],
        punctuationStyle: patch.punctuationStyle || [],
        humorNotes: patch.humorNotes || [],
        spellingNotes: patch.spellingNotes || [],
        updatedAt: now,
      });
    }

    const currentValues = normalizeTraitList(getTraitValues(profile, trait), limit);
    const previousValue = normalizeTraitValue(args.previousValue || "");
    let nextValues = currentValues;

    if (args.previousValue !== undefined) {
      let replaced = false;
      nextValues = currentValues.map((item) => {
        if (!replaced && item.toLowerCase() === previousValue.toLowerCase()) {
          replaced = true;
          return nextValue;
        }
        return item;
      });
      if (!replaced) {
        nextValues = [...nextValues, nextValue];
      }
    } else {
      nextValues = [...currentValues, nextValue];
    }

    nextValues = normalizeTraitList(nextValues, limit);
    if (arrayEquals(currentValues, nextValues)) {
      return profile._id;
    }

    await snapshotProfile(ctx, profile, `pre-trait-update:${trait}`, now);
    await ctx.db.patch(profile._id, {
      ...makeTraitPatch(trait, nextValues),
      updatedAt: now,
    });
    return profile._id;
  },
});

export const removeLearnedTrait = mutation({
  args: {
    trait: v.union(v.literal("commonPhrases"), v.literal("punctuationStyle"), v.literal("humorNotes"), v.literal("spellingNotes")),
    value: v.string(),
  },
  handler: async (ctx, args) => {
    const trait = args.trait as LearnedTraitField;
    const limit = LEARNED_TRAIT_LIMITS[trait];
    const target = normalizeTraitValue(args.value);
    if (!target) {
      throw new Error("Trait value cannot be empty.");
    }

    const profile = await ctx.db
      .query("styleProfiles")
      .withIndex("by_scope", (q) => q.eq("scope", "global"))
      .first();
    if (!profile) {
      return null;
    }

    const currentValues = normalizeTraitList(getTraitValues(profile, trait), limit);
    const nextValues = normalizeTraitList(
      currentValues.filter((item) => item.toLowerCase() !== target.toLowerCase()),
      limit,
    );
    if (arrayEquals(currentValues, nextValues)) {
      return profile._id;
    }

    const now = Date.now();
    await snapshotProfile(ctx, profile, `pre-trait-remove:${trait}`, now);
    await ctx.db.patch(profile._id, {
      ...makeTraitPatch(trait, nextValues),
      updatedAt: now,
    });
    return profile._id;
  },
});

export const clearLearnedTraitSection = mutation({
  args: {
    trait: v.union(v.literal("commonPhrases"), v.literal("punctuationStyle"), v.literal("humorNotes"), v.literal("spellingNotes")),
  },
  handler: async (ctx, args) => {
    const trait = args.trait as LearnedTraitField;
    const limit = LEARNED_TRAIT_LIMITS[trait];
    const profile = await ctx.db
      .query("styleProfiles")
      .withIndex("by_scope", (q) => q.eq("scope", "global"))
      .first();
    if (!profile) {
      return null;
    }

    const currentValues = normalizeTraitList(getTraitValues(profile, trait), limit);
    if (currentValues.length === 0) {
      return profile._id;
    }

    const now = Date.now();
    await snapshotProfile(ctx, profile, `pre-trait-clear:${trait}`, now);
    await ctx.db.patch(profile._id, {
      ...makeTraitPatch(trait, []),
      updatedAt: now,
    });
    return profile._id;
  },
});

export const update = action({
  args: {},
  handler: async (ctx) => {
    const outgoing = await ctx.runQuery(refThreadsList, { limit: 20 });
    const phrases: string[] = [];

    for (const thread of outgoing) {
      if (!thread.latestDraft?.text) {
        continue;
      }
      const words = thread.latestDraft.text
        .split(/\s+/)
        .filter((w: string) => w.length > 4)
        .slice(0, 3);
      phrases.push(...words);
    }

    await ctx.runMutation(refSetMimicry, { mimicryLevel: 0.75 });

    return {
      learnedPhrases: [...new Set(phrases)].slice(0, 15),
    };
  },
});

export const learnFromHumorSignal = mutation({
  args: {
    threadId: v.id("threads"),
    inboundText: v.string(),
    signalKind: v.union(v.literal("text"), v.literal("reaction")),
    reactionEmoji: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const config = await getConfig(ctx);
    const funnyKeywords = config.funnyStatusKeywords || [];
    const funnyEmojis = config.funnyStatusEmojis || [];
    const inboundText = args.inboundText.trim();
    const reactionEmoji = args.reactionEmoji?.trim();
    if (!hasHumorSignal({ inboundText, signalKind: args.signalKind, reactionEmoji, funnyKeywords, funnyEmojis })) {
      return {
        learned: false,
        reason: "no_humor_signal",
      } as const;
    }

    const recentMessages = await ctx.db
      .query("messages")
      .withIndex("by_thread_messageAt", (q) => q.eq("threadId", args.threadId))
      .order("desc")
      .take(24);
    const latestOutbound = recentMessages.find(
      (message) => message.direction === "outbound" && (message.messageType || "text") === "text" && message.text.trim().length > 0,
    );

    if (!latestOutbound) {
      return {
        learned: false,
        reason: "no_outbound_context",
      } as const;
    }

    const phrases = extractReusablePhrases(latestOutbound.text);
    const humorNotes = inferHumorNotes({
      inboundText,
      reactionEmoji,
      outboundText: latestOutbound.text,
      funnyKeywords,
      funnyEmojis,
    });

    const existing = await ctx.db
      .query("styleProfiles")
      .withIndex("by_scope", (q) => q.eq("scope", "global"))
      .first();
    const now = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, {
        commonPhrases: mergeLimited(existing.commonPhrases || [], phrases, 40),
        humorNotes: mergeLimited(existing.humorNotes || [], humorNotes, 30),
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("styleProfiles", {
        scope: "global",
        mimicryLevel: DEFAULT_MIMICRY_LEVEL,
        commonPhrases: mergeLimited([], phrases, 40),
        punctuationStyle: [],
        humorNotes: mergeLimited([], humorNotes, 30),
        spellingNotes: [],
        updatedAt: now,
      });
    }

    await ctx.db.insert("systemEvents", {
      source: "convex",
      eventType: "style.humor.learned",
      threadId: args.threadId,
      detail: `Learned humor signal (${args.signalKind}) from inbound: ${(inboundText || reactionEmoji || "signal").slice(0, 180)}`,
      createdAt: now,
    });

    return {
      learned: true,
      phrasesAdded: phrases.length,
      notesAdded: humorNotes.length,
    } as const;
  },
});
