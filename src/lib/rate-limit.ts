import { createHash } from "node:crypto";
import { convexRefs } from "./convex-refs";
import { createConvexClient, getConvexUrl } from "./convex-server";

export type RateLimitDecision = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterMs: number;
};

export type RateLimitOptions = {
  scope: string;
  identity?: string;
  limit: number;
  windowMs: number;
  penaltyMs?: number;
};

const localCounters = new Map<string, {
  windowStart: number;
  windowMs: number;
  limit: number;
  count: number;
  blockedUntil: number;
}>();

function hashPart(value: string) {
  return createHash("sha256").update(value).digest("base64url");
}

function normalizeIdentity(value: string | undefined) {
  return (value || "anonymous").trim().toLowerCase().slice(0, 240);
}

function getRateLimitServerSecret() {
  return (
    process.env.SLM_RATE_LIMIT_SECRET ||
    process.env.ODOGWU_CONVEX_ADMIN_SECRET ||
    process.env.ODOGWU_ADMIN_SECRET ||
    process.env.SLM_ADMIN_SECRET ||
    ""
  );
}

export function getClientIp(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",", 1)[0].trim() || "unknown";
  }
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

export function buildRateLimitKey(request: Request, options: Pick<RateLimitOptions, "scope" | "identity">) {
  const identity = normalizeIdentity(options.identity);
  const ip = getClientIp(request);
  return `${options.scope}:${hashPart(`${identity}|${ip}`)}`;
}

function localConsume(key: string, options: RateLimitOptions): RateLimitDecision {
  const now = Date.now();
  const existing = localCounters.get(key);
  if (existing?.blockedUntil && existing.blockedUntil > now) {
    return {
      allowed: false,
      limit: options.limit,
      remaining: 0,
      resetAt: existing.blockedUntil,
      retryAfterMs: existing.blockedUntil - now,
    };
  }

  const shouldReset =
    !existing ||
    existing.windowStart + existing.windowMs <= now ||
    existing.limit !== options.limit ||
    existing.windowMs !== options.windowMs;
  const windowStart = shouldReset ? now : existing.windowStart;
  const count = shouldReset ? 1 : existing.count + 1;
  const resetAt = windowStart + options.windowMs;
  const blockedUntil = count > options.limit ? (options.penaltyMs ? now + options.penaltyMs : resetAt) : 0;
  localCounters.set(key, {
    windowStart,
    windowMs: options.windowMs,
    limit: options.limit,
    count,
    blockedUntil,
  });

  if (count > options.limit) {
    return {
      allowed: false,
      limit: options.limit,
      remaining: 0,
      resetAt: blockedUntil || resetAt,
      retryAfterMs: Math.max(1000, (blockedUntil || resetAt) - now),
    };
  }

  return {
    allowed: true,
    limit: options.limit,
    remaining: Math.max(0, options.limit - count),
    resetAt,
    retryAfterMs: 0,
  };
}

export async function consumeRequestRateLimit(request: Request, options: RateLimitOptions): Promise<RateLimitDecision> {
  const key = buildRateLimitKey(request, options);
  const serverSecret = getRateLimitServerSecret();
  if (getConvexUrl() && serverSecret) {
    try {
      return (await createConvexClient().mutation(convexRefs.rateLimitsCheck, {
        serverSecret,
        key,
        scope: options.scope,
        limit: options.limit,
        windowMs: options.windowMs,
        ...(options.penaltyMs ? { penaltyMs: options.penaltyMs } : {}),
      })) as RateLimitDecision;
    } catch {
      // Setup can run before Convex is reachable; fall back to process-local protection.
    }
  }
  return localConsume(key, options);
}

export function rateLimitHeaders(decision: RateLimitDecision) {
  const retryAfterSeconds = Math.max(1, Math.ceil(decision.retryAfterMs / 1000));
  return {
    "X-RateLimit-Limit": String(decision.limit),
    "X-RateLimit-Remaining": String(decision.remaining),
    "X-RateLimit-Reset": String(Math.ceil(decision.resetAt / 1000)),
    ...(decision.allowed ? {} : { "Retry-After": String(retryAfterSeconds) }),
  };
}

export async function rateLimitJsonResponse(
  request: Request,
  options: RateLimitOptions & { message?: string },
) {
  const decision = await consumeRequestRateLimit(request, options);
  if (decision.allowed) {
    return null;
  }
  return Response.json(
    { error: options.message || "Too many requests. Try again shortly." },
    { status: 429, headers: rateLimitHeaders(decision) },
  );
}
