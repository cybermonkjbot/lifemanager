import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { mutation } from "./_generated/server";
import { detectFutureCommitment, hasRecentFollowupDuplicate } from "./lib/commitments";
import { getConfig } from "./lib/config";
import {
  classifyThreadKind,
  directIgnoreContactKey,
  directIgnoreRuleCandidates,
  eligibilityReasonLabel,
  resolveThreadEligibility,
} from "./lib/threadEligibility";
import type { EligibilityReason } from "./lib/threadEligibility";

const INBOUND_STALE_GRACE_MS = 2 * 60 * 1000;
const GHOST_MODE_DURATION_MS = 30 * 60 * 1000;
const GHOST_ACTIVITY_WINDOW_MS = 18 * 60 * 1000;
const GHOST_ACTIVITY_WINDOW_MESSAGE_LIMIT = 36;
const GHOST_ACTIVITY_MIN_TOTAL_MESSAGES = 7;
const GHOST_ACTIVITY_MIN_INBOUND_MESSAGES = 3;
const GHOST_ACTIVITY_MIN_OUTBOUND_MESSAGES = 3;
const GHOST_ACTIVITY_MIN_TURNS = 4;
const GHOST_TRIGGER_PROBABILITY = 0.2;
const IGNORE_CONTACT_FALLBACK_SCAN_LIMIT = 1000;
type IngestMode = "live" | "history_sync" | "history_fetch";
type InboundMessageType = "text" | "reaction" | "sticker" | "meme" | "image" | "video" | "audio" | "document";
type MessageProvider = "whatsapp" | "instagram";

type IngestHistoricalResult = {
  threadId: Id<"threads">;
  messageId: Id<"messages">;
  duplicate: boolean;
  ingestMode?: IngestMode;
  ignored?: boolean;
  blockedReason?: string;
  stale?: boolean;
  messageType?: InboundMessageType;
  reactionTargetMessageId?: Id<"messages">;
  promiseDetected?: boolean;
  todoDetected?: boolean;
  nightPausedUntil?: number;
  callReplyBarrierAt?: number;
  callReplyBarrierBlocked?: boolean;
};

function normalizeTimestampMs(raw: number | undefined, fallbackMs: number) {
  if (!Number.isFinite(raw) || (raw ?? 0) <= 0) {
    return fallbackMs;
  }
  const value = Number(raw);
  if (value < 10_000_000_000) {
    return value * 1000;
  }
  return value;
}

function normalizeProvider(provider?: MessageProvider): MessageProvider {
  return provider === "instagram" ? "instagram" : "whatsapp";
}

const ALIAS_TOKEN_PATTERN = /^[a-z][a-z0-9_-]{1,24}$/i;
const NON_NAME_ALIAS_TOKENS = new Set([
  "a",
  "an",
  "and",
  "better",
  "confused",
  "easy",
  "easier",
  "expected",
  "fair",
  "fine",
  "going",
  "good",
  "great",
  "heading",
  "hard",
  "its",
  "it",
  "just",
  "lost",
  "me",
  "nothing",
  "okay",
  "ok",
  "perfect",
  "safe",
  "the",
  "this",
]);

function sanitizeExtractedAliasToken(value: string | undefined) {
  const trimmed = (value || "").trim();
  if (!trimmed) {
    return null;
  }
  const normalized = trimmed.toLowerCase();
  if (!ALIAS_TOKEN_PATTERN.test(trimmed) || NON_NAME_ALIAS_TOKENS.has(normalized)) {
    return null;
  }
  return trimmed;
}

function normalizeAliasForStorage(value: string | undefined) {
  const trimmed = (value || "").trim();
  if (!trimmed) {
    return null;
  }
  const normalized = trimmed.toLowerCase();
  if (ALIAS_TOKEN_PATTERN.test(trimmed) && NON_NAME_ALIAS_TOKENS.has(normalized)) {
    return null;
  }
  return trimmed.slice(0, 50);
}

function dedupeAliases(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const value of values) {
    const alias = normalizeAliasForStorage(value || undefined);
    if (!alias) {
      continue;
    }
    const key = alias.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(alias);
    if (deduped.length >= 20) {
      break;
    }
  }
  return deduped;
}

export function extractAliasesFromText(text: string) {
  const matchesWithPosition: Array<{ alias: string; index: number }> = [];
  const patterns = [
    /\b(?:call me|my name is)\s+([a-z][a-z0-9_-]{1,24})\b/gi,
    /(?:^|[.!?]\s*|\b(?:hey|hi|hello|yo)\s*[!,]?\s*)(?:i(?:'|’)m|im|i am|this is|it(?:'|’)s|its)\s+([a-z][a-z0-9_-]{1,24})(?=\s*(?:[,.!?]|$))/gi,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const alias = sanitizeExtractedAliasToken(match[1]);
      if (alias) {
        matchesWithPosition.push({ alias, index: match.index ?? Number.MAX_SAFE_INTEGER });
      }
    }
  }
  matchesWithPosition.sort((left, right) => left.index - right.index);
  return dedupeAliases(matchesWithPosition.map((entry) => entry.alias));
}

export function hasGoodActiveChattingWindow(
  messages: Array<Pick<Doc<"messages">, "direction" | "messageAt">>,
) {
  if (messages.length < GHOST_ACTIVITY_MIN_TOTAL_MESSAGES) {
    return false;
  }

  let inbound = 0;
  let outbound = 0;
  let turns = 0;

  for (let index = 0; index < messages.length; index += 1) {
    const current = messages[index];
    if (current.direction === "inbound") {
      inbound += 1;
    } else {
      outbound += 1;
    }

    if (index > 0 && messages[index - 1].direction !== current.direction) {
      turns += 1;
    }
  }

  return (
    inbound >= GHOST_ACTIVITY_MIN_INBOUND_MESSAGES &&
    outbound >= GHOST_ACTIVITY_MIN_OUTBOUND_MESSAGES &&
    turns >= GHOST_ACTIVITY_MIN_TURNS
  );
}

export function shouldEnterGhostMode(args: {
  messages: Array<Pick<Doc<"messages">, "direction" | "messageAt">>;
  randomValue?: number;
}) {
  if (!hasGoodActiveChattingWindow(args.messages)) {
    return false;
  }

  const roll = args.randomValue ?? Math.random();
  return roll < GHOST_TRIGGER_PROBABILITY;
}

export function shouldResetRomanceMorningNoReplyState(args: {
  state: Pick<Doc<"romanceMorningState">, "lastSentAt" | "lastInboundAfterSendAt" | "noReplyStreak"> | null;
  inboundMessageAt: number;
}) {
  if (!args.state?.lastSentAt) {
    return false;
  }
  if (args.inboundMessageAt <= args.state.lastSentAt) {
    return false;
  }
  if ((args.state.lastInboundAfterSendAt || 0) >= args.inboundMessageAt && args.state.noReplyStreak === 0) {
    return false;
  }
  return true;
}

export function shouldScheduleDraftGeneration(args: {
  isHistoryIngest: boolean;
  blockedReason?: EligibilityReason;
  stale: boolean;
  isStatusMessage: boolean;
  messageType: InboundMessageType;
  callReplyBarrierBlocked: boolean;
  skipDraftGeneration?: boolean;
}) {
  if (args.isHistoryIngest || args.stale || args.isStatusMessage) {
    return false;
  }
  if (args.messageType === "reaction") {
    return false;
  }
  if (args.callReplyBarrierBlocked || args.skipDraftGeneration) {
    return false;
  }
  if (args.blockedReason && args.blockedReason !== "temporary_ghost") {
    return false;
  }
  return true;
}

async function resetRomanceMorningNoReplyState(args: {
  ctx: MutationCtx;
  threadId: Id<"threads">;
  inboundMessageAt: number;
  now: number;
}) {
  const state = await args.ctx.db
    .query("romanceMorningState")
    .withIndex("by_threadId", (q) => q.eq("threadId", args.threadId))
    .first();
  if (!state) {
    return false;
  }
  if (
    !shouldResetRomanceMorningNoReplyState({
      state,
      inboundMessageAt: args.inboundMessageAt,
    })
  ) {
    return false;
  }

  await args.ctx.db.patch(state._id, {
    lastInboundAfterSendAt: Math.max(state.lastInboundAfterSendAt || 0, args.inboundMessageAt),
    noReplyStreak: 0,
    updatedAt: args.now,
  });
  return true;
}

async function updateAutoAliases(args: {
  ctx: MutationCtx;
  threadId: Id<"threads">;
  senderTitle?: string;
  text: string;
}) {
  const titleAlias = sanitizeExtractedAliasToken(args.senderTitle?.trim().split(/\s+/).find(Boolean));
  const extracted = extractAliasesFromText(args.text);
  const candidates = dedupeAliases([titleAlias, ...extracted]);

  if (candidates.length === 0) {
    return;
  }

  const existing = await args.ctx.db
    .query("threadGrounding")
    .withIndex("by_threadId", (q) => q.eq("threadId", args.threadId))
    .first();

  const mergedAliases = dedupeAliases([...(existing?.autoAliases || []), ...candidates]);
  const now = Date.now();
  if (existing) {
    await args.ctx.db.patch(existing._id, {
      autoAliases: mergedAliases,
      updatedAt: now,
    });
    return;
  }

  await args.ctx.db.insert("threadGrounding", {
    threadId: args.threadId,
    myName: undefined,
    theirName: undefined,
    autoAliases: mergedAliases,
    vibeNotes: undefined,
    createdAt: now,
    updatedAt: now,
  });
}

export const ingest = mutation({
  args: {
    provider: v.optional(v.union(v.literal("whatsapp"), v.literal("instagram"))),
    threadJid: v.string(),
    senderJid: v.string(),
    senderTitle: v.optional(v.string()),
    text: v.string(),
    messageType: v.optional(
      v.union(
        v.literal("text"),
        v.literal("reaction"),
        v.literal("sticker"),
        v.literal("meme"),
        v.literal("image"),
        v.literal("video"),
        v.literal("audio"),
        v.literal("document"),
      ),
    ),
    reactionEmoji: v.optional(v.string()),
    reactionTargetWhatsAppMessageId: v.optional(v.string()),
    mediaAssetId: v.optional(v.id("mediaAssets")),
    mediaCaption: v.optional(v.string()),
    isStatus: v.optional(v.boolean()),
    isGroup: v.boolean(),
    threadKind: v.optional(v.union(v.literal("direct"), v.literal("group"), v.literal("broadcast_or_system"))),
    isArchived: v.optional(v.boolean()),
    archivedAt: v.optional(v.number()),
    providerMessageId: v.optional(v.string()),
    whatsappMessageId: v.optional(v.string()),
    messageAt: v.optional(v.number()),
    skipDraftGeneration: v.optional(v.boolean()),
    ingestMode: v.optional(v.union(v.literal("live"), v.literal("history_sync"), v.literal("history_fetch"))),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const messageProvider = normalizeProvider(args.provider);
    const ingestMode: IngestMode = args.ingestMode || "live";
    const isHistoryIngest = ingestMode !== "live";
    const isStatusMessage = args.isStatus === true;
    const messageAt = normalizeTimestampMs(args.messageAt, now);
    const messageType = args.messageType || "text";
    const normalizedText = args.text.trim();

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

    const config = await getConfig(ctx);
    const inputThreadKind =
      args.threadKind || classifyThreadKind({ jid: args.threadJid, isGroupHint: args.isGroup, provider: messageProvider });
    const shouldIgnoreGroup = inputThreadKind === "group" && config.ignoreGroupsByDefault;
    const normalizedArchivedAt = normalizeTimestampMs(args.archivedAt, messageAt);

    if (!thread) {
      const threadId = await ctx.db.insert("threads", {
        provider: messageProvider,
        jid: args.threadJid,
        title: args.senderTitle,
        isGroup: inputThreadKind === "group",
        isIgnored: shouldIgnoreGroup,
        threadKind: inputThreadKind,
        isArchived: args.isArchived || false,
        archivedAt: args.isArchived ? normalizedArchivedAt : undefined,
        ghostedUntil: undefined,
        callReplyBarrierAt: undefined,
        lastMessageAt: isStatusMessage ? 0 : messageAt,
        createdAt: now,
        updatedAt: now,
      });

      thread = await ctx.db.get(threadId);
      if (!thread) {
        throw new Error("Unable to create thread");
      }
    } else {
      await ctx.db.patch(thread._id, {
        provider: thread.provider || messageProvider,
        title: args.senderTitle ?? thread.title,
        isGroup: inputThreadKind === "group",
        threadKind: inputThreadKind,
        isArchived: args.isArchived === undefined ? thread.isArchived : args.isArchived,
        archivedAt:
          args.isArchived === undefined
            ? thread.archivedAt
            : args.isArchived
              ? normalizedArchivedAt
              : undefined,
        lastMessageAt: isStatusMessage ? thread.lastMessageAt : Math.max(thread.lastMessageAt, messageAt),
        updatedAt: now,
      });
    }

    const threadKind = args.threadKind || thread.threadKind || inputThreadKind;
    const isArchived = args.isArchived === undefined ? thread.isArchived || false : args.isArchived;

    let ghostedUntil = thread.ghostedUntil;
    if ((ghostedUntil || 0) <= now) {
      ghostedUntil = undefined;
    }
    let nightPausedUntil = thread.nightPausedUntil;
    if ((nightPausedUntil || 0) <= now) {
      nightPausedUntil = undefined;
    }
    let callReplyBarrierAt = thread.callReplyBarrierAt;
    if ((callReplyBarrierAt || 0) <= 0) {
      callReplyBarrierAt = undefined;
    }
    let callReplyBarrierBlocked = false;

    let explicitIgnore =
      threadKind === "group"
        ? await ctx.db
            .query("ignoreRules")
            .withIndex("by_target", (q) => q.eq("targetType", "group").eq("targetValue", args.threadJid))
            .first()
        : null;

    if (!explicitIgnore && threadKind === "direct") {
      for (const candidateJid of directIgnoreRuleCandidates({ jid: args.threadJid, provider: messageProvider })) {
        explicitIgnore = await ctx.db
          .query("ignoreRules")
          .withIndex("by_target", (q) => q.eq("targetType", "contact").eq("targetValue", candidateJid))
          .first();
        if (explicitIgnore) {
          break;
        }
      }
    }

    if (!explicitIgnore && threadKind === "direct") {
      const lookupKey = directIgnoreContactKey({ jid: args.threadJid, provider: messageProvider });
      if (lookupKey) {
        const contactRules = await ctx.db
          .query("ignoreRules")
          .withIndex("by_type", (q) => q.eq("targetType", "contact"))
          .take(IGNORE_CONTACT_FALLBACK_SCAN_LIMIT);
        explicitIgnore =
          contactRules.find(
            (rule) =>
              directIgnoreContactKey({
                jid: rule.targetValue,
                provider: messageProvider,
              }) === lookupKey,
          ) || null;
      }
    }

    const effectiveMessageId = args.providerMessageId || args.whatsappMessageId;
    if (effectiveMessageId) {
      const existing = await ctx.db
        .query("messages")
        .withIndex("by_thread_providerMessageId", (q) =>
          q.eq("threadId", thread._id).eq("providerMessageId", effectiveMessageId),
        )
        .first();

      if (existing) {
        await ctx.db.insert("systemEvents", {
          source: "worker",
          eventType: "inbound.duplicate",
          threadId: thread._id,
          detail: (normalizedText || args.reactionEmoji || "[Non-text inbound]").slice(0, 300),
          createdAt: now,
        });

        return {
          threadId: thread._id,
          messageId: existing._id,
          ignored: true,
          duplicate: true,
          stale: false,
          promiseDetected: false,
          todoDetected: false,
          nightPausedUntil,
          callReplyBarrierAt,
          callReplyBarrierBlocked,
        };
      }
    }

    const recentWindowMessages = isHistoryIngest
      ? []
      : await ctx.db
          .query("messages")
          .withIndex("by_thread_messageAt", (q) =>
            q.eq("threadId", thread._id).gte("messageAt", now - GHOST_ACTIVITY_WINDOW_MS),
          )
          .order("desc")
          .take(GHOST_ACTIVITY_WINDOW_MESSAGE_LIMIT);

    const latestMessage = recentWindowMessages[0];
    const stale = isHistoryIngest ? false : Boolean(latestMessage && messageAt + INBOUND_STALE_GRACE_MS < latestMessage.messageAt);

    const shouldEvaluateCallBarrier =
      !isHistoryIngest &&
      threadKind === "direct" &&
      !isStatusMessage &&
      messageType !== "reaction" &&
      !stale;
    if (shouldEvaluateCallBarrier && (callReplyBarrierAt || 0) > 0) {
      if (messageAt > (callReplyBarrierAt || 0)) {
        callReplyBarrierAt = undefined;
        await ctx.db.patch(thread._id, {
          callReplyBarrierAt: undefined,
          updatedAt: now,
        });
        await ctx.db.insert("systemEvents", {
          source: "worker",
          eventType: "thread.call.reply_barrier.cleared",
          threadId: thread._id,
          detail: "Post-call inbound received; call reply barrier cleared.",
          createdAt: now,
        });
      } else {
        callReplyBarrierBlocked = true;
      }
    }

    const eligibleForGhostStart =
      !isHistoryIngest &&
      threadKind === "direct" &&
      !isArchived &&
      !stale &&
      !ghostedUntil &&
      messageType !== "reaction";
    if (
      eligibleForGhostStart &&
      shouldEnterGhostMode({
        messages: [...recentWindowMessages].reverse(),
      })
    ) {
      ghostedUntil = now + GHOST_MODE_DURATION_MS;
      await ctx.db.patch(thread._id, {
        ghostedUntil,
        updatedAt: now,
      });
      await ctx.db.insert("systemEvents", {
        source: "worker",
        eventType: "thread.ghost_mode.started",
        threadId: thread._id,
        detail: `Auto-replies paused until ${new Date(ghostedUntil).toISOString()} after active back-and-forth.`,
        createdAt: now,
      });
    }

    const eligibility = resolveThreadEligibility({
      thread: {
        jid: thread.jid,
        isIgnored: thread.isIgnored,
        isArchived,
        threadKind,
        ghostedUntil,
      },
      ignoreGroupsByDefault: config.ignoreGroupsByDefault,
      explicitIgnoreEnabled: Boolean(explicitIgnore?.enabled),
      groupRuleEnabled: threadKind === "group" ? explicitIgnore?.enabled : undefined,
      nowMs: now,
    });
    const blockedReason = eligibility.allowed ? undefined : eligibility.reason;
    const ignored = isHistoryIngest ? false : Boolean(blockedReason);

    let reactionTargetMessageId: Id<"messages"> | undefined;
    const reactionTargetProviderMessageId = args.reactionTargetWhatsAppMessageId;
    if (messageType === "reaction" && reactionTargetProviderMessageId) {
      const targetMessage = await ctx.db
        .query("messages")
        .withIndex("by_thread_providerMessageId", (q) =>
          q.eq("threadId", thread._id).eq("providerMessageId", reactionTargetProviderMessageId),
        )
        .first();
      reactionTargetMessageId = targetMessage?._id;
    }

    const messageId = await ctx.db.insert("messages", {
      provider: messageProvider,
      threadId: thread._id,
      direction: "inbound",
      origin: ingestMode,
      isStatus: args.isStatus ? true : undefined,
      providerMessageId: effectiveMessageId,
      whatsappMessageId: args.whatsappMessageId,
      senderJid: args.senderJid,
      text: normalizedText,
      messageType,
      reactionEmoji: args.reactionEmoji,
      reactionTargetWhatsAppMessageId: args.reactionTargetWhatsAppMessageId,
      mediaAssetId: args.mediaAssetId,
      mediaCaption: args.mediaCaption,
      messageAt,
      createdAt: now,
    });

    if (!isStatusMessage) {
      await resetRomanceMorningNoReplyState({
        ctx,
        threadId: thread._id,
        inboundMessageAt: messageAt,
        now,
      });
    }

    if (messageType === "reaction" && reactionTargetMessageId) {
      const actorJid = args.senderJid;
      const existingReaction = await ctx.db
        .query("messageReactions")
        .withIndex("by_messageId_and_actorJid", (q) => q.eq("messageId", reactionTargetMessageId).eq("actorJid", actorJid))
        .first();

      const emoji = args.reactionEmoji?.trim() || "";
      if (!emoji) {
        if (existingReaction) {
          await ctx.db.delete(existingReaction._id);
        }
      } else if (existingReaction) {
        await ctx.db.patch(existingReaction._id, {
          emoji,
          direction: "inbound",
          provider: messageProvider,
          providerMessageId: effectiveMessageId,
          whatsappMessageId: args.whatsappMessageId,
          updatedAt: now,
        });
      } else {
        await ctx.db.insert("messageReactions", {
          provider: messageProvider,
          threadId: thread._id,
          messageId: reactionTargetMessageId,
          actorJid,
          direction: "inbound",
          emoji,
          providerMessageId: effectiveMessageId,
          whatsappMessageId: args.whatsappMessageId,
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    if (!isHistoryIngest && !isStatusMessage && messageType === "text") {
      await updateAutoAliases({
        ctx,
        threadId: thread._id,
        senderTitle: args.senderTitle,
        text: normalizedText,
      });
    }

    await ctx.db.insert("systemEvents", {
      source: "worker",
      eventType:
        isHistoryIngest
          ? ingestMode === "history_fetch"
            ? "inbound.history_fetch.received"
            : "inbound.history_sync.received"
          : callReplyBarrierBlocked
            ? "inbound.call_reply_barrier.skipped"
          : messageType === "reaction"
            ? "inbound.reaction"
            : stale
              ? "inbound.stale"
              : ignored
                ? "inbound.ignored"
                : "inbound.received",
      threadId: thread._id,
      detail:
        !isHistoryIngest && ignored && !eligibility.allowed
          ? `${eligibility.reason}: ${eligibilityReasonLabel(eligibility.reason)}`
          : (normalizedText || args.reactionEmoji || "[Non-text inbound]").slice(0, 300),
      createdAt: now,
    });

    let promiseDetected = false;
    const todoDetected = false;

    if (!isHistoryIngest && !stale && !isStatusMessage && messageType === "text") {
      const commitment = detectFutureCommitment({
        text: normalizedText,
        direction: "inbound",
        now,
      });
      if (commitment.outcome === "actionable") {
        const duplicate = await hasRecentFollowupDuplicate(ctx, {
          threadId: thread._id,
          normalizedKey: commitment.candidate.normalizedKey,
          dueAt: commitment.candidate.dueAt,
          now,
        });

        if (duplicate) {
          await ctx.db.insert("systemEvents", {
            source: "worker",
            eventType: "followup.detected.duplicate_skipped",
            threadId: thread._id,
            detail: `${commitment.candidate.reason} [key=${commitment.candidate.normalizedKey}]`,
            createdAt: now,
          });
        } else {
          promiseDetected = true;
          await ctx.db.insert("followUps", {
            threadId: thread._id,
            sourceMessageId: messageId,
            reason: commitment.candidate.reason,
            draftText:
              commitment.candidate.kind === "request"
                ? "Checking back on your request from earlier."
                : commitment.candidate.kind === "plan"
                  ? "Following up on the plan we discussed."
                  : "Following up on what I promised earlier.",
            dueAt: commitment.candidate.dueAt,
            kind: commitment.candidate.kind,
            direction: commitment.candidate.direction,
            confidence: commitment.candidate.confidence,
            normalizedKey: commitment.candidate.normalizedKey,
            sourceSnippet: commitment.candidate.sourceSnippet,
            status: "suggested",
            createdAt: now,
            updatedAt: now,
          });
          await ctx.db.insert("systemEvents", {
            source: "worker",
            eventType: "followup.detected",
            threadId: thread._id,
            detail: `${commitment.candidate.reason} [${Math.round(commitment.candidate.confidence * 100)}%]`,
            createdAt: now,
          });
        }
      } else if (commitment.outcome === "non_actionable") {
        await ctx.db.insert("systemEvents", {
          source: "worker",
          eventType: "followup.detected.non_actionable",
          threadId: thread._id,
          detail: `${commitment.reason} · ${commitment.sourceSnippet}`.slice(0, 240),
          createdAt: now,
        });
      }

    }

    if (
      shouldScheduleDraftGeneration({
        isHistoryIngest,
        blockedReason,
        stale,
        isStatusMessage,
        messageType,
        callReplyBarrierBlocked,
        skipDraftGeneration: args.skipDraftGeneration,
      })
    ) {
      await ctx.scheduler.runAfter(0, internal.draft.generate, {
        threadId: thread._id,
        sourceMessageId: messageId,
      });
    }

    if (!isHistoryIngest && !stale && !isStatusMessage) {
      await ctx.scheduler.runAfter(0, internal.memory.summarize, {
        threadId: thread._id,
      });
    }

    if (!isHistoryIngest && !isStatusMessage) {
      await ctx.scheduler.runAfter(0, internal.backlog.refreshThread, {
        threadId: thread._id,
      });
    }

    return {
      threadId: thread._id,
      messageId,
      ignored,
      blockedReason,
      duplicate: false,
      stale,
      messageType,
      reactionTargetMessageId,
      promiseDetected,
      todoDetected,
      ingestMode,
      nightPausedUntil,
      callReplyBarrierAt,
      callReplyBarrierBlocked,
    };
  },
});

export const ingestHistorical = mutation({
  args: {
    provider: v.optional(v.union(v.literal("whatsapp"), v.literal("instagram"))),
    ingestMode: v.union(v.literal("history_sync"), v.literal("history_fetch")),
    direction: v.union(v.literal("inbound"), v.literal("outbound")),
    threadJid: v.string(),
    senderJid: v.string(),
    senderTitle: v.optional(v.string()),
    text: v.string(),
    messageType: v.optional(
      v.union(
        v.literal("text"),
        v.literal("reaction"),
        v.literal("sticker"),
        v.literal("meme"),
        v.literal("image"),
        v.literal("video"),
        v.literal("audio"),
        v.literal("document"),
      ),
    ),
    reactionEmoji: v.optional(v.string()),
    reactionTargetWhatsAppMessageId: v.optional(v.string()),
    mediaAssetId: v.optional(v.id("mediaAssets")),
    mediaCaption: v.optional(v.string()),
    isStatus: v.optional(v.boolean()),
    isGroup: v.boolean(),
    threadKind: v.optional(v.union(v.literal("direct"), v.literal("group"), v.literal("broadcast_or_system"))),
    isArchived: v.optional(v.boolean()),
    archivedAt: v.optional(v.number()),
    providerMessageId: v.optional(v.string()),
    whatsappMessageId: v.optional(v.string()),
    messageAt: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<IngestHistoricalResult> => {
    const now = Date.now();
    const messageProvider = normalizeProvider(args.provider);
    const isStatusMessage = args.isStatus === true;
    const messageAt = normalizeTimestampMs(args.messageAt, now);
    const threadKind =
      args.threadKind || classifyThreadKind({ jid: args.threadJid, isGroupHint: args.isGroup, provider: messageProvider });
    const normalizedArchivedAt = normalizeTimestampMs(args.archivedAt, messageAt);
    const normalizedText = args.text.trim() || (args.direction === "outbound" ? "[Historical outbound message]" : "[Historical inbound message]");
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
      const config = await getConfig(ctx);
      const threadId = await ctx.db.insert("threads", {
        provider: messageProvider,
        jid: args.threadJid,
        title: args.senderTitle,
        isGroup: threadKind === "group",
        isIgnored: threadKind === "group" ? config.ignoreGroupsByDefault : false,
        threadKind,
        isArchived: args.isArchived || false,
        archivedAt: args.isArchived ? normalizedArchivedAt : undefined,
        ghostedUntil: undefined,
        callReplyBarrierAt: undefined,
        lastMessageAt: isStatusMessage ? 0 : messageAt,
        createdAt: now,
        updatedAt: now,
      });
      thread = await ctx.db.get(threadId);
      if (!thread) {
        throw new Error("Unable to create thread");
      }
    } else {
      await ctx.db.patch(thread._id, {
        provider: thread.provider || messageProvider,
        title: args.senderTitle ?? thread.title,
        isGroup: threadKind === "group",
        threadKind,
        isArchived: args.isArchived === undefined ? thread.isArchived : args.isArchived,
        archivedAt:
          args.isArchived === undefined
            ? thread.archivedAt
            : args.isArchived
              ? normalizedArchivedAt
              : undefined,
        lastMessageAt: isStatusMessage ? thread.lastMessageAt : Math.max(thread.lastMessageAt, messageAt),
        updatedAt: now,
      });
    }

    const effectiveMessageId = args.providerMessageId || args.whatsappMessageId;
    if (effectiveMessageId) {
      const existing = await ctx.db
        .query("messages")
        .withIndex("by_thread_providerMessageId", (q) =>
          q.eq("threadId", thread._id).eq("providerMessageId", effectiveMessageId),
        )
        .first();
      if (existing) {
        return {
          threadId: thread._id,
          messageId: existing._id,
          duplicate: true,
          ingestMode: args.ingestMode,
        };
      }
    }

    const messageId = await ctx.db.insert("messages", {
      provider: messageProvider,
      threadId: thread._id,
      direction: args.direction,
      origin: args.ingestMode,
      isStatus: args.isStatus ? true : undefined,
      providerMessageId: effectiveMessageId,
      whatsappMessageId: args.whatsappMessageId,
      senderJid: args.senderJid,
      text: normalizedText,
      messageType: args.messageType || "text",
      reactionEmoji: args.reactionEmoji,
      reactionTargetWhatsAppMessageId: args.reactionTargetWhatsAppMessageId,
      mediaAssetId: args.mediaAssetId,
      mediaCaption: args.mediaCaption,
      messageAt,
      createdAt: now,
    });

    if (args.direction === "inbound" && !isStatusMessage) {
      await resetRomanceMorningNoReplyState({
        ctx,
        threadId: thread._id,
        inboundMessageAt: messageAt,
        now,
      });
    }

    await ctx.db.insert("systemEvents", {
      source: "worker",
      eventType:
        args.direction === "outbound"
          ? args.ingestMode === "history_fetch"
            ? "outbound.history_fetch.received"
            : "outbound.history_sync.received"
          : args.ingestMode === "history_fetch"
            ? "inbound.history_fetch.received"
            : "inbound.history_sync.received",
      threadId: thread._id,
      detail: normalizedText.slice(0, 300),
      createdAt: now,
    });

    return {
      threadId: thread._id,
      messageId,
      duplicate: false,
      ingestMode: args.ingestMode,
    };
  },
});

export const attachMediaAsset = mutation({
  args: {
    messageId: v.id("messages"),
    mediaAssetId: v.id("mediaAssets"),
  },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.messageId);
    if (!message) {
      return null;
    }
    if (message.mediaAssetId) {
      return message.mediaAssetId;
    }

    await ctx.db.patch(message._id, {
      mediaAssetId: args.mediaAssetId,
    });
    return args.mediaAssetId;
  },
});
