"use client";

import { ActionNotices } from "@/components/action-notices";
import { UIModal } from "@/components/ui-modal";
import { formatDateTime, formatDateTimeWithRelative, trim } from "@/lib/format";
import { useActionStateRegistry } from "@/lib/ui/action-state";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useMemo, useState } from "react";

type NeedsReplyItem = {
  _id: string;
  provider: string;
  delayMs: number;
  typingMs: number;
  text: string;
  sendKind?: "text" | "reaction" | "sticker" | "meme";
  mediaAssetId?: string;
  mediaCaption?: string;
  mediaPreview?: {
    assetId: string;
    kind: "sticker" | "meme";
    mimeType: string;
    label: string;
    url: string | null;
  } | null;
  sourceMessage?:
    | {
        text?: string;
        mediaAssetId?: string;
        mediaCaption?: string;
        mediaPreview?: {
          assetId: string;
          kind: "sticker" | "meme";
          mimeType: string;
          label: string;
          url: string | null;
        } | null;
      }
    | null;
  thread?: { _id?: string; title?: string; jid?: string } | null;
};

type FollowupConfirmationItem = {
  _id: string;
  reason: string;
  dueAt: number;
  status: "suggested" | "confirmed" | "queued" | "sent" | "failed" | "cancelled";
  kind?: "promise" | "request" | "plan";
  direction?: "inbound" | "outbound";
  confidence?: number;
  sourceSnippet?: string;
  thread?: { _id?: string; title?: string; jid?: string } | null;
  sourceMessage?:
    | {
        text?: string;
        messageAt?: number;
        direction?: "inbound" | "outbound";
      }
    | null;
};

type TodoCandidateItem = {
  _id: string;
  title: string;
  suggestedDueAt?: number;
};

type GuardrailFlagItem = {
  _id: string;
  severity: string;
  reason: string;
  resolvedAt?: number;
};

type QueueData = {
  needsReply: NeedsReplyItem[];
  followupConfirmations: FollowupConfirmationItem[];
  todoCandidates: TodoCandidateItem[];
  guardrailFlags: GuardrailFlagItem[];
};

type QueueTab = "needsReply" | "followups" | "todos" | "guardrails";

type QueueReviewState =
  | { kind: "needsReply"; item: NeedsReplyItem }
  | { kind: "followups"; item: FollowupConfirmationItem }
  | { kind: "todos"; item: TodoCandidateItem }
  | { kind: "guardrails"; item: GuardrailFlagItem }
  | null;

function renderQueueMediaPreview(args: {
  mediaPreview?: {
    assetId: string;
    kind: "sticker" | "meme";
    mimeType: string;
    label: string;
    url: string | null;
  } | null;
  mediaAssetId?: string;
}) {
  const preview = args.mediaPreview;
  if (!preview?.url) {
    return args.mediaAssetId ? <p className="queue-meta">Media preview unavailable.</p> : null;
  }

  const mimeType = preview.mimeType.toLowerCase();
  const altText = preview.label || (preview.kind === "meme" ? "Meme" : "Sticker");
  if (mimeType.startsWith("image/") || preview.kind === "meme" || preview.kind === "sticker") {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={preview.url} alt={altText} className="message-media-image" loading="lazy" />;
  }
  if (mimeType.startsWith("video/")) {
    return <video src={preview.url} controls preload="metadata" className="message-media-video" />;
  }
  if (mimeType.startsWith("audio/")) {
    return <audio src={preview.url} controls preload="none" className="message-media-audio" />;
  }

  return (
    <a href={preview.url} target="_blank" rel="noreferrer" className="message-media-link">
      Open media attachment
    </a>
  );
}

function QueueContent() {
  const approveDraft = useMutation(api.draft.approve);
  const snoozeDraft = useMutation(api.draft.snooze);
  const rejectDraft = useMutation(api.draft.reject);
  const updateDraftContent = useMutation(api.draft.updateDraftContent);
  const confirmFollowup = useMutation(api.followups.confirm);
  const snoozeFollowup = useMutation(api.followups.snooze);
  const rescheduleFollowup = useMutation(api.followups.reschedule);
  const cancelFollowup = useMutation(api.followups.cancel);
  const createTodoFromCandidate = useMutation(api.todos.fromCandidate);
  const resolveGuardrail = useMutation(api.queue.resolveGuardrail);

  const { runAction, getRecord, isPending, notices, dismissNotice } = useActionStateRegistry();
  const [tab, setTab] = useState<QueueTab>("needsReply");
  const [reviewState, setReviewState] = useState<QueueReviewState>(null);

  const queue = useQuery(api.queue.list, {}) as QueueData | undefined;
  const queueLoading = queue === undefined;
  const needsReply = queue?.needsReply || [];
  const followupConfirmations = queue?.followupConfirmations || [];
  const todoCandidates = queue?.todoCandidates || [];
  const guardrailFlags = queue?.guardrailFlags || [];

  const counts = useMemo(
    () => ({
      needsReply: needsReply.length,
      followups: followupConfirmations.length,
      todos: todoCandidates.length,
      guardrails: guardrailFlags.length,
    }),
    [followupConfirmations.length, guardrailFlags.length, needsReply.length, todoCandidates.length],
  );

  const onSend = (draftId: string) => {
    const key = `send:${draftId}`;
    void runAction(
      key,
      async () => {
        await approveDraft({ draftId: draftId as Id<"replyDrafts"> });
      },
      {
        pendingLabel: "Sending...",
        successMessage: "Reply approved and queued.",
      },
    );
  };

  const onSnooze = (draftId: string) => {
    const key = `snooze:${draftId}`;
    void runAction(
      key,
      async () => {
        await snoozeDraft({ draftId: draftId as Id<"replyDrafts">, minutes: 30 });
      },
      {
        pendingLabel: "Snoozing...",
        successMessage: "Reply snoozed for 30 minutes.",
      },
    );
  };

  const onConfirmFollowup = (followUpId: string) => {
    const key = `followup:${followUpId}`;
    void runAction(
      key,
      async () => {
        await confirmFollowup({ followUpId: followUpId as Id<"followUps"> });
      },
      {
        pendingLabel: "Confirming...",
        successMessage: "Follow-up confirmed.",
      },
    );
  };

  const onSnoozeFollowup = (followUpId: string, minutes: number) => {
    const key = `followup:snooze:${followUpId}`;
    void runAction(
      key,
      async () => {
        await snoozeFollowup({ followUpId: followUpId as Id<"followUps">, minutes });
      },
      {
        pendingLabel: "Snoozing...",
        successMessage: "Follow-up snoozed.",
      },
    );
  };

  const onRescheduleFollowup = (followUpId: string, hoursAhead: number) => {
    const key = `followup:reschedule:${followUpId}`;
    void runAction(
      key,
      async () => {
        await rescheduleFollowup({
          followUpId: followUpId as Id<"followUps">,
          dueAt: Date.now() + Math.max(1, Math.round(hoursAhead)) * 60 * 60 * 1000,
        });
      },
      {
        pendingLabel: "Rescheduling...",
        successMessage: "Follow-up rescheduled.",
      },
    );
  };

  const onDismissFollowup = (followUpId: string) => {
    const key = `followup:cancel:${followUpId}`;
    void runAction(
      key,
      async () => {
        await cancelFollowup({ followUpId: followUpId as Id<"followUps"> });
      },
      {
        pendingLabel: "Dismissing...",
        successMessage: "Follow-up dismissed.",
      },
    );
  };

  const onConvertTodo = (candidateId: string) => {
    const key = `todo:${candidateId}`;
    void runAction(
      key,
      async () => {
        await createTodoFromCandidate({ candidateId: candidateId as Id<"todoCandidates"> });
      },
      {
        pendingLabel: "Converting...",
        successMessage: "Candidate converted to TODO.",
      },
    );
  };

  const onReject = (draftId: string) => {
    const key = `reject:${draftId}`;
    void runAction(
      key,
      async () => {
        await rejectDraft({ draftId: draftId as Id<"replyDrafts"> });
      },
      {
        pendingLabel: "Rejecting...",
        successMessage: "Draft rejected.",
      },
    );
  };

  const onEdit = (draftId: string, text: string) => {
    const edited = window.prompt("Edit draft text", text);
    if (edited === null || !edited.trim()) {
      return;
    }
    const key = `edit:${draftId}`;
    void runAction(
      key,
      async () => {
        await updateDraftContent({ draftId: draftId as Id<"replyDrafts">, text: edited });
      },
      {
        pendingLabel: "Saving edit...",
        successMessage: "Draft updated.",
      },
    );
  };

  const onResolveGuardrail = (guardrailEventId: string) => {
    const key = `guardrail:resolve:${guardrailEventId}`;
    void runAction(
      key,
      async () => {
        await resolveGuardrail({
          guardrailEventId: guardrailEventId as Id<"guardrailEvents">,
          resolutionNote: "Reviewed and resolved from queue.",
          closeDraft: true,
        });
      },
      {
        pendingLabel: "Resolving guardrail...",
        successMessage: "Guardrail resolved.",
      },
    );
  };

  const onBulkNeedsReply = (mode: "send" | "snooze") => {
    const ids = needsReply.map((item) => item._id);
    if (ids.length === 0) {
      return;
    }

    void runAction(
      `queue:bulk:${mode}`,
      async () => {
        for (const id of ids) {
          if (mode === "send") {
            await approveDraft({ draftId: id as Id<"replyDrafts"> });
          } else {
            await snoozeDraft({ draftId: id as Id<"replyDrafts">, minutes: 30 });
          }
        }
      },
      {
        pendingLabel: mode === "send" ? "Sending all pending drafts..." : "Snoozing all pending drafts...",
        successMessage: mode === "send" ? "All pending drafts queued to send." : "All pending drafts snoozed for 30 minutes.",
      },
    );
  };

  const renderNeedsReply = () => (
    <div className="stack">
      {queueLoading ? <p className="empty-line">Loading reply queue…</p> : null}
      {needsReply.map((item) => {
        const sendKey = `send:${item._id}`;
        const snoozeKey = `snooze:${item._id}`;
        const rowPending = isPending(sendKey) || isPending(snoozeKey);

        return (
          <div key={item._id} className="queue-item queue-item-condensed" aria-busy={rowPending}>
            <div>
              <p className="queue-title">{item.thread?.title || item.thread?.jid || "Unknown contact"}</p>
              <p className="queue-body">{trim(item.sourceMessage?.text || item.text || "", 180)}</p>
              <p className="queue-meta">
                Provider: {item.provider} · Delay: {Math.round(item.delayMs / 1000)}s · Typing: {Math.round(item.typingMs / 1000)}s
              </p>
            </div>
            <button type="button" className="btn btn-primary" onClick={() => setReviewState({ kind: "needsReply", item })}>
              Review
            </button>
          </div>
        );
      })}
      {!queueLoading && needsReply.length === 0 ? <p className="empty-line">No pending replies.</p> : null}
    </div>
  );

  const renderFollowups = () => (
    <div className="stack">
      {queueLoading ? <p className="empty-line">Loading follow-up confirmations…</p> : null}
      {followupConfirmations.map((item) => {
        const key = `followup:${item._id}`;
        const record = getRecord(key);
        const dismissRecord = getRecord(`followup:cancel:${item._id}`);
        const busy = record.pending || dismissRecord.pending;
        const sourceText = item.sourceSnippet?.trim() || item.sourceMessage?.text?.trim() || "";
        return (
          <div key={item._id} className="queue-item queue-item-condensed" aria-busy={busy}>
            <div>
              <p className="queue-title">{item.thread?.title || item.thread?.jid || "Unknown thread"}</p>
              <p className="queue-meta">Due: {formatDateTimeWithRelative(item.dueAt)}</p>
              <p className="queue-body">{item.reason}</p>
              {sourceText ? <p className="queue-meta">Source: {trim(sourceText, 180)}</p> : null}
            </div>
            <div className="queue-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => onConfirmFollowup(item._id)}
                disabled={record.pending || dismissRecord.pending}
                aria-disabled={record.pending || dismissRecord.pending}
              >
                {record.pending ? "Confirming..." : "Confirm"}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => onDismissFollowup(item._id)}
                disabled={record.pending || dismissRecord.pending}
                aria-disabled={record.pending || dismissRecord.pending}
              >
                {dismissRecord.pending ? "Dismissing..." : "Dismiss"}
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setReviewState({ kind: "followups", item })}>
                Review
              </button>
            </div>
          </div>
        );
      })}
      {!queueLoading && followupConfirmations.length === 0 ? <p className="empty-line">No follow-up confirmations pending.</p> : null}
    </div>
  );

  const renderTodos = () => (
    <div className="stack">
      {queueLoading ? <p className="empty-line">Loading TODO candidates…</p> : null}
      {todoCandidates.map((item) => {
        const key = `todo:${item._id}`;
        const record = getRecord(key);
        return (
          <div key={item._id} className="queue-item queue-item-condensed" aria-busy={record.pending}>
            <div>
              <p className="queue-title">{item.title}</p>
              <p className="queue-meta">Suggested due: {formatDateTime(item.suggestedDueAt)}</p>
            </div>
            <button type="button" className="btn btn-primary" onClick={() => setReviewState({ kind: "todos", item })}>
              Review
            </button>
          </div>
        );
      })}
      {!queueLoading && todoCandidates.length === 0 ? <p className="empty-line">No todo candidates.</p> : null}
    </div>
  );

  const renderGuardrails = () => (
    <div className="stack">
      {queueLoading ? <p className="empty-line">Loading guardrail flags…</p> : null}
      {guardrailFlags.map((item) => (
        <div key={item._id} className="queue-item queue-item-condensed">
          <div>
            <p className="queue-title">Severity: {item.severity}</p>
            <p className="queue-body">{item.reason}</p>
          </div>
          <button type="button" className="btn btn-ghost" onClick={() => setReviewState({ kind: "guardrails", item })}>
            Inspect
          </button>
        </div>
      ))}
      {!queueLoading && guardrailFlags.length === 0 ? <p className="empty-line">No active safety flags.</p> : null}
    </div>
  );

  return (
    <>
      <ActionNotices notices={notices} onDismiss={dismissNotice} />

      <section className="panel-card">
        <div className="queue-focus-tabs" role="tablist" aria-label="Action queue categories">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "needsReply"}
            className={`btn ${tab === "needsReply" ? "btn-primary" : "btn-ghost"}`}
            onClick={() => setTab("needsReply")}
          >
            Needs Reply ({counts.needsReply})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "followups"}
            className={`btn ${tab === "followups" ? "btn-primary" : "btn-ghost"}`}
            onClick={() => setTab("followups")}
          >
            Follow-ups ({counts.followups})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "todos"}
            className={`btn ${tab === "todos" ? "btn-primary" : "btn-ghost"}`}
            onClick={() => setTab("todos")}
          >
            TODO ({counts.todos})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "guardrails"}
            className={`btn ${tab === "guardrails" ? "btn-primary" : "btn-ghost"}`}
            onClick={() => setTab("guardrails")}
          >
            Guardrails ({counts.guardrails})
          </button>
        </div>

        {tab === "needsReply" ? (
          <div className="queue-actions">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => onBulkNeedsReply("send")}
              disabled={needsReply.length === 0 || getRecord("queue:bulk:send").pending}
              aria-disabled={needsReply.length === 0 || getRecord("queue:bulk:send").pending}
            >
              Send All
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => onBulkNeedsReply("snooze")}
              disabled={needsReply.length === 0 || getRecord("queue:bulk:snooze").pending}
              aria-disabled={needsReply.length === 0 || getRecord("queue:bulk:snooze").pending}
            >
              Snooze All 30m
            </button>
          </div>
        ) : null}

        {tab === "needsReply" ? renderNeedsReply() : null}
        {tab === "followups" ? renderFollowups() : null}
        {tab === "todos" ? renderTodos() : null}
        {tab === "guardrails" ? renderGuardrails() : null}
      </section>

      <UIModal
        open={Boolean(reviewState)}
        onClose={() => setReviewState(null)}
        title={
          reviewState?.kind === "needsReply"
            ? "Reply Review"
            : reviewState?.kind === "followups"
              ? "Follow-up Confirmation"
              : reviewState?.kind === "todos"
                ? "TODO Candidate"
                : "Guardrail Detail"
        }
      >
        {reviewState?.kind === "needsReply" ? (
          <div className="stack compact">
            <p className="queue-title">{reviewState.item.thread?.title || reviewState.item.thread?.jid || "Unknown contact"}</p>
            <p className="queue-body">{trim(reviewState.item.sourceMessage?.text || reviewState.item.text || "")}</p>
            {renderQueueMediaPreview({
              mediaPreview: reviewState.item.sourceMessage?.mediaPreview,
              mediaAssetId: reviewState.item.sourceMessage?.mediaAssetId,
            })}
            <p className="queue-meta">Draft mode: {reviewState.item.sendKind || "text"}</p>
            {reviewState.item.text ? <p className="queue-body">{trim(reviewState.item.text, 240)}</p> : null}
            {renderQueueMediaPreview({
              mediaPreview: reviewState.item.mediaPreview,
              mediaAssetId: reviewState.item.mediaAssetId,
            })}
            {reviewState.item.mediaCaption?.trim() ? (
              <p className="queue-meta">Media caption: {trim(reviewState.item.mediaCaption.trim(), 240)}</p>
            ) : null}
            <p className="queue-meta">
              Provider: {reviewState.item.provider} · Delay: {Math.round(reviewState.item.delayMs / 1000)}s · Typing: {Math.round(reviewState.item.typingMs / 1000)}s
            </p>
            <div className="queue-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => onSend(reviewState.item._id)}
                disabled={isPending(`send:${reviewState.item._id}`) || isPending(`snooze:${reviewState.item._id}`)}
                aria-disabled={isPending(`send:${reviewState.item._id}`) || isPending(`snooze:${reviewState.item._id}`)}
              >
                Send
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => onSnooze(reviewState.item._id)}
                disabled={isPending(`send:${reviewState.item._id}`) || isPending(`snooze:${reviewState.item._id}`)}
                aria-disabled={isPending(`send:${reviewState.item._id}`) || isPending(`snooze:${reviewState.item._id}`)}
              >
                Snooze 30m
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => onEdit(reviewState.item._id, reviewState.item.text)}
                disabled={isPending(`edit:${reviewState.item._id}`)}
                aria-disabled={isPending(`edit:${reviewState.item._id}`)}
              >
                Edit
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => onReject(reviewState.item._id)}
                disabled={isPending(`reject:${reviewState.item._id}`)}
                aria-disabled={isPending(`reject:${reviewState.item._id}`)}
              >
                Reject
              </button>
              {reviewState.item.thread?._id ? (
                <Link href={`/conversations?threadId=${reviewState.item.thread._id}`} className="btn btn-ghost">
                  Open Thread
                </Link>
              ) : null}
            </div>
            {getRecord(`send:${reviewState.item._id}`).error || getRecord(`snooze:${reviewState.item._id}`).error ? (
              <p className="queue-meta action-inline-error" role="alert">
                {getRecord(`send:${reviewState.item._id}`).error || getRecord(`snooze:${reviewState.item._id}`).error}
              </p>
            ) : null}
            {getRecord(`edit:${reviewState.item._id}`).error ? (
              <p className="queue-meta action-inline-error" role="alert">
                {getRecord(`edit:${reviewState.item._id}`).error}
              </p>
            ) : null}
            {getRecord(`reject:${reviewState.item._id}`).error ? (
              <p className="queue-meta action-inline-error" role="alert">
                {getRecord(`reject:${reviewState.item._id}`).error}
              </p>
            ) : null}
          </div>
        ) : null}

        {reviewState?.kind === "followups" ? (
          <div className="stack compact">
            <p className="queue-title">{reviewState.item.thread?.title || reviewState.item.thread?.jid || "Unknown thread"}</p>
            <p className="queue-meta">Due: {formatDateTimeWithRelative(reviewState.item.dueAt)}</p>
            <p className="queue-body">{reviewState.item.reason}</p>
            {reviewState.item.sourceSnippet?.trim() || reviewState.item.sourceMessage?.text?.trim() ? (
              <p className="queue-meta">
                Source: {trim(reviewState.item.sourceSnippet?.trim() || reviewState.item.sourceMessage?.text?.trim() || "", 260)}
              </p>
            ) : null}
            {typeof reviewState.item.confidence === "number" ? (
              <p className="queue-meta">Detector confidence: {Math.round(reviewState.item.confidence * 100)}%</p>
            ) : null}
            <div className="queue-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => onConfirmFollowup(reviewState.item._id)}
                disabled={getRecord(`followup:${reviewState.item._id}`).pending}
                aria-disabled={getRecord(`followup:${reviewState.item._id}`).pending}
              >
                {getRecord(`followup:${reviewState.item._id}`).pending ? "Confirming..." : "Confirm"}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => onSnoozeFollowup(reviewState.item._id, 24 * 60)}
                disabled={getRecord(`followup:snooze:${reviewState.item._id}`).pending}
                aria-disabled={getRecord(`followup:snooze:${reviewState.item._id}`).pending}
              >
                {getRecord(`followup:snooze:${reviewState.item._id}`).pending ? "Snoozing..." : "Snooze 1d"}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => onRescheduleFollowup(reviewState.item._id, 24)}
                disabled={getRecord(`followup:reschedule:${reviewState.item._id}`).pending}
                aria-disabled={getRecord(`followup:reschedule:${reviewState.item._id}`).pending}
              >
                {getRecord(`followup:reschedule:${reviewState.item._id}`).pending ? "Rescheduling..." : "+24h"}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => onDismissFollowup(reviewState.item._id)}
                disabled={getRecord(`followup:cancel:${reviewState.item._id}`).pending}
                aria-disabled={getRecord(`followup:cancel:${reviewState.item._id}`).pending}
              >
                {getRecord(`followup:cancel:${reviewState.item._id}`).pending ? "Dismissing..." : "Dismiss"}
              </button>
              {reviewState.item.thread?._id ? (
                <Link href={`/conversations?threadId=${reviewState.item.thread._id}`} className="btn btn-ghost">
                  Open Thread
                </Link>
              ) : null}
            </div>
            {getRecord(`followup:${reviewState.item._id}`).error ? (
              <p className="queue-meta action-inline-error" role="alert">
                {getRecord(`followup:${reviewState.item._id}`).error}
              </p>
            ) : null}
            {getRecord(`followup:snooze:${reviewState.item._id}`).error ? (
              <p className="queue-meta action-inline-error" role="alert">
                {getRecord(`followup:snooze:${reviewState.item._id}`).error}
              </p>
            ) : null}
            {getRecord(`followup:reschedule:${reviewState.item._id}`).error ? (
              <p className="queue-meta action-inline-error" role="alert">
                {getRecord(`followup:reschedule:${reviewState.item._id}`).error}
              </p>
            ) : null}
            {getRecord(`followup:cancel:${reviewState.item._id}`).error ? (
              <p className="queue-meta action-inline-error" role="alert">
                {getRecord(`followup:cancel:${reviewState.item._id}`).error}
              </p>
            ) : null}
          </div>
        ) : null}

        {reviewState?.kind === "todos" ? (
          <div className="stack compact">
            <p className="queue-title">{reviewState.item.title}</p>
            <p className="queue-meta">Suggested due: {formatDateTime(reviewState.item.suggestedDueAt)}</p>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => onConvertTodo(reviewState.item._id)}
              disabled={getRecord(`todo:${reviewState.item._id}`).pending}
              aria-disabled={getRecord(`todo:${reviewState.item._id}`).pending}
            >
              {getRecord(`todo:${reviewState.item._id}`).pending ? "Converting..." : "Convert to TODO"}
            </button>
            {getRecord(`todo:${reviewState.item._id}`).error ? (
              <p className="queue-meta action-inline-error" role="alert">
                {getRecord(`todo:${reviewState.item._id}`).error}
              </p>
            ) : null}
          </div>
        ) : null}

        {reviewState?.kind === "guardrails" ? (
          <div className="stack compact">
            <p className="queue-title">Severity: {reviewState.item.severity}</p>
            <p className="queue-body">{reviewState.item.reason}</p>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => onResolveGuardrail(reviewState.item._id)}
              disabled={getRecord(`guardrail:resolve:${reviewState.item._id}`).pending}
              aria-disabled={getRecord(`guardrail:resolve:${reviewState.item._id}`).pending}
            >
              {getRecord(`guardrail:resolve:${reviewState.item._id}`).pending ? "Resolving..." : "Resolve"}
            </button>
            {getRecord(`guardrail:resolve:${reviewState.item._id}`).error ? (
              <p className="queue-meta action-inline-error" role="alert">
                {getRecord(`guardrail:resolve:${reviewState.item._id}`).error}
              </p>
            ) : null}
          </div>
        ) : null}
      </UIModal>
    </>
  );
}

export function LiveQueue() {
  return <QueueContent />;
}
