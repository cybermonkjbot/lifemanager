import { v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import type { Doc } from "./_generated/dataModel";
import { action, mutation, query, type MutationCtx } from "./_generated/server";
import { DEFAULT_MIMICRY_LEVEL } from "./lib/constants";
import { getConfig } from "./lib/config";

const refThreadsList = makeFunctionReference<"query">("threads:list");
const refSetMimicry = makeFunctionReference<"mutation">("style:setMimicry");
const HUMOR_SIGNAL_PATTERN_GLOBAL = /\b(lol|lmao|lmfao|rofl|haha|hehe|banter|joke|meme|funny|roast|hilarious)\b/gi;
const STATUS_BANTER_PATTERN = /\b(status|story|update)\b/i;
const LAUGH_REACTION_EMOJIS = new Set(["😂", "🤣", "😹", "😆", "😄", "😁", "😅"]);
const LAUGH_SIGNAL_EMOJIS = new Set(["😂", "🤣", "😹", "😆", "😄", "😁", "😅", "😜", "🤪", "🙃"]);
const LAUGH_SIGNAL_EMOJIS_PATTERN_GLOBAL = /[😂🤣😹😆😄😁😅😜🤪🙃]/gu;
const LOW_SIGNAL_HUMOR_KEYWORDS = new Set(["status", "story", "update", "wild", "dead"]);
const HUMOR_SINGLE_TOKEN_ONLY_PATTERN = /^\s*(?:lol|lmao|lmfao|rofl|haha|hehe|😂|🤣|😹|😆|😄|😁|😅|😜|🤪|🙃)\s*[.!?]*\s*$/i;
const HUMOR_CONTEXT_BLOCK_PATTERNS = [
  /\b(death|died|funeral|burial|rip|hospital|surgery|diagnosis|cancer|emergency|accident|abuse|assault|suicid|depress(?:ed|ion)?)\b/i,
  /\b(password|otp|pin|social security|bank account|wire transfer|routing number|sort code|scam|fraud)\b/i,
  /\b(court|lawyer|legal|lawsuit|arrestd?|police report)\b/i,
  /\b(rent|salary|debt|loan|invoice overdue|payment issue)\b/i,
];
const STYLE_SENSITIVE_PHRASE_PATTERNS = [
  /\b(?:https?:\/\/|www\.)\S+\b/i,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  /\b(?:\+?\d[\d\s-]{7,}\d)\b/,
  /\b(password|passcode|otp|pin|bank|account|routing|sort code|wire transfer|social security|api key|access token|secret)\b/i,
];
const STYLE_MAX_COMMON_PHRASE_WORDS = 6;
const MAX_SAFE_MIMICRY_LEVEL = 0.82;
const LOW_VALUE_STYLE_PHRASE_PATTERNS = [
  /\bplease allow me small\b/i,
  /\bplease allow me\b/i,
  /\ballow me small\b/i,
  /\b(?:sounds good|noted|got it|understood)\b/i,
  /\bi(?:'|’)ll (?:handle|sort|check|look into|get (?:this )?done|circle back|follow up|update you)\b/i,
  /\bcircle back (?:soon|later|shortly)\b/i,
  /\b(?:update|details?) (?:soon|shortly)\b/i,
  /\blet me (?:sort|check|look into|get back)\b/i,
];
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

function isDiscardableCommonPhrase(value: string) {
  const normalized = normalizeTraitValue(value).toLowerCase();
  const wordCount = normalized ? normalized.split(/\s+/).length : 0;
  if (!normalized) {
    return true;
  }
  if (normalized.length < 8) {
    return true;
  }
  if (wordCount > STYLE_MAX_COMMON_PHRASE_WORDS) {
    return true;
  }
  if (STYLE_SENSITIVE_PHRASE_PATTERNS.some((pattern) => pattern.test(value))) {
    return true;
  }
  return LOW_VALUE_STYLE_PHRASE_PATTERNS.some((pattern) => pattern.test(normalized));
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

  return [...new Set(phrases)].filter((phrase) => !isDiscardableCommonPhrase(phrase)).slice(0, 6);
}

function inferHumorNotes(args: {
  inboundText: string;
  contextText?: string;
  reactionEmoji?: string;
  outboundText: string;
  funnyKeywords: string[];
  funnyEmojis: string[];
}) {
  const notes: string[] = ["Warm, playful replies are welcome when the moment is light."];
  const inbound = args.inboundText.trim();
  const context = (args.contextText || "").trim();
  const combinedSignal = [inbound, context].filter(Boolean).join("\n");
  const outbound = args.outboundText.trim();

  if (hasTextHumorSignal(combinedSignal || inbound, args.funnyKeywords, args.funnyEmojis)) {
    notes.push("Lean into light jokes when they start with laughter or playful language.");
  }
  if (STATUS_BANTER_PATTERN.test(combinedSignal || inbound)) {
    notes.push("Status/story banter can be playful and witty, but stay respectful.");
  }
  if (args.reactionEmoji && LAUGH_REACTION_EMOJIS.has(args.reactionEmoji)) {
    notes.push("Laugh reactions are a positive signal that the humor landed.");
  }
  if (/\?/.test(combinedSignal)) {
    notes.push("When humor appears with a question, answer clearly first and keep jokes short.");
  }
  if (/\b(again|still|remember|like before|as usual|same as last time|callback)\b/i.test(combinedSignal)) {
    notes.push("Callback humor works best when tied to a specific earlier thread moment.");
  }
  if (/\b(image|photo|video|caption|sticker|meme|status|story)\b/i.test(combinedSignal)) {
    notes.push("For media/status humor cues, react to the concrete visual/context detail before joking.");
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
    const reactionEmoji = args.reactionEmoji?.trim();
    return Boolean(
      (reactionEmoji && LAUGH_REACTION_EMOJIS.has(reactionEmoji)) ||
        (reactionEmoji && args.funnyEmojis.includes(reactionEmoji) && LAUGH_SIGNAL_EMOJIS.has(reactionEmoji)),
    );
  }
  return hasTextHumorSignal(args.inboundText, args.funnyKeywords, args.funnyEmojis);
}

function countConfiguredHumorKeywordHits(text: string, keywords: string[]) {
  let hits = 0;
  for (const keyword of keywords) {
    const normalized = keyword.trim().toLowerCase();
    if (!normalized || LOW_SIGNAL_HUMOR_KEYWORDS.has(normalized)) {
      continue;
    }
    const pattern = new RegExp(`\\b${normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (pattern.test(text)) {
      hits += 1;
    }
  }
  return hits;
}

function hasConfiguredHumorEmojiHit(text: string, emojis: string[]) {
  return emojis.some((emoji) => emoji && LAUGH_SIGNAL_EMOJIS.has(emoji) && text.includes(emoji));
}

function countCoreHumorKeywordHits(text: string) {
  return text.match(HUMOR_SIGNAL_PATTERN_GLOBAL)?.length ?? 0;
}

function countCoreHumorEmojiHits(text: string) {
  return text.match(LAUGH_SIGNAL_EMOJIS_PATTERN_GLOBAL)?.length ?? 0;
}

function hasHumorContextBlock(text: string) {
  return HUMOR_CONTEXT_BLOCK_PATTERNS.some((pattern) => pattern.test(text));
}

function hasTextHumorSignal(text: string, funnyKeywords: string[], funnyEmojis: string[]) {
  const normalized = text.trim();
  if (normalized.length < 10) {
    return false;
  }
  if (HUMOR_SINGLE_TOKEN_ONLY_PATTERN.test(normalized)) {
    return false;
  }
  if (hasHumorContextBlock(normalized)) {
    return false;
  }

  const coreKeywordHits = countCoreHumorKeywordHits(normalized);
  const coreEmojiHits = countCoreHumorEmojiHits(normalized);
  const configuredKeywordHits = countConfiguredHumorKeywordHits(normalized, funnyKeywords);
  const configuredEmojiHit = hasConfiguredHumorEmojiHit(normalized, funnyEmojis);
  const hasPlayfulCue = /\b(joke|banter|roast|meme|tease|playful|hilarious|comic|funny)\b/i.test(normalized);

  if (coreKeywordHits >= 2 || configuredKeywordHits >= 2) {
    return true;
  }
  if ((coreEmojiHits >= 1 || configuredEmojiHit) && (coreKeywordHits >= 1 || configuredKeywordHits >= 1 || hasPlayfulCue)) {
    return true;
  }
  if ((coreKeywordHits >= 1 || configuredKeywordHits >= 1) && hasPlayfulCue) {
    return true;
  }
  if ((coreKeywordHits >= 1 || configuredKeywordHits >= 1) && normalized.length >= 28 && !/\b(status|story)\b/i.test(normalized)) {
    return true;
  }
  return false;
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
    const bounded = Math.max(0, Math.min(args.mimicryLevel, MAX_SAFE_MIMICRY_LEVEL));
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
    if (trait === "commonPhrases" && isDiscardableCommonPhrase(nextValue)) {
      throw new Error("Trait phrase is too generic or awkward to save.");
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

export const cleanupCommonPhrases = mutation({
  args: {
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const dryRun = args.dryRun ?? false;
    const profiles = await ctx.db.query("styleProfiles").collect();
    const now = Date.now();
    let scannedProfiles = 0;
    let updatedProfiles = 0;
    let removedPhraseCount = 0;

    for (const profile of profiles) {
      scannedProfiles += 1;
      const currentPhrases = normalizeTraitList(profile.commonPhrases || [], LEARNED_TRAIT_LIMITS.commonPhrases);
      const nextPhrases = normalizeTraitList(
        currentPhrases.filter((phrase) => !isDiscardableCommonPhrase(phrase)),
        LEARNED_TRAIT_LIMITS.commonPhrases,
      );
      if (arrayEquals(currentPhrases, nextPhrases)) {
        continue;
      }

      updatedProfiles += 1;
      removedPhraseCount += Math.max(0, currentPhrases.length - nextPhrases.length);

      if (!dryRun) {
        await snapshotProfile(ctx, profile, "pre-common-phrases-cleanup", now);
        await ctx.db.patch(profile._id, {
          commonPhrases: nextPhrases,
          updatedAt: now,
        });
      }
    }

    if (!dryRun) {
      await ctx.db.insert("systemEvents", {
        source: "convex",
        eventType: "style.commonPhrases.cleanup",
        detail: `Cleaned common phrases across ${updatedProfiles}/${scannedProfiles} style profiles, removed ${removedPhraseCount} phrases.`,
        createdAt: now,
      });
    }

    return {
      dryRun,
      scannedProfiles,
      updatedProfiles,
      removedPhraseCount,
    } as const;
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
    contextText: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const config = await getConfig(ctx);
    const funnyKeywords = config.funnyStatusKeywords || [];
    const funnyEmojis = config.funnyStatusEmojis || [];
    const inboundText = args.inboundText.trim();
    const contextText = args.contextText?.trim() || "";
    const reactionEmoji = args.reactionEmoji?.trim();
    const signalInputText = [inboundText, contextText].filter(Boolean).join("\n");
    if (signalInputText && hasHumorContextBlock(signalInputText)) {
      return {
        learned: false,
        reason: "sensitive_context",
      } as const;
    }
    if (args.signalKind === "text" && HUMOR_SINGLE_TOKEN_ONLY_PATTERN.test(signalInputText)) {
      return {
        learned: false,
        reason: "weak_humor_signal",
      } as const;
    }
    if (!hasHumorSignal({ inboundText: signalInputText, signalKind: args.signalKind, reactionEmoji, funnyKeywords, funnyEmojis })) {
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

    const outboundText = latestOutbound.text.trim();
    const safeToLearnPhrases = !hasHumorContextBlock(outboundText) && hasTextHumorSignal(outboundText, funnyKeywords, funnyEmojis);
    const phrases = safeToLearnPhrases ? extractReusablePhrases(outboundText).slice(0, 3) : [];
    const humorNotes = inferHumorNotes({
      inboundText,
      contextText,
      reactionEmoji,
      outboundText,
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
      detail: `Learned humor signal (${args.signalKind}) from inbound: ${(inboundText || reactionEmoji || "signal").slice(0, 160)}${contextText ? ` | context: ${contextText.slice(0, 120)}` : ""}`,
      createdAt: now,
    });

    return {
      learned: true,
      phrasesAdded: phrases.length,
      notesAdded: humorNotes.length,
    } as const;
  },
});
