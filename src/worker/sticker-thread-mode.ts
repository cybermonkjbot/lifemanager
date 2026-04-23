type ThreadMessage = {
  messageType?: string;
  text?: string;
};

export type RollingStickerThreadSignal = {
  enabled: boolean;
  totalMessages: number;
  stickerCount: number;
  reactionCount: number;
  stickerRatio: number;
  stickerReactionRatio: number;
};

const DEFAULT_WINDOW_SIZE = 12;
const MIN_MESSAGES = 6;
const MIN_STICKER_COUNT = 3;
const MIN_STICKER_RATIO = 0.38;
const MIN_STICKER_REACTION_RATIO = 0.62;

function normalizeMessageType(message: ThreadMessage): "sticker" | "reaction" | "other" {
  const type = (message.messageType || "").trim().toLowerCase();
  if (type === "sticker") {
    return "sticker";
  }
  if (type === "reaction") {
    return "reaction";
  }

  const text = (message.text || "").trim().toLowerCase();
  if (text === "[sticker]") {
    return "sticker";
  }
  if (text === "[reaction]") {
    return "reaction";
  }
  return "other";
}

export function evaluateRollingStickerThreadMode(args: {
  threadMessages: ThreadMessage[];
  windowSize?: number;
}): RollingStickerThreadSignal {
  const windowSize = Math.max(4, Math.min(args.windowSize ?? DEFAULT_WINDOW_SIZE, 40));
  const window = (args.threadMessages || []).slice(-windowSize);
  if (window.length < MIN_MESSAGES) {
    return {
      enabled: false,
      totalMessages: window.length,
      stickerCount: 0,
      reactionCount: 0,
      stickerRatio: 0,
      stickerReactionRatio: 0,
    };
  }

  let stickerCount = 0;
  let reactionCount = 0;
  for (const message of window) {
    const normalized = normalizeMessageType(message);
    if (normalized === "sticker") {
      stickerCount += 1;
      continue;
    }
    if (normalized === "reaction") {
      reactionCount += 1;
    }
  }

  const totalMessages = window.length;
  const stickerRatio = stickerCount / Math.max(totalMessages, 1);
  const stickerReactionRatio = (stickerCount + reactionCount) / Math.max(totalMessages, 1);
  const enabled =
    stickerCount >= MIN_STICKER_COUNT &&
    stickerRatio >= MIN_STICKER_RATIO &&
    stickerReactionRatio >= MIN_STICKER_REACTION_RATIO;

  return {
    enabled,
    totalMessages,
    stickerCount,
    reactionCount,
    stickerRatio,
    stickerReactionRatio,
  };
}

const ACK_ONLY_PATTERN = /\b(ok|okay|sure|cool|great|thanks|thank you|thx|noted|done|alright|safe|bet)\b/i;
const REQUEST_CUE_PATTERN =
  /\?|(?:\b(can|could|will|would|should|when|where|what|why|how|who)\b)|(?:\b(please|pls|abeg|help|need|send|share|confirm|check|update|reply|call)\b)/i;
const PASSIVE_AGGRESSIVE_TONE_PATTERN =
  /\b(no worry|no wahala)\b.*\b(enjoy|carry on|continue)\b|\bfine then\b|\bokay then\b|\bdo your thing\b/i;

export function needsTextReplyInStickerMode(args: {
  inboundText: string;
  inboundKind: "text" | "reaction" | "sticker" | "meme" | "image" | "video" | "audio" | "document" | "unsupported";
}) {
  const text = (args.inboundText || "").trim();
  if (!text) {
    return false;
  }

  if (/^\[(sticker|reaction)\]$/i.test(text)) {
    return false;
  }

  if (ACK_ONLY_PATTERN.test(text) && !REQUEST_CUE_PATTERN.test(text)) {
    return false;
  }

  if (REQUEST_CUE_PATTERN.test(text)) {
    return true;
  }

  if (PASSIVE_AGGRESSIVE_TONE_PATTERN.test(text)) {
    return true;
  }

  const wordCount = text.split(/\s+/).filter(Boolean).length;
  if (args.inboundKind === "sticker" || args.inboundKind === "reaction") {
    return wordCount >= 9 || text.length >= 55;
  }
  if (args.inboundKind !== "text") {
    return wordCount >= 6 || text.length >= 35;
  }
  return wordCount >= 10 || text.length >= 70;
}
