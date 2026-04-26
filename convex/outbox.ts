import { v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import { internal } from "./_generated/api";
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { detectFutureCommitment, hasRecentFollowupDuplicate, judgeActualFollowupCandidate } from "./lib/commitments";
import { DEFAULT_LEASE_MS, DEFAULT_RETRY_LIMIT } from "./lib/constants";
import { getConfig } from "./lib/config";
import { detectTodoCandidate, judgeActualTodoCandidate } from "./lib/heuristics";
import {
  NEUTRAL_EVALUATION_HORIZON_MS,
  contextPackValidator,
  resolveFeedbackPath,
  resolveOutreachModeWithFallback,
} from "./lib/aiSmartness";
import {
  countUnansweredOutboundStreak,
  latestInboundMessageAt,
  MAX_UNANSWERED_OUTBOUND_STREAK,
  resolveLongSilenceReopenWeeks,
  shouldAllowLongSilenceConversationStarter,
} from "./lib/outboundGuard";
import type { OutreachMode } from "./lib/outreachModes";
import {
  classifyThreadKind,
  directIgnoreContactKey,
  directIgnoreRuleCandidates,
  eligibilityReasonLabel,
  resolveThreadEligibility,
} from "./lib/threadEligibility";
import { isIgnoredMorningPauseActive } from "../shared/romance-morning";

const UNANSWERED_OUTBOUND_RECHECK_MS = 5 * 60 * 1000;
const CALL_REPLY_BARRIER_RECHECK_MS = 5 * 60 * 1000;
const UNANSWERED_OUTBOUND_SCAN_LIMIT = 25;
const OUTBOX_STALE_INBOUND_GRACE_MS = 8_000;
const OUTBOX_STALE_INBOUND_SCAN_LIMIT = 80;
const MANUAL_INTERVENTION_GRACE_MS = 5_000;
const MANUAL_INTERVENTION_SCAN_LIMIT = 48;
const refStyleLearnFromOutboundEmoji = makeFunctionReference<"mutation">("style:learnFromOutboundEmoji");
const refChatRebuildThreadStyleProfile = makeFunctionReference<"mutation">("chatTools:rebuildThreadStyleProfile");
const refConversationIntelligenceIngestMessageSignals = makeFunctionReference<"mutation">(
  "conversationIntelligence:ingestMessageSignals",
);
type MessageProvider = "whatsapp" | "instagram";
const OUTBOUND_DUPLICATE_WINDOW_MS = 6 * 60 * 60 * 1000;
const OUTBOUND_DUPLICATE_MIN_KEY_LENGTH = 16;
const IGNORE_CONTACT_FALLBACK_SCAN_LIMIT = 1000;
const MAX_RATE_SCAN_THREAD = 1200;
const MAX_RATE_SCAN_GLOBAL = 3200;
const MAX_LEASE_RECOVERY_COUNT = 4;

function clamp01(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(value, 1));
}

async function findExplicitIgnoreRule(args: {
  ctx: MutationCtx | QueryCtx;
  threadKind: "direct" | "group" | "broadcast_or_system";
  jid: string;
  provider?: "whatsapp" | "instagram";
}) {
  if (args.threadKind === "group") {
    return await args.ctx.db
      .query("ignoreRules")
      .withIndex("by_target", (q) => q.eq("targetType", "group").eq("targetValue", args.jid))
      .first();
  }
  if (args.threadKind !== "direct") {
    return null;
  }

  const provider = args.provider || "whatsapp";
  for (const candidateJid of directIgnoreRuleCandidates({ jid: args.jid, provider })) {
    const rule = await args.ctx.db
      .query("ignoreRules")
      .withIndex("by_target", (q) => q.eq("targetType", "contact").eq("targetValue", candidateJid))
      .first();
    if (rule) {
      return rule;
    }
  }

  const lookupKey = directIgnoreContactKey({ jid: args.jid, provider });
  if (!lookupKey) {
    return null;
  }
  const rules = await args.ctx.db
    .query("ignoreRules")
    .withIndex("by_type", (q) => q.eq("targetType", "contact"))
    .take(IGNORE_CONTACT_FALLBACK_SCAN_LIMIT);
  return (
    rules.find((rule) => directIgnoreContactKey({ jid: rule.targetValue, provider }) === lookupKey) || null
  );
}

export function resolveClaimOutreachMode(
  input?:
    | string
    | {
        outreachMode?: OutreachMode | null;
        reason?: string | null;
      },
) {
  if (typeof input === "string" || input === undefined) {
    return resolveOutreachModeWithFallback({ reason: input });
  }
  return resolveOutreachModeWithFallback({
    explicitOutreachMode: input.outreachMode,
    reason: input.reason,
  });
}

async function recordAiFeedbackSignal(args: {
  ctx: MutationCtx;
  threadId: Doc<"aiFeedbackSignals">["threadId"];
  outboxId?: Doc<"aiFeedbackSignals">["outboxId"];
  toolRunId?: string;
  path: "reply" | "outreach" | "status";
  signalType: string;
  score: number;
  metadata?: {
    reason?: string;
    detail?: string;
    eventType?: string;
    signalAt?: number;
    sentAt?: number;
    engagementWindowMs?: number;
    evaluationHorizonMs?: number;
    staleMessageAt?: number;
    staleMessagePreview?: string;
    inboundMessageId?: Doc<"messages">["_id"];
    inboundMessageType?: string;
    draftId?: Doc<"replyDrafts">["_id"];
    tags?: string[];
  };
}) {
  await args.ctx.db.insert("aiFeedbackSignals", {
    threadId: args.threadId,
    outboxId: args.outboxId,
    toolRunId: args.toolRunId,
    path: args.path,
    signalType: args.signalType,
    score: args.score,
    metadata: args.metadata,
    createdAt: Date.now(),
  });

  if (args.outboxId) {
    await args.ctx.scheduler
      .runAfter(0, internal.aiFeedback.rollupOutcomeForOutbox, {
        outboxId: args.outboxId,
      })
      .catch(() => undefined);
  }
}

function normalizeMessageProvider(provider?: MessageProvider): MessageProvider {
  return provider === "instagram" ? "instagram" : "whatsapp";
}

function normalizeOutboundDuplicateKey(text: string | undefined) {
  const normalized = (text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (normalized.length < OUTBOUND_DUPLICATE_MIN_KEY_LENGTH) {
    return "";
  }
  return normalized;
}

function buildOutboundDuplicateKey(args: {
  sendKind?: "text" | "reaction" | "sticker" | "meme" | "voice_note";
  messageText?: string;
  mediaCaption?: string;
}) {
  const sendKind = args.sendKind || "text";
  if (sendKind !== "text" && sendKind !== "meme" && sendKind !== "voice_note") {
    return "";
  }
  const candidate = sendKind === "meme" ? args.mediaCaption || args.messageText || "" : args.messageText || "";
  return normalizeOutboundDuplicateKey(candidate);
}

function isWithinQuietHours(hour: number, startHour: number, endHour: number) {
  if (startHour === endHour) {
    return false;
  }
  if (startHour < endHour) {
    return hour >= startHour && hour < endHour;
  }
  return hour >= startHour || hour < endHour;
}

function nextAllowedAfterQuietHours(now: number, startHour: number, endHour: number) {
  const next = new Date(now);
  const hour = next.getHours();

  if (startHour === endHour) {
    return now;
  }

  if (startHour < endHour) {
    if (hour >= startHour && hour < endHour) {
      next.setHours(endHour, 0, 5, 0);
      return next.getTime();
    }
    return now;
  }

  if (hour >= startHour) {
    next.setDate(next.getDate() + 1);
    next.setHours(endHour, 0, 5, 0);
    return next.getTime();
  }

  if (hour < endHour) {
    next.setHours(endHour, 0, 5, 0);
    return next.getTime();
  }

  return now;
}

function normalizeTimestampMs(raw: number | undefined, fallbackMs: number) {
  if (!Number.isFinite(raw) || (raw ?? 0) <= 0) {
    return fallbackMs;
  }
  const parsed = Number(raw);
  if (parsed < 10_000_000_000) {
    return parsed * 1000;
  }
  return parsed;
}

function stableHash(input: string) {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) >>> 0;
  }
  return hash >>> 0;
}

function classifyRetryError(error: string) {
  const normalized = error.toLowerCase();
  if (
    /blocked by eligibility|blocked by .*blocklist|unsupported|missing|cannot send empty|manual review|duplicate outbound|stale inbound|skip/i.test(
      normalized,
    )
  ) {
    return "permanent" as const;
  }
  if (/rate|429|too many|retry-after/i.test(normalized)) {
    return "rate_limit" as const;
  }
  if (/auth|401|403|forbidden|unauthorized|session/i.test(normalized)) {
    return "auth" as const;
  }
  if (/network|timeout|timed out|econn|socket|fetch|temporary/i.test(normalized)) {
    return "transient" as const;
  }
  return "unknown" as const;
}

function computeRetryDelayMs(args: {
  attempts: number;
  outboxId: string;
  error: string;
}) {
  const retryClass = classifyRetryError(args.error);
  const attempt = Math.max(1, Math.round(args.attempts));
  const baseByClass =
    retryClass === "rate_limit"
      ? 30_000
      : retryClass === "auth"
        ? 45_000
        : retryClass === "transient"
          ? 12_000
          : retryClass === "unknown"
            ? 15_000
            : 0;
  if (baseByClass <= 0) {
    return 0;
  }
  const exp = Math.min(attempt - 1, 5);
  const baseDelay = Math.min(baseByClass * 2 ** exp, 8 * 60_000);
  const jitterFraction = (stableHash(`${args.outboxId}:${attempt}`) % 1000) / 1000;
  const jitter = Math.round(baseDelay * (0.2 + jitterFraction * 0.5));
  return Math.max(2_000, Math.min(baseDelay + jitter, 10 * 60_000));
}

function toStyleEmojiSendKind(messageType: string | undefined) {
  if (
    messageType === "text" ||
    messageType === "reaction" ||
    messageType === "sticker" ||
    messageType === "meme" ||
    messageType === "voice_note"
  ) {
    return messageType;
  }
  return undefined;
}

function resolveSendRateLimits(config: Awaited<ReturnType<typeof getConfig>>, messageProvider: MessageProvider) {
  if (messageProvider === "instagram") {
    return {
      windowMinutes: Math.max(5, config.instagramSendRateWindowMinutes),
      maxPerThread: Math.max(1, config.instagramSendMaxPerThreadInWindow),
      maxGlobal: Math.max(1, config.instagramSendMaxGlobalInWindow),
    };
  }
  return {
    windowMinutes: Math.max(5, config.sendRateWindowMinutes),
    maxPerThread: Math.max(1, config.sendMaxPerThreadInWindow),
    maxGlobal: Math.max(1, config.sendMaxGlobalInWindow),
  };
}

type FreshnessMessage = Pick<Doc<"messages">, "direction" | "messageAt" | "messageType" | "isStatus" | "text">;
type ManualInterventionMessage = Pick<Doc<"messages">, "direction" | "origin" | "toolRunId" | "messageAt">;

function isFreshnessBlockingInboundMessage(message: FreshnessMessage) {
  if (message.direction !== "inbound") {
    return false;
  }
  if (message.isStatus) {
    return false;
  }
  return message.messageType !== "reaction";
}

export function isManualInterventionMessage(message: ManualInterventionMessage) {
  return message.direction === "outbound" && message.origin === "live" && !message.toolRunId;
}

export function hasRecentManualIntervention(args: {
  recentMessages: ManualInterventionMessage[];
  nowMs: number;
  cooldownMs: number;
}) {
  const cutoff = args.nowMs - Math.max(0, args.cooldownMs) - MANUAL_INTERVENTION_GRACE_MS;
  return args.recentMessages.some((message) => {
    return isManualInterventionMessage(message) && (message.messageAt || 0) >= cutoff;
  });
}

export function resolveOutboxFreshnessReferenceAt(args: {
  outboxCreatedAt: number;
  draftUpdatedAt?: number;
  sourceMessageDirection?: Doc<"messages">["direction"];
  sourceMessageAt?: number;
}) {
  const outboxCreatedAt = Number.isFinite(args.outboxCreatedAt) ? Math.max(0, args.outboxCreatedAt) : 0;
  const draftUpdatedAt = Number.isFinite(args.draftUpdatedAt) ? Math.max(0, args.draftUpdatedAt || 0) : 0;
  const sourceInboundAt =
    args.sourceMessageDirection === "inbound" && Number.isFinite(args.sourceMessageAt)
      ? Math.max(0, args.sourceMessageAt || 0)
      : 0;
  return Math.max(outboxCreatedAt, draftUpdatedAt, sourceInboundAt);
}

export function findNewestStaleInboundMessage(args: {
  recentMessages: FreshnessMessage[];
  referenceAt: number;
  graceMs?: number;
}) {
  const cutoff = Math.max(0, args.referenceAt) + Math.max(0, args.graceMs ?? OUTBOX_STALE_INBOUND_GRACE_MS);
  let newest: FreshnessMessage | null = null;

  for (const message of args.recentMessages) {
    if (!isFreshnessBlockingInboundMessage(message)) {
      continue;
    }
    if ((message.messageAt || 0) <= cutoff) {
      continue;
    }
    if (!newest || (message.messageAt || 0) > (newest.messageAt || 0)) {
      newest = message;
    }
  }

  return newest;
}

export const claimDue = mutation({
  args: {
    workerId: v.string(),
    messageProvider: v.optional(v.union(v.literal("whatsapp"), v.literal("instagram"))),
    limit: v.optional(v.number()),
    leaseMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const messageProvider = normalizeMessageProvider(args.messageProvider);
    const leaseMs = Math.max(15_000, Math.min(args.leaseMs ?? DEFAULT_LEASE_MS, 10 * 60_000));
    const max = Math.min(args.limit ?? 5, 20);
    const config = await getConfig(ctx);
    const sendRateLimits = resolveSendRateLimits(config, messageProvider);

    const expiredClaims = await ctx.db
      .query("outbox")
      .withIndex("by_messageProvider_and_status_leaseExpiresAt", (q) =>
        q.eq("messageProvider", messageProvider).eq("status", "claimed").lte("leaseExpiresAt", now),
      )
      .take(max);

    for (const item of expiredClaims) {
      const nextRecoveryCount = (item.leaseRecoveryCount || 0) + 1;
      const quarantine = nextRecoveryCount >= MAX_LEASE_RECOVERY_COUNT;
      await ctx.db.patch(item._id, {
        status: quarantine ? "failed" : "pending",
        workerId: undefined,
        leaseExpiresAt: undefined,
        sendAt: quarantine ? item.sendAt : Math.min(item.sendAt, now),
        error: quarantine ? "Outbox item quarantined after repeated lease expiries." : item.error,
        leaseRecoveryCount: nextRecoveryCount,
        lastLeaseRecoveredAt: now,
        updatedAt: now,
      });
      if (quarantine) {
        await ctx.db.insert("systemEvents", {
          source: "convex",
          eventType: "outbox.quarantined.lease_expiry",
          threadId: item.threadId,
          outboxId: item._id,
          detail: `Quarantined after ${nextRecoveryCount} lease recoveries.`,
          createdAt: now,
        });
      }
    }

    const due = await ctx.db
      .query("outbox")
      .withIndex("by_messageProvider_and_status_sendAt", (q) =>
        q.eq("messageProvider", messageProvider).eq("status", "pending").lte("sendAt", now),
      )
      .take(max);

    const claimed = [] as Array<{
      outboxId: string;
      threadId: string;
      draftId: string;
      toolRunId?: string;
      outreachMode?: "proactive" | "good_morning" | "compliment";
      contextPack?: Doc<"outbox">["contextPack"];
      messageText: string;
      typingMs: number;
      jid: string;
      idempotencyKey: string;
      messageProvider: "whatsapp" | "instagram";
      provider: "azure" | "codex" | "heuristic";
      sendKind: "text" | "reaction" | "sticker" | "meme" | "voice_note";
      isStatusPost?: boolean;
      statusAudienceJids?: string[];
      statusTrendTheme?: string;
      statusDemographicHint?: string;
      statusFormat?: "text" | "meme";
      statusReviewRequired?: boolean;
      reactionEmoji?: string;
      reactionTargetProviderMessageId?: string;
      reactionTargetWhatsAppMessageId?: string;
      preReactionEmoji?: string;
      mediaAssetId?: string;
      mediaCaption?: string;
      replyTargetProviderMessageId?: string;
      replyTargetWhatsAppMessageId?: string;
      replyTargetSenderJid?: string;
      replyTargetText?: string;
      replyTargetMessageAt?: number;
    }>;
    const claimedDuplicateKeysByThread = new Map<string, Set<string>>();
    const unansweredOutboundStateByThread = new Map<
      string,
      {
        unansweredStreak: number;
        latestInboundAt?: number;
      }
    >();
    const manualInterventionActiveByThread = new Map<string, boolean>();

    for (const item of due) {
      const draft = await ctx.db.get(item.draftId);
      const thread = await ctx.db.get(item.threadId);
      if (!draft || !thread) {
        continue;
      }
      const sourceMessage = await ctx.db.get(draft.sourceMessageId);
      const resolvedOutreachMode = resolveClaimOutreachMode({
        outreachMode: item.outreachMode || draft.outreachMode,
        reason: draft.reason,
      });
      const feedbackPath = resolveFeedbackPath({
        isStatusPost: item.isStatusPost,
        explicitOutreachMode: resolvedOutreachMode,
        reason: draft.reason,
      });
      const threadKind = thread.threadKind || classifyThreadKind({ jid: thread.jid, isGroupHint: thread.isGroup });
      if (threadKind === "direct") {
        const romanceState = await ctx.db
          .query("romanceMorningState")
          .withIndex("by_threadId", (q) => q.eq("threadId", thread._id))
          .first();
        if (
          isIgnoredMorningPauseActive({
            now,
            noReplyStreak: romanceState?.noReplyStreak,
            lastSentAt: romanceState?.lastSentAt,
            lastInboundAfterSendAt: romanceState?.lastInboundAfterSendAt,
          })
        ) {
          const reason = "Suppressed: ignored previous good morning; pausing automated sends for 3 days.";
          await ctx.db.patch(item._id, {
            status: "failed",
            workerId: undefined,
            leaseExpiresAt: undefined,
            error: reason,
            updatedAt: now,
          });
          if (draft.status !== "sent" && draft.status !== "rejected") {
            await ctx.db.patch(draft._id, {
              status: "rejected",
              updatedAt: now,
            });
          }
          await ctx.db.insert("systemEvents", {
            source: "worker",
            eventType: "outbox.suppressed.ignored_pause",
            threadId: item.threadId,
            outboxId: item._id,
            detail: reason,
            createdAt: now,
          });
          await recordAiFeedbackSignal({
            ctx,
            threadId: item.threadId,
            outboxId: item._id,
            toolRunId: item.toolRunId,
            path: feedbackPath,
            signalType: "suppressed_manual_intervention",
            score: -1,
            metadata: {
              reason: "ignored_pause",
              detail: reason,
              eventType: "outbox.suppressed.ignored_pause",
              signalAt: now,
              draftId: draft._id,
              tags: ["suppression", "manual_intervention"],
            },
          }).catch(() => undefined);
          continue;
        }
      }
      const callReplyBarrierAt = (thread.callReplyBarrierAt || 0) > 0 ? thread.callReplyBarrierAt : undefined;
      if (threadKind === "direct" && callReplyBarrierAt) {
        await ctx.db.patch(item._id, {
          status: "pending",
          workerId: undefined,
          leaseExpiresAt: undefined,
          sendAt: Math.max(item.sendAt, now + CALL_REPLY_BARRIER_RECHECK_MS),
          updatedAt: now,
        });
        await ctx.db.insert("systemEvents", {
          source: "worker",
          eventType: "outbox.deferred.call_reply_barrier",
          threadId: item.threadId,
          outboxId: item._id,
          detail: `Deferred send until a new inbound arrives after qualified call barrier (${new Date(callReplyBarrierAt).toISOString()}).`,
          createdAt: now,
        });
        continue;
      }
      const shouldQuoteSource = sourceMessage?.direction === "inbound";
      if (threadKind === "direct" && !item.isStatusPost) {
        const referenceAt = resolveOutboxFreshnessReferenceAt({
          outboxCreatedAt: item.createdAt,
          draftUpdatedAt: draft.updatedAt,
          sourceMessageDirection: sourceMessage?.direction,
          sourceMessageAt: sourceMessage?.messageAt,
        });
        const freshnessCandidates = await ctx.db
          .query("messages")
          .withIndex("by_thread_messageAt", (q) => q.eq("threadId", thread._id).gt("messageAt", referenceAt))
          .order("desc")
          .take(OUTBOX_STALE_INBOUND_SCAN_LIMIT);
        const staleInbound = findNewestStaleInboundMessage({
          recentMessages: freshnessCandidates,
          referenceAt,
        });
        if (staleInbound) {
          const staleAtIso = new Date(staleInbound.messageAt).toISOString();
          const reason = `Suppressed: newer inbound at ${staleAtIso} made this automatic reply stale.`;
          await ctx.db.patch(item._id, {
            status: "failed",
            workerId: undefined,
            leaseExpiresAt: undefined,
            error: reason,
            updatedAt: now,
          });
          if (draft.status !== "sent" && draft.status !== "rejected") {
            await ctx.db.patch(draft._id, {
              status: "rejected",
              updatedAt: now,
            });
          }
          if (item.followUpId) {
            const followUp = await ctx.db.get(item.followUpId);
            if (followUp && followUp.status !== "sent" && followUp.status !== "failed" && followUp.status !== "cancelled") {
              await ctx.db.patch(followUp._id, {
                status: "cancelled",
                updatedAt: now,
              });
            }
          }
          await ctx.db.insert("systemEvents", {
            source: "worker",
            eventType: "outbox.suppressed.stale_inbound",
            threadId: item.threadId,
            outboxId: item._id,
            detail: `${staleAtIso} · ${(staleInbound.text || "[Inbound message]").slice(0, 220)}`,
            createdAt: now,
          });
          await recordAiFeedbackSignal({
            ctx,
            threadId: item.threadId,
            outboxId: item._id,
            toolRunId: item.toolRunId,
            path: feedbackPath,
            signalType: "suppressed_stale",
            score: -1,
            metadata: {
              reason: "stale_inbound",
              detail: reason,
              eventType: "outbox.suppressed.stale_inbound",
              signalAt: now,
              staleMessageAt: staleInbound.messageAt,
              staleMessagePreview: (staleInbound.text || "").slice(0, 180),
              draftId: draft._id,
              tags: ["suppression", "stale"],
            },
          }).catch(() => undefined);
          continue;
        }
      }
      const duplicateCandidateKey = buildOutboundDuplicateKey({
        sendKind: item.sendKind,
        messageText: item.messageText,
        mediaCaption: item.mediaCaption,
      });

      const seenDuplicateKeys = claimedDuplicateKeysByThread.get(thread._id);
      if (duplicateCandidateKey && seenDuplicateKeys?.has(duplicateCandidateKey)) {
        const reason = "Suppressed: duplicate outbound text in same claim batch.";
        await ctx.db.patch(item._id, {
          status: "failed",
          workerId: undefined,
          leaseExpiresAt: undefined,
          error: reason,
          updatedAt: now,
        });
        if (draft.status !== "sent" && draft.status !== "rejected") {
          await ctx.db.patch(draft._id, {
            status: "rejected",
            updatedAt: now,
          });
        }
        if (item.followUpId) {
          const followUp = await ctx.db.get(item.followUpId);
          if (followUp && followUp.status !== "sent" && followUp.status !== "failed" && followUp.status !== "cancelled") {
            await ctx.db.patch(followUp._id, {
              status: "failed",
              updatedAt: now,
            });
          }
        }
        await ctx.db.insert("systemEvents", {
          source: "worker",
          eventType: "outbox.suppressed.duplicate",
          threadId: item.threadId,
          outboxId: item._id,
          detail: reason,
          createdAt: now,
        });
        continue;
      }

      let deferUntil = 0;
      const deferReasons: string[] = [];
      if (messageProvider === "instagram" && item.isStatusPost) {
        const cadenceMs = Math.max(60_000, Math.round(config.instagramStoryCadenceHours * 60 * 60 * 1000));
        const dailyWindowMs = 24 * 60 * 60 * 1000;
        const recentStatusMessages = await ctx.db
          .query("messages")
          .withIndex("by_thread_messageAt", (q) =>
            q.eq("threadId", thread._id).gte("messageAt", now - dailyWindowMs),
          )
          .order("desc")
          .take(Math.max(config.instagramStoryDailyMaxPosts + 12, 40));
        const recentOutboundStories = recentStatusMessages.filter(
          (message) => message.direction === "outbound" && message.isStatus === true,
        );
        const lastStoryAt = recentOutboundStories[0]?.messageAt || 0;
        if (lastStoryAt > 0 && now - lastStoryAt < cadenceMs) {
          deferUntil = Math.max(deferUntil, lastStoryAt + cadenceMs + 1_000);
          deferReasons.push("instagram-story-cadence");
        }
        if (recentOutboundStories.length >= config.instagramStoryDailyMaxPosts) {
          const oldestInWindow = Math.min(
            ...recentOutboundStories
              .slice(0, config.instagramStoryDailyMaxPosts)
              .map((message) => message.messageAt),
          );
          deferUntil = Math.max(deferUntil, oldestInWindow + dailyWindowMs + 1_000);
          deferReasons.push("instagram-story-daily-limit");
        }
      }
      const nowHour = new Date(now).getHours();
      if (config.quietHoursEnabled && isWithinQuietHours(nowHour, config.quietHoursStartHour, config.quietHoursEndHour)) {
        deferUntil = Math.max(deferUntil, nextAllowedAfterQuietHours(now, config.quietHoursStartHour, config.quietHoursEndHour));
        deferReasons.push("quiet-hours");
      }

      const windowMs = sendRateLimits.windowMinutes * 60 * 1000;
      const cutoff = now - windowMs;
      const duplicateWindowMs = Math.max(windowMs, OUTBOUND_DUPLICATE_WINDOW_MS);
      const duplicateCutoff = now - duplicateWindowMs;

      const threadScanLimit = Math.min(Math.max(sendRateLimits.maxPerThread + 40, 120), MAX_RATE_SCAN_THREAD);
      const recentThread = await ctx.db
        .query("messages")
        .withIndex("by_thread_messageAt", (q) => q.eq("threadId", thread._id).gte("messageAt", duplicateCutoff))
        .order("desc")
        .take(threadScanLimit);
      const recentThreadOutbound = recentThread.filter(
        (message) => message.direction === "outbound" && message.messageAt >= cutoff,
      );
      if (recentThread.length >= threadScanLimit && recentThreadOutbound.length >= sendRateLimits.maxPerThread) {
        deferUntil = Math.max(deferUntil, now + 30_000);
        deferReasons.push("thread-rate-limit-scan-cap");
      }
      if (recentThreadOutbound.length >= sendRateLimits.maxPerThread) {
        const oldestThreadWindow = Math.min(...recentThreadOutbound.slice(0, sendRateLimits.maxPerThread).map((message) => message.messageAt));
        deferUntil = Math.max(deferUntil, oldestThreadWindow + windowMs + 1_000);
        deferReasons.push("thread-rate-limit");
      }

      if (duplicateCandidateKey) {
        const hasRecentDuplicateOutbound = recentThread.some((message) => {
          if (message.direction !== "outbound") {
            return false;
          }
          const outboundSendKind =
            message.messageType === "meme"
              ? "meme"
              : message.messageType === "voice_note"
                ? "voice_note"
                : message.messageType === undefined || message.messageType === "text"
                  ? "text"
                  : undefined;
          if (!outboundSendKind) {
            return false;
          }
          const outboundKey = buildOutboundDuplicateKey({
            sendKind: outboundSendKind,
            messageText: message.text,
            mediaCaption: message.mediaCaption,
          });
          return outboundKey !== "" && outboundKey === duplicateCandidateKey;
        });
        if (hasRecentDuplicateOutbound) {
          const reason = "Suppressed: duplicate outbound text sent recently to this thread.";
          await ctx.db.patch(item._id, {
            status: "failed",
            workerId: undefined,
            leaseExpiresAt: undefined,
            error: reason,
            updatedAt: now,
          });
          if (draft.status !== "sent" && draft.status !== "rejected") {
            await ctx.db.patch(draft._id, {
              status: "rejected",
              updatedAt: now,
            });
          }
          if (item.followUpId) {
            const followUp = await ctx.db.get(item.followUpId);
            if (followUp && followUp.status !== "sent" && followUp.status !== "failed" && followUp.status !== "cancelled") {
              await ctx.db.patch(followUp._id, {
                status: "failed",
                updatedAt: now,
              });
            }
          }
          await ctx.db.insert("systemEvents", {
            source: "worker",
            eventType: "outbox.suppressed.duplicate",
            threadId: item.threadId,
            outboxId: item._id,
            detail: reason,
            createdAt: now,
          });
          continue;
        }
      }

      const globalScanLimit = Math.min(sendRateLimits.maxGlobal + 240, MAX_RATE_SCAN_GLOBAL);
      const recentGlobal = await ctx.db
        .query("messages")
        .withIndex("by_createdAt", (q) => q.gte("createdAt", cutoff))
        .order("desc")
        .take(globalScanLimit);
      const recentGlobalOutbound = recentGlobal.filter(
        (message) =>
          message.direction === "outbound" &&
          message.messageAt >= cutoff &&
          (message.provider || "whatsapp") === messageProvider,
      );
      if (recentGlobal.length >= globalScanLimit && recentGlobalOutbound.length >= sendRateLimits.maxGlobal) {
        deferUntil = Math.max(deferUntil, now + 30_000);
        deferReasons.push("global-rate-limit-scan-cap");
      }
      if (recentGlobalOutbound.length >= sendRateLimits.maxGlobal) {
        const oldestGlobalWindow = Math.min(...recentGlobalOutbound.slice(0, sendRateLimits.maxGlobal).map((message) => message.messageAt));
        deferUntil = Math.max(deferUntil, oldestGlobalWindow + windowMs + 1_000);
        deferReasons.push("global-rate-limit");
      }

      if (threadKind === "direct") {
        let unansweredState = unansweredOutboundStateByThread.get(thread._id);
        if (!unansweredState) {
          const latestMessages = await ctx.db
            .query("messages")
            .withIndex("by_thread_messageAt", (q) => q.eq("threadId", thread._id))
            .order("desc")
            .take(UNANSWERED_OUTBOUND_SCAN_LIMIT);
          const activeClaimedOutbox = await ctx.db
            .query("outbox")
            .withIndex("by_thread_and_status", (q) => q.eq("threadId", thread._id).eq("status", "claimed"))
            .take(MAX_UNANSWERED_OUTBOUND_STREAK + 2);

          unansweredState = {
            unansweredStreak: countUnansweredOutboundStreak(latestMessages) + activeClaimedOutbox.length,
            latestInboundAt: latestInboundMessageAt(latestMessages),
          };
          unansweredOutboundStateByThread.set(thread._id, unansweredState);
        }

        const allowLongSilenceStarter = shouldAllowLongSilenceConversationStarter({
          unansweredStreak: unansweredState.unansweredStreak,
          latestInboundAt: unansweredState.latestInboundAt,
          nowMs: now,
          isConversationStarter: Boolean(resolvedOutreachMode),
        });

        if (unansweredState.unansweredStreak >= MAX_UNANSWERED_OUTBOUND_STREAK && !allowLongSilenceStarter) {
          deferUntil = Math.max(deferUntil, now + UNANSWERED_OUTBOUND_RECHECK_MS);
          deferReasons.push("unanswered-outbound-limit");
        } else if (allowLongSilenceStarter) {
          const requiredWeeks = resolveLongSilenceReopenWeeks(unansweredState.unansweredStreak);
          const elapsedWeeks = Math.max(
            1,
            Math.round((now - (unansweredState.latestInboundAt || now)) / (7 * 24 * 60 * 60 * 1000)),
          );
          await ctx.db.insert("systemEvents", {
            source: "worker",
            eventType: "outbox.unanswered_limit.override",
            threadId: item.threadId,
            outboxId: item._id,
            detail: `Allowing long-silence conversation starter after ${elapsedWeeks} week(s) unanswered (threshold ${requiredWeeks} week(s)).`,
            createdAt: now,
          });
        }
      }

      if (deferUntil > now) {
        await ctx.db.patch(item._id, {
          status: "pending",
          workerId: undefined,
          leaseExpiresAt: undefined,
          sendAt: deferUntil,
          updatedAt: now,
        });
        await ctx.db.insert("systemEvents", {
          source: "worker",
          eventType: "outbox.deferred.policy",
          threadId: item.threadId,
          outboxId: item._id,
          detail: `Deferred send due to ${deferReasons.join(", ")}.`,
          createdAt: now,
        });
        continue;
      }

      const isStatusBroadcastSend =
        item.isStatusPost === true && (thread.jid === "status@broadcast" || thread.jid === "ig:story:broadcast");
      if (!isStatusBroadcastSend) {
        const explicitIgnore = await findExplicitIgnoreRule({
          ctx,
          threadKind,
          jid: thread.jid,
          provider: thread.provider || "whatsapp",
        });
        const eligibility = resolveThreadEligibility({
          thread: {
            jid: thread.jid,
            isIgnored: thread.isIgnored,
            isArchived: thread.isArchived,
            threadKind,
            ghostedUntil: thread.ghostedUntil,
          },
          ignoreGroupsByDefault: config.ignoreGroupsByDefault,
          explicitIgnoreEnabled: Boolean(explicitIgnore?.enabled),
          groupRuleEnabled: threadKind === "group" ? explicitIgnore?.enabled : undefined,
          nowMs: now,
        });
        if (!eligibility.allowed) {
          if (eligibility.reason === "temporary_ghost") {
            let manualInterventionActive = false;
            if (threadKind === "direct") {
              const cached = manualInterventionActiveByThread.get(thread._id);
              if (cached === undefined) {
                const lookbackStart = now - Math.max(30_000, config.manualInterventionCooldownMs + MANUAL_INTERVENTION_GRACE_MS);
                const recentThreadMessages = await ctx.db
                  .query("messages")
                  .withIndex("by_thread_messageAt", (q) => q.eq("threadId", thread._id).gte("messageAt", lookbackStart))
                  .order("desc")
                  .take(MANUAL_INTERVENTION_SCAN_LIMIT);
                const resolved = hasRecentManualIntervention({
                  recentMessages: recentThreadMessages,
                  nowMs: now,
                  cooldownMs: config.manualInterventionCooldownMs,
                });
                manualInterventionActiveByThread.set(thread._id, resolved);
                manualInterventionActive = resolved;
              } else {
                manualInterventionActive = cached;
              }
            }

            if (manualInterventionActive) {
              const reason = "Suppressed: manual intervention cooldown is active for this thread.";
              await ctx.db.patch(item._id, {
                status: "failed",
                workerId: undefined,
                leaseExpiresAt: undefined,
                error: reason,
                updatedAt: now,
              });
              if (draft.status !== "sent" && draft.status !== "rejected") {
                await ctx.db.patch(draft._id, {
                  status: "rejected",
                  updatedAt: now,
                });
              }
              if (item.followUpId) {
                const followUp = await ctx.db.get(item.followUpId);
                if (followUp && followUp.status !== "sent" && followUp.status !== "failed" && followUp.status !== "cancelled") {
                  await ctx.db.patch(followUp._id, {
                    status: "cancelled",
                    updatedAt: now,
                  });
                }
              }
              await ctx.db.insert("systemEvents", {
                source: "worker",
                eventType: "outbox.suppressed.manual_cooldown",
                threadId: item.threadId,
                outboxId: item._id,
                detail: reason,
                createdAt: now,
              });
              await recordAiFeedbackSignal({
                ctx,
                threadId: item.threadId,
                outboxId: item._id,
                toolRunId: item.toolRunId,
                path: feedbackPath,
                signalType: "suppressed_manual_cooldown",
                score: -0.9,
                metadata: {
                  reason: "manual_cooldown",
                  detail: reason,
                  eventType: "outbox.suppressed.manual_cooldown",
                  signalAt: now,
                  draftId: draft._id,
                  tags: ["suppression", "manual_intervention"],
                },
              }).catch(() => undefined);
              continue;
            }

            const ghostUntil = Math.max(thread.ghostedUntil ?? now, now + 30_000);
            await ctx.db.patch(item._id, {
              status: "pending",
              workerId: undefined,
              leaseExpiresAt: undefined,
              sendAt: ghostUntil + 2_000,
              updatedAt: now,
            });
            await ctx.db.insert("systemEvents", {
              source: "worker",
              eventType: "outbox.deferred.ghost_mode",
              threadId: item.threadId,
              outboxId: item._id,
              detail: `Deferred send until temporary ghost window ends (${new Date(ghostUntil).toISOString()}).`,
              createdAt: now,
            });
            continue;
          }

          const reason = `Blocked by eligibility: ${eligibility.reason} (${eligibilityReasonLabel(eligibility.reason)}).`;
          await ctx.db.patch(item._id, {
            status: "failed",
            workerId: undefined,
            leaseExpiresAt: undefined,
            error: reason,
            updatedAt: now,
          });
          await ctx.db.patch(draft._id, {
            status: "rejected",
            updatedAt: now,
          });
          if (item.followUpId) {
            const followUp = await ctx.db.get(item.followUpId);
            if (followUp && followUp.status === "queued") {
              await ctx.db.patch(followUp._id, {
                status: "failed",
                updatedAt: now,
              });
              await ctx.db.insert("systemEvents", {
                source: "worker",
                eventType: "followup.failed",
                threadId: item.threadId,
                outboxId: item._id,
                detail: reason.slice(0, 240),
                createdAt: now,
              });
            }
          }
          await ctx.db.insert("systemEvents", {
            source: "worker",
            eventType: "outbox.blocked.eligibility",
            threadId: item.threadId,
            outboxId: item._id,
            detail: reason,
            createdAt: now,
          });
          continue;
        }
      }

      await ctx.db.patch(item._id, {
        status: "claimed",
        workerId: args.workerId,
        leaseExpiresAt: now + leaseMs,
        attempts: item.attempts + 1,
        updatedAt: now,
      });
      if (threadKind === "direct") {
        const state = unansweredOutboundStateByThread.get(thread._id);
        if (state) {
          unansweredOutboundStateByThread.set(thread._id, {
            ...state,
            unansweredStreak: state.unansweredStreak + 1,
          });
        } else {
          unansweredOutboundStateByThread.set(thread._id, {
            unansweredStreak: 1,
            latestInboundAt: undefined,
          });
        }
      }
      if (duplicateCandidateKey) {
        let threadKeys = claimedDuplicateKeysByThread.get(thread._id);
        if (!threadKeys) {
          threadKeys = new Set<string>();
          claimedDuplicateKeysByThread.set(thread._id, threadKeys);
        }
        threadKeys.add(duplicateCandidateKey);
      }

      claimed.push({
        outboxId: item._id,
        threadId: item.threadId,
        draftId: item.draftId,
        toolRunId: item.toolRunId,
        outreachMode: resolvedOutreachMode,
        contextPack: item.contextPack || draft.contextPack,
        messageText: item.messageText,
        typingMs: draft.typingMs,
        jid: thread.jid,
        idempotencyKey: item.idempotencyKey,
        messageProvider: item.messageProvider || normalizeMessageProvider(thread.provider),
        provider: item.provider,
        sendKind: item.sendKind || "text",
        isStatusPost: item.isStatusPost,
        statusAudienceJids: item.statusAudienceJids,
        statusTrendTheme: item.statusTrendTheme,
        statusDemographicHint: item.statusDemographicHint,
        statusFormat: item.statusFormat,
        statusReviewRequired: item.statusReviewRequired,
        reactionEmoji: item.reactionEmoji,
        reactionTargetProviderMessageId: item.reactionTargetProviderMessageId || item.reactionTargetWhatsAppMessageId,
        reactionTargetWhatsAppMessageId: item.reactionTargetWhatsAppMessageId,
        preReactionEmoji: item.preReactionEmoji,
        mediaAssetId: item.mediaAssetId,
        mediaCaption: item.mediaCaption,
        replyTargetProviderMessageId: shouldQuoteSource
          ? sourceMessage?.providerMessageId || sourceMessage?.whatsappMessageId
          : undefined,
        replyTargetWhatsAppMessageId: shouldQuoteSource ? sourceMessage?.whatsappMessageId : undefined,
        replyTargetSenderJid: shouldQuoteSource ? sourceMessage?.senderJid : undefined,
        replyTargetText: shouldQuoteSource ? sourceMessage?.text : undefined,
        replyTargetMessageAt: shouldQuoteSource ? sourceMessage?.messageAt : undefined,
      });
    }

    return claimed;
  },
});

export const markTyping = mutation({
  args: {
    outboxId: v.id("outbox"),
  },
  handler: async (ctx, args) => {
    const outbox = await ctx.db.get(args.outboxId);
    if (!outbox) {
      return null;
    }

    await ctx.db.insert("systemEvents", {
      source: "worker",
      eventType: "outbox.typing",
      threadId: outbox.threadId,
      outboxId: outbox._id,
      detail: "Typing indicator emitted.",
      createdAt: Date.now(),
    });

    return outbox._id;
  },
});

export const getSendDisposition = query({
  args: {
    outboxId: v.id("outbox"),
  },
  handler: async (ctx, args) => {
    const outbox = await ctx.db.get(args.outboxId);
    if (!outbox) {
      return {
        canSend: false,
        reason: "outbox_missing",
      };
    }
    if (outbox.status !== "claimed") {
      return {
        canSend: false,
        reason: `outbox_not_claimed:${outbox.status}`,
      };
    }

    const thread = await ctx.db.get(outbox.threadId);
    if (!thread) {
      return {
        canSend: false,
        reason: "thread_missing",
      };
    }
    const draft = await ctx.db.get(outbox.draftId);
    if (!draft) {
      return {
        canSend: false,
        reason: "draft_missing",
      };
    }
    const threadKind = thread.threadKind || classifyThreadKind({ jid: thread.jid, isGroupHint: thread.isGroup, provider: thread.provider });
    const config = await getConfig(ctx);
    const explicitIgnore = await findExplicitIgnoreRule({
      ctx,
      threadKind,
      jid: thread.jid,
      provider: thread.provider || "whatsapp",
    });
    const eligibility = resolveThreadEligibility({
      thread: {
        jid: thread.jid,
        isIgnored: thread.isIgnored,
        isArchived: thread.isArchived,
        threadKind,
        ghostedUntil: thread.ghostedUntil,
      },
      ignoreGroupsByDefault: config.ignoreGroupsByDefault,
      explicitIgnoreEnabled: Boolean(explicitIgnore?.enabled),
      groupRuleEnabled: threadKind === "group" ? explicitIgnore?.enabled : undefined,
      nowMs: Date.now(),
    });
    if (!eligibility.allowed && eligibility.reason !== "temporary_ghost") {
      return {
        canSend: false,
        reason: `eligibility_blocked:${eligibility.reason}`,
      };
    }
    if (threadKind === "direct" && (thread.callReplyBarrierAt || 0) > 0) {
      return {
        canSend: false,
        reason: `call_reply_barrier:${thread.callReplyBarrierAt}`,
      };
    }
    if (threadKind === "direct" && !outbox.isStatusPost) {
      const sourceMessage = await ctx.db.get(draft.sourceMessageId);
      const referenceAt = resolveOutboxFreshnessReferenceAt({
        outboxCreatedAt: outbox.createdAt,
        draftUpdatedAt: draft.updatedAt,
        sourceMessageDirection: sourceMessage?.direction,
        sourceMessageAt: sourceMessage?.messageAt,
      });
      const freshnessCandidates = await ctx.db
        .query("messages")
        .withIndex("by_thread_messageAt", (q) => q.eq("threadId", thread._id).gt("messageAt", referenceAt))
        .order("desc")
        .take(OUTBOX_STALE_INBOUND_SCAN_LIMIT);
      const staleInbound = findNewestStaleInboundMessage({
        recentMessages: freshnessCandidates,
        referenceAt,
      });
      if (staleInbound) {
        return {
          canSend: false,
          reason: `stale_inbound:${staleInbound.messageAt}`,
        };
      }
    }

    return {
      canSend: true,
    };
  },
});

export const suppressForManualIntervention = mutation({
  args: {
    messageProvider: v.optional(v.union(v.literal("whatsapp"), v.literal("instagram"))),
    threadJid: v.string(),
    providerMessageId: v.optional(v.string()),
    whatsappMessageId: v.optional(v.string()),
    text: v.optional(v.string()),
    messageType: v.optional(
      v.union(
        v.literal("text"),
        v.literal("reaction"),
        v.literal("sticker"),
        v.literal("meme"),
        v.literal("voice_note"),
        v.literal("image"),
        v.literal("video"),
        v.literal("audio"),
        v.literal("document"),
      ),
    ),
    reactionEmoji: v.optional(v.string()),
    reactionTargetWhatsAppMessageId: v.optional(v.string()),
    mediaCaption: v.optional(v.string()),
    isStatus: v.optional(v.boolean()),
    messageAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const messageProvider = normalizeMessageProvider(args.messageProvider);
    const config = await getConfig(ctx);
    const messageAt = normalizeTimestampMs(args.messageAt, now);
    const effectiveMessageId = args.providerMessageId || args.whatsappMessageId;
    let thread = await ctx.db
      .query("threads")
      .withIndex("by_provider_and_jid", (q) => q.eq("provider", messageProvider).eq("jid", args.threadJid))
      .first();
    if (!thread) {
      thread = await ctx.db
        .query("threads")
        .withIndex("by_jid", (q) => q.eq("jid", args.threadJid))
        .first();
    }

    if (!thread) {
      return {
        threadFound: false,
        threadId: undefined,
        suppressedOutbox: 0,
      };
    }

    const threadKind = thread.threadKind || classifyThreadKind({ jid: thread.jid, isGroupHint: thread.isGroup });
    const cooldownUntil =
      threadKind === "direct"
        ? Math.max(thread.ghostedUntil ?? 0, Math.max(now, messageAt) + config.manualInterventionCooldownMs)
        : thread.ghostedUntil;

    await ctx.db.patch(thread._id, {
      lastMessageAt: Math.max(thread.lastMessageAt, messageAt),
      ghostedUntil: cooldownUntil,
      updatedAt: now,
    });

    if (threadKind === "direct") {
      await ctx.db.insert("systemEvents", {
        source: "worker",
        eventType: "thread.ghost_mode.manual_intervention",
        threadId: thread._id,
        detail: `Manual intervention cooldown active until ${new Date(cooldownUntil ?? now).toISOString()}.`,
        createdAt: now,
      });
    }

    let recordedMessageId: string | undefined;
    if (effectiveMessageId) {
      const existing = await ctx.db
        .query("messages")
        .withIndex("by_thread_providerMessageId", (q) =>
          q.eq("threadId", thread._id).eq("providerMessageId", effectiveMessageId),
        )
        .first();
      if (existing) {
        recordedMessageId = existing._id;
      }
    }

    if (!recordedMessageId) {
      const messageText = (args.text || "").trim() || "[Manual outbound message]";
      const inserted = await ctx.db.insert("messages", {
        provider: messageProvider,
        threadId: thread._id,
        direction: "outbound",
        origin: "live",
        isStatus: args.isStatus ? true : undefined,
        providerMessageId: effectiveMessageId,
        whatsappMessageId: args.whatsappMessageId,
        senderJid: "me",
        text: messageText,
        messageType: args.messageType || "text",
        reactionEmoji: args.reactionEmoji,
        reactionTargetWhatsAppMessageId: args.reactionTargetWhatsAppMessageId,
        mediaAssetId: undefined,
        mediaCaption: args.mediaCaption,
        messageAt,
        createdAt: now,
      });
      recordedMessageId = inserted;
    }

    try {
      await ctx.runMutation(refStyleLearnFromOutboundEmoji, {
        threadId: thread._id,
        sendKind: toStyleEmojiSendKind(args.messageType),
        text: args.text,
        mediaCaption: args.mediaCaption,
        reactionEmoji: args.reactionEmoji,
        messageAt,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await ctx.db.insert("systemEvents", {
        source: "worker",
        eventType: "style.emoji.learn_failed",
        threadId: thread._id,
        detail: `Failed to learn outbound emoji usage: ${reason}`.slice(0, 280),
        createdAt: now,
      });
    }

    if (threadKind === "direct" && !args.isStatus && args.messageType !== "reaction") {
      try {
        await ctx.scheduler.runAfter(0, refChatRebuildThreadStyleProfile, {
          threadId: thread._id,
          lookbackMessages: 220,
        });
        await ctx.db.insert("systemEvents", {
          source: "worker",
          eventType: "style.thread.manual_rebuild_queued",
          threadId: thread._id,
          detail: "Queued thread-style refresh after manual outbound intervention.",
          createdAt: now,
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        await ctx.db.insert("systemEvents", {
          source: "worker",
          eventType: "style.thread.manual_rebuild_queue_failed",
          threadId: thread._id,
          detail: `Failed to queue thread-style refresh: ${reason}`.slice(0, 280),
          createdAt: now,
        });
      }
    }

    const pending = await ctx.db
      .query("outbox")
      .withIndex("by_thread_and_status", (q) => q.eq("threadId", thread._id).eq("status", "pending"))
      .take(60);
    const claimed = await ctx.db
      .query("outbox")
      .withIndex("by_thread_and_status", (q) => q.eq("threadId", thread._id).eq("status", "claimed"))
      .take(60);
    const activeOutbox = [...pending, ...claimed];

    let suppressedOutbox = 0;
    for (const item of activeOutbox) {
      await ctx.db.patch(item._id, {
        status: "failed",
        workerId: undefined,
        leaseExpiresAt: undefined,
        error: "Suppressed: manual reply was sent before automated send.",
        updatedAt: now,
      });
      suppressedOutbox += 1;

      const draft = await ctx.db.get(item.draftId);
      if (draft && draft.status !== "sent" && draft.status !== "rejected") {
        await ctx.db.patch(draft._id, {
          status: "rejected",
          updatedAt: now,
        });
      }

      const outreachMode = resolveClaimOutreachMode({
        outreachMode: item.outreachMode || draft?.outreachMode,
        reason: draft?.reason,
      });
      await recordAiFeedbackSignal({
        ctx,
        threadId: item.threadId,
        outboxId: item._id,
        toolRunId: item.toolRunId,
        path: resolveFeedbackPath({
          isStatusPost: item.isStatusPost,
          explicitOutreachMode: outreachMode,
          reason: draft?.reason,
        }),
        signalType: "suppressed_manual_intervention",
        score: -1,
        metadata: {
          reason: "manual_reply_preempted_automation",
          detail: "Automated outbox item suppressed after manual intervention.",
          eventType: "outbox.suppressed.manual",
          signalAt: now,
          draftId: draft?._id,
          tags: ["suppression", "manual_intervention"],
        },
      }).catch(() => undefined);

      if (item.followUpId) {
        const followUp = await ctx.db.get(item.followUpId);
        if (followUp && followUp.status !== "sent" && followUp.status !== "failed" && followUp.status !== "cancelled") {
          await ctx.db.patch(followUp._id, {
            status: "cancelled",
            updatedAt: now,
          });
        }
      }
    }

    if (suppressedOutbox > 0) {
      await ctx.db.insert("systemEvents", {
        source: "worker",
        eventType: "outbox.suppressed.manual",
        threadId: thread._id,
        detail: `Suppressed ${suppressedOutbox} active outbox item(s) after manual intervention.`,
        createdAt: now,
      });
    }

    if (!args.isStatus) {
      await ctx.scheduler.runAfter(0, internal.backlog.refreshThread, {
        threadId: thread._id,
      });
    }

    return {
      threadFound: true,
      threadId: thread._id,
      recordedMessageId,
      suppressedOutbox,
    };
  },
});

export const hydrateAiOutreach = mutation({
  args: {
    outboxId: v.id("outbox"),
    text: v.string(),
    provider: v.union(v.literal("azure"), v.literal("codex"), v.literal("heuristic")),
    confidence: v.number(),
    typingMs: v.number(),
    toolRunId: v.optional(v.string()),
    contextPack: v.optional(contextPackValidator),
  },
  handler: async (ctx, args) => {
    const outbox = await ctx.db.get(args.outboxId);
    if (!outbox) {
      return null;
    }

    const now = Date.now();
    await ctx.db.patch(outbox._id, {
      messageText: args.text,
      provider: args.provider,
      toolRunId: args.toolRunId,
      contextPack: args.contextPack ?? outbox.contextPack,
      updatedAt: now,
    });

    const draft = await ctx.db.get(outbox.draftId);
    if (draft) {
      await ctx.db.patch(draft._id, {
        text: args.text,
        provider: args.provider,
        confidence: args.confidence,
        typingMs: args.typingMs,
        toolRunId: args.toolRunId,
        contextPack: args.contextPack ?? draft.contextPack,
        updatedAt: now,
      });
    }

    await ctx.db.insert("systemEvents", {
      source: "worker",
      eventType: "outbox.aiOutreachHydrated",
      threadId: outbox.threadId,
      outboxId: outbox._id,
      detail: args.text.slice(0, 240),
      createdAt: now,
    });

    return outbox._id;
  },
});

export const hydrateAiStatus = mutation({
  args: {
    outboxId: v.id("outbox"),
    text: v.string(),
    provider: v.union(v.literal("azure"), v.literal("codex"), v.literal("heuristic")),
    confidence: v.number(),
    typingMs: v.optional(v.number()),
    toolRunId: v.optional(v.string()),
    statusFormat: v.union(v.literal("text"), v.literal("meme")),
    mediaAssetId: v.optional(v.id("mediaAssets")),
    mediaCaption: v.optional(v.string()),
    statusTrendTheme: v.optional(v.string()),
    statusDemographicHint: v.optional(v.string()),
    contextPack: v.optional(contextPackValidator),
  },
  handler: async (ctx, args) => {
    const outbox = await ctx.db.get(args.outboxId);
    if (!outbox) {
      return null;
    }

    const now = Date.now();
    const nextSendKind: "text" | "meme" = args.statusFormat === "meme" ? "meme" : "text";
    await ctx.db.patch(outbox._id, {
      messageText: args.text,
      provider: args.provider,
      toolRunId: args.toolRunId,
      sendKind: nextSendKind,
      mediaAssetId: args.statusFormat === "meme" ? args.mediaAssetId : undefined,
      mediaCaption: args.statusFormat === "meme" ? args.mediaCaption : undefined,
      statusTrendTheme: args.statusTrendTheme ?? outbox.statusTrendTheme,
      statusDemographicHint: args.statusDemographicHint ?? outbox.statusDemographicHint,
      statusFormat: args.statusFormat,
      contextPack: args.contextPack ?? outbox.contextPack,
      updatedAt: now,
    });

    const draft = await ctx.db.get(outbox.draftId);
    if (draft) {
      await ctx.db.patch(draft._id, {
        text: args.text,
        provider: args.provider,
        confidence: args.confidence,
        typingMs: args.typingMs ?? draft.typingMs,
        toolRunId: args.toolRunId,
        sendKind: nextSendKind,
        mediaAssetId: args.statusFormat === "meme" ? args.mediaAssetId : undefined,
        mediaCaption: args.statusFormat === "meme" ? args.mediaCaption : undefined,
        statusTrendTheme: args.statusTrendTheme ?? draft.statusTrendTheme,
        statusDemographicHint: args.statusDemographicHint ?? draft.statusDemographicHint,
        statusFormat: args.statusFormat,
        contextPack: args.contextPack ?? draft.contextPack,
        updatedAt: now,
      });
    }

    await ctx.db.insert("systemEvents", {
      source: "worker",
      eventType: "outbox.aiStatusHydrated",
      threadId: outbox.threadId,
      outboxId: outbox._id,
      detail: args.text.slice(0, 240),
      createdAt: now,
    });

    return outbox._id;
  },
});

export const stageStatusReview = mutation({
  args: {
    outboxId: v.id("outbox"),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const outbox = await ctx.db.get(args.outboxId);
    if (!outbox) {
      return null;
    }

    const now = Date.now();
    const reason = (args.reason?.trim() || "Auto status sampled for manual review before send.").slice(0, 280);

    await ctx.db.patch(outbox._id, {
      status: "failed",
      error: reason,
      workerId: undefined,
      leaseExpiresAt: undefined,
      updatedAt: now,
    });

    const draft = await ctx.db.get(outbox.draftId);
    if (draft && draft.status !== "sent" && draft.status !== "rejected") {
      await ctx.db.patch(draft._id, {
        status: "pending",
        updatedAt: now,
      });
    }

    await ctx.db.insert("systemEvents", {
      source: "worker",
      eventType: "status_builder.staged_manual_review",
      threadId: outbox.threadId,
      outboxId: outbox._id,
      detail: reason,
      createdAt: now,
    });

    await ctx.scheduler.runAfter(0, internal.backlog.refreshThread, {
      threadId: outbox.threadId,
    });

    return outbox._id;
  },
});

export const rewriteClaimedMessage = mutation({
  args: {
    outboxId: v.id("outbox"),
    messageText: v.string(),
    mediaCaption: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const outbox = await ctx.db.get(args.outboxId);
    if (!outbox) {
      return null;
    }

    const now = Date.now();
    const previousText = outbox.messageText;
    await ctx.db.patch(outbox._id, {
      messageText: args.messageText,
      mediaCaption: args.mediaCaption,
      updatedAt: now,
    });

    const draft = await ctx.db.get(outbox.draftId);
    if (draft) {
      await ctx.db.patch(draft._id, {
        text: args.messageText,
        updatedAt: now,
      });
    }

    if (args.messageText.trim() && args.messageText.trim() !== previousText.trim()) {
      const outreachMode = resolveClaimOutreachMode({
        outreachMode: outbox.outreachMode || draft?.outreachMode,
        reason: draft?.reason,
      });
      await recordAiFeedbackSignal({
        ctx,
        threadId: outbox.threadId,
        outboxId: outbox._id,
        toolRunId: outbox.toolRunId,
        path: resolveFeedbackPath({
          isStatusPost: outbox.isStatusPost,
          explicitOutreachMode: outreachMode,
          reason: draft?.reason,
        }),
        signalType: "manual_rewrite",
        score: -0.7,
        metadata: {
          reason: "claimed_message_rewrite",
          detail: `Manual rewrite on claimed outbox (${previousText.slice(0, 120)} -> ${args.messageText.slice(0, 120)})`,
          signalAt: now,
          draftId: draft?._id,
          tags: ["manual", "rewrite"],
        },
      }).catch(() => undefined);
    }

    return outbox._id;
  },
});

export const markSent = mutation({
  args: {
    outboxId: v.id("outbox"),
    messageProvider: v.optional(v.union(v.literal("whatsapp"), v.literal("instagram"))),
    providerMessageId: v.optional(v.string()),
    whatsappMessageId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.outboxId);
    if (!item) {
      return null;
    }

    if (item.status === "sent") {
      return item._id;
    }

    const now = Date.now();
    const messageProvider = normalizeMessageProvider(args.messageProvider || item.messageProvider);
    const effectiveMessageId = args.providerMessageId || args.whatsappMessageId;
    await ctx.db.patch(item._id, {
      status: "sent",
      updatedAt: now,
      leaseExpiresAt: undefined,
      workerId: undefined,
      error: undefined,
    });

    const draft = await ctx.db.get(item.draftId);
    const outreachMode = resolveClaimOutreachMode({
      outreachMode: item.outreachMode || draft?.outreachMode,
      reason: draft?.reason,
    });
    const sourceMessage = draft ? await ctx.db.get(draft.sourceMessageId) : null;
    if (draft) {
      await ctx.db.patch(draft._id, {
        status: "sent",
        updatedAt: now,
      });
    }

    if (item.followUpId) {
      const followUp = await ctx.db.get(item.followUpId);
      if (followUp && followUp.status === "queued") {
        await ctx.db.patch(followUp._id, {
          status: "sent",
          updatedAt: now,
        });
        await ctx.db.insert("systemEvents", {
          source: "worker",
          eventType: "followup.sent",
          threadId: item.threadId,
          outboxId: item._id,
          detail: followUp.reason.slice(0, 240),
          createdAt: now,
        });
      }
    }

    const insertedMessageId = await ctx.db.insert("messages", {
      provider: messageProvider,
      threadId: item.threadId,
      direction: "outbound",
      origin: "live",
      isStatus: item.isStatusPost || sourceMessage?.isStatus ? true : undefined,
      senderJid: "me",
      providerMessageId: effectiveMessageId,
      whatsappMessageId: args.whatsappMessageId,
      toolRunId: item.toolRunId || `outbox:${item._id}`,
      text: item.messageText,
      messageType: item.sendKind || "text",
      reactionEmoji: item.reactionEmoji,
      reactionTargetWhatsAppMessageId: item.reactionTargetWhatsAppMessageId,
      mediaAssetId: item.mediaAssetId,
      mediaCaption: item.mediaCaption,
      messageAt: now,
      createdAt: now,
    });

    await ctx.scheduler
      .runAfter(0, refConversationIntelligenceIngestMessageSignals, {
        threadId: item.threadId,
        messageId: insertedMessageId,
      })
      .catch(() => undefined);

    if (item.mediaAssetId) {
      const asset = await ctx.db.get(item.mediaAssetId);
      if (asset) {
        await ctx.db.patch(asset._id, {
          lastUsedAt: now,
          updatedAt: now,
        });
      }
    }

    if (outreachMode === "good_morning") {
      const morningState = await ctx.db
        .query("romanceMorningState")
        .withIndex("by_threadId", (q) => q.eq("threadId", item.threadId))
        .first();
      if (!morningState) {
        await ctx.db.insert("romanceMorningState", {
          threadId: item.threadId,
          lastSentAt: now,
          lastMode: undefined,
          lastPromptFingerprint: undefined,
          lastInboundAfterSendAt: undefined,
          noReplyStreak: 0,
          updatedAt: now,
        });
      } else {
        const recentMessages = await ctx.db
          .query("messages")
          .withIndex("by_thread_messageAt", (q) => q.eq("threadId", item.threadId))
          .order("desc")
          .take(140);
        const inboundAfterPreviousSend = morningState.lastSentAt
          ? recentMessages.find(
              (message) =>
                message.direction === "inbound" &&
                !message.isStatus &&
                message.messageAt > (morningState.lastSentAt || 0),
            )
          : undefined;
        const nextNoReplyStreak = morningState.lastSentAt
          ? inboundAfterPreviousSend
            ? 0
            : Math.max(0, morningState.noReplyStreak) + 1
          : 0;

        await ctx.db.patch(morningState._id, {
          lastSentAt: now,
          lastInboundAfterSendAt: inboundAfterPreviousSend?.messageAt,
          noReplyStreak: nextNoReplyStreak,
          updatedAt: now,
        });
      }
    }

    if (((item.sendKind || "text") === "text" || (item.sendKind || "text") === "voice_note") && !item.followUpId) {
      const commitment = detectFutureCommitment({
        text: item.messageText,
        direction: "outbound",
        now,
      });

      if (commitment.outcome === "actionable") {
        const duplicate = await hasRecentFollowupDuplicate(ctx, {
          threadId: item.threadId,
          normalizedKey: commitment.candidate.normalizedKey,
          dueAt: commitment.candidate.dueAt,
          now,
        });
        if (duplicate) {
          await ctx.db.insert("systemEvents", {
            source: "worker",
            eventType: "followup.detected.duplicate_skipped",
            threadId: item.threadId,
            outboxId: item._id,
            detail: `${commitment.candidate.reason} [key=${commitment.candidate.normalizedKey}]`,
            createdAt: now,
          });
        } else {
          const followupJudge = judgeActualFollowupCandidate({
            text: item.messageText,
            candidate: commitment.candidate,
            now,
          });
          if (followupJudge.decision === "reject") {
            await ctx.db.insert("systemEvents", {
              source: "worker",
              eventType: "followup.detected.judge_rejected",
              threadId: item.threadId,
              outboxId: item._id,
              detail: `${followupJudge.reasonCode} · ${commitment.candidate.reason}`.slice(0, 240),
              createdAt: now,
            });
          } else {
            const judgedConfidence = clamp01(commitment.candidate.confidence * followupJudge.confidenceScale);
            await ctx.db.insert("followUps", {
              threadId: item.threadId,
              sourceMessageId: insertedMessageId,
              reason: commitment.candidate.reason,
              draftText:
                commitment.candidate.kind === "plan"
                  ? "Quick check-in on the plan we agreed."
                  : "Quick reminder from my earlier promise.",
              dueAt: commitment.candidate.dueAt,
              kind: commitment.candidate.kind,
              direction: commitment.candidate.direction,
              confidence: judgedConfidence,
              normalizedKey: commitment.candidate.normalizedKey,
              sourceSnippet: commitment.candidate.sourceSnippet,
              status: "suggested",
              createdAt: now,
              updatedAt: now,
            });
            await ctx.db.insert("systemEvents", {
              source: "worker",
              eventType: "followup.detected",
              threadId: item.threadId,
              outboxId: item._id,
              detail: `${commitment.candidate.reason} [${Math.round(judgedConfidence * 100)}%]`,
              createdAt: now,
            });
          }
        }
      } else if (commitment.outcome === "non_actionable") {
        await ctx.db.insert("systemEvents", {
          source: "worker",
          eventType: "followup.detected.non_actionable",
          threadId: item.threadId,
          outboxId: item._id,
          detail: `${commitment.reason} · ${commitment.sourceSnippet}`.slice(0, 240),
          createdAt: now,
        });
      }

      const todo = detectTodoCandidate({
        text: item.messageText,
        direction: "outbound",
        now,
        contextText: sourceMessage?.direction === "inbound" ? sourceMessage.text : undefined,
      });
      if (todo) {
        const todoJudge = judgeActualTodoCandidate({
          sourceText: item.messageText,
          contextText: sourceMessage?.direction === "inbound" ? sourceMessage.text : undefined,
          candidate: todo,
        });
        if (todoJudge.decision === "reject") {
          await ctx.db.insert("systemEvents", {
            source: "worker",
            eventType: "todo.detected.judge_rejected",
            threadId: item.threadId,
            outboxId: item._id,
            detail: `${todoJudge.reasonCode} · ${todo.title}`.slice(0, 240),
            createdAt: now,
          });
        } else {
          await ctx.db.insert("todoCandidates", {
            threadId: item.threadId,
            sourceMessageId: insertedMessageId,
            title: todoJudge.title,
            suggestedDueAt: todoJudge.suggestedDueAt,
            status: "suggested",
            createdAt: now,
            updatedAt: now,
          });
          await ctx.db.insert("systemEvents", {
            source: "worker",
            eventType: "todo.detected",
            threadId: item.threadId,
            outboxId: item._id,
            detail: todoJudge.title.slice(0, 240),
            createdAt: now,
          });
        }
      }
    }

    if (
      ((item.sendKind || "text") === "reaction" ||
        (item.sendKind || "text") === "text" ||
        (item.sendKind || "text") === "voice_note") &&
      (item.reactionTargetProviderMessageId || item.reactionTargetWhatsAppMessageId) &&
      item.reactionEmoji
    ) {
      const reactionTargetProviderMessageId = item.reactionTargetProviderMessageId || item.reactionTargetWhatsAppMessageId;
      const targetMessage = await ctx.db
        .query("messages")
        .withIndex("by_thread_providerMessageId", (q) =>
          q.eq("threadId", item.threadId).eq("providerMessageId", reactionTargetProviderMessageId),
        )
        .first();

      if (targetMessage) {
        const existingReaction = await ctx.db
          .query("messageReactions")
          .withIndex("by_messageId_and_actorJid", (q) => q.eq("messageId", targetMessage._id).eq("actorJid", "me"))
          .first();

        if (existingReaction) {
          await ctx.db.patch(existingReaction._id, {
            emoji: item.reactionEmoji,
            direction: "outbound",
            provider: messageProvider,
            providerMessageId: effectiveMessageId,
            whatsappMessageId: args.whatsappMessageId,
            updatedAt: now,
          });
        } else {
          await ctx.db.insert("messageReactions", {
            provider: messageProvider,
            threadId: item.threadId,
            messageId: targetMessage._id,
            actorJid: "me",
            direction: "outbound",
            emoji: item.reactionEmoji,
            providerMessageId: effectiveMessageId,
            whatsappMessageId: args.whatsappMessageId,
            createdAt: now,
            updatedAt: now,
          });
        }
      }
    }

    await ctx.db.insert("systemEvents", {
      source: "worker",
      eventType: "outbox.sent",
      threadId: item.threadId,
      outboxId: item._id,
      detail: item.messageText.slice(0, 240),
      createdAt: now,
    });

    await ctx.scheduler
      .runAfter(NEUTRAL_EVALUATION_HORIZON_MS, internal.aiFeedback.evaluateNoReplySignal, {
        outboxId: item._id,
        sentAt: now,
      })
      .catch(() => undefined);

    await ctx.scheduler.runAfter(0, internal.backlog.refreshThread, {
      threadId: item.threadId,
    });

    return item._id;
  },
});

export const markFailed = mutation({
  args: {
    outboxId: v.id("outbox"),
    error: v.string(),
    forceFinal: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.outboxId);
    if (!item) {
      return null;
    }

    const now = Date.now();
    const retryClass = classifyRetryError(args.error);
    const permanentFailure = retryClass === "permanent";
    const exhausted = Boolean(args.forceFinal) || permanentFailure || item.attempts >= DEFAULT_RETRY_LIMIT;
    const retryDelayMs = exhausted ? 0 : computeRetryDelayMs({ attempts: item.attempts, outboxId: String(item._id), error: args.error });

    await ctx.db.patch(item._id, {
      status: exhausted ? "failed" : "pending",
      error: args.error,
      updatedAt: now,
      leaseExpiresAt: undefined,
      workerId: undefined,
      sendAt: exhausted ? item.sendAt : now + retryDelayMs,
    });

    if (item.followUpId && exhausted) {
      const followUp = await ctx.db.get(item.followUpId);
      if (followUp && followUp.status === "queued") {
        await ctx.db.patch(followUp._id, {
          status: "failed",
          updatedAt: now,
        });
        await ctx.db.insert("systemEvents", {
          source: "worker",
          eventType: "followup.failed",
          threadId: item.threadId,
          outboxId: item._id,
          detail: args.error.slice(0, 240),
          createdAt: now,
        });
      }
    }

    await ctx.db.insert("systemEvents", {
      source: "worker",
      eventType: exhausted ? "outbox.failed.final" : "outbox.failed.retry",
      threadId: item.threadId,
      outboxId: item._id,
      detail: `${args.error.slice(0, 320)} [retryClass=${retryClass}; delayMs=${retryDelayMs}]`,
      createdAt: now,
    });

    await ctx.scheduler.runAfter(0, internal.backlog.refreshThread, {
      threadId: item.threadId,
    });

    return item._id;
  },
});

export const deferClaimed = mutation({
  args: {
    outboxId: v.id("outbox"),
    sendAt: v.number(),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.outboxId);
    if (!item) {
      return null;
    }
    const now = Date.now();
    const nextSendAt = Math.max(now + 1_000, Math.round(args.sendAt));
    await ctx.db.patch(item._id, {
      status: "pending",
      sendAt: nextSendAt,
      leaseExpiresAt: undefined,
      workerId: undefined,
      updatedAt: now,
      error: args.reason.slice(0, 300),
    });
    await ctx.db.insert("systemEvents", {
      source: "worker",
      eventType: "outbox.deferred.time_window",
      threadId: item.threadId,
      outboxId: item._id,
      detail: `${args.reason.slice(0, 220)}; nextSendAt=${new Date(nextSendAt).toISOString()}`,
      createdAt: now,
    });
    return item._id;
  },
});

export const recoverExpiredClaims = internalMutation({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const limit = Math.min(args.limit ?? 100, 250);
    const expiredClaims = await ctx.db
      .query("outbox")
      .withIndex("by_status_leaseExpiresAt", (q) => q.eq("status", "claimed").lte("leaseExpiresAt", now))
      .take(limit);

    for (const item of expiredClaims) {
      await ctx.db.patch(item._id, {
        status: "pending",
        workerId: undefined,
        leaseExpiresAt: undefined,
        sendAt: Math.min(item.sendAt, now),
        updatedAt: now,
      });
    }

    if (expiredClaims.length > 0) {
      await ctx.db.insert("systemEvents", {
        source: "convex",
        eventType: "outbox.recoveredExpiredClaims",
        detail: `Recovered ${expiredClaims.length} stuck outbox items.`,
        createdAt: now,
      });
    }

    return {
      recovered: expiredClaims.length,
    };
  },
});
