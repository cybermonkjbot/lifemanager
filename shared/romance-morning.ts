export type RomanceMorningMode = "lead" | "warm";
export const ROMANCE_BASE_VARIANT_COUNT = 3;
export const ROMANCE_BOUNDARY_REOPEN_VARIANT_COUNT = 23;

export function stableHash(input: string) {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) >>> 0;
  }
  return hash;
}

export function isWithinHourWindow(hour: number, startHour: number, endHour: number) {
  if (startHour === endHour) {
    return false;
  }
  if (startHour < endHour) {
    return hour >= startHour && hour < endHour;
  }
  return hour >= startHour || hour < endHour;
}

export function normalizeLeadRatio(value: number | undefined, fallback = 0.7) {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.min(value as number, 1));
}

export function resolvePlanSuggestionCooldownMs(args: {
  threadId: string;
  minDays?: number;
  maxDays?: number;
}) {
  const minDays = Math.max(1, Math.round(args.minDays ?? 1));
  const maxDays = Math.max(minDays, Math.round(args.maxDays ?? 2));
  const spanDays = maxDays - minDays + 1;
  const selectedDays = minDays + (stableHash(`${args.threadId}|plan-cooldown-days`) % spanDays);
  return selectedDays * 24 * 60 * 60 * 1000;
}

export function resolveIgnoredMorningPauseMs(days = 3) {
  return Math.max(1, Math.round(days)) * 24 * 60 * 60 * 1000;
}

export function hasInboundAfterLastMorningSend(args: {
  lastSentAt?: number;
  lastInboundAfterSendAt?: number;
}) {
  const lastSentAt = Number.isFinite(args.lastSentAt) ? Number(args.lastSentAt) : 0;
  const inboundAfterSend = Number.isFinite(args.lastInboundAfterSendAt) ? Number(args.lastInboundAfterSendAt) : 0;
  return lastSentAt > 0 && inboundAfterSend > lastSentAt;
}

export function isIgnoredMorningPauseActive(args: {
  now: number;
  lastSentAt?: number;
  lastInboundAfterSendAt?: number;
  noReplyStreak?: number;
  pauseDays?: number;
}) {
  const noReplyStreak = Math.max(0, Math.round(args.noReplyStreak ?? 0));
  const lastSentAt = Number.isFinite(args.lastSentAt) ? Number(args.lastSentAt) : 0;
  if (noReplyStreak < 1 || lastSentAt <= 0) {
    return false;
  }
  if (
    hasInboundAfterLastMorningSend({
      lastSentAt,
      lastInboundAfterSendAt: args.lastInboundAfterSendAt,
    })
  ) {
    return false;
  }
  return args.now - lastSentAt < resolveIgnoredMorningPauseMs(args.pauseDays ?? 3);
}

export function shouldSendIgnoredMorningBoundaryReopen(args: {
  now: number;
  lastSentAt?: number;
  lastInboundAfterSendAt?: number;
  noReplyStreak?: number;
  pauseDays?: number;
}) {
  const noReplyStreak = Math.max(0, Math.round(args.noReplyStreak ?? 0));
  const lastSentAt = Number.isFinite(args.lastSentAt) ? Number(args.lastSentAt) : 0;
  if (noReplyStreak < 1 || lastSentAt <= 0) {
    return false;
  }
  if (
    hasInboundAfterLastMorningSend({
      lastSentAt,
      lastInboundAfterSendAt: args.lastInboundAfterSendAt,
    })
  ) {
    return false;
  }
  return args.now - lastSentAt >= resolveIgnoredMorningPauseMs(args.pauseDays ?? 3);
}

export function isSuccessfulLeadPlanCooldownActive(args: {
  threadId: string;
  now: number;
  lastMode?: RomanceMorningMode;
  lastSentAt?: number;
  lastInboundAfterSendAt?: number;
  minDays?: number;
  maxDays?: number;
}) {
  if (args.lastMode !== "lead") {
    return false;
  }
  if (!Number.isFinite(args.lastSentAt) || (args.lastSentAt || 0) <= 0) {
    return false;
  }
  if (!Number.isFinite(args.lastInboundAfterSendAt) || (args.lastInboundAfterSendAt || 0) <= (args.lastSentAt || 0)) {
    return false;
  }
  const cooldownMs = resolvePlanSuggestionCooldownMs({
    threadId: args.threadId,
    minDays: args.minDays,
    maxDays: args.maxDays,
  });
  return args.now - (args.lastSentAt || 0) < cooldownMs;
}

export function selectAdaptiveRomanceMorningMode(args: {
  threadId: string;
  seed: string;
  leadRatio: number;
  now: number;
  lastMode?: RomanceMorningMode;
  noReplyStreak?: number;
  lastSentAt?: number;
  lastInboundAfterSendAt?: number;
}) {
  if (
    isIgnoredMorningPauseActive({
      now: args.now,
      lastSentAt: args.lastSentAt,
      lastInboundAfterSendAt: args.lastInboundAfterSendAt,
      noReplyStreak: args.noReplyStreak,
    })
  ) {
    return "warm" as const;
  }
  if (
    shouldSendIgnoredMorningBoundaryReopen({
      now: args.now,
      lastSentAt: args.lastSentAt,
      lastInboundAfterSendAt: args.lastInboundAfterSendAt,
      noReplyStreak: args.noReplyStreak,
    })
  ) {
    return "warm" as const;
  }
  if (
    isSuccessfulLeadPlanCooldownActive({
      threadId: args.threadId,
      now: args.now,
      lastMode: args.lastMode,
      lastSentAt: args.lastSentAt,
      lastInboundAfterSendAt: args.lastInboundAfterSendAt,
    })
  ) {
    return "warm" as const;
  }
  return selectRomanceMorningMode({
    seed: args.seed,
    leadRatio: args.leadRatio,
    lastMode: args.lastMode,
    noReplyStreak: args.noReplyStreak,
  });
}

export function selectRomanceMorningMode(args: {
  seed: string;
  leadRatio: number;
  lastMode?: RomanceMorningMode;
  noReplyStreak?: number;
}): RomanceMorningMode {
  const leadRatio = normalizeLeadRatio(args.leadRatio, 0.7);
  const noReplyStreak = Math.max(0, Math.round(args.noReplyStreak ?? 0));
  if (noReplyStreak >= 2) {
    return "warm";
  }

  const hash = stableHash(args.seed);
  const mixedHash = (hash ^ (hash >>> 16)) >>> 0;
  const baseMode: RomanceMorningMode = (mixedHash % 1000) / 1000 < leadRatio ? "lead" : "warm";
  if (!args.lastMode || args.lastMode !== baseMode) {
    return baseMode;
  }
  return baseMode === "lead" ? "warm" : "lead";
}

export function buildRomancePromptFingerprint(args: {
  threadId: string;
  mode: RomanceMorningMode;
  variant: number;
  dayBucket: string;
}) {
  const input = `${args.threadId}|${args.mode}|${args.variant}|${args.dayBucket}`;
  return `rm_${stableHash(input).toString(16)}`;
}
