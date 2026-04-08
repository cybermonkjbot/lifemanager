export type EmojiUsageCategory =
  | "humor"
  | "affection"
  | "gratitude"
  | "hype"
  | "calm"
  | "skeptical"
  | "sad"
  | "frustrated"
  | "general";

export type LearnedEmojiStat = {
  emoji: string;
  count: number;
  lastUsedAt: number;
  categoryCounts: Record<string, number>;
};

export type LearnedEmojiProfile = {
  version: 1;
  updatedAt: number;
  totalEmojiObservations: number;
  totalEmojiMessages: number;
  emojiStats: LearnedEmojiStat[];
  topEmojis: string[];
  categoryHints: string[];
};

const KNOWN_CATEGORIES: EmojiUsageCategory[] = [
  "humor",
  "affection",
  "gratitude",
  "hype",
  "calm",
  "skeptical",
  "sad",
  "frustrated",
  "general",
];
const CATEGORY_LABELS: Record<EmojiUsageCategory, string> = {
  humor: "Humor",
  affection: "Affection",
  gratitude: "Gratitude",
  hype: "Hype",
  calm: "Calm/ack",
  skeptical: "Skeptical/teasing",
  sad: "Sad/soft",
  frustrated: "Frustrated/emphasis",
  general: "General",
};

const MAX_TRACKED_EMOJIS = 40;
const MAX_TOP_EMOJIS = 12;
const MAX_HINTS = 6;
const MAX_EMOJI_TOKENS_PER_SIGNAL = 40;
const EMOJI_TOKEN_REGEX = /[\p{Extended_Pictographic}\p{Regional_Indicator}](?:[\uFE0F\u200D\p{Extended_Pictographic}\p{Regional_Indicator}]*)/gu;
const EMOJI_PRESENT_REGEX = /[\p{Extended_Pictographic}\p{Regional_Indicator}]/u;

const HUMOR_EMOJIS = new Set(["😂", "🤣", "😹", "😆", "😄", "😁", "😅", "😜", "🤪", "🙃", "💀", "😹"]);
const AFFECTION_EMOJIS = new Set(["❤️", "♥️", "💕", "💖", "😍", "🥰", "😘", "🤍", "💙", "💚", "🫶"]);
const GRATITUDE_EMOJIS = new Set(["🙏", "🤝", "🙌", "🤲"]);
const HYPE_EMOJIS = new Set(["🔥", "🚀", "💯", "⚡", "✨", "🎉", "🥳", "👏", "🙌"]);
const CALM_EMOJIS = new Set(["🙂", "😊", "😌", "👌", "✅", "👍", "🙂‍↔️"]);
const SKEPTICAL_EMOJIS = new Set(["😒", "🙄", "🤨", "😏", "🌚"]);
const SAD_EMOJIS = new Set(["😢", "😭", "🥲", "😔", "😞"]);
const FRUSTRATED_EMOJIS = new Set(["😤", "😠", "🤦", "🤦‍♂️", "🤦‍♀️", "😩"]);

const CATEGORY_TEXT_PATTERNS: Array<{ category: EmojiUsageCategory; pattern: RegExp }> = [
  { category: "humor", pattern: /\b(lol|lmao|lmfao|haha|hehe|joke|banter|funny|meme|roast|dead)\b/i },
  { category: "affection", pattern: /\b(love|miss you|baby|babe|darling|sweet|dear|xoxo)\b/i },
  { category: "gratitude", pattern: /\b(thanks|thank you|grateful|appreciate|bless)\b/i },
  { category: "hype", pattern: /\b(fire|mad|crazy good|let'?s go|goated|hyped|win|victory|big)\b/i },
  { category: "calm", pattern: /\b(okay|ok|alright|noted|calm|easy|safe|sure)\b/i },
  { category: "skeptical", pattern: /\b(abi|really|sure\?|hmm|hmmm|side eye|skeptical)\b/i },
  { category: "sad", pattern: /\b(sad|sorry|pain|hurt|miss|bad day|tired)\b/i },
  { category: "frustrated", pattern: /\b(stress|annoy|frustrat|wtf|why now|tire me)\b/i },
];

function clampInt(value: number, min: number, max: number) {
  return Math.round(Math.max(min, Math.min(max, value)));
}

function isEmojiToken(value: string) {
  return EMOJI_PRESENT_REGEX.test(value);
}

function normalizeStat(raw: unknown): LearnedEmojiStat | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const row = raw as { emoji?: unknown; count?: unknown; lastUsedAt?: unknown; categoryCounts?: unknown };
  const emoji = typeof row.emoji === "string" ? row.emoji.trim() : "";
  const count = Number.isFinite(row.count) ? clampInt(Number(row.count), 1, 1_000_000_000) : 0;
  const lastUsedAt = Number.isFinite(row.lastUsedAt) ? Math.max(0, Number(row.lastUsedAt)) : 0;
  if (!emoji || !isEmojiToken(emoji) || count <= 0) {
    return null;
  }

  const nextCategoryCounts: Record<string, number> = {};
  if (row.categoryCounts && typeof row.categoryCounts === "object") {
    for (const category of KNOWN_CATEGORIES) {
      const value = (row.categoryCounts as Record<string, unknown>)[category];
      if (!Number.isFinite(value)) {
        continue;
      }
      const parsed = clampInt(Number(value), 0, 1_000_000_000);
      if (parsed > 0) {
        nextCategoryCounts[category] = parsed;
      }
    }
  }

  return {
    emoji,
    count,
    lastUsedAt,
    categoryCounts: nextCategoryCounts,
  };
}

function sortEmojiStats(stats: LearnedEmojiStat[]) {
  return [...stats]
    .sort((left, right) => right.count - left.count || right.lastUsedAt - left.lastUsedAt || left.emoji.localeCompare(right.emoji))
    .slice(0, MAX_TRACKED_EMOJIS);
}

function summarizeCategoryHints(stats: LearnedEmojiStat[]) {
  const categoryTotals = new Map<EmojiUsageCategory, number>();
  for (const stat of stats) {
    for (const category of KNOWN_CATEGORIES) {
      const count = Number(stat.categoryCounts?.[category] || 0);
      if (count <= 0) {
        continue;
      }
      categoryTotals.set(category, (categoryTotals.get(category) || 0) + count);
    }
  }

  const ranked = [...categoryTotals.entries()]
    .filter(([, count]) => count > 0)
    .sort((left, right) => right[1] - left[1])
    .slice(0, MAX_HINTS);

  const hints: string[] = [];
  for (const [category] of ranked) {
    const categoryEmojis = stats
      .map((stat) => ({
        emoji: stat.emoji,
        count: Number(stat.categoryCounts?.[category] || 0),
      }))
      .filter((entry) => entry.count > 0)
      .sort((left, right) => right.count - left.count || left.emoji.localeCompare(right.emoji))
      .slice(0, 3)
      .map((entry) => entry.emoji);

    if (categoryEmojis.length === 0) {
      continue;
    }
    hints.push(`${CATEGORY_LABELS[category]}: often uses ${categoryEmojis.join(", ")}.`);
  }

  return hints.slice(0, MAX_HINTS);
}

function withDerivedFields(args: {
  updatedAt: number;
  totalEmojiObservations: number;
  totalEmojiMessages: number;
  emojiStats: LearnedEmojiStat[];
}): LearnedEmojiProfile {
  const emojiStats = sortEmojiStats(args.emojiStats);
  const topEmojis = emojiStats.slice(0, MAX_TOP_EMOJIS).map((entry) => entry.emoji);
  return {
    version: 1,
    updatedAt: Math.max(0, args.updatedAt),
    totalEmojiObservations: clampInt(args.totalEmojiObservations, 0, 1_000_000_000),
    totalEmojiMessages: clampInt(args.totalEmojiMessages, 0, 1_000_000_000),
    emojiStats,
    topEmojis,
    categoryHints: summarizeCategoryHints(emojiStats),
  };
}

export function createEmptyLearnedEmojiProfile(nowMs = Date.now()): LearnedEmojiProfile {
  return {
    version: 1,
    updatedAt: nowMs,
    totalEmojiObservations: 0,
    totalEmojiMessages: 0,
    emojiStats: [],
    topEmojis: [],
    categoryHints: [],
  };
}

export function parseLearnedEmojiProfile(raw: string | undefined | null): LearnedEmojiProfile {
  if (!raw) {
    return createEmptyLearnedEmojiProfile();
  }

  try {
    const parsed = JSON.parse(raw) as {
      version?: unknown;
      updatedAt?: unknown;
      totalEmojiObservations?: unknown;
      totalEmojiMessages?: unknown;
      emojiStats?: unknown;
    };
    const stats = Array.isArray(parsed.emojiStats) ? parsed.emojiStats.map(normalizeStat).filter(Boolean) as LearnedEmojiStat[] : [];
    const updatedAt = Number.isFinite(parsed.updatedAt) ? Math.max(0, Number(parsed.updatedAt)) : Date.now();
    const totalEmojiObservations = Number.isFinite(parsed.totalEmojiObservations) ? Number(parsed.totalEmojiObservations) : 0;
    const totalEmojiMessages = Number.isFinite(parsed.totalEmojiMessages) ? Number(parsed.totalEmojiMessages) : 0;
    return withDerivedFields({
      updatedAt,
      totalEmojiObservations,
      totalEmojiMessages,
      emojiStats: stats,
    });
  } catch {
    return createEmptyLearnedEmojiProfile();
  }
}

export function extractEmojiTokens(text: string) {
  const normalized = text.trim();
  if (!normalized) {
    return [] as string[];
  }
  if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    const tokens: string[] = [];
    for (const part of segmenter.segment(normalized)) {
      const segment = part.segment;
      if (!isEmojiToken(segment)) {
        continue;
      }
      tokens.push(segment);
      if (tokens.length >= MAX_EMOJI_TOKENS_PER_SIGNAL) {
        break;
      }
    }
    if (tokens.length > 0) {
      return tokens;
    }
  }
  return (normalized.match(EMOJI_TOKEN_REGEX) || []).filter(isEmojiToken).slice(0, MAX_EMOJI_TOKENS_PER_SIGNAL);
}

function inferCategoriesForToken(emoji: string, contextText: string) {
  const inferred: EmojiUsageCategory[] = [];

  if (HUMOR_EMOJIS.has(emoji)) inferred.push("humor");
  if (AFFECTION_EMOJIS.has(emoji)) inferred.push("affection");
  if (GRATITUDE_EMOJIS.has(emoji)) inferred.push("gratitude");
  if (HYPE_EMOJIS.has(emoji)) inferred.push("hype");
  if (CALM_EMOJIS.has(emoji)) inferred.push("calm");
  if (SKEPTICAL_EMOJIS.has(emoji)) inferred.push("skeptical");
  if (SAD_EMOJIS.has(emoji)) inferred.push("sad");
  if (FRUSTRATED_EMOJIS.has(emoji)) inferred.push("frustrated");

  for (const rule of CATEGORY_TEXT_PATTERNS) {
    if (rule.pattern.test(contextText)) {
      inferred.push(rule.category);
    }
  }

  if (inferred.length === 0) {
    inferred.push("general");
  }

  return [...new Set(inferred)].slice(0, 4);
}

export function applyEmojiUsageSignal(
  current: LearnedEmojiProfile,
  args: {
    texts?: string[];
    reactionEmoji?: string;
    messageAt?: number;
  },
) {
  const messageAt = Number.isFinite(args.messageAt) ? Number(args.messageAt) : Date.now();
  const textSources = (args.texts || []).map((value) => value.trim()).filter(Boolean).slice(0, 3);
  const contextText = textSources.join("\n").toLowerCase();
  const tokens = textSources.flatMap((source) => extractEmojiTokens(source));
  if (args.reactionEmoji?.trim()) {
    tokens.push(...extractEmojiTokens(args.reactionEmoji.trim()));
  }
  const boundedTokens = tokens.slice(0, MAX_EMOJI_TOKENS_PER_SIGNAL);

  if (boundedTokens.length === 0) {
    return current;
  }

  const statsMap = new Map<string, LearnedEmojiStat>();
  for (const entry of current.emojiStats || []) {
    statsMap.set(entry.emoji, {
      emoji: entry.emoji,
      count: Math.max(0, Number(entry.count || 0)),
      lastUsedAt: Math.max(0, Number(entry.lastUsedAt || 0)),
      categoryCounts: { ...(entry.categoryCounts || {}) },
    });
  }

  for (const emoji of boundedTokens) {
    const stat = statsMap.get(emoji) || {
      emoji,
      count: 0,
      lastUsedAt: 0,
      categoryCounts: {},
    };
    stat.count += 1;
    stat.lastUsedAt = Math.max(stat.lastUsedAt, messageAt);
    const categories = inferCategoriesForToken(emoji, contextText);
    for (const category of categories) {
      stat.categoryCounts[category] = (stat.categoryCounts[category] || 0) + 1;
    }
    statsMap.set(emoji, stat);
  }

  return withDerivedFields({
    updatedAt: messageAt,
    totalEmojiObservations: current.totalEmojiObservations + boundedTokens.length,
    totalEmojiMessages: current.totalEmojiMessages + 1,
    emojiStats: [...statsMap.values()],
  });
}
