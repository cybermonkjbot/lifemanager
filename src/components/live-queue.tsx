"use client";

import { ActionNotices } from "@/components/action-notices";
import { formatDateTime, trim } from "@/lib/format";
import { useActionStateRegistry } from "@/lib/ui/action-state";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";

function QueueContent() {
  const approveDraft = useMutation(api.draft.approve);
  const snoozeDraft = useMutation(api.draft.snooze);
  const confirmFollowup = useMutation(api.followups.confirm);
  const createTodoFromCandidate = useMutation(api.todos.fromCandidate);

  const { runAction, getRecord, isPending, notices, dismissNotice } = useActionStateRegistry();

  const queue = useQuery(api.queue.list, {}) as
    | {
        needsReply: Array<{
          _id: string;
          provider: string;
          delayMs: number;
          typingMs: number;
          text: string;
          sourceMessage?: { text?: string } | null;
          thread?: { title?: string; jid?: string } | null;
        }>;
        followupConfirmations: Array<{
          _id: string;
          reason: string;
          dueAt: number;
        }>;
        todoCandidates: Array<{
          _id: string;
          title: string;
          suggestedDueAt?: number;
        }>;
        guardrailFlags: Array<{
          _id: string;
          severity: string;
          reason: string;
        }>;
      }
    | undefined;
  const queueLoading = queue === undefined;
  const needsReply = queue?.needsReply || [];
  const followupConfirmations = queue?.followupConfirmations || [];
  const todoCandidates = queue?.todoCandidates || [];
  const guardrailFlags = queue?.guardrailFlags || [];

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

  return (
    <>
      <ActionNotices notices={notices} onDismiss={dismissNotice} />

      <section className="panel-grid two-col">
        <article className="panel-card">
          <h3>Needs Reply</h3>
          <div className="stack">
            {queueLoading ? <p className="empty-line">Loading reply queue…</p> : null}
            {needsReply.map((item) => {
              const sendKey = `send:${item._id}`;
              const snoozeKey = `snooze:${item._id}`;
              const rowPending = isPending(sendKey) || isPending(snoozeKey);
              const rowLabel = isPending(sendKey)
                ? "Sending..."
                : isPending(snoozeKey)
                  ? "Snoozing..."
                  : undefined;
              const rowError = getRecord(sendKey).error || getRecord(snoozeKey).error;

              return (
                <div key={item._id} className="queue-item" aria-busy={rowPending}>
                  <p className="queue-title">{item.thread?.title || item.thread?.jid || "Unknown contact"}</p>
                  <p className="queue-body">{trim(item.sourceMessage?.text || item.text || "")}</p>
                  <p className="queue-meta">
                    Provider: {item.provider} · Delay: {Math.round(item.delayMs / 1000)}s · Typing: {Math.round(item.typingMs / 1000)}s
                  </p>
                  <div className="queue-actions">
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => onSend(item._id)}
                      disabled={rowPending}
                      aria-disabled={rowPending}
                    >
                      Send
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => onSnooze(item._id)}
                      disabled={rowPending}
                      aria-disabled={rowPending}
                    >
                      Snooze 30m
                    </button>
                  </div>
                  {rowLabel ? <p className="queue-meta action-pending-label">{rowLabel}</p> : null}
                  {rowError ? (
                    <p className="queue-meta action-inline-error" role="alert">
                      {rowError}
                    </p>
                  ) : null}
                </div>
              );
            })}
            {!queueLoading && needsReply.length === 0 ? <p className="empty-line">No pending replies.</p> : null}
          </div>
        </article>

        <article className="panel-card">
          <h3>Follow-up Confirmations</h3>
          <div className="stack">
            {queueLoading ? <p className="empty-line">Loading follow-up confirmations…</p> : null}
            {followupConfirmations.map((item) => {
              const key = `followup:${item._id}`;
              const record = getRecord(key);

              return (
                <div key={item._id} className="queue-item" aria-busy={record.pending}>
                  <p className="queue-title">{item.reason}</p>
                  <p className="queue-body">Due: {formatDateTime(item.dueAt)}</p>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => onConfirmFollowup(item._id)}
                    disabled={record.pending}
                    aria-disabled={record.pending}
                  >
                    {record.pending ? "Confirming..." : "Confirm Follow-up"}
                  </button>
                  {record.error ? (
                    <p className="queue-meta action-inline-error" role="alert">
                      {record.error}
                    </p>
                  ) : null}
                </div>
              );
            })}
            {!queueLoading && followupConfirmations.length === 0 ? (
              <p className="empty-line">No follow-up confirmations pending.</p>
            ) : null}
          </div>
        </article>
      </section>

      <section className="panel-grid two-col">
        <article className="panel-card">
          <h3>TODO Candidates</h3>
          <div className="stack">
            {queueLoading ? <p className="empty-line">Loading TODO candidates…</p> : null}
            {todoCandidates.map((item) => {
              const key = `todo:${item._id}`;
              const record = getRecord(key);

              return (
                <div key={item._id} className="queue-item" aria-busy={record.pending}>
                  <p className="queue-title">{item.title}</p>
                  <p className="queue-meta">Suggested due: {formatDateTime(item.suggestedDueAt)}</p>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => onConvertTodo(item._id)}
                    disabled={record.pending}
                    aria-disabled={record.pending}
                  >
                    {record.pending ? "Converting..." : "Convert to TODO"}
                  </button>
                  {record.error ? (
                    <p className="queue-meta action-inline-error" role="alert">
                      {record.error}
                    </p>
                  ) : null}
                </div>
              );
            })}
            {!queueLoading && todoCandidates.length === 0 ? <p className="empty-line">No todo candidates.</p> : null}
          </div>
        </article>

        <article className="panel-card">
          <h3>Guardrail Flags</h3>
          <div className="stack">
            {queueLoading ? <p className="empty-line">Loading guardrail flags…</p> : null}
            {guardrailFlags.map((item) => (
              <div key={item._id} className="queue-item">
                <p className="queue-title">Severity: {item.severity}</p>
                <p className="queue-body">{item.reason}</p>
              </div>
            ))}
            {!queueLoading && guardrailFlags.length === 0 ? <p className="empty-line">No active safety flags.</p> : null}
          </div>
        </article>
      </section>
    </>
  );
}

export function LiveQueue() {
  return <QueueContent />;
}
