import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, mutation, query, type MutationCtx } from "./_generated/server";
import { getConfig } from "./lib/config";
import {
  buildSignalExcerpt,
  detectCheckInSignal,
  evaluateLeadPivotSafety,
  GENERAL_TOPIC_KEY,
  hasTopicCloseCue,
  isCheckInSignalType,
  isTrackableTopicMessageType,
  MUTUAL_CHECKIN_WINDOW_MS,
  resolveTopicFromText,
} from "./lib/conversationIntelligence";
import { computeConversationStyleMatrix } from "../shared/conversation-style-matrix";

type NextMove = "none" | "check_in" | "pivot" | "close";
type CheckInSignalType = "checkin_prompt" | "checkin_response";
type LeadPivotTheme = "wellbeing" | "plans" | "day_recap";

const ACK_LIKE_PATTERN = /^(ok(?:ay)?|k|kk|cool|nice|great|alright|all good|no wahala|noted|seen|sharp|safe|sure|true|yep|yeah|yup|thanks?|thank you|anytime)[.!?]*$/i;
const CLOSE_CUE_PATTERN =
  /\b(bye|good ?night|good ?nite|gud ?night|gud ?nite|gnight|night night|sweet dreams|sleep well|rest well|have (?:a )?(?:good|great|lovely|nice) night|about to sleep|going to sleep|off to bed|heading to bed|later|talk later|talk tom+or+ow|chat tom+or+ow|speak tom+or+ow|catch(?:\s+up)? tom+or+ow|continue tom+or+ow|tmrw?|ttyl|that(?:'s| is) all(?: for now)?|let'?s end|end (this|chat)|leave (it|am) here|stop texting|no more talk)\b/i;
const HARD_STOP_CUE_PATTERN = /\b(don'?t text|do not text|leave me alone|stop messaging|never text|block you)\b/i;
const PAUSE_CUE_PATTERN =
  /\b(i'?m busy|later|talk later|talk tom+or+ow|chat tom+or+ow|speak tom+or+ow|catch(?:\s+up)? tom+or+ow|continue tom+or+ow|tmrw?|another time|not now|let'?s continue later)\b/i;
const NIGHT_SIGNOFF_CUE_PATTERN =
  /\b(gudnyt|goodnightt+|night night|nighty night|sweet dreams?|sleep (?:well|tight)|rest well|rest up|have (?:a )?(?:good|great|lovely|nice|peaceful) (?:night|evening)|go(?:ing)? bed|bedtime|sleep calls|i (?:need|wan|wanna|want) (?:to )?sleep|i(?:'|’)?m sleeping|i(?:'|’)?m off|i(?:'|’)?m going off|let me sleep|make i sleep)\b/i;
const SHORT_NIGHT_SIGNOFF_CUE_PATTERN =
  /^(?:gn+|g9|nyt|nite|night|goodnight|good night|sleep well|sweet dreams?|rest well|rest up)[.!?~\s]*$/i;
const TOMORROW_SIGNOFF_CUE_PATTERN =
  /\b((?:can|could|shall)\s+we\s+|let(?:'|’)?s\s+|we(?:'|’)?ll\s+|we\s+will\s+)?(talk|speak|chat|catch(?:\s+up)?|continue|yarn|gist|resume|pick\s+this\s+up)\s+(?:to\s+you\s+|again\s+|more\s+|properly\s+)?(?:tom+or+ow|tmrw?|tmr|tomoz|in\s+the\s+morning|later)\b/i;
const NEXT_DAY_CONTACT_SIGNOFF_CUE_PATTERN =
  /\b(i(?:'|’)?ll|i will|we(?:'|’)?ll|we will|let(?:'|’)?s|make i|make we)\s+(?:text|message|msg|call|ring|ping|dm|holla|buzz|talk|speak|chat|continue|yarn|gist|resume)\s+(?:you\s+|again\s+|properly\s+)?(?:tom+or+ow|tmrw?|tmr|tomoz|in\s+the\s+morning|later)\b/i;
const SEE_YOU_SIGNOFF_CUE_PATTERN =
  /\b(see (?:you|u|ya)|cya|catch (?:you|u|ya)|talk to (?:you|u)|speak to (?:you|u)|chat to (?:you|u))\s+(?:tom+or+ow|tmrw?|tmr|tomoz|in\s+the\s+morning|later)\b/i;
const TOMORROW_ONLY_SIGNOFF_CUE_PATTERN =
  /^(?:okay\s+|ok\s+|kk\s+|alright\s+|sounds good\s+|cool\s+|sure\s+|bet\s+|then\s+)?(?:tom+or+ow|tmrw?|tmr|tomoz|morning)(?:\s+(?:then|it is|works|sounds good|by god'?s grace|lord willing))?[.!?~\s]*$/i;
const CONFLICT_CUE_PATTERN =
  /\b(stupid|nonsense|idiot|annoying|shut up|useless|fool|angry|upset|frustrated|leave me)\b/i;
const POSITIVE_WARMTH_CUE_PATTERN =
  /\b(thanks|appreciate|miss you|love|proud|nice|great|sweet|kind|glad|happy|good to hear)\b/i;
const EXPLICIT_ASK_CUE_PATTERN = /\b(can|could|would|will|should|please|abeg|kindly|help|send|share|check|confirm)\b/i;
const TOPIC_DYING_EVENT_THRESHOLD = 0.72;

function hasGuidanceCloseCue(text: string) {
  return (
    CLOSE_CUE_PATTERN.test(text) ||
    NIGHT_SIGNOFF_CUE_PATTERN.test(text) ||
    SHORT_NIGHT_SIGNOFF_CUE_PATTERN.test(text) ||
    TOMORROW_SIGNOFF_CUE_PATTERN.test(text) ||
    NEXT_DAY_CONTACT_SIGNOFF_CUE_PATTERN.test(text) ||
    SEE_YOU_SIGNOFF_CUE_PATTERN.test(text) ||
    TOMORROW_ONLY_SIGNOFF_CUE_PATTERN.test(text)
  );
}

function hasGuidancePauseCue(text: string) {
  return (
    PAUSE_CUE_PATTERN.test(text) ||
    TOMORROW_SIGNOFF_CUE_PATTERN.test(text) ||
    NEXT_DAY_CONTACT_SIGNOFF_CUE_PATTERN.test(text) ||
    SEE_YOU_SIGNOFF_CUE_PATTERN.test(text) ||
    TOMORROW_ONLY_SIGNOFF_CUE_PATTERN.test(text)
  );
}

function normalizeGuidanceText(raw: string | undefined) {
  return (raw || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function isAckLikeMessage(message: Pick<Doc<"messages">, "text" | "messageType">) {
  if ((message.messageType || "text") !== "text") {
    return false;
  }
  const normalized = normalizeGuidanceText(message.text);
  if (!normalized || normalized.length > 36) {
    return false;
  }
  return ACK_LIKE_PATTERN.test(normalized);
}

function computeRecentAckStreak(messagesDesc: Array<Pick<Doc<"messages">, "text" | "messageType" | "isStatus">>) {
  let streak = 0;
  for (const message of messagesDesc) {
    if (message.isStatus) {
      continue;
    }
    if (!isAckLikeMessage(message)) {
      break;
    }
    streak += 1;
  }
  return streak;
}

function computeAlternationRatio(messagesDesc: Array<Pick<Doc<"messages">, "direction" | "isStatus">>) {
  const usable = messagesDesc.filter((message) => !message.isStatus).slice(0, 8);
  if (usable.length < 3) {
    return 0.5;
  }
  let switches = 0;
  for (let index = 1; index < usable.length; index += 1) {
    if (usable[index]?.direction !== usable[index - 1]?.direction) {
      switches += 1;
    }
  }
  return clamp01(switches / Math.max(1, usable.length - 1));
}

function computeRecentUnansweredOutboundStreak(
  messagesDesc: Array<Pick<Doc<"messages">, "direction" | "isStatus">>,
) {
  let streak = 0;
  for (const message of messagesDesc) {
    if (message.isStatus) {
      continue;
    }
    if (message.direction !== "outbound") {
      break;
    }
    streak += 1;
  }
  return streak;
}

function pickLeadPivotTheme(args: {
  threadId: Id<"threads">;
  daysSinceMutualCheckIn?: number;
  activeTopicKey?: string;
}): LeadPivotTheme {
  if ((args.daysSinceMutualCheckIn ?? 0) >= 7) {
    return "wellbeing";
  }
  if (args.activeTopicKey && /plan|work|task|deadline|project/i.test(args.activeTopicKey)) {
    return "day_recap";
  }
  const fingerprint = `${String(args.threadId)}:${args.activeTopicKey || "none"}:${args.daysSinceMutualCheckIn ?? 0}`;
  let hash = 0;
  for (let index = 0; index < fingerprint.length; index += 1) {
    hash = (hash * 31 + fingerprint.charCodeAt(index)) >>> 0;
  }
  const bucket = hash % 3;
  if (bucket === 0) return "wellbeing";
  if (bucket === 1) return "plans";
  return "day_recap";
}

async function coolDownOtherActiveLanes(args: {
  ctx: MutationCtx;
  threadId: Id<"threads">;
  excludeTopicKey: string;
  now: number;
}) {
  const activeLanes = await args.ctx.db
    .query("threadTopicLanes")
    .withIndex("by_threadId_and_status_and_lastMessageAt", (q) =>
      q.eq("threadId", args.threadId).eq("status", "active"),
    )
    .take(12);

  for (const lane of activeLanes) {
    if (lane.topicKey === args.excludeTopicKey) {
      continue;
    }
    await args.ctx.db.patch(lane._id, {
      status: "cooling",
      updatedAt: args.now,
    });
  }
}

async function enforceActiveLaneLimit(args: {
  ctx: MutationCtx;
  threadId: Id<"threads">;
  laneMaxActive: number;
  now: number;
}) {
  const activeLanes = await args.ctx.db
    .query("threadTopicLanes")
    .withIndex("by_threadId_and_status_and_lastMessageAt", (q) =>
      q.eq("threadId", args.threadId).eq("status", "active"),
    )
    .order("desc")
    .take(20);
  const maxActive = Math.max(1, args.laneMaxActive);
  if (activeLanes.length <= maxActive) {
    return;
  }
  const overflow = activeLanes.slice(maxActive);
  for (const lane of overflow) {
    await args.ctx.db.patch(lane._id, {
      status: "cooling",
      updatedAt: args.now,
    });
  }
}

async function upsertTopicLane(args: {
  ctx: MutationCtx;
  message: Doc<"messages">;
  now: number;
  topicKey: string;
  topicLabel: string;
  closeTopic: boolean;
  changedFromPreviousPrimary: boolean;
  laneMaxActive: number;
}) {
  const existingLane = await args.ctx.db
    .query("threadTopicLanes")
    .withIndex("by_threadId_and_topicKey", (q) =>
      q.eq("threadId", args.message.threadId).eq("topicKey", args.topicKey),
    )
    .first();

  const inboundIncrement = args.message.direction === "inbound" ? 1 : 0;
  const outboundIncrement = args.message.direction === "outbound" ? 1 : 0;
  const nextLastInboundAt =
    args.message.direction === "inbound"
      ? Math.max(args.message.messageAt, existingLane?.lastInboundAt ?? 0)
      : existingLane?.lastInboundAt;
  const nextLastOutboundAt =
    args.message.direction === "outbound"
      ? Math.max(args.message.messageAt, existingLane?.lastOutboundAt ?? 0)
      : existingLane?.lastOutboundAt;
  const status = args.closeTopic ? "closed" : "active";
  const nextAckStreak = isAckLikeMessage(args.message)
    ? Math.min(9, Math.max(0, existingLane?.ackStreak ?? 0) + 1)
    : 0;
  const nextDyingScore = clamp01((existingLane?.dyingScore ?? 0) * 0.65 + (nextAckStreak > 0 ? 0.28 : 0));

  if (existingLane) {
    await args.ctx.db.patch(existingLane._id, {
      topicLabel: args.topicLabel,
      status,
      lastMessageAt: Math.max(existingLane.lastMessageAt, args.message.messageAt),
      lastInboundAt: nextLastInboundAt,
      lastOutboundAt: nextLastOutboundAt,
      inboundTurns: Math.max(0, existingLane.inboundTurns) + inboundIncrement,
      outboundTurns: Math.max(0, existingLane.outboundTurns) + outboundIncrement,
      ackStreak: nextAckStreak,
      dyingScore: nextDyingScore,
      updatedAt: args.now,
    });
  } else {
    await args.ctx.db.insert("threadTopicLanes", {
      threadId: args.message.threadId,
      topicKey: args.topicKey,
      topicLabel: args.topicLabel,
      status,
      firstMessageAt: args.message.messageAt,
      lastMessageAt: args.message.messageAt,
      lastInboundAt: args.message.direction === "inbound" ? args.message.messageAt : undefined,
      lastOutboundAt: args.message.direction === "outbound" ? args.message.messageAt : undefined,
      inboundTurns: inboundIncrement,
      outboundTurns: outboundIncrement,
      ackStreak: nextAckStreak,
      dyingScore: nextDyingScore,
      createdAt: args.now,
      updatedAt: args.now,
    });
  }

  if (!args.closeTopic && args.changedFromPreviousPrimary) {
    await coolDownOtherActiveLanes({
      ctx: args.ctx,
      threadId: args.message.threadId,
      excludeTopicKey: args.topicKey,
      now: args.now,
    });
  }

  if (!args.closeTopic) {
    await enforceActiveLaneLimit({
      ctx: args.ctx,
      threadId: args.message.threadId,
      laneMaxActive: args.laneMaxActive,
      now: args.now,
    });
  }
}

async function upsertConversationState(args: {
  ctx: MutationCtx;
  threadId: Id<"threads">;
  message: Doc<"messages">;
  now: number;
  signalType: CheckInSignalType | null;
  trackTopic: boolean;
  topicKey?: string;
  topicCloseCue: boolean;
  changedFromPreviousPrimary: boolean;
}) {
  const currentState = await args.ctx.db
    .query("threadConversationState")
    .withIndex("by_threadId", (q) => q.eq("threadId", args.threadId))
    .first();

  const normalizedMessageText = normalizeGuidanceText(args.message.text);
  const closeCue = hasGuidanceCloseCue(normalizedMessageText) || HARD_STOP_CUE_PATTERN.test(normalizedMessageText);
  const pauseCue = hasGuidancePauseCue(normalizedMessageText);
  const outboundQuestion = args.message.direction === "outbound" && /\?/.test(normalizedMessageText);
  let nextMove: NextMove = currentState?.nextMove ?? "none";
  if (closeCue || pauseCue) {
    nextMove = "close";
  } else if (args.signalType === "checkin_prompt" && args.message.direction === "outbound") {
    nextMove = "check_in";
  } else if (args.changedFromPreviousPrimary || (outboundQuestion && !args.signalType)) {
    nextMove = "pivot";
  } else if (args.message.direction === "inbound") {
    nextMove = "none";
  }

  const messageAckLike = isAckLikeMessage(args.message);
  const priorDwellScore = clamp01(currentState?.topicDwellScore ?? 0);
  const previousNextMove: NextMove = currentState?.nextMove ?? "none";
  const nextTopicDwellScore = messageAckLike
    ? clamp01(priorDwellScore * 0.72 + 0.32)
    : clamp01(priorDwellScore * 0.7);
  const topicDyingDetected =
    priorDwellScore < TOPIC_DYING_EVENT_THRESHOLD && nextTopicDwellScore >= TOPIC_DYING_EVENT_THRESHOLD;
  const nextMoveChanged = nextMove !== previousNextMove;
  const nextConversationEndImminent =
    closeCue || pauseCue
      ? true
      : args.message.direction === "inbound" && !messageAckLike && normalizedMessageText.length >= 18
        ? false
        : currentState?.conversationEndImminent;
  const nextLastCloseAt =
    args.message.direction === "outbound" && (closeCue || pauseCue)
      ? Math.max(currentState?.lastCloseAt ?? 0, args.message.messageAt)
      : currentState?.lastCloseAt;
  const nextLastLeadQuestionAt =
    args.message.direction === "outbound" && outboundQuestion && !args.signalType
      ? Math.max(currentState?.lastLeadQuestionAt ?? 0, args.message.messageAt)
      : currentState?.lastLeadQuestionAt;
  const nextLastPivotAt =
    args.message.direction === "outbound" && nextMove === "pivot"
      ? Math.max(currentState?.lastPivotAt ?? 0, args.message.messageAt)
      : currentState?.lastPivotAt;
  const nextLastInboundCheckInAt =
    args.signalType && args.message.direction === "inbound"
      ? Math.max(currentState?.lastInboundCheckInAt ?? 0, args.message.messageAt)
      : currentState?.lastInboundCheckInAt;
  const nextLastOutboundCheckInAt =
    args.signalType && args.message.direction === "outbound"
      ? Math.max(currentState?.lastOutboundCheckInAt ?? 0, args.message.messageAt)
      : currentState?.lastOutboundCheckInAt;

  let nextLastMutualCheckInAt = currentState?.lastMutualCheckInAt;
  if (args.signalType) {
    const windowStart = Math.max(0, args.message.messageAt - MUTUAL_CHECKIN_WINDOW_MS);
    const recentCheckins = await args.ctx.db
      .query("conversationSignals")
      .withIndex("by_threadId_and_messageAt", (q) =>
        q.eq("threadId", args.threadId).gte("messageAt", windowStart).lte("messageAt", args.message.messageAt),
      )
      .order("desc")
      .take(80);

    const counterpart = recentCheckins.find(
      (signal) => signal.direction !== args.message.direction && isCheckInSignalType(signal.signalType),
    );

    if (
      counterpart &&
      (counterpart.signalType === "checkin_prompt" || args.signalType === "checkin_prompt")
    ) {
      const counterpartMessageAt = counterpart.messageAt || counterpart.createdAt;
      const resolvedMutualAt = Math.max(counterpartMessageAt, args.message.messageAt);
      nextLastMutualCheckInAt = Math.max(nextLastMutualCheckInAt ?? 0, resolvedMutualAt);
    }
  }
  const mutualCheckInUpdated = (nextLastMutualCheckInAt ?? 0) > (currentState?.lastMutualCheckInAt ?? 0);

  if (currentState) {
    await args.ctx.db.patch(currentState._id, {
      lastMutualCheckInAt: nextLastMutualCheckInAt,
      lastInboundCheckInAt: nextLastInboundCheckInAt,
      lastOutboundCheckInAt: nextLastOutboundCheckInAt,
      currentPrimaryTopicKey:
        args.trackTopic && args.topicCloseCue
          ? undefined
          : args.trackTopic
            ? args.topicKey || currentState.currentPrimaryTopicKey
            : currentState.currentPrimaryTopicKey,
      topicDwellScore: nextTopicDwellScore,
      nextMove,
      conversationEndImminent: nextConversationEndImminent,
      lastPivotAt: nextLastPivotAt,
      lastCloseAt: nextLastCloseAt,
      lastLeadQuestionAt: nextLastLeadQuestionAt,
      updatedAt: args.now,
    });
    if (mutualCheckInUpdated) {
      await args.ctx.db.insert("systemEvents", {
        source: "worker",
        eventType: "conversation.checkin.mutual_updated",
        threadId: args.threadId,
        detail: `lastMutualCheckInAt=${nextLastMutualCheckInAt}`,
        createdAt: args.now,
      });
    }
    if (nextMoveChanged) {
      await args.ctx.db.insert("systemEvents", {
        source: "worker",
        eventType: "conversation.next_move.updated",
        threadId: args.threadId,
        detail: `nextMove ${previousNextMove} -> ${nextMove}`,
        createdAt: args.now,
      });
    }
    if (topicDyingDetected) {
      await args.ctx.db.insert("systemEvents", {
        source: "worker",
        eventType: "conversation.topic_dying.detected",
        threadId: args.threadId,
        detail: `dwell=${nextTopicDwellScore.toFixed(2)} messageAt=${args.message.messageAt}`,
        createdAt: args.now,
      });
    }
    return;
  }

  await args.ctx.db.insert("threadConversationState", {
    threadId: args.threadId,
    lastMutualCheckInAt: nextLastMutualCheckInAt,
    lastInboundCheckInAt: nextLastInboundCheckInAt,
    lastOutboundCheckInAt: nextLastOutboundCheckInAt,
    currentPrimaryTopicKey: args.trackTopic && !args.topicCloseCue ? args.topicKey || GENERAL_TOPIC_KEY : undefined,
    topicDyingScore: undefined,
    nextMove,
    conversationEndImminent: nextConversationEndImminent,
    topicDwellScore: nextTopicDwellScore,
    lastPivotAt: nextLastPivotAt,
    lastCloseAt: nextLastCloseAt,
    lastLeadQuestionAt: nextLastLeadQuestionAt,
    createdAt: args.now,
    updatedAt: args.now,
  });
  if (nextLastMutualCheckInAt) {
    await args.ctx.db.insert("systemEvents", {
      source: "worker",
      eventType: "conversation.checkin.mutual_updated",
      threadId: args.threadId,
      detail: `lastMutualCheckInAt=${nextLastMutualCheckInAt}`,
      createdAt: args.now,
    });
  }
  if (nextMove !== "none") {
    await args.ctx.db.insert("systemEvents", {
      source: "worker",
      eventType: "conversation.next_move.updated",
      threadId: args.threadId,
      detail: `nextMove none -> ${nextMove}`,
      createdAt: args.now,
    });
  }
  if (topicDyingDetected) {
    await args.ctx.db.insert("systemEvents", {
      source: "worker",
      eventType: "conversation.topic_dying.detected",
      threadId: args.threadId,
      detail: `dwell=${nextTopicDwellScore.toFixed(2)} messageAt=${args.message.messageAt}`,
      createdAt: args.now,
    });
  }
}

export const ingestMessageSignals = internalMutation({
  args: {
    threadId: v.id("threads"),
    messageId: v.id("messages"),
  },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.messageId);
    if (!message || message.threadId !== args.threadId) {
      return { insertedSignals: 0, skipped: "message_not_found" as const };
    }

    const alreadyIngested = await ctx.db
      .query("conversationSignals")
      .withIndex("by_messageId", (q) => q.eq("messageId", args.messageId))
      .first();
    if (alreadyIngested) {
      return { insertedSignals: 0, skipped: "already_ingested" as const };
    }

    const now = Date.now();
    const config = await getConfig(ctx);
    const checkInDetection = detectCheckInSignal(message.text);
    const checkInSignalType = checkInDetection?.signalType || null;
    const excerpt = buildSignalExcerpt(message.text);
    const trackTopic = !message.isStatus && isTrackableTopicMessageType(message.messageType);
    const currentState = await ctx.db
      .query("threadConversationState")
      .withIndex("by_threadId", (q) => q.eq("threadId", args.threadId))
      .first();
    let insertedSignals = 0;
    let topicKey = GENERAL_TOPIC_KEY;
    let topicLabel = "General chat";
    let changedFromPreviousPrimary = false;
    let topicCloseCue = false;

    if (trackTopic) {
      const laneHintLimit = Math.max(4, config.topicLaneMaxActive * 2);
      const activeLaneHints = await ctx.db
        .query("threadTopicLanes")
        .withIndex("by_threadId_and_status_and_lastMessageAt", (q) =>
          q.eq("threadId", args.threadId).eq("status", "active"),
        )
        .order("desc")
        .take(laneHintLimit);
      const coolingLaneHints = await ctx.db
        .query("threadTopicLanes")
        .withIndex("by_threadId_and_status_and_lastMessageAt", (q) =>
          q.eq("threadId", args.threadId).eq("status", "cooling"),
        )
        .order("desc")
        .take(Math.max(2, config.topicLaneMaxActive));
      const resolvedTopic = resolveTopicFromText({
        text: message.text,
        currentPrimaryTopicKey: currentState?.currentPrimaryTopicKey,
        laneHints: [...activeLaneHints, ...coolingLaneHints].map((lane) => ({
          topicKey: lane.topicKey,
          topicLabel: lane.topicLabel,
          status: lane.status,
          lastMessageAt: lane.lastMessageAt,
        })),
      });
      topicKey = resolvedTopic.topicKey;
      topicLabel = resolvedTopic.topicLabel;
      changedFromPreviousPrimary =
        Boolean(currentState?.currentPrimaryTopicKey) && currentState?.currentPrimaryTopicKey !== topicKey;
      topicCloseCue = hasTopicCloseCue(message.text);

      const existingLane = await ctx.db
        .query("threadTopicLanes")
        .withIndex("by_threadId_and_topicKey", (q) =>
          q.eq("threadId", args.threadId).eq("topicKey", topicKey),
        )
        .first();
      const topicSignalType = topicCloseCue
        ? "topic_close"
        : !existingLane
          ? "topic_start"
          : changedFromPreviousPrimary
            ? "topic_pivot"
            : "topic_continue";

      await ctx.db.insert("conversationSignals", {
        threadId: args.threadId,
        messageId: args.messageId,
        direction: message.direction,
        signalType: topicSignalType,
        topicKey,
        confidence: resolvedTopic.confidence,
        excerpt,
        messageAt: message.messageAt,
        createdAt: now,
      });
      insertedSignals += 1;
      await upsertTopicLane({
        ctx,
        message,
        now,
        topicKey,
        topicLabel,
        closeTopic: topicCloseCue,
        changedFromPreviousPrimary,
        laneMaxActive: config.topicLaneMaxActive,
      });
      await ctx.db.insert("systemEvents", {
        source: "worker",
        eventType: "conversation.topic_lane.updated",
        threadId: args.threadId,
        detail: `topic=${topicKey} signal=${topicSignalType} confidence=${resolvedTopic.confidence.toFixed(2)} source=${resolvedTopic.source}`,
        createdAt: now,
      });
    }

    if (checkInSignalType) {
      await ctx.db.insert("conversationSignals", {
        threadId: args.threadId,
        messageId: args.messageId,
        direction: message.direction,
        signalType: checkInSignalType,
        topicKey: undefined,
        confidence: checkInDetection?.confidence ?? 0.82,
        excerpt,
        messageAt: message.messageAt,
        createdAt: now,
      });
      insertedSignals += 1;
      await ctx.db.insert("systemEvents", {
        source: "worker",
        eventType: "conversation.checkin.detected",
        threadId: args.threadId,
        detail: `signal=${checkInSignalType} confidence=${(checkInDetection?.confidence ?? 0.82).toFixed(2)} reason=${checkInDetection?.reason || "pattern_match"}`,
        createdAt: now,
      });
    }

    await upsertConversationState({
      ctx,
      threadId: args.threadId,
      message,
      now,
      signalType: checkInSignalType,
      trackTopic,
      topicKey,
      topicCloseCue,
      changedFromPreviousPrimary,
    });

    if (insertedSignals > 0) {
      await ctx.db.insert("systemEvents", {
        source: "worker",
        eventType: "conversation.intelligence.signals_ingested",
        threadId: args.threadId,
        detail: `message=${String(args.messageId)} signals=${insertedSignals}`,
        createdAt: now,
      });
    }

    return {
      insertedSignals,
      skipped: null as null,
    };
  },
});

export const getThreadState = query({
  args: {
    threadId: v.id("threads"),
    laneLimit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const laneLimit = Math.max(1, Math.min(args.laneLimit ?? 5, 10));
    const promptSampleLimit = 60;
    const responseSampleLimit = 60;
    const mutualSampleLimit = 30;
    const conversationState = await ctx.db
      .query("threadConversationState")
      .withIndex("by_threadId", (q) => q.eq("threadId", args.threadId))
      .first();

    const activeLanes = await ctx.db
      .query("threadTopicLanes")
      .withIndex("by_threadId_and_status_and_lastMessageAt", (q) =>
        q.eq("threadId", args.threadId).eq("status", "active"),
      )
      .order("desc")
      .take(laneLimit);

    const coolingLanes = await ctx.db
      .query("threadTopicLanes")
      .withIndex("by_threadId_and_status_and_lastMessageAt", (q) =>
        q.eq("threadId", args.threadId).eq("status", "cooling"),
      )
      .order("desc")
      .take(laneLimit);

    const promptSignals = await ctx.db
      .query("conversationSignals")
      .withIndex("by_threadId_and_signalType_and_createdAt", (q) =>
        q.eq("threadId", args.threadId).eq("signalType", "checkin_prompt"),
      )
      .order("desc")
      .take(promptSampleLimit);
    const responseSignals = await ctx.db
      .query("conversationSignals")
      .withIndex("by_threadId_and_signalType_and_createdAt", (q) =>
        q.eq("threadId", args.threadId).eq("signalType", "checkin_response"),
      )
      .order("desc")
      .take(responseSampleLimit);
    const mutualUpdates = await ctx.db
      .query("systemEvents")
      .withIndex("by_threadId_and_eventType_and_createdAt", (q) =>
        q.eq("threadId", args.threadId).eq("eventType", "conversation.checkin.mutual_updated"),
      )
      .order("desc")
      .take(mutualSampleLimit);

    return {
      conversationState,
      topicLanes: [...activeLanes, ...coolingLanes].slice(0, laneLimit),
      checkInDiagnostics: {
        promptDetectionsRecent: promptSignals.length,
        responseDetectionsRecent: responseSignals.length,
        mutualUpdatesRecent: mutualUpdates.length,
        lastPromptAt: promptSignals[0]?.messageAt,
        lastResponseAt: responseSignals[0]?.messageAt,
        lastMutualUpdateAt: mutualUpdates[0]?.createdAt,
        lastMutualUpdateDetail: mutualUpdates[0]?.detail,
        lastMutualCheckInAt: conversationState?.lastMutualCheckInAt,
        sampledWindowSize: {
          promptSignals: promptSampleLimit,
          responseSignals: responseSampleLimit,
          mutualUpdates: mutualSampleLimit,
        },
      },
    };
  },
});

export const recordReplyGuidance = mutation({
  args: {
    threadId: v.id("threads"),
    appliedAt: v.number(),
    mode: v.union(v.literal("close"), v.literal("lead_pivot"), v.literal("check_in")),
    outboundText: v.optional(v.string()),
    reasonCodes: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const now = Math.max(0, Math.round(args.appliedAt || Date.now()));
    const state = await ctx.db
      .query("threadConversationState")
      .withIndex("by_threadId", (q) => q.eq("threadId", args.threadId))
      .first();
    const outboundText = normalizeGuidanceText(args.outboundText);
    const hasQuestion = /\?/.test(outboundText);
    const detailSuffix =
      args.reasonCodes && args.reasonCodes.length > 0 ? ` reasons=${args.reasonCodes.join(",")}` : "";

    if (state) {
      const patch: Partial<Doc<"threadConversationState">> = {
        updatedAt: now,
      };
      if (args.mode === "close") {
        patch.lastCloseAt = Math.max(state.lastCloseAt ?? 0, now);
        patch.conversationEndImminent = true;
        patch.nextMove = "close";
        patch.topicDwellScore = clamp01((state.topicDwellScore ?? 0) * 0.62);
      } else if (args.mode === "lead_pivot") {
        patch.lastPivotAt = Math.max(state.lastPivotAt ?? 0, now);
        patch.nextMove = "pivot";
        if (hasQuestion) {
          patch.lastLeadQuestionAt = Math.max(state.lastLeadQuestionAt ?? 0, now);
        }
        patch.topicDwellScore = clamp01((state.topicDwellScore ?? 0) * 0.7);
      } else {
        patch.nextMove = "check_in";
      }
      await ctx.db.patch(state._id, patch);
    } else {
      await ctx.db.insert("threadConversationState", {
        threadId: args.threadId,
        lastMutualCheckInAt: undefined,
        lastInboundCheckInAt: undefined,
        lastOutboundCheckInAt: undefined,
        currentPrimaryTopicKey: undefined,
        topicDyingScore: undefined,
        nextMove: args.mode === "close" ? "close" : args.mode === "lead_pivot" ? "pivot" : "check_in",
        conversationEndImminent: args.mode === "close" ? true : undefined,
        topicDwellScore: args.mode === "close" ? 0.2 : args.mode === "lead_pivot" ? 0.3 : undefined,
        lastPivotAt: args.mode === "lead_pivot" ? now : undefined,
        lastCloseAt: args.mode === "close" ? now : undefined,
        lastLeadQuestionAt: args.mode === "lead_pivot" && hasQuestion ? now : undefined,
        createdAt: now,
        updatedAt: now,
      });
    }

    await ctx.db.insert("systemEvents", {
      source: "worker",
      eventType: "conversation.guidance.applied",
      threadId: args.threadId,
      detail: `mode=${args.mode} question=${hasQuestion ? "yes" : "no"}${detailSuffix}`,
      createdAt: now,
    });

    return {
      applied: true,
      mode: args.mode,
    };
  },
});

export const getReplyGuidance = query({
  args: {
    threadId: v.id("threads"),
    inboundText: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const config = await getConfig(ctx);
    const now = Date.now();
    const inboundText = normalizeGuidanceText(args.inboundText);
    const reasonCodes: string[] = [];

    const conversationState = await ctx.db
      .query("threadConversationState")
      .withIndex("by_threadId", (q) => q.eq("threadId", args.threadId))
      .first();

    const activeLane = await ctx.db
      .query("threadTopicLanes")
      .withIndex("by_threadId_and_status_and_lastMessageAt", (q) =>
        q.eq("threadId", args.threadId).eq("status", "active"),
      )
      .order("desc")
      .first();
    const coolingLane = activeLane
      ? null
      : await ctx.db
          .query("threadTopicLanes")
          .withIndex("by_threadId_and_status_and_lastMessageAt", (q) =>
            q.eq("threadId", args.threadId).eq("status", "cooling"),
          )
          .order("desc")
          .first();
    const currentLane = activeLane || coolingLane;

    const recentMessages = await ctx.db
      .query("messages")
      .withIndex("by_thread_messageAt", (q) => q.eq("threadId", args.threadId))
      .order("desc")
      .take(16);
    const conversationalRecent = recentMessages.filter((message) => !message.isStatus);
    const recentAckStreak = computeRecentAckStreak(conversationalRecent);
    const alternationRatio = computeAlternationRatio(conversationalRecent);
    const recentUnansweredOutboundStreak = computeRecentUnansweredOutboundStreak(conversationalRecent);
    const explicitAskCue =
      Boolean(inboundText && (inboundText.includes("?") || EXPLICIT_ASK_CUE_PATTERN.test(inboundText))) ||
      conversationalRecent
        .slice(0, 2)
        .some((message) => message.direction === "inbound" && /\?/.test(normalizeGuidanceText(message.text)));

    const closeCue =
      Boolean(inboundText && (hasGuidanceCloseCue(inboundText) || HARD_STOP_CUE_PATTERN.test(inboundText))) ||
      recentAckStreak >= Math.max(2, config.topicDyingAckStreakThreshold + 1);
    const pauseCue = Boolean(inboundText && hasGuidancePauseCue(inboundText));
    const conflictCue =
      Boolean(inboundText && CONFLICT_CUE_PATTERN.test(inboundText)) ||
      conversationalRecent.slice(0, 5).some((message) => CONFLICT_CUE_PATTERN.test(normalizeGuidanceText(message.text)));
    const warmthCue =
      Boolean(inboundText && POSITIVE_WARMTH_CUE_PATTERN.test(inboundText)) ||
      conversationalRecent.slice(0, 5).some((message) => POSITIVE_WARMTH_CUE_PATTERN.test(normalizeGuidanceText(message.text)));

    const turnCount = currentLane
      ? Math.max(0, currentLane.inboundTurns) + Math.max(0, currentLane.outboundTurns)
      : conversationalRecent.slice(0, 10).length;
    const softLimit = Math.max(2, config.antiDwellingTopicTurnSoftLimit);
    const hardLimit = Math.max(softLimit + 1, config.antiDwellingTopicTurnHardLimit);
    const turnPressure = clamp01((turnCount - softLimit) / Math.max(1, hardLimit - softLimit));
    const ackPressure = clamp01(recentAckStreak / Math.max(1, config.topicDyingAckStreakThreshold + 1));
    const topicDwellScore = clamp01(
      Math.max(conversationState?.topicDwellScore ?? 0, ackPressure * 0.65 + turnPressure * 0.55),
    );

    const conversationEndImminent = Boolean(conversationState?.conversationEndImminent) || closeCue || pauseCue;
    const closeCooldownMs = Math.max(5, config.antiDwellingEndgameCloseCooldownMinutes) * 60 * 1000;
    const closeCooldownActive =
      Boolean(conversationState?.lastCloseAt) && now - (conversationState?.lastCloseAt || 0) < closeCooldownMs;
    const shouldClose = config.antiDwellingEnabled && (conversationEndImminent || closeCooldownActive);
    if (conversationEndImminent) {
      reasonCodes.push("end_imminent");
    }
    if (closeCooldownActive) {
      reasonCodes.push("close_cooldown_active");
    }

    let vibeScore = 0.5;
    if (warmthCue) {
      vibeScore += 0.2;
    }
    if (conflictCue) {
      vibeScore -= 0.35;
    }
    vibeScore += (alternationRatio - 0.5) * 0.2;
    vibeScore = clamp01(vibeScore);

    const leadCooldownMs = Math.max(5, config.topicLeadPivotCooldownMinutes) * 60 * 1000;
    const leadCooldownAnchor = Math.max(
      conversationState?.lastPivotAt || 0,
      conversationState?.lastLeadQuestionAt || 0,
      conversationState?.lastCloseAt || 0,
    );
    const leadCooldownActive = leadCooldownAnchor > 0 && now - leadCooldownAnchor < leadCooldownMs;
    const laneExhausted =
      Boolean(currentLane && currentLane.status === "cooling") ||
      turnCount >= softLimit ||
      (currentLane?.ackStreak ?? 0) >= Math.max(2, config.topicDyingAckStreakThreshold) ||
      topicDwellScore >= 0.62;
    const styleMatrix = computeConversationStyleMatrix({
      inboundText,
      recentHistoryLines: conversationalRecent
        .slice(0, 8)
        .map((message) => `${message.direction === "inbound" ? "Them" : "Me"}: ${message.text}`),
      conversationGuidance: {
        shouldClose,
        topicDwellScore,
        vibeScore,
        reasonCodes,
      },
    });
    const leadPivotDecision = evaluateLeadPivotSafety({
      conversationIntelligenceEnabled: config.conversationIntelligenceEnabled,
      pivotReplyEnabled: config.pivotReplyEnabled,
      topicLeadPivotEnabled: config.topicLeadPivotEnabled,
      shouldClose,
      conflictCue,
      pauseCue,
      leadCooldownActive,
      topicDwellScore,
      vibeScore,
      minVibeScore: config.topicLeadPivotMinVibeScore,
      laneExhausted,
      explicitAskCue,
      unansweredOutboundStreak: recentUnansweredOutboundStreak,
      maxUnansweredOutboundStreak: 1,
      styleMatrixRisk: styleMatrix.riskSensitivity,
      styleMatrixConfidence: styleMatrix.confidence,
    });
    const shouldLeadPivot = leadPivotDecision.eligible;
    if (shouldLeadPivot) {
      reasonCodes.push("lead_pivot");
    }

    const daysSinceMutualCheckIn =
      conversationState?.lastMutualCheckInAt && conversationState.lastMutualCheckInAt > 0
        ? Math.floor((now - conversationState.lastMutualCheckInAt) / (24 * 60 * 60 * 1000))
        : undefined;
    const checkInDue =
      !daysSinceMutualCheckIn || daysSinceMutualCheckIn >= Math.max(1, config.checkInRecencyTargetDays);
    const shouldCheckIn =
      config.conversationIntelligenceEnabled &&
      checkInDue &&
      !shouldClose &&
      !shouldLeadPivot &&
      !explicitAskCue &&
      recentUnansweredOutboundStreak <= 1 &&
      !conflictCue &&
      !pauseCue;
    if (shouldCheckIn) {
      reasonCodes.push("checkin_due");
    }

    const leadPivotTheme = shouldLeadPivot
      ? pickLeadPivotTheme({
          threadId: args.threadId,
          daysSinceMutualCheckIn,
          activeTopicKey: currentLane?.topicKey,
        })
      : undefined;

    return {
      enabled: config.conversationIntelligenceEnabled,
      shouldClose,
      shouldLeadPivot,
      shouldCheckIn,
      conversationEndImminent,
      topicDwellScore,
      vibeScore,
      daysSinceMutualCheckIn,
      activeTopic: currentLane
        ? {
            topicKey: currentLane.topicKey,
            topicLabel: currentLane.topicLabel,
            status: currentLane.status,
            turnCount,
          }
        : null,
      leadPivotTheme,
      reasonCodes,
    };
  },
});
