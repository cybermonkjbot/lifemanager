export const MAX_UNANSWERED_OUTBOUND_STREAK = 2;
export const MIN_LONG_SILENCE_REOPEN_WEEKS = 2;
export const MAX_LONG_SILENCE_REOPEN_WEEKS = 7;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export type GhostingSeverity = "mild" | "moderate" | "severe";

type DirectionSnapshot = {
  direction: "inbound" | "outbound";
};

type DirectionWithTimestampSnapshot = DirectionSnapshot & {
  messageAt?: number;
};

export function countUnansweredOutboundStreak(messages: DirectionSnapshot[]) {
  let streak = 0;
  for (const message of messages) {
    if (message.direction !== "outbound") {
      break;
    }
    streak += 1;
  }
  return streak;
}

export function latestInboundMessageAt(messages: DirectionWithTimestampSnapshot[]) {
  for (const message of messages) {
    if (message.direction === "inbound" && Number.isFinite(message.messageAt) && (message.messageAt || 0) > 0) {
      return Number(message.messageAt);
    }
  }
  return undefined;
}

export function resolveLongSilenceReopenWeeks(unansweredStreak: number) {
  const base = unansweredStreak - MAX_UNANSWERED_OUTBOUND_STREAK + 1;
  if (!Number.isFinite(base)) {
    return MIN_LONG_SILENCE_REOPEN_WEEKS;
  }
  const rounded = Math.round(base);
  return Math.max(MIN_LONG_SILENCE_REOPEN_WEEKS, Math.min(MAX_LONG_SILENCE_REOPEN_WEEKS, rounded));
}

export function resolveLongSilenceReopenMs(unansweredStreak: number) {
  return resolveLongSilenceReopenWeeks(unansweredStreak) * WEEK_MS;
}

export function resolveGhostingSeverity(args: {
  unansweredStreak: number;
  elapsedSilenceMs: number;
}): GhostingSeverity {
  const unansweredPressure = Math.max(0, args.unansweredStreak - MAX_UNANSWERED_OUTBOUND_STREAK);
  const silenceWeeks = Math.max(0, args.elapsedSilenceMs) / WEEK_MS;

  if (unansweredPressure >= 3 || silenceWeeks >= 12) {
    return "severe";
  }
  if (unansweredPressure >= 1 || silenceWeeks >= 5) {
    return "moderate";
  }
  return "mild";
}

export function shouldAllowLongSilenceConversationStarter(args: {
  unansweredStreak: number;
  latestInboundAt?: number;
  nowMs: number;
  isConversationStarter: boolean;
}) {
  if (!args.isConversationStarter) {
    return false;
  }
  if (args.unansweredStreak < MAX_UNANSWERED_OUTBOUND_STREAK) {
    return false;
  }
  if (!Number.isFinite(args.latestInboundAt) || (args.latestInboundAt || 0) <= 0) {
    return false;
  }
  return args.nowMs - Number(args.latestInboundAt) >= resolveLongSilenceReopenMs(args.unansweredStreak);
}
