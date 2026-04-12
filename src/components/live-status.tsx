"use client";

import { LoadingBlock } from "@/components/loading-state";
import { SharedMediaPreview } from "@/components/media-preview";
import { ProviderFilter, type ProviderFilterValue } from "@/components/provider-filter";
import { formatDateTime, trim } from "@/lib/format";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useQuery } from "convex/react";
import Link from "next/link";
import { useMemo, useState } from "react";

const STATUS_JID_WHATSAPP = "status@broadcast";
const STATUS_JID_INSTAGRAM = "ig:story:broadcast";

type ThreadSummary = {
  _id: string;
  title?: string;
  jid: string;
  lastMessageAt: number;
};

type ThreadMessage = {
  _id: string;
  direction: "inbound" | "outbound";
  isStatus?: boolean;
  text: string;
  messageType?: "text" | "reaction" | "sticker" | "meme" | "image" | "video" | "audio" | "document";
  mediaAssetId?: string;
  mediaCaption?: string;
  mediaPreview?: {
    assetId: string;
    kind: "sticker" | "meme" | "image" | "video" | "audio" | "document";
    mimeType: string;
    label: string;
    url: string | null;
  } | null;
  messageAt: number;
};

type StatusThreadPayload = {
  thread: {
    _id: string;
    title?: string;
    jid: string;
  };
  messages: ThreadMessage[];
} | null;

type QueueNeedsReplyItem = {
  _id: string;
  text: string;
  provider: string;
  messageProvider?: "whatsapp" | "instagram";
  isStatusPost?: boolean;
  sendKind?: "text" | "reaction" | "sticker" | "meme";
  mediaCaption?: string;
  mediaPreview?: {
    assetId: string;
    kind: "sticker" | "meme" | "image" | "video" | "audio" | "document";
    mimeType: string;
    label: string;
    url: string | null;
  } | null;
  thread?: { _id?: string; title?: string; jid?: string; provider?: "whatsapp" | "instagram" } | null;
};

type QueuePayload = {
  needsReply: QueueNeedsReplyItem[];
};

function statusMessageText(message: ThreadMessage) {
  const normalizedText = message.text.trim();
  if (normalizedText) {
    return normalizedText;
  }
  if (message.mediaCaption?.trim()) {
    return message.mediaCaption.trim();
  }
  if (message.messageType === "meme") {
    return "Posted a meme status";
  }
  if (message.messageType === "image") {
    return "Posted an image status";
  }
  return "Posted a status";
}

function resolveStatusDraftProvider(item: QueueNeedsReplyItem): "whatsapp" | "instagram" {
  if (item.messageProvider === "instagram" || item.messageProvider === "whatsapp") {
    return item.messageProvider;
  }
  if (item.thread?.provider === "instagram" || item.thread?.provider === "whatsapp") {
    return item.thread.provider;
  }
  if (item.thread?.jid === STATUS_JID_INSTAGRAM) {
    return "instagram";
  }
  return "whatsapp";
}

export function LiveStatus() {
  const [providerFilter, setProviderFilter] = useState<ProviderFilterValue>("all");
  const threads = useQuery(api.threads.list, { limit: 260, provider: providerFilter }) as ThreadSummary[] | undefined;
  const statusThread = useMemo(() => {
    const rows = threads || [];
    if (providerFilter === "whatsapp") {
      return rows.find((thread) => thread.jid === STATUS_JID_WHATSAPP) || null;
    }
    if (providerFilter === "instagram") {
      return rows.find((thread) => thread.jid === STATUS_JID_INSTAGRAM) || null;
    }
    const whatsapp = rows.find((thread) => thread.jid === STATUS_JID_WHATSAPP) || null;
    const instagram = rows.find((thread) => thread.jid === STATUS_JID_INSTAGRAM) || null;
    if (!whatsapp) return instagram;
    if (!instagram) return whatsapp;
    return whatsapp.lastMessageAt >= instagram.lastMessageAt ? whatsapp : instagram;
  }, [providerFilter, threads]);
  const statusThreadId = statusThread?._id;
  const statusData = useQuery(
    api.threads.get,
    statusThreadId ? { threadId: statusThreadId as Id<"threads"> } : "skip",
  ) as StatusThreadPayload | undefined;

  const queue = useQuery(api.queue.list, {
    draftLimit: 120,
    provider: providerFilter,
  }) as QueuePayload | undefined;
  const pendingStatusDrafts = useMemo(
    () =>
      (queue?.needsReply || []).filter((item) => {
        if (item.isStatusPost !== true) {
          return false;
        }
        const statusProvider = resolveStatusDraftProvider(item);
        if (providerFilter === "instagram") {
          return statusProvider === "instagram";
        }
        if (providerFilter === "whatsapp") {
          return statusProvider === "whatsapp";
        }
        return true;
      }),
    [providerFilter, queue?.needsReply],
  );

  const messages = useMemo(() => statusData?.messages || [], [statusData?.messages]);
  const outboundStatuses = useMemo(
    () => messages.filter((message) => message.direction === "outbound" && message.isStatus),
    [messages],
  );
  const timeline = useMemo(() => [...outboundStatuses].reverse(), [outboundStatuses]);

  const threadsLoading = threads === undefined;
  const queueLoading = queue === undefined;
  const statusLoading = statusThreadId ? statusData === undefined : false;
  const pendingCountLabel = queueLoading ? "…" : String(pendingStatusDrafts.length);
  const postedCountLabel = threadsLoading || statusLoading ? "…" : String(outboundStatuses.length);
  const lastPostedAt =
    !threadsLoading && !statusLoading && outboundStatuses.length > 0
      ? formatDateTime(outboundStatuses[outboundStatuses.length - 1].messageAt)
      : null;

  return (
    <section className="status-surface">
      <div className="status-overview" aria-live="polite">
        <p className="status-overview-item">
          <span className="status-overview-label">Pending review</span>
          <strong>{pendingCountLabel}</strong>
        </p>
        <p className="status-overview-item">
          <span className="status-overview-label">Posted statuses</span>
          <strong>{postedCountLabel}</strong>
        </p>
        <p className="status-overview-item">
          <span className="status-overview-label">Last posted</span>
          <strong>{lastPostedAt || "—"}</strong>
        </p>
      </div>

      <div className="panel-grid split-view status-split-view">
        <article className="panel-card">
          <div className="status-section-heading">
            <h3>Queue</h3>
            <span className="status-count-chip">{pendingCountLabel}</span>
          </div>
          <ProviderFilter
            value={providerFilter}
            onChange={setProviderFilter}
            label="Status provider filter"
          />
          <div className="stack compact">
            <div className="queue-actions">
              <Link href="/queue" className="btn btn-primary">
                Open Action Queue
              </Link>
              {statusThreadId ? (
                <Link href={`/conversations?threadId=${statusThreadId}`} className="btn btn-ghost">
                  Open in Conversations
                </Link>
              ) : null}
            </div>

            {queueLoading ? (
              <LoadingBlock label="Loading status queue…" rows={2} compact />
            ) : pendingStatusDrafts.length === 0 ? (
              <p className="empty-line">No pending status drafts.</p>
            ) : (
              <div className="stack compact">
                {pendingStatusDrafts.map((item) => (
                  <div key={item._id} className="queue-item queue-item-condensed status-draft-row">
                    <div>
                      <p className="queue-title status-draft-title">
                        <span>My Status</span>
                        <span className="status-inline-chip">{resolveStatusDraftProvider(item)}</span>
                      </p>
                      <p className="queue-body">{trim(item.mediaCaption || item.text || "", 180)}</p>
                      <p className="queue-meta">
                        Model: {item.provider} · Type: {item.sendKind || "text"}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </article>

        <article className="panel-card">
          <div className="status-section-heading">
            <h3>Timeline</h3>
            <span className="status-count-chip">{postedCountLabel}</span>
          </div>
          {threadsLoading || statusLoading ? (
            <LoadingBlock label="Loading statuses..." rows={3} />
          ) : !statusThread ? (
            <div className="status-empty-shell">
              <p className="empty-line">No status thread yet.</p>
              <p className="queue-meta">Post your first update and timeline history will appear here.</p>
            </div>
          ) : timeline.length === 0 ? (
            <div className="status-empty-shell">
              <p className="empty-line">No outbound status posts yet.</p>
              <p className="queue-meta">Approve one draft to start building timeline history.</p>
              <div className="queue-actions">
                <Link href="/queue" className="btn btn-ghost">
                  Review pending drafts
                </Link>
              </div>
            </div>
          ) : (
            <div className="stack">
              {timeline.map((message) => (
                <div key={message._id} className="queue-item status-timeline-item">
                  <div>
                    <p className="queue-body">{trim(statusMessageText(message), 280)}</p>
                    <p className="queue-meta">
                      {message.messageType || "text"} · {formatDateTime(message.messageAt)}
                    </p>
                  </div>
                  <SharedMediaPreview preview={message.mediaPreview} mediaAssetId={message.mediaAssetId} />
                </div>
              ))}
            </div>
          )}
        </article>
      </div>
    </section>
  );
}
