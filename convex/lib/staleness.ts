import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

const STALE_INBOUND_GRACE_MS = 8_000;
const STALE_INBOUND_SCAN_LIMIT = 40;

export const QUEUE_DRAFT_STALE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
export const TODO_CANDIDATE_STALE_MAX_AGE_MS = 21 * 24 * 60 * 60 * 1000;

type StalenessCtx = Pick<QueryCtx, "db">;
type FreshnessMessage = Pick<Doc<"messages">, "direction" | "messageAt" | "messageType" | "isStatus" | "text">;

function isFreshnessBlockingInboundMessage(message: FreshnessMessage) {
  if (message.direction !== "inbound") {
    return false;
  }
  if (message.isStatus) {
    return false;
  }
  return message.messageType !== "reaction";
}

function isFreshnessBlockingOutboundMessage(message: FreshnessMessage) {
  if (message.direction !== "outbound") {
    return false;
  }
  if (message.isStatus) {
    return false;
  }
  return message.messageType !== "reaction";
}

export function resolveQueueFreshnessReferenceAt(args: {
  itemCreatedAt: number;
  itemUpdatedAt?: number;
  sourceMessageDirection?: Doc<"messages">["direction"];
  sourceMessageAt?: number;
}) {
  const createdAt = Number.isFinite(args.itemCreatedAt) ? Math.max(0, args.itemCreatedAt) : 0;
  const updatedAt = Number.isFinite(args.itemUpdatedAt) ? Math.max(0, args.itemUpdatedAt || 0) : 0;
  const sourceInboundAt =
    args.sourceMessageDirection === "inbound" && Number.isFinite(args.sourceMessageAt)
      ? Math.max(0, args.sourceMessageAt || 0)
      : 0;
  return Math.max(createdAt, updatedAt, sourceInboundAt);
}

export async function hasBlockingInboundAfter(args: {
  ctx: StalenessCtx;
  threadId: Id<"threads">;
  referenceAt: number;
  graceMs?: number;
  scanLimit?: number;
}) {
  const cutoff = Math.max(0, args.referenceAt) + Math.max(0, args.graceMs ?? STALE_INBOUND_GRACE_MS);
  const recent = await args.ctx.db
    .query("messages")
    .withIndex("by_thread_messageAt", (q) => q.eq("threadId", args.threadId).gt("messageAt", cutoff))
    .order("desc")
    .take(Math.max(1, Math.min(args.scanLimit ?? STALE_INBOUND_SCAN_LIMIT, 120)));

  return recent.some((message) => isFreshnessBlockingInboundMessage(message));
}

export async function hasBlockingConversationActivityAfter(args: {
  ctx: StalenessCtx;
  threadId: Id<"threads">;
  referenceAt: number;
  graceMs?: number;
  scanLimit?: number;
}) {
  const cutoff = Math.max(0, args.referenceAt) + Math.max(0, args.graceMs ?? STALE_INBOUND_GRACE_MS);
  const recent = await args.ctx.db
    .query("messages")
    .withIndex("by_thread_messageAt", (q) => q.eq("threadId", args.threadId).gt("messageAt", cutoff))
    .order("desc")
    .take(Math.max(1, Math.min(args.scanLimit ?? STALE_INBOUND_SCAN_LIMIT, 120)));

  return recent.some((message) => {
    return isFreshnessBlockingInboundMessage(message) || isFreshnessBlockingOutboundMessage(message);
  });
}

export async function isQueueDraftStale(args: {
  ctx: StalenessCtx;
  draft: Pick<Doc<"replyDrafts">, "_id" | "threadId" | "createdAt" | "updatedAt">;
  thread: Pick<Doc<"threads">, "isArchived" | "isIgnored"> | null;
  sourceMessage: Pick<Doc<"messages">, "direction" | "messageAt"> | null;
  now: number;
}) {
  if (!args.thread || args.thread.isArchived || args.thread.isIgnored) {
    return true;
  }

  if (args.now - Math.max(args.draft.updatedAt || 0, args.draft.createdAt || 0) > QUEUE_DRAFT_STALE_MAX_AGE_MS) {
    return true;
  }

  const referenceAt = resolveQueueFreshnessReferenceAt({
    itemCreatedAt: args.draft.createdAt,
    itemUpdatedAt: args.draft.updatedAt,
    sourceMessageDirection: args.sourceMessage?.direction,
    sourceMessageAt: args.sourceMessage?.messageAt,
  });

  return await hasBlockingConversationActivityAfter({
    ctx: args.ctx,
    threadId: args.draft.threadId,
    referenceAt,
  });
}

export async function isTodoCandidateStale(args: {
  ctx: StalenessCtx;
  candidate: Pick<Doc<"todoCandidates">, "_id" | "threadId" | "createdAt" | "updatedAt">;
  thread: Pick<Doc<"threads">, "isArchived" | "isIgnored"> | null;
  sourceMessage: Pick<Doc<"messages">, "direction" | "messageAt"> | null;
  now: number;
}) {
  if (!args.thread || args.thread.isArchived || args.thread.isIgnored) {
    return true;
  }

  if (args.now - Math.max(args.candidate.updatedAt || 0, args.candidate.createdAt || 0) > TODO_CANDIDATE_STALE_MAX_AGE_MS) {
    return true;
  }

  const referenceAt = resolveQueueFreshnessReferenceAt({
    itemCreatedAt: args.candidate.createdAt,
    itemUpdatedAt: args.candidate.updatedAt,
    sourceMessageDirection: args.sourceMessage?.direction,
    sourceMessageAt: args.sourceMessage?.messageAt,
  });

  return await hasBlockingInboundAfter({
    ctx: args.ctx,
    threadId: args.candidate.threadId,
    referenceAt,
  });
}
