import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { mutation } from "./_generated/server";
import { getConfig } from "./lib/config";
import { detectPromiseOrPlan, detectTodoCandidate } from "./lib/heuristics";
import {
  classifyThreadKind,
  eligibilityReasonLabel,
  resolveThreadEligibility,
} from "./lib/threadEligibility";

const INBOUND_STALE_GRACE_MS = 2 * 60 * 1000;
const GHOST_MODE_DURATION_MS = 30 * 60 * 1000;
const GHOST_ACTIVITY_WINDOW_MS = 18 * 60 * 1000;
const GHOST_ACTIVITY_WINDOW_MESSAGE_LIMIT = 36;
const GHOST_ACTIVITY_MIN_TOTAL_MESSAGES = 7;
const GHOST_ACTIVITY_MIN_INBOUND_MESSAGES = 3;
const GHOST_ACTIVITY_MIN_OUTBOUND_MESSAGES = 3;
const GHOST_ACTIVITY_MIN_TURNS = 4;
const GHOST_TRIGGER_PROBABILITY = 0.2;

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

export function extractAliasesFromText(text: string) {
  const aliases: string[] = [];
  const patterns = [/\b(?:call me|i(?:'|’)m|im|it(?:'|’)s|its)\s+([a-z][a-z0-9_-]{1,24})\b/gi];
  for (const pattern of patterns) {
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      const alias = match[1]?.trim();
      if (alias) {
        aliases.push(alias);
      }
    }
  }
  return aliases;
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

async function updateAutoAliases(args: {
  ctx: MutationCtx;
  threadId: Id<"threads">;
  senderTitle?: string;
  text: string;
}) {
  const titleAlias = args.senderTitle?.trim().split(/\s+/).find(Boolean);
  const extracted = extractAliasesFromText(args.text);
  const candidates = [...new Set([titleAlias, ...extracted].filter(Boolean).map((item) => (item || "").slice(0, 50)))];

  if (candidates.length === 0) {
    return;
  }

  const existing = await args.ctx.db
    .query("threadGrounding")
    .withIndex("by_threadId", (q) => q.eq("threadId", args.threadId))
    .first();

  const mergedAliases = [...new Set([...(existing?.autoAliases || []), ...candidates])].slice(0, 20);
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
    threadJid: v.string(),
    senderJid: v.string(),
    senderTitle: v.optional(v.string()),
    text: v.string(),
    messageType: v.optional(v.union(v.literal("text"), v.literal("reaction"), v.literal("sticker"), v.literal("meme"))),
    reactionEmoji: v.optional(v.string()),
    reactionTargetWhatsAppMessageId: v.optional(v.string()),
    mediaAssetId: v.optional(v.id("mediaAssets")),
    mediaCaption: v.optional(v.string()),
    isGroup: v.boolean(),
    threadKind: v.optional(v.union(v.literal("direct"), v.literal("group"), v.literal("broadcast_or_system"))),
    isArchived: v.optional(v.boolean()),
    archivedAt: v.optional(v.number()),
    whatsappMessageId: v.optional(v.string()),
    messageAt: v.optional(v.number()),
    skipDraftGeneration: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const messageAt = normalizeTimestampMs(args.messageAt, now);
    const messageType = args.messageType || "text";
    const normalizedText = args.text.trim();

    let thread = await ctx.db
      .query("threads")
      .withIndex("by_jid", (q) => q.eq("jid", args.threadJid))
      .first();

    const config = await getConfig(ctx);
    const inputThreadKind = args.threadKind || classifyThreadKind({ jid: args.threadJid, isGroupHint: args.isGroup });
    const shouldIgnoreGroup = inputThreadKind === "group" && config.ignoreGroupsByDefault;
    const normalizedArchivedAt = normalizeTimestampMs(args.archivedAt, messageAt);

    if (!thread) {
      const threadId = await ctx.db.insert("threads", {
        jid: args.threadJid,
        title: args.senderTitle,
        isGroup: inputThreadKind === "group",
        isIgnored: shouldIgnoreGroup,
        threadKind: inputThreadKind,
        isArchived: args.isArchived || false,
        archivedAt: args.isArchived ? normalizedArchivedAt : undefined,
        ghostedUntil: undefined,
        lastMessageAt: messageAt,
        createdAt: now,
        updatedAt: now,
      });

      thread = await ctx.db.get(threadId);
      if (!thread) {
        throw new Error("Unable to create thread");
      }
    } else {
      await ctx.db.patch(thread._id, {
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
        lastMessageAt: Math.max(thread.lastMessageAt, messageAt),
        updatedAt: now,
      });
    }

    const threadKind = args.threadKind || thread.threadKind || inputThreadKind;
    const isArchived = args.isArchived === undefined ? thread.isArchived || false : args.isArchived;

    let ghostedUntil = thread.ghostedUntil;
    if ((ghostedUntil || 0) <= now) {
      ghostedUntil = undefined;
    }

    const explicitIgnore = await ctx.db
      .query("ignoreRules")
      .withIndex("by_target", (q) =>
        q.eq("targetType", threadKind === "group" ? "group" : "contact").eq("targetValue", args.threadJid),
      )
      .first();

    if (args.whatsappMessageId) {
      const existing = await ctx.db
        .query("messages")
        .withIndex("by_thread_whatsappMessageId", (q) =>
          q.eq("threadId", thread._id).eq("whatsappMessageId", args.whatsappMessageId),
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
        };
      }
    }

    const recentWindowMessages = await ctx.db
      .query("messages")
      .withIndex("by_thread_messageAt", (q) =>
        q.eq("threadId", thread._id).gte("messageAt", now - GHOST_ACTIVITY_WINDOW_MS),
      )
      .order("desc")
      .take(GHOST_ACTIVITY_WINDOW_MESSAGE_LIMIT);

    const latestMessage = recentWindowMessages[0];
    const stale = Boolean(latestMessage && messageAt + INBOUND_STALE_GRACE_MS < latestMessage.messageAt);

    const eligibleForGhostStart =
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
      nowMs: now,
    });
    const ignored = !eligibility.allowed;

    let reactionTargetMessageId: Id<"messages"> | undefined;
    if (messageType === "reaction" && args.reactionTargetWhatsAppMessageId) {
      const targetMessage = await ctx.db
        .query("messages")
        .withIndex("by_thread_whatsappMessageId", (q) =>
          q.eq("threadId", thread._id).eq("whatsappMessageId", args.reactionTargetWhatsAppMessageId),
        )
        .first();
      reactionTargetMessageId = targetMessage?._id;
    }

    const messageId = await ctx.db.insert("messages", {
      threadId: thread._id,
      direction: "inbound",
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
          whatsappMessageId: args.whatsappMessageId,
          updatedAt: now,
        });
      } else {
        await ctx.db.insert("messageReactions", {
          threadId: thread._id,
          messageId: reactionTargetMessageId,
          actorJid,
          direction: "inbound",
          emoji,
          whatsappMessageId: args.whatsappMessageId,
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    if (messageType === "text") {
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
        messageType === "reaction"
          ? "inbound.reaction"
          : stale
            ? "inbound.stale"
            : ignored
              ? "inbound.ignored"
              : "inbound.received",
      threadId: thread._id,
      detail:
        ignored && !eligibility.allowed
          ? `${eligibility.reason}: ${eligibilityReasonLabel(eligibility.reason)}`
          : (normalizedText || args.reactionEmoji || "[Non-text inbound]").slice(0, 300),
      createdAt: now,
    });

    let promiseDetected = false;
    let todoDetected = false;

    if (!stale && messageType === "text") {
      const promise = detectPromiseOrPlan(normalizedText);
      if (promise) {
        promiseDetected = true;
        await ctx.db.insert("followUps", {
          threadId: thread._id,
          sourceMessageId: messageId,
          reason: promise.reason,
          draftText: "Following up on this so we stay aligned.",
          dueAt: promise.dueAt,
          status: "suggested",
          createdAt: now,
          updatedAt: now,
        });
      }

      const todo = detectTodoCandidate(normalizedText);
      if (todo) {
        todoDetected = true;
        await ctx.db.insert("todoCandidates", {
          threadId: thread._id,
          sourceMessageId: messageId,
          title: todo.title,
          suggestedDueAt: todo.suggestedDueAt,
          status: "suggested",
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    if (!ignored && !stale && messageType !== "reaction" && !args.skipDraftGeneration) {
      await ctx.scheduler.runAfter(0, internal.draft.generate, {
        threadId: thread._id,
        sourceMessageId: messageId,
      });
    }

    if (!stale) {
      await ctx.scheduler.runAfter(0, internal.memory.summarize, {
        threadId: thread._id,
      });
    }

    await ctx.scheduler.runAfter(0, internal.backlog.refreshThread, {
      threadId: thread._id,
    });

    return {
      threadId: thread._id,
      messageId,
      ignored,
      blockedReason: eligibility.allowed ? undefined : eligibility.reason,
      duplicate: false,
      stale,
      messageType,
      reactionTargetMessageId,
      promiseDetected,
      todoDetected,
    };
  },
});
