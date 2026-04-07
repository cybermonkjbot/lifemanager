export const EMOJI_COOLDOWN_MS = 15 * 60 * 1000;

const EMOJI_DETECTION_REGEX = /[\p{Extended_Pictographic}\p{Regional_Indicator}]/u;
const EMOJI_STRIP_REGEX = /[\p{Extended_Pictographic}\p{Regional_Indicator}\uFE0F\u200D]/gu;

type ThreadMessageLike = {
  direction?: "inbound" | "outbound" | string;
  text?: string;
  messageAt?: number;
};

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

export function applyEmojiCooldownPolicy(args: {
  text: string;
  nowMs?: number;
  cooldownMs?: number;
  fallbackText?: string;
  recentMessages?: ThreadMessageLike[] | null;
  lastEmojiSentAtMs?: number | null;
}) {
  const nowMs = Number.isFinite(args.nowMs) ? Number(args.nowMs) : Date.now();
  const cooldownMs = Math.max(1_000, args.cooldownMs ?? EMOJI_COOLDOWN_MS);
  const historyEmojiAt = findRecentOutboundEmojiTimestamp({
    messages: args.recentMessages,
    nowMs,
    cooldownMs,
  });
  const liveEmojiAt = Number.isFinite(args.lastEmojiSentAtMs) ? Number(args.lastEmojiSentAtMs) : null;
  const latestEmojiAt = Math.max(historyEmojiAt ?? -1, liveEmojiAt ?? -1);
  const cooldownActive = latestEmojiAt >= 0 && nowMs - latestEmojiAt < cooldownMs;
  const hadEmoji = containsAnyEmoji(args.text);

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

  if (!cooldownActive) {
    return {
      text: args.text,
      hadEmoji,
      cooldownActive,
      emojiSuppressed: false,
      shouldRecordEmojiSend: true,
      activeSinceMs: undefined,
    };
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
