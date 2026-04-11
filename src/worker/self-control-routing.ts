export function shouldAttemptSelfControlOnUpsert(args: {
  ingestMode: "history_sync" | "history_fetch" | null;
  upsertType: string;
  fromMe?: boolean;
  messageAt: number;
  nowMs?: number;
  maxAgeMs?: number;
}) {
  if (!args.ingestMode) {
    return true;
  }

  if (args.upsertType !== "append") {
    return false;
  }

  const nowMs = Number.isFinite(args.nowMs) ? Number(args.nowMs) : Date.now();
  const maxAgeMs = Number.isFinite(args.maxAgeMs) ? Math.max(1, Number(args.maxAgeMs)) : 5 * 60 * 1000;
  if (!Number.isFinite(args.messageAt)) {
    return false;
  }

  const ageMs = Math.max(0, nowMs - args.messageAt);
  return ageMs <= maxAgeMs;
}
