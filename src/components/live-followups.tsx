"use client";

import { ActionNotices } from "@/components/action-notices";
import { formatDateTime } from "@/lib/format";
import { useActionStateRegistry } from "@/lib/ui/action-state";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";

type FollowupStatus = "all" | "suggested" | "confirmed" | "queued" | "sent" | "failed" | "cancelled";
type FollowupSort = "due_asc" | "due_desc" | "updated_desc";

function FollowupsContent() {
  const confirmFollowup = useMutation(api.followups.confirm);
  const rescheduleFollowup = useMutation(api.followups.reschedule);
  const snoozeFollowup = useMutation(api.followups.snooze);
  const cancelFollowup = useMutation(api.followups.cancel);
  const { runAction, getRecord, notices, dismissNotice } = useActionStateRegistry();
  const [statusFilter, setStatusFilter] = useState<FollowupStatus>("all");
  const [sort, setSort] = useState<FollowupSort>("due_asc");

  const followups = useQuery(api.followups.list, { limit: 120, status: statusFilter, sort }) as
    | Array<{
        _id: string;
        reason: string;
        dueAt: number;
        status: string;
        thread?: { title?: string; jid?: string } | null;
      }>
    | undefined;
  const followupsLoading = followups === undefined;
  const followupItems = followups || [];

  const onConfirm = (followUpId: string) => {
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

  const onSnooze = (followUpId: string, minutes: number) => {
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

  const onReschedule = (followUpId: string, hoursAhead: number) => {
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

  const onCancel = (followUpId: string) => {
    const key = `followup:cancel:${followUpId}`;
    void runAction(
      key,
      async () => {
        await cancelFollowup({ followUpId: followUpId as Id<"followUps"> });
      },
      {
        pendingLabel: "Cancelling...",
        successMessage: "Follow-up cancelled.",
      },
    );
  };

  return (
    <section className="panel-card">
      <ActionNotices notices={notices} onDismiss={dismissNotice} />
      <h3>Follow-up Timeline</h3>
      <div className="queue-actions">
        <label className="setup-input-group inline">
          <span className="queue-meta">Status</span>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as FollowupStatus)}>
            <option value="all">All</option>
            <option value="suggested">Suggested</option>
            <option value="confirmed">Confirmed</option>
            <option value="queued">Queued</option>
            <option value="sent">Sent</option>
            <option value="failed">Failed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </label>
        <label className="setup-input-group inline">
          <span className="queue-meta">Sort</span>
          <select value={sort} onChange={(event) => setSort(event.target.value as FollowupSort)}>
            <option value="due_asc">Due (oldest first)</option>
            <option value="due_desc">Due (latest first)</option>
            <option value="updated_desc">Recently updated</option>
          </select>
        </label>
      </div>
      <div className="stack">
        {followupsLoading ? <p className="empty-line">Loading follow-ups…</p> : null}
        {followupItems.map((item) => {
          const key = `followup:${item._id}`;
          const record = getRecord(key);
          const snoozeRecord = getRecord(`followup:snooze:${item._id}`);
          const rescheduleRecord = getRecord(`followup:reschedule:${item._id}`);
          const cancelRecord = getRecord(`followup:cancel:${item._id}`);
          const busy = record.pending || snoozeRecord.pending || rescheduleRecord.pending || cancelRecord.pending;
          const closed = item.status === "sent" || item.status === "failed" || item.status === "cancelled";

          return (
            <div key={item._id} className="queue-item" aria-busy={busy}>
              <p className="queue-title">{item.thread?.title || item.thread?.jid || "Unknown thread"}</p>
              <p className="queue-body">{item.reason}</p>
              <p className="queue-meta">
                Due: {formatDateTime(item.dueAt)} · Status: {item.status}
              </p>
              {item.status === "suggested" ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => onConfirm(item._id)}
                  disabled={record.pending}
                  aria-disabled={record.pending}
                >
                  {record.pending ? "Confirming..." : "Confirm"}
                </button>
              ) : null}
              <div className="queue-actions">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => onSnooze(item._id, 24 * 60)}
                  disabled={busy || closed}
                  aria-disabled={busy || closed}
                >
                  Snooze 1d
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => onReschedule(item._id, 24)}
                  disabled={busy || closed}
                  aria-disabled={busy || closed}
                >
                  +24h
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => onReschedule(item._id, 72)}
                  disabled={busy || closed}
                  aria-disabled={busy || closed}
                >
                  +72h
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => onCancel(item._id)}
                  disabled={busy || closed}
                  aria-disabled={busy || closed}
                >
                  Cancel
                </button>
              </div>
              {record.error ? (
                <p className="queue-meta action-inline-error" role="alert">
                  {record.error}
                </p>
              ) : null}
              {snoozeRecord.error ? (
                <p className="queue-meta action-inline-error" role="alert">
                  {snoozeRecord.error}
                </p>
              ) : null}
              {rescheduleRecord.error ? (
                <p className="queue-meta action-inline-error" role="alert">
                  {rescheduleRecord.error}
                </p>
              ) : null}
              {cancelRecord.error ? (
                <p className="queue-meta action-inline-error" role="alert">
                  {cancelRecord.error}
                </p>
              ) : null}
            </div>
          );
        })}
        {!followupsLoading && followupItems.length === 0 ? <p className="empty-line">No follow-ups yet.</p> : null}
      </div>
    </section>
  );
}

export function LiveFollowups() {
  return <FollowupsContent />;
}
