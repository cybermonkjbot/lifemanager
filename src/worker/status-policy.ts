export type MinimalMessageSnapshot = {
  direction: "inbound" | "outbound";
  messageAt?: number;
};

export type StatusOutreachLimitResult = {
  allowed: boolean;
  reason?: "daily_limit" | "too_soon";
  outboundInWindow: number;
  lastOutboundAt?: number;
  waitMs?: number;
};

export const STATUS_OUTREACH_WINDOW_MS = 24 * 60 * 60 * 1000;
export const STATUS_OUTREACH_MAX_PER_WINDOW = 2;
export const STATUS_OUTREACH_MIN_GAP_MS = 3 * 60 * 60 * 1000;
const MARKETING_STRONG_PATTERN =
  /\b(link in bio|order now|buy now|book now|promo code|use code|limited offer|while stocks? last|for sale|available for (booking|bookings|order|orders|sale))\b/i;
const MARKETING_INTENT_PATTERN =
  /\b(sale|discount|promo|promotion|offer|deal|clearance|pre[- ]?order|order|orders|buy|selling|sell|book|booking|bookings|subscribe|register|apply|price|pricing|rates?|slot|slots|available)\b/i;
const MARKETING_CTA_PATTERN = /\b(dm|dms|inbox|message|whatsapp|call|text|tap|click|contact)\b/i;
const MARKETING_TAG_PATTERN = /#(?:ad|ads|advert|advertisement|sponsored|promo)\b/i;
const MARKETING_PRICE_PATTERN = /(?:[$£€₦]|usd|ngn|naira)\s?\d|\b\d{2,}\s?(?:usd|ngn|naira|bucks)\b/i;
const MARKETING_DISCOUNT_PATTERN = /\b\d{1,3}\s?%\s?off\b/i;
const STATUS_QUESTION_WORD_PATTERN = /\b(what|why|when|where|who|how|which)\b/i;
const STATUS_DIRECT_QUESTION_START_PATTERN = /^(can|could|would|will|should|do|does|did|is|are|am|was|were|have|has|had|anyone)\b/i;
const STATUS_QUESTION_CUE_PATTERN = /\b(let me know|tell me|thoughts|opinion|opinions)\b/i;
const DECLARATIVE_STATUS_FALLBACKS = [
  "The signal gets clearer after the noise fades.",
  "Staying close to the trends, but closer to the fundamentals.",
  "Culture moves fast; pattern recognition still wins.",
  "A little context changes the whole moment.",
];
const STATUS_INTEREST_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "around",
  "audience",
  "daily",
  "demographic",
  "for",
  "fun",
  "general",
  "interest",
  "interests",
  "in",
  "life",
  "mixed",
  "motivation",
  "news",
  "of",
  "on",
  "social",
  "status",
  "story",
  "the",
  "topic",
  "topics",
  "trend",
  "trends",
  "update",
  "updates",
  "with",
]);

export type StatusInterestSearchPlan = {
  interests: string[];
  queries: string[];
};

function finiteTimestamp(value: unknown): number | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return parsed;
}

function computeStableHash(input: string) {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function normalizeInterestPhrase(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function clampRound(value: number | undefined, fallback: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.round(value as number)));
}

export function evaluateStatusOutreachLimit(args: {
  nowMs: number;
  messages: MinimalMessageSnapshot[];
  maxPerWindow?: number;
  windowMs?: number;
  minGapMs?: number;
}): StatusOutreachLimitResult {
  const nowMs = Math.max(0, Number(args.nowMs) || Date.now());
  const maxPerWindow = Math.max(1, Math.round(args.maxPerWindow ?? STATUS_OUTREACH_MAX_PER_WINDOW));
  const windowMs = Math.max(60_000, Math.round(args.windowMs ?? STATUS_OUTREACH_WINDOW_MS));
  const minGapMs = Math.max(15_000, Math.round(args.minGapMs ?? STATUS_OUTREACH_MIN_GAP_MS));
  const cutoff = nowMs - windowMs;

  const outboundTimestamps = args.messages
    .filter((message) => message.direction === "outbound")
    .map((message) => finiteTimestamp(message.messageAt))
    .filter((value): value is number => value !== undefined && value <= nowMs)
    .sort((a, b) => b - a);

  const outboundInWindow = outboundTimestamps.filter((messageAt) => messageAt >= cutoff).length;
  const lastOutboundAt = outboundTimestamps[0];

  if (outboundInWindow >= maxPerWindow) {
    return {
      allowed: false,
      reason: "daily_limit",
      outboundInWindow,
      lastOutboundAt,
    };
  }

  if (lastOutboundAt && nowMs - lastOutboundAt < minGapMs) {
    return {
      allowed: false,
      reason: "too_soon",
      outboundInWindow,
      lastOutboundAt,
      waitMs: Math.max(0, minGapMs - (nowMs - lastOutboundAt)),
    };
  }

  return {
    allowed: true,
    outboundInWindow,
    lastOutboundAt,
  };
}

export function pickLaughReactionEmoji(text: string, funnyEmojis: string[]) {
  const laughPool = ["😂", "🤣", "😆", "😅", "😄", "😁", "😹", "💀"];
  for (const emoji of laughPool) {
    if (text.includes(emoji)) {
      return emoji;
    }
  }
  for (const emoji of funnyEmojis) {
    if (laughPool.includes(emoji)) {
      return emoji;
    }
  }
  return "😂";
}

export function shouldUseLaughReactionOnly(args: {
  text: string;
  hasFunnySignal: boolean;
  hasInterestSignal: boolean;
  messageAt: number;
}): boolean {
  if (!args.hasFunnySignal || args.hasInterestSignal) {
    return false;
  }

  const normalized = args.text.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  if (/[?]/.test(normalized)) {
    return false;
  }

  if (/\b(what|why|when|where|who|how|should|can|could|would|let\s+me\s+know|thoughts|opinion)\b/i.test(normalized)) {
    return false;
  }

  const hash = computeStableHash(`${normalized}:${Math.round(args.messageAt / 60_000)}`);
  return hash % 3 === 0;
}

export function forceDeclarativeStatusText(text: string) {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (!collapsed) {
    return DECLARATIVE_STATUS_FALLBACKS[0];
  }

  const normalized = collapsed.toLowerCase();
  const questionLike =
    /[?]/.test(collapsed) ||
    STATUS_DIRECT_QUESTION_START_PATTERN.test(normalized) ||
    STATUS_QUESTION_WORD_PATTERN.test(normalized) ||
    STATUS_QUESTION_CUE_PATTERN.test(normalized);

  if (!questionLike) {
    return collapsed.replace(/[?]+/g, "").trim();
  }

  const index = computeStableHash(normalized) % DECLARATIVE_STATUS_FALLBACKS.length;
  return DECLARATIVE_STATUS_FALLBACKS[index];
}

export function isLikelyMarketingStatus(text: string): boolean {
  const normalized = text.replace(/\s+/g, " ").trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  if (MARKETING_TAG_PATTERN.test(normalized) || MARKETING_STRONG_PATTERN.test(normalized)) {
    return true;
  }

  const hasIntent = MARKETING_INTENT_PATTERN.test(normalized);
  const hasCta = MARKETING_CTA_PATTERN.test(normalized);
  const hasPrice = MARKETING_PRICE_PATTERN.test(normalized) || MARKETING_DISCOUNT_PATTERN.test(normalized);
  return (hasIntent && hasCta) || (hasIntent && hasPrice);
}

export function extractStatusInterests(theme: string): string[] {
  const raw = String(theme || "").trim();
  if (!raw) {
    return [];
  }

  const seen = new Set<string>();
  const picked: string[] = [];
  const pushCandidate = (candidate: string) => {
    const cleaned = normalizeInterestPhrase(candidate);
    if (!cleaned || seen.has(cleaned)) {
      return;
    }
    const tokens = cleaned.split(" ").filter(Boolean);
    if (tokens.length === 0 || tokens.length > 5) {
      return;
    }
    if (tokens.every((token) => STATUS_INTEREST_STOPWORDS.has(token) || token.length < 2)) {
      return;
    }
    if (tokens.some((token) => token.length >= 2 && !STATUS_INTEREST_STOPWORDS.has(token))) {
      seen.add(cleaned);
      picked.push(cleaned);
    }
  };

  const commaChunks = raw
    .split(/[|,;]+/)
    .map((segment) => normalizeInterestPhrase(segment))
    .filter(Boolean)
    .slice(0, 12);
  for (const chunk of commaChunks) {
    pushCandidate(chunk);
  }

  if (picked.length === 0) {
    const normalized = normalizeInterestPhrase(raw);
    const wordChunks = normalized
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 2 && !STATUS_INTEREST_STOPWORDS.has(token))
      .slice(0, 6);
    for (const chunk of wordChunks) {
      pushCandidate(chunk);
    }
  }

  return picked.slice(0, 4);
}

export function buildStatusInterestSearchQueries(args: {
  trendTheme: string;
  demographicHint?: string;
  nowMs?: number;
  maxQueries?: number;
}): StatusInterestSearchPlan {
  const interests = extractStatusInterests(args.trendTheme).slice(0, 3);
  const maxQueries = clampRound(args.maxQueries, 3, 1, 5);
  const nowMs = Math.max(0, Number(args.nowMs) || Date.now());
  const year = new Date(nowMs).getFullYear();
  const demographic = normalizeInterestPhrase(args.demographicHint || "");
  const demographicSuffix = demographic && demographic !== "mixed" ? ` for ${demographic} audience` : "";

  const queries: string[] = [];
  const seenQueries = new Set<string>();
  const pushQuery = (query: string) => {
    if (queries.length >= maxQueries) {
      return;
    }
    const normalized = query.replace(/\s+/g, " ").trim().slice(0, 240);
    if (!normalized) {
      return;
    }
    const key = normalized.toLowerCase();
    if (seenQueries.has(key)) {
      return;
    }
    seenQueries.add(key);
    queries.push(normalized);
  };

  if (interests.length > 0) {
    pushQuery(`latest ${year} updates and social conversation on ${interests.join(", ")}${demographicSuffix}`);
    for (const interest of interests) {
      pushQuery(`latest ${year} news and online trends about ${interest}${demographicSuffix}`);
      pushQuery(`${year} talking points and memes around ${interest}${demographicSuffix}`);
      if (queries.length >= maxQueries) {
        break;
      }
    }
  }

  if (queries.length === 0) {
    pushQuery(`latest ${year} social and pop-culture trends${demographicSuffix}`);
    pushQuery(`what people are discussing online right now${demographicSuffix}`);
  }

  return {
    interests,
    queries,
  };
}
