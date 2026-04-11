import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, mutation, query, type MutationCtx } from "./_generated/server";
import { getConfig } from "./lib/config";
import { classifyThreadKind } from "./lib/threadEligibility";
import { GOOD_MORNING_OUTREACH_REASON_PREFIX, isConversationStarterReason } from "./lib/outreachModes";
import { estimateHumanTiming } from "./lib/heuristics";
import { buildRomancePromptFingerprint, isWithinHourWindow, selectRomanceMorningMode, stableHash } from "../shared/romance-morning";

const AI_OUTREACH_PLACEHOLDER = "__SLM_AI_OUTREACH__";
const MAX_SIGNAL_ROWS = 360;
const MAX_RECENT_DRAFTS = 60;
const MAX_RECENT_MESSAGES = 140;
const MAX_TARGET_THREADS = 180;

type RomanceMorningMode = "lead" | "warm";

function resolveLocalDayStart(now: number) {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function isDirectWhatsAppThread(thread: Pick<Doc<"threads">, "provider" | "jid" | "isGroup" | "threadKind">) {
  const provider = thread.provider || "whatsapp";
  if (provider !== "whatsapp") {
    return false;
  }
  const kind = thread.threadKind || classifyThreadKind({ jid: thread.jid, isGroupHint: thread.isGroup, provider });
  return kind === "direct";
}

export function mergeUniqueThreadIds(groups: string[][]) {
  const merged = new Set<string>();
  for (const group of groups) {
    for (const id of group) {
      const normalized = id.trim();
      if (!normalized) {
        continue;
      }
      merged.add(normalized);
    }
  }
  return [...merged];
}

export function hasQueuedMorningDraftToday(
  drafts: Array<Pick<Doc<"replyDrafts">, "reason" | "createdAt">>,
  dayStartMs: number,
) {
  return countQueuedMorningDraftsToday(drafts, dayStartMs) > 0;
}

export function countQueuedMorningDraftsToday(
  drafts: Array<Pick<Doc<"replyDrafts">, "reason" | "createdAt">>,
  dayStartMs: number,
) {
  let count = 0;
  for (const draft of drafts) {
    if (!draft.reason || draft.createdAt < dayStartMs) {
      continue;
    }
    if (draft.reason.startsWith(GOOD_MORNING_OUTREACH_REASON_PREFIX)) {
      count += 1;
    }
  }
  return count;
}

export function hasReachedMorningDraftLimit(
  drafts: Array<Pick<Doc<"replyDrafts">, "reason" | "createdAt">>,
  dayStartMs: number,
  maxPerThreadPerDay: number,
) {
  const max = Math.max(1, Math.round(maxPerThreadPerDay || 1));
  return countQueuedMorningDraftsToday(drafts, dayStartMs) >= max;
}

export function hasPendingOrClaimedOutbox(
  outboxItems: Array<Pick<Doc<"outbox">, "status">>,
) {
  return outboxItems.some((item) => item.status === "pending" || item.status === "claimed");
}

export function hasConversationStarterCollision(
  drafts: Array<Pick<Doc<"replyDrafts">, "reason" | "createdAt">>,
  now: number,
  cooldownMs: number,
) {
  return drafts.some((draft) => {
    if (!draft.reason) {
      return false;
    }
    if (!isConversationStarterReason(draft.reason)) {
      return false;
    }
    return draft.createdAt >= now - cooldownMs;
  });
}

async function getThreadByJid(ctx: MutationCtx, jid: string) {
  const directProviderMatch = await ctx.db
    .query("threads")
    .withIndex("by_provider_and_jid", (q) => q.eq("provider", "whatsapp").eq("jid", jid))
    .first();
  if (directProviderMatch) {
    return directProviderMatch;
  }
  return await ctx.db
    .query("threads")
    .withIndex("by_jid", (q) => q.eq("jid", jid))
    .first();
}

async function getRomanceState(ctx: MutationCtx, threadId: Id<"threads">) {
  return await ctx.db
    .query("romanceMorningState")
    .withIndex("by_threadId", (q) => q.eq("threadId", threadId))
    .first();
}

async function syncNoReplyState(
  ctx: MutationCtx,
  threadId: Id<"threads">,
  state: Doc<"romanceMorningState"> | null,
  now: number,
) {
  if (!state?.lastSentAt) {
    return state;
  }

  const recentMessages = await ctx.db
    .query("messages")
    .withIndex("by_thread_messageAt", (q) => q.eq("threadId", threadId))
    .order("desc")
    .take(MAX_RECENT_MESSAGES);
  const inboundAfterLastSend = recentMessages.find(
    (message) => message.direction === "inbound" && !message.isStatus && message.messageAt > (state.lastSentAt || 0),
  );
  const inboundAt = inboundAfterLastSend?.messageAt;
  const nextNoReplyStreak = inboundAt ? 0 : state.noReplyStreak;
  if (
    state.lastInboundAfterSendAt === inboundAt &&
    state.noReplyStreak === nextNoReplyStreak
  ) {
    return state;
  }

  await ctx.db.patch(state._id, {
    lastInboundAfterSendAt: inboundAt,
    noReplyStreak: nextNoReplyStreak,
    updatedAt: now,
  });

  return {
    ...state,
    lastInboundAfterSendAt: inboundAt,
    noReplyStreak: nextNoReplyStreak,
    updatedAt: now,
  };
}

function resolveGoodMorningHint(args: {
  mode: RomanceMorningMode;
  firstName: string;
  variant: number;
}) {
  if (args.mode === "lead") {
    if (args.variant === 0) {
      return `Good morning ${args.firstName}, let us lock one sweet plan for today.`;
    }
    if (args.variant === 1) {
      return `Morning ${args.firstName}, pick one thing we should do together later.`;
    }
    return `Good morning ${args.firstName}, I want to lead today with something thoughtful for us.`;
  }

  if (args.variant === 0) {
    return `Good morning ${args.firstName}, just checking in with warmth and calm energy.`;
  }
  if (args.variant === 1) {
    return `Morning ${args.firstName}, soft affection and genuine check-in vibes only.`;
  }
  return `Good morning ${args.firstName}, sweet and simple affection with one gentle nudge.`;
}

function firstNameFromThread(thread: Pick<Doc<"threads">, "title" | "jid">) {
  const title = thread.title?.trim();
  if (title) {
    return title.split(/\s+/)[0] || title;
  }
  return thread.jid.replace(/@s\.whatsapp\.net$/i, "").slice(0, 18) || "there";
}

export const getThreadState = query({
  args: {
    threadId: v.id("threads"),
  },
  handler: async (ctx, args) => {
    const state = await ctx.db
      .query("romanceMorningState")
      .withIndex("by_threadId", (q) => q.eq("threadId", args.threadId))
      .first();
    if (!state) {
      return null;
    }
    return {
      threadId: state.threadId,
      lastSentAt: state.lastSentAt,
      lastMode: state.lastMode,
      lastPromptFingerprint: state.lastPromptFingerprint,
      lastInboundAfterSendAt: state.lastInboundAfterSendAt,
      noReplyStreak: state.noReplyStreak,
      updatedAt: state.updatedAt,
    };
  },
});

export const recordHydration = mutation({
  args: {
    threadId: v.id("threads"),
    mode: v.union(v.literal("lead"), v.literal("warm")),
    promptFingerprint: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await getRomanceState(ctx, args.threadId);
    if (!existing) {
      await ctx.db.insert("romanceMorningState", {
        threadId: args.threadId,
        lastSentAt: undefined,
        lastMode: args.mode,
        lastPromptFingerprint: args.promptFingerprint.trim() || undefined,
        lastInboundAfterSendAt: undefined,
        noReplyStreak: 0,
        updatedAt: now,
      });
      return args.threadId;
    }

    await ctx.db.patch(existing._id, {
      lastMode: args.mode,
      lastPromptFingerprint: args.promptFingerprint.trim() || existing.lastPromptFingerprint,
      updatedAt: now,
    });
    return args.threadId;
  },
});

export const run = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const config = await getConfig(ctx);
    const nowHour = new Date(now).getHours();

    if (!config.romanticMorningEnabled) {
      return { queued: 0, considered: 0, reason: "disabled" as const };
    }

    if (!isWithinHourWindow(nowHour, config.romanticMorningStartHour, config.romanticMorningEndHour)) {
      return { queued: 0, considered: 0, reason: "outside_window" as const };
    }

    const cooldownMs = Math.max(60 * 60 * 1000, config.romanticMorningCollisionCooldownHours * 60 * 60 * 1000);
    const dayStart = resolveLocalDayStart(now);
    const romanticPartnerJids = [...new Set(config.romanticPartnerJids.map((jid) => jid.trim().toLowerCase()).filter(Boolean))];

    const listThreadIds: string[] = [];
    for (const jid of romanticPartnerJids) {
      const thread = await getThreadByJid(ctx, jid);
      if (!thread) {
        continue;
      }
      listThreadIds.push(String(thread._id));
    }

    const romanticBacklogThreadIds = (
      await Promise.all([
        ctx.db
          .query("backlogThreadState")
          .withIndex("by_relationship_and_updatedAt", (q) => q.eq("relationship", "girlfriend"))
          .order("desc")
          .take(MAX_SIGNAL_ROWS),
        ctx.db
          .query("backlogThreadState")
          .withIndex("by_relationship_and_updatedAt", (q) => q.eq("relationship", "relationship"))
          .order("desc")
          .take(MAX_SIGNAL_ROWS),
      ])
    )
      .flat()
      .map((row) => String(row.threadId));

    const romanticProfileThreadIds = (
      await Promise.all([
        ctx.db
          .query("threadPersonalitySettings")
          .withIndex("by_profileSlug", (q) => q.eq("profileSlug", "girlfriend"))
          .take(MAX_SIGNAL_ROWS),
        ctx.db
          .query("threadPersonalitySettings")
          .withIndex("by_profileSlug", (q) => q.eq("profileSlug", "relationship"))
          .take(MAX_SIGNAL_ROWS),
      ])
    )
      .flat()
      .map((row) => String(row.threadId));

    const candidateThreadIds = mergeUniqueThreadIds([
      listThreadIds,
      romanticBacklogThreadIds,
      romanticProfileThreadIds,
    ]).slice(0, MAX_TARGET_THREADS);

    const summary = {
      queued: 0,
      considered: 0,
      skippedOutsideWindow: 0,
      skippedThreadState: 0,
      skippedPendingOutbox: 0,
      skippedMorningAlreadyQueued: 0,
      skippedConversationStarterCollision: 0,
      skippedPushinessCooldown: 0,
    };

    for (const threadIdRaw of candidateThreadIds) {
      const threadId = threadIdRaw as Id<"threads">;
      const thread = await ctx.db.get(threadId);
      if (!thread || !isDirectWhatsAppThread(thread) || thread.isIgnored || thread.isArchived) {
        summary.skippedThreadState += 1;
        continue;
      }
      summary.considered += 1;

      const [pending, claimed] = await Promise.all([
        ctx.db
          .query("outbox")
          .withIndex("by_thread_and_status", (q) => q.eq("threadId", threadId).eq("status", "pending"))
          .first(),
        ctx.db
          .query("outbox")
          .withIndex("by_thread_and_status", (q) => q.eq("threadId", threadId).eq("status", "claimed"))
          .first(),
      ]);
      if (hasPendingOrClaimedOutbox([pending, claimed].filter((item): item is Doc<"outbox"> => Boolean(item)))) {
        summary.skippedPendingOutbox += 1;
        continue;
      }

      const recentDrafts = await ctx.db
        .query("replyDrafts")
        .withIndex("by_thread", (q) => q.eq("threadId", threadId))
        .order("desc")
        .take(MAX_RECENT_DRAFTS);

      if (
        hasReachedMorningDraftLimit(
          recentDrafts,
          dayStart,
          config.romanticMorningMaxPerThreadPerDay,
        )
      ) {
        summary.skippedMorningAlreadyQueued += 1;
        continue;
      }

      if (hasConversationStarterCollision(recentDrafts, now, cooldownMs)) {
        summary.skippedConversationStarterCollision += 1;
        continue;
      }

      let romanceState = await getRomanceState(ctx, threadId);
      romanceState = await syncNoReplyState(ctx, threadId, romanceState, now);
      const noReplyStreak = romanceState?.noReplyStreak || 0;
      if (
        noReplyStreak >= 2 &&
        romanceState?.lastSentAt &&
        now - romanceState.lastSentAt < Math.max(cooldownMs, 24 * 60 * 60 * 1000)
      ) {
        summary.skippedPushinessCooldown += 1;
        continue;
      }

      const latestMessage = await ctx.db
        .query("messages")
        .withIndex("by_thread_messageAt", (q) => q.eq("threadId", threadId))
        .order("desc")
        .first();
      if (!latestMessage) {
        summary.skippedThreadState += 1;
        continue;
      }

      const dayBucket = `${new Date(dayStart).toISOString().slice(0, 10)}`;
      const mode = selectRomanceMorningMode({
        seed: `${threadId}|${dayBucket}|${summary.considered}`,
        leadRatio: config.romanticMorningLeadRatio,
        lastMode: romanceState?.lastMode,
        noReplyStreak,
      });
      let variant = stableHash(`${threadId}|${dayBucket}|${mode}`) % 3;
      let promptFingerprint = buildRomancePromptFingerprint({
        threadId,
        mode,
        variant,
        dayBucket,
      });
      if (
        romanceState?.lastPromptFingerprint &&
        romanceState.lastPromptFingerprint === promptFingerprint
      ) {
        variant = (variant + 1) % 3;
        promptFingerprint = buildRomancePromptFingerprint({
          threadId,
          mode,
          variant,
          dayBucket,
        });
      }

      const firstName = firstNameFromThread(thread);
      const hintText = resolveGoodMorningHint({
        mode,
        firstName,
        variant,
      });
      const timing = estimateHumanTiming(hintText);
      const messageProvider = thread.provider || "whatsapp";

      const draftId = await ctx.db.insert("replyDrafts", {
        messageProvider,
        threadId,
        sourceMessageId: latestMessage._id,
        text: AI_OUTREACH_PLACEHOLDER,
        sendKind: "text",
        status: "approved",
        confidence: config.aiFallbackConfidence,
        provider: "heuristic",
        delayMs: timing.delayMs,
        typingMs: timing.typingMs,
        reason: `${GOOD_MORNING_OUTREACH_REASON_PREFIX} (AI pending): mode=${mode}; variant=${variant}; hint=${hintText.slice(0, 160)}`,
        createdAt: now,
        updatedAt: now,
      });

      const outboxId = await ctx.db.insert("outbox", {
        messageProvider,
        threadId,
        draftId,
        messageText: AI_OUTREACH_PLACEHOLDER,
        sendKind: "text",
        sendAt: now + timing.delayMs,
        status: "pending",
        attempts: 0,
        idempotencyKey: `romance-morning-${threadId}-${dayBucket}`,
        provider: "heuristic",
        createdAt: now,
        updatedAt: now,
      });

      if (!romanceState) {
        await ctx.db.insert("romanceMorningState", {
          threadId,
          lastSentAt: undefined,
          lastMode: mode,
          lastPromptFingerprint: promptFingerprint,
          lastInboundAfterSendAt: undefined,
          noReplyStreak,
          updatedAt: now,
        });
      } else {
        await ctx.db.patch(romanceState._id, {
          lastMode: mode,
          lastPromptFingerprint: promptFingerprint,
          noReplyStreak,
          updatedAt: now,
        });
      }

      await ctx.db.insert("systemEvents", {
        source: "convex",
        eventType: "romance_morning.queued",
        threadId,
        outboxId,
        detail: `mode=${mode}; variant=${variant}; noReplyStreak=${noReplyStreak}; hint=${hintText.slice(0, 140)}`,
        createdAt: now,
      });
      summary.queued += 1;
    }

    await ctx.db.insert("systemEvents", {
      source: "convex",
      eventType: "romance_morning.batch",
      detail: `queued=${summary.queued}; considered=${summary.considered}; pending=${summary.skippedPendingOutbox}; queued_today=${summary.skippedMorningAlreadyQueued}; collision=${summary.skippedConversationStarterCollision}; pushiness=${summary.skippedPushinessCooldown}; invalid=${summary.skippedThreadState}`,
      createdAt: now,
    });

    return summary;
  },
});
