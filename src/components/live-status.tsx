"use client";

import { ActionNotices } from "@/components/action-notices";
import { LoadingBlock } from "@/components/loading-state";
import { SharedMediaPreview } from "@/components/media-preview";
import { ProviderFilter, type ProviderFilterValue } from "@/components/provider-filter";
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

type StatusSettingsPayload = {
  statusBuilderEnabled: boolean;
  statusPostAudienceMode?: "whatsapp_privacy" | "manual_allowlist";
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
  const [providerFilter, setProviderFilter] = useState<ProviderFilterValue>("all");
  const [statusPostingPending, setStatusPostingPending] = useState(false);
  const [statusPostingError, setStatusPostingError] = useState<string | null>(null);
  const approveDraft = useMutation(api.draft.approve);
  const snoozeDraft = useMutation(api.draft.snooze);
  const rejectDraft = useMutation(api.draft.reject);
  const setStatusPostingEnabled = useMutation(api.settings.setStatusBuilderEnabled);
  const { runAction, getRecord, notices, dismissNotice } = useActionStateRegistry();
  const statusSettings = useQuery(api.settings.get, {}) as StatusSettingsPayload | undefined;

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

  const statusPostingEnabled = statusSettings?.statusBuilderEnabled ?? true;
  const statusAudienceMode = statusSettings?.statusPostAudienceMode || "whatsapp_privacy";
  const statusPostingLabel = statusSettings === undefined
    ? "Loading…"
    : statusPostingPending
      ? "Saving…"
      : statusPostingEnabled
        ? "Enabled"
        : "Disabled";

  const onStatusPostingToggle = async (enabled: boolean) => {
    if (statusPostingPending || statusSettings === undefined || enabled === statusPostingEnabled) {
      return;
    }
    setStatusPostingPending(true);
    setStatusPostingError(null);
    try {
      await setStatusPostingEnabled({ enabled });
    } catch (error) {
      setStatusPostingError(error instanceof Error ? error.message : "Could not update auto status posting.");
    } finally {
      setStatusPostingPending(false);
    }
  };

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

      <article className="panel-card">
        <div className="status-section-heading">
          <h3>Auto Status Posting</h3>
          <span className={`status-pill ${statusPostingEnabled ? "status-active" : "status-paused"}`}>
            {statusPostingLabel}
          </span>
        </div>
        <div className="stack compact">
          <label className="stack compact">
            <span className="queue-meta">Allow approved status drafts to post automatically</span>
            <select
              value={statusPostingEnabled ? "true" : "false"}
              onChange={(event) => void onStatusPostingToggle(event.target.value === "true")}
              disabled={statusPostingPending || statusSettings === undefined}
              aria-disabled={statusPostingPending || statusSettings === undefined}
            >
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          </label>
          <p className="queue-meta">
            {statusAudienceMode === "manual_allowlist"
              ? "Only allowlisted recipients can receive auto status posts. An empty allowlist skips posting."
              : "Posting uses your current WhatsApp status privacy setting."}
          </p>
          {statusPostingError ? (
            <p className="queue-meta" role="alert">
              {trim(statusPostingError, 220)}
            </p>
          ) : null}
        </div>
      </article>

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
                Open Queue
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
              <p className="empty-line">No status drafts waiting for approval.</p>
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
              <p className="empty-line">No status thread has been captured yet.</p>
              <p className="queue-meta">Once a status post is detected, its history will appear here.</p>
            </div>
          ) : timeline.length === 0 ? (
            <div className="status-empty-shell">
              <p className="empty-line">No posted status updates yet.</p>
              <p className="queue-meta">Approve a status draft to start building timeline history.</p>
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
