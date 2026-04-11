export type RomanceMorningMode = "lead" | "warm";

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

  const baseMode: RomanceMorningMode = (stableHash(args.seed) % 1000) / 1000 < leadRatio ? "lead" : "warm";
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
