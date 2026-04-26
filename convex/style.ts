import { v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { action, internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { DEFAULT_MIMICRY_LEVEL } from "./lib/constants";
import { getConfig, setConfigValue } from "./lib/config";
import {
  applyEmojiUsageSignal,
  parseLearnedEmojiProfile,
  type LearnedEmojiProfile,
} from "./lib/emojiLearning";

const refThreadsList = makeFunctionReference<"query">("threads:list");
const refSetMimicry = makeFunctionReference<"mutation">("style:setMimicry");
const LEARNED_EMOJI_PROFILE_CONFIG_KEY = "style.learnedEmojiProfile.v1";
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
const CLEANUP_COMMON_PHRASES_BATCH_SIZE = 50;
const LOW_VALUE_STYLE_PHRASE_PATTERNS = [
  /\b(?:please|kindly|abeg)\s+(?:just\s+)?(?:allow|pardon)\s+me(?:\s+small)?\b/i,
  /\b(?:allow|pardon)\s+me\s+small\b/i,
  /\b(?:sounds good|noted|got it|understood)\b/i,
  /\bi(?:'|’)ll (?:handle|sort|check|look into|get (?:this )?done|circle back|follow up|update you)\b/i,
  /\bcircle back (?:soon|later|shortly)\b/i,
  /\b(?:update|details?) (?:soon|shortly)\b/i,
  /\blet me (?:sort|check|look into|get back)\b/i,
];
const STYLE_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "be",
  "for",
  "from",
  "i",
  "im",
  "is",
  "it",
  "just",
  "me",
  "my",
  "of",
  "on",
  "or",
  "so",
  "that",
  "the",
  "this",
  "to",
  "we",
  "you",
  "your",
]);
const STYLE_LOW_SIGNAL_TOKENS = new Set([
  "please",
  "kindly",
  "abeg",
  "allow",
  "pardon",
  "me",
  "small",
  "just",
  "okay",
  "ok",
  "alright",
  "noted",
  "got",
  "it",
  "understood",
  "thanks",
  "thank",
  "you",
  "soon",
  "later",
]);
const STYLE_COMMON_PHRASE_GLUE_TOKENS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "because",
  "be",
  "been",
  "being",
  "but",
  "by",
  "for",
  "from",
  "if",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "same",
  "some",
  "so",
  "that",
  "the",
  "then",
  "this",
  "to",
  "too",
  "true",
  "was",
  "were",
  "with",
]);
const STYLE_COMMON_PHRASE_BOUNDARY_FILLER_TOKENS = new Set([
  "actually",
  "basically",
  "exactly",
  "fair",
  "honestly",
  "literally",
  "maybe",
  "point",
  "seriously",
  "simply",
  "sometimes",
  "well",
]);
const LEARNED_TRAIT_LIMITS = {
  commonPhrases: 40,
  punctuationStyle: 30,
  humorNotes: 30,
  spellingNotes: 30,
} as const;
type LearnedTraitField = keyof typeof LEARNED_TRAIT_LIMITS;

function isManualSelfAuthoredMessage(message: Pick<Doc<"messages">, "direction" | "senderJid" | "toolRunId">) {
  return message.direction === "outbound" && message.senderJid === "me" && !message.toolRunId;
}

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
  if (hasLowSignalStylePhrase(normalized)) {
    return true;
  }
  return LOW_VALUE_STYLE_PHRASE_PATTERNS.some((pattern) => pattern.test(normalized));
}

function tokenizeStylePhrase(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function hasLowSignalStylePhrase(value: string) {
  const tokens = tokenizeStylePhrase(value);
  if (tokens.length === 0) {
    return true;
  }

  const contentTokens = tokens.filter(
    (token) => token.length > 2 && !STYLE_STOPWORDS.has(token) && !STYLE_LOW_SIGNAL_TOKENS.has(token),
  );
  if (contentTokens.length === 0) {
    return true;
  }

  if (
    tokens.length <= 4 &&
    contentTokens.length <= 1 &&
    (tokens.includes("me") || tokens[0] === "please" || tokens[0] === "kindly" || tokens[0] === "abeg")
  ) {
    return true;
  }
  return false;
}

function containsTokenSequence(containerTokens: string[], candidateTokens: string[]) {
  if (candidateTokens.length === 0 || containerTokens.length < candidateTokens.length) {
    return false;
  }
  outer: for (let containerIndex = 0; containerIndex + candidateTokens.length <= containerTokens.length; containerIndex += 1) {
    for (let candidateIndex = 0; candidateIndex < candidateTokens.length; candidateIndex += 1) {
      if (containerTokens[containerIndex + candidateIndex] !== candidateTokens[candidateIndex]) {
        continue outer;
      }
    }
    return true;
  }
  return false;
}

function collapseContainedCommonPhrases(phrases: string[]) {
  const entries = phrases.map((phrase, index) => ({
    phrase,
    index,
    tokens: tokenizeStylePhrase(phrase),
  }));
  const bySpecificity = [...entries].sort((left, right) => {
    if (right.tokens.length !== left.tokens.length) {
      return right.tokens.length - left.tokens.length;
    }
    if (right.phrase.length !== left.phrase.length) {
      return right.phrase.length - left.phrase.length;
    }
    return left.index - right.index;
  });

  const kept: typeof entries = [];
  for (const entry of bySpecificity) {
    if (kept.some((existing) => containsTokenSequence(existing.tokens, entry.tokens))) {
      continue;
    }
    kept.push(entry);
  }

  return kept
    .sort((left, right) => left.index - right.index)
    .map((entry) => entry.phrase);
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

function isStrictDiscardableCommonPhrase(value: string) {
  if (isDiscardableCommonPhrase(value)) {
    return true;
  }

  const tokens = tokenizeStylePhrase(value);
  if (tokens.length < 3) {
    return true;
  }
  if (tokens.length === 3 && tokens.some((token) => STYLE_COMMON_PHRASE_GLUE_TOKENS.has(token))) {
    return true;
  }

  const firstToken = tokens[0];
  const lastToken = tokens[tokens.length - 1];
  if (tokens.length <= 4 && (STYLE_COMMON_PHRASE_BOUNDARY_FILLER_TOKENS.has(firstToken) || STYLE_COMMON_PHRASE_BOUNDARY_FILLER_TOKENS.has(lastToken))) {
    return true;
  }
  return false;
}

function looksLikeSlidingWindowFragment(phrase: string, phraseSet: Set<string>) {
  const tokens = tokenizeStylePhrase(phrase);
  if (tokens.length !== 3) {
    return false;
  }
  const firstPair = `${tokens[0]} ${tokens[1]}`;
  const lastPair = `${tokens[1]} ${tokens[2]}`;
  return phraseSet.has(firstPair) || phraseSet.has(lastPair);
}

export function normalizeCommonPhraseList(
  values: string[],
  limit: number,
  options: {
    strict?: boolean;
  } = {},
) {
  const normalized = normalizeTraitList(values, limit);
  const strict = options.strict ?? false;
  const phraseSet = new Set(normalized.map((phrase) => phrase.toLowerCase()));
  const filtered = normalized.filter((phrase) => {
    if (strict && looksLikeSlidingWindowFragment(phrase, phraseSet)) {
      return false;
    }
    return strict ? !isStrictDiscardableCommonPhrase(phrase) : !isDiscardableCommonPhrase(phrase);
  });
  return collapseContainedCommonPhrases(filtered).slice(0, limit);
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

export function extractReusablePhrases(text: string) {
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
  }

  return normalizeCommonPhraseList(phrases, 6, { strict: true });
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

function wordCount(text: string) {
  return normalizeTraitValue(text)
    .split(/\s+/)
    .filter(Boolean).length;
}

export function buildStatusVoiceHintsFromTexts(texts: string[]) {
  const cleaned = texts
    .map((text) => normalizeTraitValue(text))
    .filter((text) => text.length > 0)
    .slice(0, 120);

  if (cleaned.length === 0) {
    return {
      totalSamples: 0,
      recurringPhrases: [] as string[],
      toneNotes: [] as string[],
      sampleLines: [] as string[],
      avgWords: 0,
      emojiRate: 0,
      questionRate: 0,
    };
  }

  const phrasePool: string[] = [];
  let emojiCount = 0;
  let questionCount = 0;
  let totalWords = 0;
  for (const text of cleaned) {
    phrasePool.push(...extractReusablePhrases(text).slice(0, 2));
    if (/[😂🤣😹😆😄😁😅😜🤪🙃❤️🔥💯]/u.test(text)) {
      emojiCount += 1;
    }
    if (text.includes("?")) {
      questionCount += 1;
    }
    totalWords += wordCount(text);
  }

  const recurringPhrases = normalizeCommonPhraseList(phrasePool, 8, { strict: true }).slice(0, 5);
  const avgWords = totalWords / Math.max(1, cleaned.length);
  const emojiRate = emojiCount / cleaned.length;
  const questionRate = questionCount / cleaned.length;

  const toneNotes: string[] = [];
  if (avgWords <= 12) {
    toneNotes.push("Prefers short punchy status lines.");
  } else if (avgWords >= 20) {
    toneNotes.push("Sometimes writes fuller status captions.");
  } else {
    toneNotes.push("Uses medium-length conversational status lines.");
  }

  if (questionRate <= 0.2) {
    toneNotes.push("Mostly declarative updates over question prompts.");
  } else {
    toneNotes.push("Occasionally uses question-led status hooks.");
  }

  if (emojiRate >= 0.45) {
    toneNotes.push("Often uses emoji as tone markers.");
  } else if (emojiRate > 0.05) {
    toneNotes.push("Uses emoji sparingly for emphasis.");
  } else {
    toneNotes.push("Mostly text-first style with minimal emoji.");
  }

  return {
    totalSamples: cleaned.length,
    recurringPhrases,
    toneNotes: [...new Set(toneNotes)].slice(0, 4),
    sampleLines: cleaned.slice(0, 5),
    avgWords,
    emojiRate,
    questionRate,
  };
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

async function getLearnedEmojiProfile(ctx: QueryCtx | MutationCtx): Promise<LearnedEmojiProfile> {
  const row = await ctx.db
    .query("appConfig")
    .withIndex("by_key", (q) => q.eq("key", LEARNED_EMOJI_PROFILE_CONFIG_KEY))
    .first();
  return parseLearnedEmojiProfile(row?.value);
}

function withEmojiLearningHints<T extends Record<string, unknown>>(profile: T, learnedEmojiProfile: LearnedEmojiProfile) {
  return {
    ...profile,
    learnedEmojiAllowlist: learnedEmojiProfile.topEmojis.slice(0, 12),
    learnedEmojiCategoryHints: learnedEmojiProfile.categoryHints.slice(0, 6),
  };
}

export const getEmojiProfile = query({
  args: {},
  handler: async (ctx) => {
    return await getLearnedEmojiProfile(ctx);
  },
});

export const getProfile = query({
  args: {},
  handler: async (ctx) => {
    const learnedEmojiProfile = await getLearnedEmojiProfile(ctx);
    const profile = await ctx.db
      .query("styleProfiles")
      .withIndex("by_scope", (q) => q.eq("scope", "global"))
      .first();

    if (profile) {
      return withEmojiLearningHints(profile, learnedEmojiProfile);
    }

    return withEmojiLearningHints({
      scope: "global" as const,
      mimicryLevel: DEFAULT_MIMICRY_LEVEL,
      commonPhrases: [],
      punctuationStyle: [],
      humorNotes: [],
      spellingNotes: [],
      updatedAt: Date.now(),
    }, learnedEmojiProfile);
  },
});

export const getStatusVoice = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(Math.round(args.limit ?? 10), 24));
    const scanLimit = Math.max(limit * 6, 80);
    const statusRows = await ctx.db
      .query("messages")
      .withIndex("by_isStatus_and_messageAt", (q) => q.eq("isStatus", true))
      .order("desc")
      .take(scanLimit);

    const manualStatusTexts = statusRows
      .filter((row) => isManualSelfAuthoredMessage(row))
      .map((row) => {
        const primary = normalizeTraitValue(row.text || "");
        const caption = normalizeTraitValue(row.mediaCaption || "");
        if (row.messageType === "reaction") {
          return "";
        }
        if (caption && caption !== primary) {
          return `${primary} ${caption}`.trim();
        }
        return primary || caption;
      })
      .filter((text) => text.length > 0)
      .slice(0, limit);

    const hints = buildStatusVoiceHintsFromTexts(manualStatusTexts);
    return {
      ...hints,
      tool: "style.status_voice",
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
      const seedValues = trait === "commonPhrases" ? normalizeCommonPhraseList([nextValue], limit) : normalizeTraitList([nextValue], limit);
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

    const currentValues =
      trait === "commonPhrases"
        ? normalizeCommonPhraseList(getTraitValues(profile, trait), limit)
        : normalizeTraitList(getTraitValues(profile, trait), limit);
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

    nextValues = trait === "commonPhrases" ? normalizeCommonPhraseList(nextValues, limit) : normalizeTraitList(nextValues, limit);
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

    const currentValues =
      trait === "commonPhrases"
        ? normalizeCommonPhraseList(getTraitValues(profile, trait), limit)
        : normalizeTraitList(getTraitValues(profile, trait), limit);
    const nextValues =
      trait === "commonPhrases"
        ? normalizeCommonPhraseList(
            currentValues.filter((item) => item.toLowerCase() !== target.toLowerCase()),
            limit,
          )
        : normalizeTraitList(
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

    const currentValues =
      trait === "commonPhrases"
        ? normalizeCommonPhraseList(getTraitValues(profile, trait), limit)
        : normalizeTraitList(getTraitValues(profile, trait), limit);
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
    const result: {
      dryRun: boolean;
      scannedProfiles: number;
      updatedProfiles: number;
      removedPhraseCount: number;
      isDone: boolean;
    } = await ctx.runMutation(internal.style.cleanupCommonPhrasesBatch, {
      dryRun: args.dryRun ?? false,
      cursor: null,
      scannedProfiles: 0,
      updatedProfiles: 0,
      removedPhraseCount: 0,
    });
    return result;
  },
});

export const cleanupCommonPhrasesBatch = internalMutation({
  args: {
    dryRun: v.boolean(),
    cursor: v.union(v.string(), v.null()),
    scannedProfiles: v.number(),
    updatedProfiles: v.number(),
    removedPhraseCount: v.number(),
  },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("styleProfiles")
      .order("asc")
      .paginate({ numItems: CLEANUP_COMMON_PHRASES_BATCH_SIZE, cursor: args.cursor });
    const now = Date.now();
    let scannedProfiles = args.scannedProfiles;
    let updatedProfiles = args.updatedProfiles;
    let removedPhraseCount = args.removedPhraseCount;

    for (const profile of page.page) {
      scannedProfiles += 1;
      const currentPhrases = normalizeTraitList(profile.commonPhrases || [], LEARNED_TRAIT_LIMITS.commonPhrases);
      const nextPhrases = normalizeCommonPhraseList(currentPhrases, LEARNED_TRAIT_LIMITS.commonPhrases, { strict: true });
      if (arrayEquals(currentPhrases, nextPhrases)) {
        continue;
      }

      updatedProfiles += 1;
      removedPhraseCount += Math.max(0, currentPhrases.length - nextPhrases.length);

      if (!args.dryRun) {
        await snapshotProfile(ctx, profile, "pre-common-phrases-cleanup", now);
        await ctx.db.patch(profile._id, {
          commonPhrases: nextPhrases,
          updatedAt: now,
        });
      }
    }

    if (!args.dryRun && !page.isDone) {
      await ctx.scheduler.runAfter(0, internal.style.cleanupCommonPhrasesBatch, {
        dryRun: false,
        cursor: page.continueCursor,
        scannedProfiles,
        updatedProfiles,
        removedPhraseCount,
      });
    }

    if (!args.dryRun && page.isDone) {
      await ctx.db.insert("systemEvents", {
        source: "convex",
        eventType: "style.commonPhrases.cleanup",
        detail: `Cleaned common phrases across ${updatedProfiles}/${scannedProfiles} style profiles, removed ${removedPhraseCount} phrases.`,
        createdAt: now,
      });
    }

    return {
      dryRun: args.dryRun,
      scannedProfiles,
      updatedProfiles,
      removedPhraseCount,
      isDone: page.isDone,
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

export const learnFromOutboundEmoji = internalMutation({
  args: {
    threadId: v.id("threads"),
    sendKind: v.optional(v.union(v.literal("text"), v.literal("reaction"), v.literal("sticker"), v.literal("meme"), v.literal("voice_note"))),
    text: v.optional(v.string()),
    mediaCaption: v.optional(v.string()),
    reactionEmoji: v.optional(v.string()),
    messageAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const messageAt = Number.isFinite(args.messageAt) ? Number(args.messageAt) : Date.now();
    const baseProfile = await getLearnedEmojiProfile(ctx);
    const nextProfile = applyEmojiUsageSignal(baseProfile, {
      texts: [args.text || "", args.mediaCaption || ""],
      reactionEmoji: args.reactionEmoji,
      messageAt,
    });

    if (nextProfile.totalEmojiObservations === baseProfile.totalEmojiObservations) {
      return {
        learned: false,
        reason: "no_emoji_signal",
        threadId: args.threadId,
        topEmojis: baseProfile.topEmojis.slice(0, 6),
      } as const;
    }

    await setConfigValue(ctx, LEARNED_EMOJI_PROFILE_CONFIG_KEY, JSON.stringify(nextProfile));

    return {
      learned: true,
      threadId: args.threadId,
      topEmojis: nextProfile.topEmojis.slice(0, 6),
      categoryHints: nextProfile.categoryHints.slice(0, 3),
    } as const;
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
      (message) =>
        isManualSelfAuthoredMessage(message) &&
        (message.messageType || "text") === "text" &&
        message.text.trim().length > 0,
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
        commonPhrases: normalizeCommonPhraseList(mergeLimited(existing.commonPhrases || [], phrases, 40), 40, { strict: true }),
        humorNotes: mergeLimited(existing.humorNotes || [], humorNotes, 30),
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("styleProfiles", {
        scope: "global",
        mimicryLevel: DEFAULT_MIMICRY_LEVEL,
        commonPhrases: normalizeCommonPhraseList(mergeLimited([], phrases, 40), 40, { strict: true }),
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
