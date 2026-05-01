import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx } from "./_generated/server";
import { assertTenantBillingActive } from "./lib/billingAccess";
import { assertTenantOwned, resolveTenantForMutation, resolveTenantForQuery } from "./lib/tenantSecurity";

const SOCIAL_ACTION_LEASE_MS = 2 * 60 * 1000;
const SOCIAL_ACTION_MAX_LEASE_MS = 35 * 60 * 1000;
const SOCIAL_ACTION_MAX_ATTEMPTS = 3;
const SOCIAL_ACTION_GLOBAL_DAILY_MAX = 18;
const SOCIAL_ACTION_KIND_DAILY_MAX = {
  like_media: 10,
  comment_media: 4,
  follow_user: 3,
} as const;
const AUTO_ACTION_MIN_DELAY_MS = 2 * 60 * 1000;
const AUTO_ACTION_MAX_DELAY_MS = 18 * 60 * 1000;
const COMMENT_REVIEW_PATTERN =
  /(https?:\/\/|www\.|@\w|#\w|\b(?:follow me|dm me|giveaway|promo|discount|free|buy|crypto|forex|investment|subscribe|check my)\b)/i;

const actionKindValidator = v.union(v.literal("like_media"), v.literal("comment_media"), v.literal("follow_user"));
const actionStatusValidator = v.union(
  v.literal("pending_review"),
  v.literal("approved"),
  v.literal("claimed"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("rejected"),
);

type ActionKind = "like_media" | "comment_media" | "follow_user";
type SafetyLevel = "limited_auto" | "review_required";

function normalizeOptionalText(value: string | undefined, maxLength: number) {
  const trimmed = (value || "").trim();
  return trimmed ? trimmed.slice(0, maxLength) : undefined;
}

function normalizeCommentText(value: string | undefined) {
  const text = normalizeOptionalText(value, 220);
  if (!text) {
    return undefined;
  }
  const withoutLinks = text.replace(/https?:\/\/\S+/gi, "").trim();
  return withoutLinks.slice(0, 220);
}

function requireActionTargets(args: {
  actionKind: ActionKind;
  targetMediaId?: string;
  targetUserId?: string;
  commentText?: string;
}) {
  if ((args.actionKind === "like_media" || args.actionKind === "comment_media") && !args.targetMediaId) {
    throw new Error("Instagram media id is required for this action.");
  }
  if (args.actionKind === "follow_user" && !args.targetUserId) {
    throw new Error("Instagram user id is required for follow actions.");
  }
  if (args.actionKind === "comment_media" && !args.commentText) {
    throw new Error("Comment text is required for Instagram comment actions.");
  }
}

function buildIdempotencyKey(args: {
  tenantId?: Id<"tenantAccounts">;
  actionKind: ActionKind;
  targetMediaId?: string;
  targetUserId?: string;
  commentText?: string;
}) {
  return [
    args.tenantId || "local",
    args.actionKind,
    args.targetMediaId || "",
    args.targetUserId || "",
    (args.commentText || "").toLowerCase(),
  ].join(":");
}

function stableDelayMs(seed: string, minMs: number, maxMs: number) {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }
  return minMs + (hash % Math.max(1, maxMs - minMs));
}

function commentNeedsReview(commentText: string | undefined, confidence: number) {
  if (!commentText) {
    return true;
  }
  if (confidence < 0.78) {
    return true;
  }
  if (commentText.length > 140) {
    return true;
  }
  return COMMENT_REVIEW_PATTERN.test(commentText);
}

function resolveInitialActionState(args: {
  actionKind: ActionKind;
  confidence: number;
  requestedSafetyLevel?: SafetyLevel;
  commentText?: string;
  idempotencyKey: string;
  now: number;
}) {
  const forceReview = args.requestedSafetyLevel === "review_required";
  const needsReview =
    forceReview ||
    (args.actionKind === "like_media" && args.confidence < 0.45) ||
    (args.actionKind === "comment_media" && commentNeedsReview(args.commentText, args.confidence)) ||
    (args.actionKind === "follow_user" && !(args.requestedSafetyLevel === "limited_auto" && args.confidence >= 0.9));

  if (needsReview) {
    return {
      safetyLevel: "review_required" as const,
      status: "pending_review" as const,
      sendAt: args.now,
    };
  }

  return {
    safetyLevel: "limited_auto" as const,
    status: "approved" as const,
    sendAt: args.now + stableDelayMs(args.idempotencyKey, AUTO_ACTION_MIN_DELAY_MS, AUTO_ACTION_MAX_DELAY_MS),
  };
}

async function hasEnabledInstagramIgnoreRule(
  ctx: MutationCtx,
  args: {
    tenantId?: Id<"tenantAccounts">;
    targetUserId?: string;
    targetUsername?: string;
  },
) {
  const candidates = new Set<string>();
  const userId = args.targetUserId?.trim();
  const username = args.targetUsername?.trim().toLowerCase();
  if (userId) {
    candidates.add(userId);
    candidates.add(`ig:user:${userId}`);
    candidates.add(`instagram:user:${userId}`);
  }
  if (username) {
    candidates.add(username);
    candidates.add(`ig:username:${username}`);
    candidates.add(`instagram:username:${username}`);
  }

  for (const targetValue of candidates) {
    const rule = args.tenantId
      ? await ctx.db
          .query("ignoreRules")
          .withIndex("by_tenantId_and_target", (q) =>
            q.eq("tenantId", args.tenantId).eq("targetType", "contact").eq("targetValue", targetValue),
          )
          .first()
      : await ctx.db
          .query("ignoreRules")
          .withIndex("by_target", (q) => q.eq("targetType", "contact").eq("targetValue", targetValue))
          .first();
    if (rule?.enabled) {
      return true;
    }
  }
  return false;
}

async function recordSocialActionEvent(
  ctx: MutationCtx,
  args: {
    tenantId?: Id<"tenantAccounts">;
    eventType: string;
    detail: string;
  },
) {
  await ctx.db.insert("systemEvents", {
    tenantId: args.tenantId,
    source: "convex",
    eventType: args.eventType,
    detail: args.detail.slice(0, 500),
    createdAt: Date.now(),
  });
}

async function countCompletedActions(
  ctx: MutationCtx,
  args: {
    tenantId?: Id<"tenantAccounts">;
    actionKind?: ActionKind;
    since: number;
    limit: number;
  },
) {
  const limit = Math.max(1, Math.min(Math.round(args.limit), 100));
  if (args.tenantId && args.actionKind) {
    return (
      await ctx.db
        .query("instagramSocialActions")
        .withIndex("by_tenantId_and_status_and_actionKind_and_completedAt", (q) =>
          q.eq("tenantId", args.tenantId!).eq("status", "completed").eq("actionKind", args.actionKind!).gte("completedAt", args.since),
        )
        .take(limit)
    ).length;
  }
  if (args.tenantId) {
    return (
      await ctx.db
        .query("instagramSocialActions")
        .withIndex("by_tenantId_and_status_and_completedAt", (q) =>
          q.eq("tenantId", args.tenantId!).eq("status", "completed").gte("completedAt", args.since),
        )
        .take(limit)
    ).length;
  }
  if (args.actionKind) {
    return (
      await ctx.db
        .query("instagramSocialActions")
        .withIndex("by_status_and_actionKind_and_completedAt", (q) =>
          q.eq("status", "completed").eq("actionKind", args.actionKind!).gte("completedAt", args.since),
        )
        .take(limit)
    ).length;
  }
  return (
    await ctx.db
      .query("instagramSocialActions")
      .withIndex("by_status_and_completedAt", (q) => q.eq("status", "completed").gte("completedAt", args.since))
      .take(limit)
  ).length;
}

export const list = query({
  args: {
    tenantId: v.optional(v.id("tenantAccounts")),
    connectorTokenHash: v.optional(v.string()),
    status: v.optional(actionStatusValidator),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const tenantId = await resolveTenantForQuery(ctx, { ...args, provider: "instagram" });
    const status = args.status || "pending_review";
    const limit = Math.min(Math.max(Math.round(args.limit ?? 30), 1), 100);
    if (tenantId) {
      return await ctx.db
        .query("instagramSocialActions")
        .withIndex("by_tenantId_and_status_and_createdAt", (q) => q.eq("tenantId", tenantId).eq("status", status))
        .order("desc")
        .take(limit);
    }
    return await ctx.db
      .query("instagramSocialActions")
      .withIndex("by_status_and_createdAt", (q) => q.eq("status", status))
      .order("desc")
      .take(limit);
  },
});

export const propose = mutation({
  args: {
    tenantId: v.optional(v.id("tenantAccounts")),
    connectorTokenHash: v.optional(v.string()),
    actionKind: actionKindValidator,
    targetMediaId: v.optional(v.string()),
    targetUserId: v.optional(v.string()),
    targetUsername: v.optional(v.string()),
    targetUrl: v.optional(v.string()),
    commentText: v.optional(v.string()),
    reason: v.string(),
    provider: v.optional(v.union(v.literal("codex"), v.literal("heuristic"))),
    confidence: v.optional(v.number()),
    safetyLevel: v.optional(v.union(v.literal("limited_auto"), v.literal("review_required"))),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const tenantId = await resolveTenantForMutation(ctx, { ...args, provider: "instagram" });
    await assertTenantBillingActive(ctx, tenantId, now);
    const actionKind = args.actionKind;
    const targetMediaId = normalizeOptionalText(args.targetMediaId, 120);
    const targetUserId = normalizeOptionalText(args.targetUserId, 80);
    const targetUsername = normalizeOptionalText(args.targetUsername, 80);
    const targetUrl = normalizeOptionalText(args.targetUrl, 400);
    const commentText = normalizeCommentText(args.commentText);
    const reason = normalizeOptionalText(args.reason, 600) || "Suggested Instagram social action.";
    requireActionTargets({ actionKind, targetMediaId, targetUserId, commentText });

    const idempotencyKey = buildIdempotencyKey({
      tenantId,
      actionKind,
      targetMediaId,
      targetUserId,
      commentText,
    });
    const existing = await ctx.db
      .query("instagramSocialActions")
      .withIndex("by_idempotencyKey", (q) => q.eq("idempotencyKey", idempotencyKey))
      .unique();
    if (existing && existing.status !== "failed") {
      return existing._id;
    }

    if (await hasEnabledInstagramIgnoreRule(ctx, { tenantId, targetUserId, targetUsername })) {
      const rejectedId = await ctx.db.insert("instagramSocialActions", {
        tenantId,
        actionKind,
        targetMediaId,
        targetUserId,
        targetUsername,
        targetUrl,
        commentText,
        reason,
        provider: args.provider || "codex",
        confidence: Math.max(0, Math.min(1, args.confidence ?? 0.72)),
        safetyLevel: "review_required",
        status: "rejected",
        sendAt: now,
        attempts: 0,
        idempotencyKey,
        error: "Target is ignored.",
        createdAt: now,
        updatedAt: now,
      });
      await recordSocialActionEvent(ctx, {
        tenantId,
        eventType: "instagram.social.ignored_target",
        detail: `${actionKind}: ignored target ${targetUsername || targetUserId || targetMediaId || "unknown"}`,
      });
      return rejectedId;
    }

    const confidence = Math.max(0, Math.min(1, args.confidence ?? 0.72));
    const initialState = resolveInitialActionState({
      actionKind,
      confidence,
      requestedSafetyLevel: args.safetyLevel,
      commentText,
      idempotencyKey,
      now,
    });
    const actionId = await ctx.db.insert("instagramSocialActions", {
      tenantId,
      actionKind,
      targetMediaId,
      targetUserId,
      targetUsername,
      targetUrl,
      commentText,
      reason,
      provider: args.provider || "codex",
      confidence,
      safetyLevel: initialState.safetyLevel,
      status: initialState.status,
      sendAt: initialState.sendAt,
      attempts: 0,
      idempotencyKey,
      createdAt: now,
      updatedAt: now,
    });
    await recordSocialActionEvent(ctx, {
      tenantId,
      eventType: "instagram.social.proposed",
      detail: `${actionKind}: ${reason}`,
    });
    if (initialState.status === "approved") {
      await recordSocialActionEvent(ctx, {
        tenantId,
        eventType: "instagram.social.auto_approved",
        detail: `${actionKind}: queued for ${new Date(initialState.sendAt).toISOString()}`,
      });
    }
    return actionId;
  },
});

export const approve = mutation({
  args: {
    tenantId: v.optional(v.id("tenantAccounts")),
    connectorTokenHash: v.optional(v.string()),
    actionId: v.id("instagramSocialActions"),
    delayMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const tenantId = await resolveTenantForMutation(ctx, { ...args, provider: "instagram" });
    await assertTenantBillingActive(ctx, tenantId, now);
    const action = await ctx.db.get(args.actionId);
    if (!action) {
      throw new Error("Instagram social action not found.");
    }
    assertTenantOwned(tenantId, action.tenantId);
    if (action.status !== "pending_review" && action.status !== "failed") {
      throw new Error(`Instagram social action cannot be approved from ${action.status}.`);
    }
    const delayMs = Math.max(30_000, Math.min(args.delayMs ?? 10 * 60_000, 24 * 60 * 60 * 1000));
    await ctx.db.patch(action._id, {
      status: "approved",
      sendAt: now + delayMs,
      workerId: undefined,
      leaseExpiresAt: undefined,
      error: undefined,
      updatedAt: now,
    });
    await recordSocialActionEvent(ctx, {
      tenantId,
      eventType: "instagram.social.approved",
      detail: `${action.actionKind}: ${action._id}`,
    });
    return action._id;
  },
});

export const reject = mutation({
  args: {
    tenantId: v.optional(v.id("tenantAccounts")),
    connectorTokenHash: v.optional(v.string()),
    actionId: v.id("instagramSocialActions"),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const tenantId = await resolveTenantForMutation(ctx, { ...args, provider: "instagram" });
    const action = await ctx.db.get(args.actionId);
    if (!action) {
      throw new Error("Instagram social action not found.");
    }
    assertTenantOwned(tenantId, action.tenantId);
    await ctx.db.patch(action._id, {
      status: "rejected",
      error: normalizeOptionalText(args.reason, 300),
      workerId: undefined,
      leaseExpiresAt: undefined,
      updatedAt: now,
    });
    await recordSocialActionEvent(ctx, {
      tenantId,
      eventType: "instagram.social.rejected",
      detail: `${action.actionKind}: ${action._id}`,
    });
    return action._id;
  },
});

export const claimDue = mutation({
  args: {
    tenantId: v.optional(v.id("tenantAccounts")),
    connectorTokenHash: v.optional(v.string()),
    workerId: v.string(),
    limit: v.optional(v.number()),
    leaseMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const tenantId = await resolveTenantForMutation(ctx, { ...args, provider: "instagram" });
    const limit = Math.min(Math.max(Math.round(args.limit ?? 1), 1), 3);
    const leaseMs = Math.max(30_000, Math.min(args.leaseMs ?? SOCIAL_ACTION_LEASE_MS, SOCIAL_ACTION_MAX_LEASE_MS));
    const expired = await ctx.db
      .query("instagramSocialActions")
      .withIndex("by_status_and_leaseExpiresAt", (q) => q.eq("status", "claimed").lte("leaseExpiresAt", now))
      .take(limit);
    for (const action of expired) {
      if (tenantId && action.tenantId !== tenantId) {
        continue;
      }
      await ctx.db.patch(action._id, {
        status: action.attempts >= SOCIAL_ACTION_MAX_ATTEMPTS ? "failed" : "approved",
        workerId: undefined,
        leaseExpiresAt: undefined,
        error: action.attempts >= SOCIAL_ACTION_MAX_ATTEMPTS ? "Action lease expired too many times." : action.error,
        updatedAt: now,
      });
    }

    const dueRows = tenantId
      ? await ctx.db
          .query("instagramSocialActions")
          .withIndex("by_tenantId_and_status_and_sendAt", (q) =>
            q.eq("tenantId", tenantId).eq("status", "approved").lte("sendAt", now),
          )
          .order("asc")
          .take(limit)
      : await ctx.db
          .query("instagramSocialActions")
          .withIndex("by_status_and_sendAt", (q) => q.eq("status", "approved").lte("sendAt", now))
          .order("asc")
          .take(limit);

    const dailyCutoff = now - 24 * 60 * 60 * 1000;
    const globalCount = await countCompletedActions(ctx, {
      tenantId,
      since: dailyCutoff,
      limit: SOCIAL_ACTION_GLOBAL_DAILY_MAX,
    });
    const claimed = [];
    for (const action of dueRows) {
      if (globalCount + claimed.length >= SOCIAL_ACTION_GLOBAL_DAILY_MAX) {
        await ctx.db.patch(action._id, {
          sendAt: now + 60 * 60 * 1000,
          updatedAt: now,
        });
        continue;
      }
      const kindCount = await countCompletedActions(ctx, {
        tenantId,
        actionKind: action.actionKind,
        since: dailyCutoff,
        limit: SOCIAL_ACTION_KIND_DAILY_MAX[action.actionKind],
      });
      if (kindCount >= SOCIAL_ACTION_KIND_DAILY_MAX[action.actionKind]) {
        await ctx.db.patch(action._id, {
          sendAt: now + 60 * 60 * 1000,
          updatedAt: now,
        });
        continue;
      }
      await ctx.db.patch(action._id, {
        status: "claimed",
        workerId: args.workerId,
        leaseExpiresAt: now + leaseMs,
        attempts: action.attempts + 1,
        updatedAt: now,
      });
      claimed.push({
        actionId: action._id,
        actionKind: action.actionKind,
        targetMediaId: action.targetMediaId,
        targetUserId: action.targetUserId,
        targetUsername: action.targetUsername,
        targetUrl: action.targetUrl,
        commentText: action.commentText,
        reason: action.reason,
      });
    }
    return claimed;
  },
});

export const markCompleted = mutation({
  args: {
    tenantId: v.optional(v.id("tenantAccounts")),
    connectorTokenHash: v.optional(v.string()),
    actionId: v.id("instagramSocialActions"),
    providerResultId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const tenantId = await resolveTenantForMutation(ctx, { ...args, provider: "instagram" });
    const action = await ctx.db.get(args.actionId);
    if (!action) {
      throw new Error("Instagram social action not found.");
    }
    assertTenantOwned(tenantId, action.tenantId);
    await ctx.db.patch(action._id, {
      status: "completed",
      providerResultId: normalizeOptionalText(args.providerResultId, 160),
      workerId: undefined,
      leaseExpiresAt: undefined,
      error: undefined,
      completedAt: now,
      updatedAt: now,
    });
    await recordSocialActionEvent(ctx, {
      tenantId,
      eventType: "instagram.social.completed",
      detail: `${action.actionKind}: ${action._id}`,
    });
    return action._id;
  },
});

export const markFailed = mutation({
  args: {
    tenantId: v.optional(v.id("tenantAccounts")),
    connectorTokenHash: v.optional(v.string()),
    actionId: v.id("instagramSocialActions"),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const tenantId = await resolveTenantForMutation(ctx, { ...args, provider: "instagram" });
    const action = await ctx.db.get(args.actionId);
    if (!action) {
      throw new Error("Instagram social action not found.");
    }
    assertTenantOwned(tenantId, action.tenantId);
    const exhausted = action.attempts >= SOCIAL_ACTION_MAX_ATTEMPTS;
    await ctx.db.patch(action._id, {
      status: exhausted ? "failed" : "approved",
      sendAt: exhausted ? action.sendAt : now + 30 * 60 * 1000,
      workerId: undefined,
      leaseExpiresAt: undefined,
      error: normalizeOptionalText(args.error, 300),
      updatedAt: now,
    });
    await recordSocialActionEvent(ctx, {
      tenantId,
      eventType: exhausted ? "instagram.social.failed" : "instagram.social.retry",
      detail: `${action.actionKind}: ${(args.error || "").slice(0, 240)}`,
    });
    return action._id;
  },
});
