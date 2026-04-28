import type { MutationCtx } from "../_generated/server";

export type RateLimitDecision = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterMs: number;
};

type ConsumeRateLimitArgs = {
  key: string;
  scope: string;
  limit: number;
  windowMs: number;
  penaltyMs?: number;
  now?: number;
};

const MIN_WINDOW_MS = 1000;
const MAX_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

function clampInteger(value: number, fallback: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(Math.max(Math.round(value), min), max);
}

export async function consumeRateLimit(ctx: MutationCtx, args: ConsumeRateLimitArgs): Promise<RateLimitDecision> {
  const now = clampInteger(args.now ?? Date.now(), Date.now(), 0, Number.MAX_SAFE_INTEGER);
  const limit = clampInteger(args.limit, 1, 1, 1_000_000);
  const windowMs = clampInteger(args.windowMs, 60_000, MIN_WINDOW_MS, MAX_WINDOW_MS);
  const penaltyMs = clampInteger(args.penaltyMs ?? 0, 0, 0, MAX_WINDOW_MS);
  const normalizedKey = args.key.trim().slice(0, 240);
  const scope = args.scope.trim().slice(0, 80) || "default";

  if (!normalizedKey) {
    throw new Error("Rate limit key is required.");
  }

  const existing = await ctx.db
    .query("apiRateLimits")
    .withIndex("by_key", (q) => q.eq("key", normalizedKey))
    .take(1);
  const row = existing[0];
  const blockedUntil = row?.blockedUntil ?? 0;
  if (row && blockedUntil > now) {
    return {
      allowed: false,
      limit,
      remaining: 0,
      resetAt: blockedUntil,
      retryAfterMs: blockedUntil - now,
    };
  }

  const shouldReset = !row || row.windowStart + row.windowMs <= now || row.limit !== limit || row.windowMs !== windowMs;
  const windowStart = shouldReset ? now : row.windowStart;
  const resetAt = windowStart + windowMs;
  const nextCount = shouldReset ? 1 : row.count + 1;
  const expiresAt = Math.min(resetAt + Math.max(windowMs, penaltyMs), now + MAX_EXPIRY_MS);

  if (nextCount > limit) {
    const retryAfterMs = Math.max(1000, penaltyMs || resetAt - now);
    const nextBlockedUntil = penaltyMs ? now + penaltyMs : resetAt;
    if (row) {
      await ctx.db.patch(row._id, {
        count: nextCount,
        blockedUntil: nextBlockedUntil,
        expiresAt: Math.max(expiresAt, nextBlockedUntil),
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("apiRateLimits", {
        key: normalizedKey,
        scope,
        windowStart,
        windowMs,
        limit,
        count: nextCount,
        blockedUntil: nextBlockedUntil,
        expiresAt: Math.max(expiresAt, nextBlockedUntil),
        updatedAt: now,
      });
    }
    return {
      allowed: false,
      limit,
      remaining: 0,
      resetAt: nextBlockedUntil,
      retryAfterMs,
    };
  }

  if (row) {
    await ctx.db.patch(row._id, {
      scope,
      windowStart,
      windowMs,
      limit,
      count: nextCount,
      blockedUntil: 0,
      expiresAt,
      updatedAt: now,
    });
  } else {
    await ctx.db.insert("apiRateLimits", {
      key: normalizedKey,
      scope,
      windowStart,
      windowMs,
      limit,
      count: nextCount,
      expiresAt,
      updatedAt: now,
    });
  }

  return {
    allowed: true,
    limit,
    remaining: Math.max(0, limit - nextCount),
    resetAt,
    retryAfterMs: 0,
  };
}
