import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getConfig } from "./lib/config";
import { classifyThreadKind } from "./lib/threadEligibility";

type CallStatus = "offer" | "ringing" | "timeout" | "reject" | "accept" | "terminate";
type MessageProvider = "whatsapp" | "instagram";

const CALL_ENDED_STATUSES = new Set<CallStatus>(["timeout", "reject", "terminate"]);

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

function normalizeProvider(provider?: MessageProvider): MessageProvider {
  return provider === "instagram" ? "instagram" : "whatsapp";
}

function normalizeMinDurationMs(raw: number | undefined) {
  const fallback = 2 * 60 * 1000;
  if (!Number.isFinite(raw)) {
    return fallback;
  }
  return Math.round(Math.max(30_000, Math.min(raw as number, 30 * 60 * 1000)));
}

export function computeCallDurationMs(args: { acceptedAt?: number; endedAt?: number }) {
  if (!args.acceptedAt || !args.endedAt) {
    return undefined;
  }
  if (args.endedAt < args.acceptedAt) {
    return undefined;
  }
  return args.endedAt - args.acceptedAt;
}

export function isCallSessionQualifiedForReplyBarrier(args: {
  threadKind: "direct" | "group" | "broadcast_or_system";
  acceptedAt?: number;
  endedAt?: number;
  sawSelfEvent: boolean;
  sawPeerEvent: boolean;
  minDurationMs: number;
}) {
  if (args.threadKind !== "direct") {
    return false;
  }
  const durationMs = computeCallDurationMs({
    acceptedAt: args.acceptedAt,
    endedAt: args.endedAt,
  });
  if (!Number.isFinite(durationMs) || (durationMs as number) < args.minDurationMs) {
    return false;
  }
  return args.sawSelfEvent && args.sawPeerEvent;
}

export const recordEvent = mutation({
  args: {
    provider: v.optional(v.union(v.literal("whatsapp"), v.literal("instagram"))),
    callId: v.string(),
    threadJid: v.string(),
    fromJid: v.optional(v.string()),
    status: v.union(
      v.literal("offer"),
      v.literal("ringing"),
      v.literal("timeout"),
      v.literal("reject"),
      v.literal("accept"),
      v.literal("terminate"),
    ),
    eventAt: v.optional(v.number()),
    isGroup: v.optional(v.boolean()),
    isVideo: v.optional(v.boolean()),
    offline: v.optional(v.boolean()),
    isFromSelf: v.optional(v.boolean()),
    minDurationMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const provider = normalizeProvider(args.provider);
    const callId = args.callId.trim();
    const threadJid = args.threadJid.trim();
    if (!callId || !threadJid) {
      return {
        stored: false,
      };
    }

    const eventAt = normalizeTimestampMs(args.eventAt, now);
    const minDurationMs = normalizeMinDurationMs(args.minDurationMs);
    const fromJid = args.fromJid?.trim() || undefined;

    let thread = await ctx.db
      .query("threads")
      .withIndex("by_provider_and_jid", (q) => q.eq("provider", provider).eq("jid", threadJid))
      .first();
    if (!thread) {
      thread = await ctx.db
        .query("threads")
        .withIndex("by_jid", (q) => q.eq("jid", threadJid))
        .first();
    }
    if (!thread) {
      const config = await getConfig(ctx);
      const threadKind = classifyThreadKind({
        jid: threadJid,
        isGroupHint: args.isGroup,
        provider,
      });
      const threadId = await ctx.db.insert("threads", {
        provider,
        jid: threadJid,
        title: undefined,
        isGroup: threadKind === "group",
        isIgnored: threadKind === "group" ? config.ignoreGroupsByDefault : false,
        threadKind,
        isArchived: false,
        archivedAt: undefined,
        ghostedUntil: undefined,
        nightPausedUntil: undefined,
        callReplyBarrierAt: undefined,
        lastMessageAt: 0,
        createdAt: now,
        updatedAt: now,
      });
      thread = await ctx.db.get(threadId);
      if (!thread) {
        throw new Error("Failed to initialize thread for call event");
      }
    }

    const threadKind =
      thread.threadKind || classifyThreadKind({ jid: thread.jid, isGroupHint: thread.isGroup, provider: thread.provider });
    const session = await ctx.db
      .query("callSessions")
      .withIndex("by_provider_and_callId", (q) => q.eq("provider", provider).eq("callId", callId))
      .first();

    let offeredAt = session?.offeredAt;
    let ringingAt = session?.ringingAt;
    let acceptedAt = session?.acceptedAt;
    let endedAt = session?.endedAt;
    let initiatorJid = session?.initiatorJid;
    let sawSelfEvent = session?.sawSelfEvent || false;
    let sawPeerEvent = session?.sawPeerEvent || false;
    const eventFromSelf = args.isFromSelf;
    if (eventFromSelf === true) {
      sawSelfEvent = true;
    } else if (eventFromSelf === false) {
      sawPeerEvent = true;
    }

    if (args.status === "offer") {
      offeredAt = offeredAt ? Math.min(offeredAt, eventAt) : eventAt;
      if (!initiatorJid && fromJid) {
        initiatorJid = fromJid;
      }
    } else if (args.status === "ringing") {
      ringingAt = ringingAt ? Math.min(ringingAt, eventAt) : eventAt;
    } else if (args.status === "accept") {
      acceptedAt = acceptedAt ? Math.min(acceptedAt, eventAt) : eventAt;
    } else if (CALL_ENDED_STATUSES.has(args.status)) {
      endedAt = endedAt ? Math.max(endedAt, eventAt) : eventAt;
    }

    const durationMs = computeCallDurationMs({
      acceptedAt,
      endedAt,
    });
    const qualifiesForReplyBarrier = isCallSessionQualifiedForReplyBarrier({
      threadKind,
      acceptedAt,
      endedAt,
      sawSelfEvent,
      sawPeerEvent,
      minDurationMs,
    });

    let replyBarrierAppliedAt = session?.replyBarrierAppliedAt;
    let barrierApplied = false;
    let callReplyBarrierAt = thread.callReplyBarrierAt;
    if (qualifiesForReplyBarrier && !replyBarrierAppliedAt && endedAt) {
      const nextBarrierAt = Math.max(thread.callReplyBarrierAt || 0, endedAt);
      await ctx.db.patch(thread._id, {
        callReplyBarrierAt: nextBarrierAt,
        updatedAt: now,
      });
      callReplyBarrierAt = nextBarrierAt;
      replyBarrierAppliedAt = now;
      barrierApplied = true;
      await ctx.db.insert("systemEvents", {
        source: "worker",
        eventType: "thread.call.reply_barrier.set",
        threadId: thread._id,
        detail: `Qualified call ${callId} ended ${new Date(endedAt).toISOString()}; auto-replies wait for next inbound after call.`,
        createdAt: now,
      });
    }

    const payload = {
      provider,
      callId,
      threadId: thread._id,
      threadJid,
      threadKind,
      fromJid,
      initiatorJid,
      isGroup: args.isGroup ?? session?.isGroup ?? (threadKind === "group" ? true : undefined),
      isVideo: args.isVideo ?? session?.isVideo,
      offeredAt,
      ringingAt,
      acceptedAt,
      endedAt,
      durationMs,
      lastStatus: args.status,
      sawSelfEvent,
      sawPeerEvent,
      qualifiesForReplyBarrier,
      replyBarrierAppliedAt,
      offline: args.offline ?? session?.offline,
      updatedAt: now,
    };

    let callSessionId = session?._id;
    if (session) {
      await ctx.db.patch(session._id, payload);
    } else {
      callSessionId = await ctx.db.insert("callSessions", {
        ...payload,
        createdAt: now,
      });
    }
    if (!callSessionId) {
      throw new Error("Failed to persist call session");
    }

    await ctx.db.insert("systemEvents", {
      source: "worker",
      eventType: `call.event.${args.status}`,
      threadId: thread._id,
      detail: `callId=${callId} from=${fromJid || "unknown"} status=${args.status} durationMs=${durationMs ?? -1} self=${sawSelfEvent} peer=${sawPeerEvent}`,
      createdAt: now,
    });

    return {
      stored: true,
      callSessionId,
      threadId: thread._id,
      qualifiesForReplyBarrier,
      barrierApplied,
      callReplyBarrierAt,
      durationMs,
    };
  },
});

export const listByThread = query({
  args: {
    threadId: v.id("threads"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.round(Math.max(1, Math.min(args.limit ?? 50, 200)));
    return await ctx.db
      .query("callSessions")
      .withIndex("by_threadId_and_updatedAt", (q) => q.eq("threadId", args.threadId))
      .order("desc")
      .take(limit);
  },
});
