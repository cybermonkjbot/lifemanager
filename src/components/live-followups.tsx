"use client";

import { ActionNotices } from "@/components/action-notices";
import { formatDateTimeWithRelative, trim } from "@/lib/format";
import { useActionStateRegistry } from "@/lib/ui/action-state";
import { createFollowupActionHandlers, followupCommitmentLabel, followupStatusLabel, type FollowupItem } from "@/lib/ui/followups";
import { api } from "../../convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useMemo, useState } from "react";

type TimelineFilter = "all" | "needs_review" | "confirmed" | "queued_sent" | "failed" | "dismissed";

type TimelineItem = FollowupItem;

type TimelinePayload = {
  now: number;
  filter: TimelineFilter;
  totals: {
    all: number;
    visible: number;
    overdue: number;
    today: number;
    upcoming: number;
  };
  sections: {
    overdue: TimelineItem[];
    today: TimelineItem[];
    upcoming: TimelineItem[];
  };
};

function TimelineCard(args: {
  item: TimelineItem;
  now: number;
  onConfirm: (id: string) => void;
  onSnooze: (id: string, minutes: number) => void;
  onReschedule: (id: string, hoursAhead: number) => void;
  onDismiss: (id: string) => void;
  getRecord: ReturnType<typeof useActionStateRegistry>["getRecord"];
}) {
  const { item, now, onConfirm, onSnooze, onReschedule, onDismiss, getRecord } = args;
  const confirmRecord = getRecord(`followup:${item._id}`);
  const snoozeRecord = getRecord(`followup:snooze:${item._id}`);
  const rescheduleRecord = getRecord(`followup:reschedule:${item._id}`);
  const dismissRecord = getRecord(`followup:cancel:${item._id}`);
  const busy = confirmRecord.pending || snoozeRecord.pending || rescheduleRecord.pending || dismissRecord.pending;
  const closed = item.status === "sent" || item.status === "failed" || item.status === "cancelled";
  const sourceText = item.sourceSnippet?.trim() || item.sourceMessage?.text?.trim() || "";
  const confidence = typeof item.confidence === "number" ? Math.round(item.confidence * 100) : null;

  return (
    <div className="queue-item" aria-busy={busy}>
      <p className="queue-title">{item.thread?.title || item.thread?.jid || "Unknown thread"}</p>
      <p className="queue-meta">
        {followupCommitmentLabel(item)} · {followupStatusLabel(item.status)} · Due {formatDateTimeWithRelative(item.dueAt, now)}
      </p>
      <p className="queue-body">{item.reason}</p>
      {sourceText ? <p className="queue-meta">Source: {trim(sourceText, 220)}</p> : null}
      {confidence !== null ? <p className="queue-meta">Detector confidence: {confidence}%</p> : null}

      <div className="queue-actions">
        {item.status === "suggested" ? (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => onConfirm(item._id)}
            disabled={confirmRecord.pending}
            aria-disabled={confirmRecord.pending}
          >
            {confirmRecord.pending ? "Confirming…" : "Confirm"}
          </button>
        ) : null}
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
          onClick={() => onDismiss(item._id)}
          disabled={busy || closed}
          aria-disabled={busy || closed}
        >
          Dismiss
        </button>
        {item.thread?._id ? (
          <Link href={`/conversations?threadId=${item.thread._id}`} className="btn btn-ghost">
            Open Thread
          </Link>
        ) : null}
      </div>

      {confirmRecord.error ? (
        <p className="queue-meta action-inline-error" role="alert">
          {confirmRecord.error}
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
      {dismissRecord.error ? (
        <p className="queue-meta action-inline-error" role="alert">
          {dismissRecord.error}
        </p>
      ) : null}
    </div>
  );
}

function FollowupsContent() {
  const confirmFollowup = useMutation(api.followups.confirm);
  const rescheduleFollowup = useMutation(api.followups.reschedule);
  const snoozeFollowup = useMutation(api.followups.snooze);
  const cancelFollowup = useMutation(api.followups.cancel);
  const { runAction, getRecord, notices, dismissNotice } = useActionStateRegistry();

  const [filter, setFilter] = useState<TimelineFilter>("needs_review");

  const timeline = useQuery(api.followups.timeline, { limit: 180, filter }) as TimelinePayload | undefined;
  const loading = timeline === undefined;
  const now = timeline?.now ?? 0;
  const sections = timeline?.sections || { overdue: [], today: [], upcoming: [] };

  const headerCounts = useMemo(() => {
    return {
      overdue: sections.overdue.length,
      today: sections.today.length,
      upcoming: sections.upcoming.length,
      visible: timeline?.totals.visible || 0,
    };
  }, [sections.overdue.length, sections.today.length, sections.upcoming.length, timeline?.totals.visible]);

  const { onConfirm, onSnooze, onReschedule, onDismiss } = createFollowupActionHandlers({
    runAction,
    mutations: {
      confirmFollowup: async (args) => await confirmFollowup(args),
      snoozeFollowup: async (args) => await snoozeFollowup(args),
      rescheduleFollowup: async (args) => await rescheduleFollowup(args),
      cancelFollowup: async (args) => await cancelFollowup(args),
    },
  });

  const renderSection = (title: string, items: TimelineItem[]) => (
    <article className="panel-card">
      <h3>{title}</h3>
      <div className="stack">
        {items.map((item) => (
          <TimelineCard
            key={item._id}
            item={item}
            now={now}
            onConfirm={onConfirm}
            onSnooze={onSnooze}
            onReschedule={onReschedule}
            onDismiss={onDismiss}
            getRecord={getRecord}
          />
        ))}
        {!loading && items.length === 0 ? <p className="empty-line">No items in this section.</p> : null}
      </div>
    </article>
  );

  return (
    <section className="stack">
      <ActionNotices notices={notices} onDismiss={dismissNotice} />

      <article className="panel-card">
        <h3>Follow-up Timeline</h3>
        <p className="queue-meta">
          Visible: {headerCounts.visible} · Overdue: {headerCounts.overdue} · Today: {headerCounts.today} · Upcoming: {headerCounts.upcoming}
        </p>
        <div className="queue-focus-tabs" role="tablist" aria-label="Follow-up timeline filters">
          <button
            type="button"
            role="tab"
            aria-selected={filter === "needs_review"}
            className={`btn ${filter === "needs_review" ? "btn-primary" : "btn-ghost"}`}
            onClick={() => setFilter("needs_review")}
          >
            Needs Review
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={filter === "confirmed"}
            className={`btn ${filter === "confirmed" ? "btn-primary" : "btn-ghost"}`}
            onClick={() => setFilter("confirmed")}
          >
            Confirmed
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={filter === "queued_sent"}
            className={`btn ${filter === "queued_sent" ? "btn-primary" : "btn-ghost"}`}
            onClick={() => setFilter("queued_sent")}
          >
            Queued/Sent
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={filter === "failed"}
            className={`btn ${filter === "failed" ? "btn-primary" : "btn-ghost"}`}
            onClick={() => setFilter("failed")}
          >
            Failed
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={filter === "dismissed"}
            className={`btn ${filter === "dismissed" ? "btn-primary" : "btn-ghost"}`}
            onClick={() => setFilter("dismissed")}
          >
            Dismissed
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={filter === "all"}
            className={`btn ${filter === "all" ? "btn-primary" : "btn-ghost"}`}
            onClick={() => setFilter("all")}
          >
            All
          </button>
        </div>
        {loading ? <p className="empty-line">Loading follow-up timeline…</p> : null}
      </article>

      {renderSection("Overdue", sections.overdue)}
      {renderSection("Today", sections.today)}
      {renderSection("Upcoming", sections.upcoming)}
    </section>
  );
}

export function LiveFollowups() {
  return <FollowupsContent />;
}
