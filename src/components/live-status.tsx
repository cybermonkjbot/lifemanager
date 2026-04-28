"use client";

import { ActionNotices } from "@/components/action-notices";
import { EmptyState } from "@/components/empty-state";
import { LoadingBlock } from "@/components/loading-state";
import { SharedMediaPreview } from "@/components/media-preview";
import { ProviderFilter, type ProviderFilterValue } from "@/components/provider-filter";
import { useTenantScopeArgs } from "@/components/tenant-scope-provider";
import { formatDateTime, trim } from "@/lib/format";
import { useActionStateRegistry } from "@/lib/ui/action-state";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
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
  messageType?: "text" | "reaction" | "sticker" | "meme" | "image" | "video" | "audio" | "voice_note" | "document";
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
  sendKind?: "text" | "reaction" | "sticker" | "meme" | "voice_note";
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
  if (message.messageType === "voice_note" || message.messageType === "audio") {
    return "Posted a voice note status";
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
  const tenantScope = useTenantScopeArgs();
  const [providerFilter, setProviderFilter] = useState<ProviderFilterValue>("all");
  const approveDraft = useMutation(api.draft.approve);
  const snoozeDraft = useMutation(api.draft.snooze);
  const rejectDraft = useMutation(api.draft.reject);
  const { runAction, getRecord, notices, dismissNotice } = useActionStateRegistry();

  const threads = useQuery(api.threads.list, { ...tenantScope, limit: 260, provider: providerFilter }) as ThreadSummary[] | undefined;
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
    statusThreadId ? { ...tenantScope, threadId: statusThreadId as Id<"threads"> } : "skip",
  ) as StatusThreadPayload | undefined;

  const queue = useQuery(api.queue.list, {
    ...tenantScope,
    draftLimit: 120,
    provider: providerFilter,
  }) as QueuePayload | undefined;

  const onApproveStatusDraft = (draftId: string) => {
    const key = `status:approve:${draftId}`;
    void runAction(
      key,
      async () => {
        await approveDraft({ draftId: draftId as Id<"replyDrafts">, sendImmediately: true });
      },
      {
        pendingLabel: "Approving status draft...",
        successMessage: "Status draft approved and queued for posting.",
      },
    );
  };

  const onSnoozeStatusDraft = (draftId: string) => {
    const key = `status:snooze:${draftId}`;
    void runAction(
      key,
      async () => {
        await snoozeDraft({ draftId: draftId as Id<"replyDrafts">, minutes: 60 });
      },
      {
        pendingLabel: "Snoozing status draft...",
        successMessage: "Status draft snoozed for 60 minutes.",
      },
    );
  };

  const onRejectStatusDraft = (draftId: string) => {
    const key = `status:reject:${draftId}`;
    void runAction(
      key,
      async () => {
        await rejectDraft({ draftId: draftId as Id<"replyDrafts"> });
      },
      {
        pendingLabel: "Discarding status draft...",
        successMessage: "Status draft discarded.",
      },
    );
  };

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
      <ActionNotices notices={notices} onDismiss={dismissNotice} />
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
            <h3>Review</h3>
            <span className="status-count-chip">{pendingCountLabel}</span>
          </div>
          <ProviderFilter
            value={providerFilter}
            onChange={setProviderFilter}
            label="Status provider filter"
          />
          <div className="stack compact">
            {pendingStatusDrafts.length > 0 ? (
              <div className="queue-actions">
                <Link href="/review" className="btn btn-primary">
                  Open Review
                </Link>
                {statusThreadId ? (
                  <Link href={`/conversations?threadId=${statusThreadId}`} className="btn btn-ghost">
                    Open in Conversations
                  </Link>
                ) : null}
              </div>
            ) : null}

            {queueLoading ? (
              <LoadingBlock label="Loading status queue…" rows={2} compact />
            ) : pendingStatusDrafts.length === 0 ? (
              <EmptyState
                variant="status"
                compact
                title="No status drafts waiting."
                description="Status drafts will appear here when there is something ready to approve, snooze, or discard."
              />
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
                      <div className="queue-actions">
                        <button
                          type="button"
                          className="btn btn-primary"
                          onClick={() => onApproveStatusDraft(item._id)}
                          disabled={getRecord(`status:approve:${item._id}`).pending}
                          aria-disabled={getRecord(`status:approve:${item._id}`).pending}
                        >
                          {getRecord(`status:approve:${item._id}`).pending ? "Approving..." : "Approve"}
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => onSnoozeStatusDraft(item._id)}
                          disabled={getRecord(`status:snooze:${item._id}`).pending}
                          aria-disabled={getRecord(`status:snooze:${item._id}`).pending}
                        >
                          {getRecord(`status:snooze:${item._id}`).pending ? "Snoozing..." : "Snooze 60m"}
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => onRejectStatusDraft(item._id)}
                          disabled={getRecord(`status:reject:${item._id}`).pending}
                          aria-disabled={getRecord(`status:reject:${item._id}`).pending}
                        >
                          {getRecord(`status:reject:${item._id}`).pending ? "Discarding..." : "Discard"}
                        </button>
                      </div>
                      {getRecord(`status:approve:${item._id}`).error ? (
                        <p className="queue-meta action-inline-error" role="alert">
                          {getRecord(`status:approve:${item._id}`).error}
                        </p>
                      ) : null}
                      {getRecord(`status:snooze:${item._id}`).error ? (
                        <p className="queue-meta action-inline-error" role="alert">
                          {getRecord(`status:snooze:${item._id}`).error}
                        </p>
                      ) : null}
                      {getRecord(`status:reject:${item._id}`).error ? (
                        <p className="queue-meta action-inline-error" role="alert">
                          {getRecord(`status:reject:${item._id}`).error}
                        </p>
                      ) : null}
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
              <EmptyState
                variant="status"
                title="No status thread captured yet."
                description="Once a status post is detected, its history will appear here."
              />
            </div>
          ) : timeline.length === 0 ? (
            <div className="status-empty-shell">
              <EmptyState
                variant="status"
                title="No posted status updates yet."
                description="Approve a status draft to start building timeline history."
              >
                {pendingStatusDrafts.length > 0 ? (
                  <Link href="/review" className="btn btn-ghost">
                    Review pending drafts
                  </Link>
                ) : null}
              </EmptyState>
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
