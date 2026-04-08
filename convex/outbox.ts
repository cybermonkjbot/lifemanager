import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, mutation, query } from "./_generated/server";
import { detectFutureCommitment, hasRecentFollowupDuplicate } from "./lib/commitments";
import { DEFAULT_LEASE_MS, DEFAULT_RETRY_LIMIT } from "./lib/constants";
import { getConfig } from "./lib/config";
import {
  countUnansweredOutboundStreak,
  latestInboundMessageAt,
  MAX_UNANSWERED_OUTBOUND_STREAK,
  resolveLongSilenceReopenWeeks,
  shouldAllowLongSilenceConversationStarter,
} from "./lib/outboundGuard";
import {
  classifyThreadKind,
  eligibilityReasonLabel,
  resolveThreadEligibility,
} from "./lib/threadEligibility";

const UNANSWERED_OUTBOUND_RECHECK_MS = 5 * 60 * 1000;
const UNANSWERED_OUTBOUND_SCAN_LIMIT = 25;

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

export const claimDue = mutation({
  args: {
    workerId: v.string(),
    limit: v.optional(v.number()),
    leaseMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const leaseMs = args.leaseMs ?? DEFAULT_LEASE_MS;
    const max = Math.min(args.limit ?? 5, 20);
    const config = await getConfig(ctx);

    const expiredClaims = await ctx.db
      .query("outbox")
      .withIndex("by_status_leaseExpiresAt", (q) => q.eq("status", "claimed").lte("leaseExpiresAt", now))
      .take(max);

    for (const item of expiredClaims) {
      await ctx.db.patch(item._id, {
        status: "pending",
        workerId: undefined,
        leaseExpiresAt: undefined,
        sendAt: Math.min(item.sendAt, now),
        updatedAt: now,
      });
    }

    const due = await ctx.db
      .query("outbox")
      .withIndex("by_status_sendAt", (q) => q.eq("status", "pending").lte("sendAt", now))
      .take(max);

    const claimed = [] as Array<{
      outboxId: string;
      threadId: string;
      draftId: string;
      toolRunId?: string;
      messageText: string;
      typingMs: number;
      jid: string;
      idempotencyKey: string;
      provider: "azure" | "codex" | "heuristic";
      sendKind: "text" | "reaction" | "sticker" | "meme";
      reactionEmoji?: string;
      reactionTargetWhatsAppMessageId?: string;
      preReactionEmoji?: string;
      mediaAssetId?: string;
      mediaCaption?: string;
      replyTargetWhatsAppMessageId?: string;
      replyTargetSenderJid?: string;
      replyTargetText?: string;
      replyTargetMessageAt?: number;
    }>;
    const unansweredOutboundStateByThread = new Map<
      string,
      {
        unansweredStreak: number;
        latestInboundAt?: number;
      }
    >();

    for (const item of due) {
      const draft = await ctx.db.get(item.draftId);
      const thread = await ctx.db.get(item.threadId);
      if (!draft || !thread) {
        continue;
      }
      const threadKind = thread.threadKind || classifyThreadKind({ jid: thread.jid, isGroupHint: thread.isGroup });
      const sourceMessage = await ctx.db.get(draft.sourceMessageId);
      const shouldQuoteSource = sourceMessage?.direction === "inbound";

      let deferUntil = 0;
      const deferReasons: string[] = [];
      const nowHour = new Date(now).getHours();
      if (config.quietHoursEnabled && isWithinQuietHours(nowHour, config.quietHoursStartHour, config.quietHoursEndHour)) {
        deferUntil = Math.max(deferUntil, nextAllowedAfterQuietHours(now, config.quietHoursStartHour, config.quietHoursEndHour));
        deferReasons.push("quiet-hours");
      }

      const windowMs = Math.max(5, config.sendRateWindowMinutes) * 60 * 1000;
      const cutoff = now - windowMs;

      const recentThread = await ctx.db
        .query("messages")
        .withIndex("by_thread_messageAt", (q) => q.eq("threadId", thread._id).gte("messageAt", cutoff))
        .order("desc")
        .take(Math.min(config.sendMaxPerThreadInWindow + 5, 120));
      const recentThreadOutbound = recentThread.filter((message) => message.direction === "outbound");
      if (recentThreadOutbound.length >= config.sendMaxPerThreadInWindow) {
        const oldestThreadWindow = Math.min(...recentThreadOutbound.slice(0, config.sendMaxPerThreadInWindow).map((message) => message.messageAt));
        deferUntil = Math.max(deferUntil, oldestThreadWindow + windowMs + 1_000);
        deferReasons.push("thread-rate-limit");
      }

      const recentGlobal = await ctx.db
        .query("messages")
        .withIndex("by_createdAt", (q) => q.gte("createdAt", cutoff))
        .order("desc")
        .take(Math.min(config.sendMaxGlobalInWindow + 80, 800));
      const recentGlobalOutbound = recentGlobal.filter((message) => message.direction === "outbound" && message.messageAt >= cutoff);
      if (recentGlobalOutbound.length >= config.sendMaxGlobalInWindow) {
        const oldestGlobalWindow = Math.min(...recentGlobalOutbound.slice(0, config.sendMaxGlobalInWindow).map((message) => message.messageAt));
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
          isConversationStarter: Boolean(draft.reason?.startsWith("Proactive check-in outreach")),
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

      const explicitIgnore = await ctx.db
        .query("ignoreRules")
        .withIndex("by_target", (q) =>
          q.eq("targetType", threadKind === "group" ? "group" : "contact").eq("targetValue", thread.jid),
        )
        .first();
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
        nowMs: now,
      });
      if (!eligibility.allowed) {
        if (eligibility.reason === "temporary_ghost") {
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

      claimed.push({
        outboxId: item._id,
        threadId: item.threadId,
        draftId: item.draftId,
        toolRunId: item.toolRunId,
        messageText: item.messageText,
        typingMs: draft.typingMs,
        jid: thread.jid,
        idempotencyKey: item.idempotencyKey,
        provider: item.provider,
        sendKind: item.sendKind || "text",
        reactionEmoji: item.reactionEmoji,
        reactionTargetWhatsAppMessageId: item.reactionTargetWhatsAppMessageId,
        preReactionEmoji: item.preReactionEmoji,
        mediaAssetId: item.mediaAssetId,
        mediaCaption: item.mediaCaption,
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

    return {
      canSend: true,
    };
  },
});

export const suppressForManualIntervention = mutation({
  args: {
    threadJid: v.string(),
    whatsappMessageId: v.optional(v.string()),
    text: v.optional(v.string()),
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
    mediaCaption: v.optional(v.string()),
    messageAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const config = await getConfig(ctx);
    const messageAt = normalizeTimestampMs(args.messageAt, now);
    const thread = await ctx.db
      .query("threads")
      .withIndex("by_jid", (q) => q.eq("jid", args.threadJid))
      .first();

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
    if (args.whatsappMessageId) {
      const existing = await ctx.db
        .query("messages")
        .withIndex("by_thread_whatsappMessageId", (q) =>
          q.eq("threadId", thread._id).eq("whatsappMessageId", args.whatsappMessageId),
        )
        .first();
      if (existing) {
        recordedMessageId = existing._id;
      }
    }

    if (!recordedMessageId) {
      const messageText = (args.text || "").trim() || "[Manual outbound message]";
      const inserted = await ctx.db.insert("messages", {
        threadId: thread._id,
        direction: "outbound",
        origin: "live",
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
      if (item.createdAt > messageAt + 5_000) {
        continue;
      }

      await ctx.db.patch(item._id, {
        status: "failed",
        workerId: undefined,
        leaseExpiresAt: undefined,
        error: "Suppressed: manual WhatsApp reply was sent before automated send.",
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

    return outbox._id;
  },
});

export const markSent = mutation({
  args: {
    outboxId: v.id("outbox"),
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
    await ctx.db.patch(item._id, {
      status: "sent",
      updatedAt: now,
      leaseExpiresAt: undefined,
      workerId: undefined,
      error: undefined,
    });

    const draft = await ctx.db.get(item.draftId);
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
      threadId: item.threadId,
      direction: "outbound",
      origin: "live",
      senderJid: "me",
      whatsappMessageId: args.whatsappMessageId,
      toolRunId: item.toolRunId,
      text: item.messageText,
      messageType: item.sendKind || "text",
      reactionEmoji: item.reactionEmoji,
      reactionTargetWhatsAppMessageId: item.reactionTargetWhatsAppMessageId,
      mediaAssetId: item.mediaAssetId,
      mediaCaption: item.mediaCaption,
      messageAt: now,
      createdAt: now,
    });

    if (item.mediaAssetId) {
      const asset = await ctx.db.get(item.mediaAssetId);
      if (asset) {
        await ctx.db.patch(asset._id, {
          lastUsedAt: now,
          updatedAt: now,
        });
      }
    }

    if ((item.sendKind || "text") === "text" && !item.followUpId) {
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
            threadId: item.threadId,
            outboxId: item._id,
            detail: `${commitment.candidate.reason} [${Math.round(commitment.candidate.confidence * 100)}%]`,
            createdAt: now,
          });
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
    }

    if (
      ((item.sendKind || "text") === "reaction" || (item.sendKind || "text") === "text") &&
      item.reactionTargetWhatsAppMessageId &&
      item.reactionEmoji
    ) {
      const targetMessage = await ctx.db
        .query("messages")
        .withIndex("by_thread_whatsappMessageId", (q) =>
          q.eq("threadId", item.threadId).eq("whatsappMessageId", item.reactionTargetWhatsAppMessageId),
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
            whatsappMessageId: args.whatsappMessageId,
            updatedAt: now,
          });
        } else {
          await ctx.db.insert("messageReactions", {
            threadId: item.threadId,
            messageId: targetMessage._id,
            actorJid: "me",
            direction: "outbound",
            emoji: item.reactionEmoji,
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
    const exhausted = Boolean(args.forceFinal) || item.attempts >= DEFAULT_RETRY_LIMIT;

    await ctx.db.patch(item._id, {
      status: exhausted ? "failed" : "pending",
      error: args.error,
      updatedAt: now,
      leaseExpiresAt: undefined,
      workerId: undefined,
      sendAt: exhausted ? item.sendAt : now + Math.min(item.attempts * 15_000, 120_000),
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
      detail: args.error.slice(0, 400),
      createdAt: now,
    });

    await ctx.scheduler.runAfter(0, internal.backlog.refreshThread, {
      threadId: item.threadId,
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
