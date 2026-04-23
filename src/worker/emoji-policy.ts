export const EMOJI_COOLDOWN_MS = 12 * 60 * 1000;

const EMOJI_DETECTION_REGEX = /[\p{Extended_Pictographic}\p{Regional_Indicator}]/u;
const EMOJI_STRIP_REGEX = /[\p{Extended_Pictographic}\p{Regional_Indicator}\uFE0F\u200D]/gu;

type ThreadMessageLike = {
  direction?: "inbound" | "outbound" | string;
  text?: string;
  messageAt?: number;
};

function containsOneOf(text: string, tokens: string[]) {
  return tokens.some((token) => token && text.includes(token));
}

function stripProvidedEmojiTokens(text: string, tokens: string[]) {
  let next = text;
  for (const token of tokens) {
    if (!token) {
      continue;
    }
    next = next.split(token).join("");
  }
  return next;
}

export function containsAnyEmoji(text: string) {
  return EMOJI_DETECTION_REGEX.test(text);
}

export function stripEmojiCharacters(text: string) {
  const withoutEmoji = text.replace(EMOJI_STRIP_REGEX, "");
  return withoutEmoji
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/[ \t]+(\n)/g, "$1")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .trim();
}

export function findRecentOutboundEmojiTimestamp(args: {
  messages?: ThreadMessageLike[] | null;
  nowMs: number;
  cooldownMs?: number;
}) {
  const cooldownMs = Math.max(1_000, args.cooldownMs ?? EMOJI_COOLDOWN_MS);
  const messages = args.messages || [];
  let latest: number | null = null;

  for (const message of messages) {
    if (message.direction !== "outbound") {
      continue;
    }
    if (!Number.isFinite(message.messageAt)) {
      continue;
    }
    const messageAt = Number(message.messageAt);
    if (messageAt > args.nowMs) {
      continue;
    }
    if (args.nowMs - messageAt >= cooldownMs) {
      continue;
    }
    if (!containsAnyEmoji(message.text || "")) {
      continue;
    }
    if (latest === null || messageAt > latest) {
      latest = messageAt;
    }
  }

  return latest;
}

function countRecentOutboundEmojiMessages(args: {
  messages?: ThreadMessageLike[] | null;
  nowMs: number;
  windowMs: number;
  allowedEmojis?: string[];
}) {
  const messages = args.messages || [];
  const windowMs = Math.max(60_000, args.windowMs);
  const cutoff = args.nowMs - windowMs;
  const allowed = args.allowedEmojis?.filter(Boolean) || [];
  const enforceAllowlist = allowed.length > 0;
  let count = 0;

  for (const message of messages) {
    if (message.direction !== "outbound") {
      continue;
    }
    const text = (message.text || "").trim();
    if (!text) {
      continue;
    }
    if (Number.isFinite(message.messageAt)) {
      const messageAt = Number(message.messageAt);
      if (messageAt > args.nowMs) {
        continue;
      }
      if (messageAt < cutoff) {
        continue;
      }
    }
    const matches = enforceAllowlist ? containsOneOf(text, allowed) : containsAnyEmoji(text);
    if (!matches) {
      continue;
    }
    count += 1;
  }

  return count;
}

export function applyEmojiCooldownPolicy(args: {
  text: string;
  nowMs?: number;
  cooldownMs?: number;
  fallbackText?: string;
  recentMessages?: ThreadMessageLike[] | null;
  lastEmojiSentAtMs?: number | null;
  allowEmojiInText?: boolean;
  allowedEmojiInText?: string[];
  maxAllowedEmojiMessagesInWindow?: number;
  maxAnyEmojiMessagesInWindowBeforeAllowlist?: number;
  allowedEmojiWindowMs?: number;
}) {
  const nowMs = Number.isFinite(args.nowMs) ? Number(args.nowMs) : Date.now();
  const cooldownMs = Math.max(1_000, args.cooldownMs ?? EMOJI_COOLDOWN_MS);
  const allowEmojiInText = args.allowEmojiInText === true;
  const allowedEmojis = Array.from(new Set((args.allowedEmojiInText || []).map((item) => item.trim()).filter(Boolean)));
  const enforceAllowlist = allowedEmojis.length > 0;
  const maxAllowedEmojiMessagesInWindow = Math.max(1, Math.min(5, Math.round(args.maxAllowedEmojiMessagesInWindow ?? 2)));
  const maxAnyEmojiMessagesInWindowBeforeAllowlist = Math.max(
    0,
    Math.min(5, Math.round(args.maxAnyEmojiMessagesInWindowBeforeAllowlist ?? 0)),
  );
  const allowedEmojiWindowMs = Math.max(60_000, args.allowedEmojiWindowMs ?? 6 * 60 * 60 * 1000);
  const hasRecentMessages = (args.recentMessages || []).length > 0;
  const recentAllowedEmojiCount = countRecentOutboundEmojiMessages({
    messages: args.recentMessages,
    nowMs,
    windowMs: allowedEmojiWindowMs,
    allowedEmojis: enforceAllowlist ? allowedEmojis : undefined,
  });
  const recentAnyEmojiCount = countRecentOutboundEmojiMessages({
    messages: args.recentMessages,
    nowMs,
    windowMs: allowedEmojiWindowMs,
  });
  const historyEmojiAt = findRecentOutboundEmojiTimestamp({
    messages: args.recentMessages,
    nowMs,
    cooldownMs,
  });
  const liveEmojiAt = Number.isFinite(args.lastEmojiSentAtMs) ? Number(args.lastEmojiSentAtMs) : null;
  const latestEmojiAt = Math.max(historyEmojiAt ?? -1, liveEmojiAt ?? -1);
  const cooldownActive = latestEmojiAt >= 0 && nowMs - latestEmojiAt < cooldownMs;
  const hadEmoji = containsAnyEmoji(args.text);
  const hasAllowedEmoji = enforceAllowlist ? containsOneOf(args.text, allowedEmojis) : hadEmoji;
  const hasOnlyAllowedEmoji = enforceAllowlist ? !containsAnyEmoji(stripProvidedEmojiTokens(args.text, allowedEmojis)) : hadEmoji;
  const hasDisallowedEmoji = enforceAllowlist && !hasOnlyAllowedEmoji;

  if (!hadEmoji) {
    return {
      text: args.text,
      hadEmoji,
      cooldownActive,
      emojiSuppressed: false,
      shouldRecordEmojiSend: false,
      activeSinceMs: latestEmojiAt >= 0 ? latestEmojiAt : undefined,
    };
  }

  if (allowEmojiInText && hasAllowedEmoji && hasOnlyAllowedEmoji) {
    const belowWindowLimit = hasRecentMessages && recentAllowedEmojiCount < maxAllowedEmojiMessagesInWindow;
    const allowByFallbackCooldown = !hasRecentMessages && !cooldownActive;
    if (belowWindowLimit || allowByFallbackCooldown) {
      return {
        text: args.text,
        hadEmoji,
        cooldownActive,
        emojiSuppressed: false,
        shouldRecordEmojiSend: true,
        activeSinceMs: undefined,
      };
    }
  }

  if (allowEmojiInText && hasDisallowedEmoji && maxAnyEmojiMessagesInWindowBeforeAllowlist > 0) {
    const belowWarmupLimit = recentAnyEmojiCount < maxAnyEmojiMessagesInWindowBeforeAllowlist;
    if (belowWarmupLimit) {
      return {
        text: args.text,
        hadEmoji,
        cooldownActive,
        emojiSuppressed: false,
        shouldRecordEmojiSend: true,
        activeSinceMs: undefined,
      };
    }
  }

  const fallback = (args.fallbackText || "All good.").trim() || "All good.";
  const stripped = stripEmojiCharacters(args.text);

  return {
    text: stripped || fallback,
    hadEmoji,
    cooldownActive,
    emojiSuppressed: true,
    shouldRecordEmojiSend: false,
    activeSinceMs: latestEmojiAt,
  };
}
