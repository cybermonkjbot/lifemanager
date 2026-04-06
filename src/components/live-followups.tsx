"use client";

import { ActionNotices } from "@/components/action-notices";
import { formatDateTime } from "@/lib/format";
import { useActionStateRegistry } from "@/lib/ui/action-state";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";

function FollowupsContent() {
  const confirmFollowup = useMutation(api.followups.confirm);
  const { runAction, getRecord, notices, dismissNotice } = useActionStateRegistry();

  const followups = useQuery(api.followups.list, { limit: 80 }) as
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

  return (
    <section className="panel-card">
      <ActionNotices notices={notices} onDismiss={dismissNotice} />
      <h3>Follow-up Timeline</h3>
      <div className="stack">
        {followupsLoading ? <p className="empty-line">Loading follow-ups…</p> : null}
        {followupItems.map((item) => {
          const key = `followup:${item._id}`;
          const record = getRecord(key);

          return (
            <div key={item._id} className="queue-item" aria-busy={record.pending}>
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
              {record.error ? (
                <p className="queue-meta action-inline-error" role="alert">
                  {record.error}
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
