import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, mutation, query, type MutationCtx } from "./_generated/server";
import { assertTenantBillingActive, assertThreadTenantBillingActive, listHostedTenantBillingScopes } from "./lib/billingAccess";
import { getConfig } from "./lib/config";
import { classifyThreadKind } from "./lib/threadEligibility";
import { GOOD_MORNING_OUTREACH_REASON_PREFIX, isConversationStarterReason } from "./lib/outreachModes";
import { estimateHumanTiming } from "./lib/heuristics";
import { enqueueOutbox } from "./lib/outboxEnqueue";
import {
  buildRomancePromptFingerprint,
  isIgnoredMorningPauseActive,
  isSuccessfulLeadPlanCooldownActive,
  ROMANCE_BASE_VARIANT_COUNT,
  ROMANCE_BOUNDARY_REOPEN_VARIANT_COUNT,
  shouldSendIgnoredMorningBoundaryReopen,
  isWithinHourWindow,
  selectAdaptiveRomanceMorningMode,
  stableHash,
} from "../shared/romance-morning";

const AI_OUTREACH_PLACEHOLDER = "__SLM_AI_OUTREACH__";
const MAX_SIGNAL_ROWS = 360;
const MAX_RECENT_DRAFTS = 60;
const MAX_RECENT_MESSAGES = 140;
const MAX_TARGET_THREADS = 180;
const HOLDOUT_RATIO_DEFAULT = 0.1;

type RomanceMorningMode = "lead" | "warm";
const BOUNDARY_REOPEN_HINT_VARIATIONS = [
  "Good morning {{name}}, I did not enjoy being ghosted, but I am choosing peace and still checking on you.",
  "Good morning {{name}}, I did not like how we went silent, but I am taking the higher road and checking on you.",
  "Good morning {{name}}, being ignored did not feel good, but I am choosing calm and still checking on you.",
  "Good morning {{name}}, I did not enjoy the silence, but I still want to check on you with respect.",
  "Good morning {{name}}, I did not like being left on read, but I am choosing maturity and checking on you.",
  "Good morning {{name}}, I did not enjoy being shut out, but I am keeping it calm and still checking on you.",
  "Good morning {{name}}, the silence was not pleasant for me, but I would rather choose peace and check on you.",
  "Good morning {{name}}, I did not like being ignored after reaching out, but I am still checking on you respectfully.",
  "Good morning {{name}}, I did not enjoy how distant things felt, but I am choosing grace and checking on you.",
  "Good morning {{name}}, I did not like the quiet between us, but I am still checking in with good intentions.",
  "Good morning {{name}}, I did not enjoy being ghosted like that, but I am choosing calm and care while checking on you.",
  "Good morning {{name}}, I did not like how we lost touch this way, but I am taking the bigger-person route and checking on you.",
  "Good morning {{name}}, I did not enjoy that silence at all, but I am not here to fight, just to check on you.",
  "Good morning {{name}}, I did not like being ignored, honestly, but I am still checking in from a calm place.",
  "Good morning {{name}}, I did not enjoy how things went quiet, but I am choosing respect and still checking on you.",
  "Good morning {{name}}, I did not like the way communication dropped, but I am keeping it mature and checking on you.",
  "Good morning {{name}}, I did not enjoy being ghosted, but I am not escalating it and still checking on you today.",
  "Good morning {{name}}, I did not like being left hanging, but I am choosing peace and checking in anyway.",
  "Good morning {{name}}, I did not enjoy that silent treatment, but I am still reaching out with calm energy.",
  "Good morning {{name}}, I did not like being ignored after my earlier message, but I am still choosing the bigger person approach.",
  "Good morning {{name}}, I did not enjoy how we went cold, but I am checking on you without drama.",
  "Good morning {{name}}, I did not like that silence, but I am keeping it respectful and still checking on you.",
  "Good morning {{name}}, I did not enjoy being ignored, yet I am choosing composure and still checking on you.",
] as const;

function resolveLocalDayStart(now: number) {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function isDirectMessageThread(thread: Pick<Doc<"threads">, "provider" | "jid" | "isGroup" | "threadKind">) {
  const provider = thread.provider || "whatsapp";
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

export function isMorningHoldoutThread(args: {
  threadId: string;
  dayBucket: string;
  holdoutRatio?: number;
}) {
  const holdoutRatio = Math.max(0, Math.min(args.holdoutRatio ?? HOLDOUT_RATIO_DEFAULT, 1));
  if (holdoutRatio <= 0) {
    return false;
  }
  const sample = (stableHash(`${args.threadId}|${args.dayBucket}|holdout`) % 1000) / 1000;
  return sample < holdoutRatio;
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

async function getThreadByJid(ctx: MutationCtx, jid: string, tenantId?: Id<"tenantAccounts">) {
  const directProviderMatch = tenantId
    ? await ctx.db
        .query("threads")
        .withIndex("by_tenantId_and_provider_and_jid", (q) =>
          q.eq("tenantId", tenantId).eq("provider", "whatsapp").eq("jid", jid),
        )
        .first()
    : await ctx.db
        .query("threads")
        .withIndex("by_provider_and_jid", (q) => q.eq("provider", "whatsapp").eq("jid", jid))
        .first();
  if (directProviderMatch) {
    return directProviderMatch;
  }
  if (tenantId) {
    return await ctx.db
      .query("threads")
      .withIndex("by_tenantId_and_jid", (q) => q.eq("tenantId", tenantId).eq("jid", jid))
      .first();
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
  const nextNoReplyStreak = inboundAt ? 0 : Math.max(1, state.noReplyStreak);
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

async function suppressConversationStarterOutboxForThread(args: {
  ctx: MutationCtx;
  threadId: Id<"threads">;
  now: number;
  reason: string;
}) {
  const rows = [
    ...(await args.ctx.db
      .query("outbox")
      .withIndex("by_thread_and_status", (q) => q.eq("threadId", args.threadId).eq("status", "pending"))
      .take(80)),
    ...(await args.ctx.db
      .query("outbox")
      .withIndex("by_thread_and_status", (q) => q.eq("threadId", args.threadId).eq("status", "claimed"))
      .take(80)),
  ];

  let suppressed = 0;
  for (const row of rows) {
    const draft = await args.ctx.db.get(row.draftId);
    if (!draft) {
      continue;
    }
    await args.ctx.db.patch(row._id, {
      status: "failed",
      workerId: undefined,
      leaseExpiresAt: undefined,
      error: args.reason,
      updatedAt: args.now,
    });
    if (draft.status !== "sent" && draft.status !== "rejected") {
      await args.ctx.db.patch(draft._id, {
        status: "rejected",
        updatedAt: args.now,
      });
    }
    await args.ctx.db.insert("systemEvents", {
      source: "convex",
      eventType: "romance_morning.suppressed_outbox",
      threadId: args.threadId,
      outboxId: row._id,
      detail: args.reason.slice(0, 220),
      createdAt: args.now,
    });
    suppressed += 1;
  }
  return suppressed;
}

function resolveGoodMorningHint(args: {
  mode: RomanceMorningMode;
  firstName: string;
  variant: number;
  boundaryReopen: boolean;
}) {
  if (args.boundaryReopen) {
    const index =
      ((Math.round(args.variant) % ROMANCE_BOUNDARY_REOPEN_VARIANT_COUNT) + ROMANCE_BOUNDARY_REOPEN_VARIANT_COUNT) %
      ROMANCE_BOUNDARY_REOPEN_VARIANT_COUNT;
    const template = BOUNDARY_REOPEN_HINT_VARIATIONS[index];
    return template.replace(/\{\{name\}\}/g, args.firstName);
  }
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
    await assertThreadTenantBillingActive(ctx, args.threadId);
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

async function runRomanceMorning(ctx: MutationCtx, tenantId?: Id<"tenantAccounts">) {
    const now = Date.now();
    await assertTenantBillingActive(ctx, tenantId, now);
    const config = await getConfig(ctx, tenantId);
    const nowHour = new Date(now).getHours();

    if (!config.romanticMorningEnabled) {
      return { queued: 0, considered: 0, reason: "disabled" as const };
    }

    if (!isWithinHourWindow(nowHour, config.romanticMorningStartHour, config.romanticMorningEndHour)) {
      return { queued: 0, considered: 0, reason: "outside_window" as const };
    }

    const cooldownMs = Math.max(60 * 60 * 1000, config.romanticMorningCollisionCooldownHours * 60 * 60 * 1000);
    const dayStart = resolveLocalDayStart(now);
    const dayBucket = `${new Date(dayStart).toISOString().slice(0, 10)}`;
    const romanticPartnerJids = [...new Set(config.romanticPartnerJids.map((jid) => jid.trim().toLowerCase()).filter(Boolean))];

    const listThreadIds: string[] = [];
    for (const jid of romanticPartnerJids) {
      const thread = await getThreadByJid(ctx, jid, tenantId);
      if (!thread) {
        continue;
      }
      listThreadIds.push(String(thread._id));
    }

    const romanticBacklogRows = (
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
    ).flat();
    const romanticBacklogThreadIds: string[] = [];
    for (const row of romanticBacklogRows) {
      if (tenantId) {
        const thread = await ctx.db.get(row.threadId);
        if (thread?.tenantId !== tenantId) {
          continue;
        }
      }
      romanticBacklogThreadIds.push(String(row.threadId));
    }

    const romanticProfileRows = (
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
    ).flat();
    const romanticProfileThreadIds: string[] = [];
    for (const row of romanticProfileRows) {
      if (tenantId) {
        const thread = await ctx.db.get(row.threadId);
        if (thread?.tenantId !== tenantId) {
          continue;
        }
      }
      romanticProfileThreadIds.push(String(row.threadId));
    }

    const candidateThreadIds = mergeUniqueThreadIds([
      listThreadIds,
      romanticBacklogThreadIds,
      romanticProfileThreadIds,
    ]).slice(0, MAX_TARGET_THREADS);

    if (candidateThreadIds.length === 0) {
      await ctx.db.insert("systemEvents", {
        tenantId,
        source: "convex",
        eventType: "romance_morning.no_candidates",
        detail: `No eligible romantic morning targets. configured_jids=${romanticPartnerJids.length}; backlog_candidates=${romanticBacklogThreadIds.length}; profile_candidates=${romanticProfileThreadIds.length}.`,
        createdAt: now,
      });
      return { queued: 0, considered: 0, reason: "no_candidates" as const };
    }

    const summary = {
      queued: 0,
      considered: 0,
      skippedOutsideWindow: 0,
      skippedThreadState: 0,
      skippedPendingOutbox: 0,
      skippedMorningAlreadyQueued: 0,
      skippedConversationStarterCollision: 0,
      skippedPushinessCooldown: 0,
      skippedHoldout: 0,
      forcedWarmPlanCooldown: 0,
      skippedIgnoredPause: 0,
      suppressedOutboxIgnoredPause: 0,
    };

    for (const threadIdRaw of candidateThreadIds) {
      const threadId = threadIdRaw as Id<"threads">;
      const thread = await ctx.db.get(threadId);
      if (!thread || !isDirectMessageThread(thread) || thread.isIgnored || thread.isArchived) {
        summary.skippedThreadState += 1;
        continue;
      }
      if (tenantId && thread.tenantId !== tenantId) {
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
      const ignoredPauseActive = isIgnoredMorningPauseActive({
        now,
        noReplyStreak,
        lastSentAt: romanceState?.lastSentAt,
        lastInboundAfterSendAt: romanceState?.lastInboundAfterSendAt,
      });
      if (ignoredPauseActive) {
        summary.skippedIgnoredPause += 1;
        const suppressed = await suppressConversationStarterOutboxForThread({
          ctx,
          threadId,
          now,
          reason: "Suppressed: no reply to previous good morning; pausing outreach for 3 days.",
        });
        summary.suppressedOutboxIgnoredPause += suppressed;
        await ctx.db.insert("systemEvents", {
          source: "convex",
          eventType: "romance_morning.paused_ignored",
          threadId,
          detail: `pauseDays=3; noReplyStreak=${noReplyStreak}; suppressed=${suppressed}`,
          createdAt: now,
        });
        continue;
      }
      if (
        noReplyStreak >= 2 &&
        romanceState?.lastSentAt &&
        now - romanceState.lastSentAt < Math.max(cooldownMs, 24 * 60 * 60 * 1000)
      ) {
        summary.skippedPushinessCooldown += 1;
        continue;
      }

      if (
        isMorningHoldoutThread({
          threadId,
          dayBucket,
        })
      ) {
        summary.skippedHoldout += 1;
        await ctx.db.insert("systemEvents", {
          source: "convex",
          eventType: "romance_morning.holdout",
          threadId,
          detail: `control=ab_holdout_10pct; day=${dayBucket}`,
          createdAt: now,
        });
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

      const planCooldownActive = isSuccessfulLeadPlanCooldownActive({
        threadId,
        now,
        lastMode: romanceState?.lastMode,
        lastSentAt: romanceState?.lastSentAt,
        lastInboundAfterSendAt: romanceState?.lastInboundAfterSendAt,
      });
      const boundaryReopen = shouldSendIgnoredMorningBoundaryReopen({
        now,
        noReplyStreak,
        lastSentAt: romanceState?.lastSentAt,
        lastInboundAfterSendAt: romanceState?.lastInboundAfterSendAt,
      });
      const mode = selectAdaptiveRomanceMorningMode({
        threadId,
        seed: `${threadId}|${dayBucket}|${summary.considered}`,
        leadRatio: config.romanticMorningLeadRatio,
        now,
        lastMode: romanceState?.lastMode,
        noReplyStreak,
        lastSentAt: romanceState?.lastSentAt,
        lastInboundAfterSendAt: romanceState?.lastInboundAfterSendAt,
      });
      if ((planCooldownActive || boundaryReopen) && mode === "warm") {
        summary.forcedWarmPlanCooldown += 1;
      }
      const variantCount = boundaryReopen ? ROMANCE_BOUNDARY_REOPEN_VARIANT_COUNT : ROMANCE_BASE_VARIANT_COUNT;
      let variant = stableHash(`${threadId}|${dayBucket}|${mode}`) % variantCount;
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
        variant = (variant + 1) % variantCount;
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
        boundaryReopen,
      });
      const timing = estimateHumanTiming(hintText);
      const messageProvider = thread.provider || "whatsapp";

      const draftId = await ctx.db.insert("replyDrafts", {
        tenantId: thread.tenantId,
        messageProvider,
        threadId,
        sourceMessageId: latestMessage._id,
        text: AI_OUTREACH_PLACEHOLDER,
        sendKind: "text",
        outreachMode: "good_morning",
        status: "approved",
        confidence: config.aiFallbackConfidence,
        provider: "heuristic",
        delayMs: timing.delayMs,
        typingMs: timing.typingMs,
        reason: `${GOOD_MORNING_OUTREACH_REASON_PREFIX} (AI pending): mode=${mode}; variant=${variant}; hint=${hintText.slice(0, 160)}`,
        createdAt: now,
        updatedAt: now,
      });

      const { outboxId } = await enqueueOutbox(ctx, {
        messageProvider,
        threadId,
        draftId,
        messageText: AI_OUTREACH_PLACEHOLDER,
        sendKind: "text",
        outreachMode: "good_morning",
        sendAt: now + timing.delayMs,
        idempotencyKey: `romance-morning:${threadId}:${dayBucket}`,
        provider: "heuristic",
        now,
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
        tenantId: thread.tenantId,
        source: "convex",
        eventType: "romance_morning.queued",
        threadId,
        outboxId,
        detail: `mode=${mode}; variant=${variant}; noReplyStreak=${noReplyStreak}; planCooldown=${planCooldownActive ? "active" : "inactive"}; boundaryReopen=${boundaryReopen ? "yes" : "no"}; hint=${hintText.slice(0, 140)}`,
        createdAt: now,
      });
      summary.queued += 1;
    }

    await ctx.db.insert("systemEvents", {
      tenantId,
      source: "convex",
      eventType: "romance_morning.batch",
      detail: `queued=${summary.queued}; considered=${summary.considered}; pending=${summary.skippedPendingOutbox}; queued_today=${summary.skippedMorningAlreadyQueued}; collision=${summary.skippedConversationStarterCollision}; pushiness=${summary.skippedPushinessCooldown}; holdout=${summary.skippedHoldout}; ignoredPause=${summary.skippedIgnoredPause}; suppressedIgnoredPause=${summary.suppressedOutboxIgnoredPause}; forcedWarmPlanCooldown=${summary.forcedWarmPlanCooldown}; invalid=${summary.skippedThreadState}`,
      createdAt: now,
    });

    return summary;
}

export const run = internalMutation({
  args: {},
  handler: async (ctx) => {
    const scopes = await listHostedTenantBillingScopes(ctx);
    if (!scopes.hasHostedTenants) {
      return await runRomanceMorning(ctx);
    }
    const results = [];
    for (const tenantId of scopes.activeTenantIds) {
      results.push(await runRomanceMorning(ctx, tenantId));
    }
    return {
      queued: results.reduce((sum, result) => sum + result.queued, 0),
      considered: results.reduce((sum, result) => sum + result.considered, 0),
      tenantCount: scopes.activeTenantIds.length,
      results,
    };
  },
});
