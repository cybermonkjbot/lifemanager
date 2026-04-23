"use client";

import { ActionNotices } from "@/components/action-notices";
import { LoadingBlock, LoadingIndicator } from "@/components/loading-state";
import { ProviderFilter, type ProviderFilterValue } from "@/components/provider-filter";
import { formatDateTimeWithRelative, trim } from "@/lib/format";
import { useActionStateRegistry } from "@/lib/ui/action-state";
import { createFollowupActionHandlers, followupCommitmentLabel, followupStatusLabel, type FollowupItem } from "@/lib/ui/followups";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useMemo, useState, type FormEvent } from "react";

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

type ClearAllBatchResult = {
  cleared: number;
  scanned: number;
  hasMore: boolean;
};

type TodoItem = {
  _id: string;
  title: string;
  dueAt?: number;
  status: "open" | "done";
};

function formatIsoDate(value: Date) {
  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, "0");
  const day = `${value.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function buildAgendaEntries(args: {
  startDate: string;
  endDate: string;
  time: string;
  weekdaysOnly: boolean;
}) {
  const { startDate, endDate, time, weekdaysOnly } = args;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    throw new Error("Pick a valid start and end date.");
  }
  if (!/^\d{2}:\d{2}$/.test(time)) {
    throw new Error("Pick a valid reminder time.");
  }
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error("Pick a valid date range.");
  }
  if (end.getTime() < start.getTime()) {
    throw new Error("End date cannot be before start date.");
  }

  const [hoursText, minutesText] = time.split(":");
  const hours = Number(hoursText);
  const minutes = Number(minutesText);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    throw new Error("Pick a valid reminder time.");
  }

  const entries: Array<{ date: string; dueAt: number }> = [];
  let current = start;
  let guard = 0;
  while (current.getTime() <= end.getTime()) {
    const dayOfWeek = current.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    if (!weekdaysOnly || !isWeekend) {
      const due = new Date(current);
      due.setHours(hours, minutes, 0, 0);
      entries.push({
        date: formatIsoDate(current),
        dueAt: due.getTime(),
      });
    }
    current = addDays(current, 1);
    guard += 1;
    if (guard > 366) {
      throw new Error("Range too large. Keep it under one year.");
    }
  }

  if (entries.length === 0) {
    throw new Error("Range produced no days. Disable weekdays-only or adjust dates.");
  }
  return entries;
}

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
  const clearAllFollowups = useMutation(api.followups.clearAll);
  const createAgendaRange = useMutation(api.todos.createAgendaRange);
  const setTodoStatus = useMutation(api.todos.setTodoStatus);
  const { runAction, getRecord, notices, pushNotice, dismissNotice } = useActionStateRegistry();

  const [providerFilter, setProviderFilter] = useState<ProviderFilterValue>("all");
  const [filter, setFilter] = useState<TimelineFilter>("needs_review");
  const [agendaTitle, setAgendaTitle] = useState("");
  const [startDate, setStartDate] = useState(formatIsoDate(new Date()));
  const [endDate, setEndDate] = useState(formatIsoDate(addDays(new Date(), 13)));
  const [agendaTime, setAgendaTime] = useState("09:00");
  const [weekdaysOnly, setWeekdaysOnly] = useState(false);

  const timeline = useQuery(api.followups.timeline, {
    limit: 180,
    filter,
    provider: providerFilter,
  }) as TimelinePayload | undefined;
  const todoPayload = useQuery(api.todos.list, {
    todoLimit: 220,
    candidateLimit: 1,
  }) as { todos: TodoItem[] } | undefined;
  const loading = timeline === undefined;
  const now = timeline?.now ?? 0;
  const sections = timeline?.sections || { overdue: [], today: [], upcoming: [] };
  const openAgendaTodos = useMemo(() => {
    const todos = todoPayload?.todos || [];
    return todos
      .filter((todo) => todo.status === "open")
      .sort((a, b) => (a.dueAt ?? Number.MAX_SAFE_INTEGER) - (b.dueAt ?? Number.MAX_SAFE_INTEGER));
  }, [todoPayload?.todos]);

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
  const clearAllRecord = getRecord("followup:clear-all");

  const onClearAll = () => {
    const confirmed = window.confirm(
      "Clear all open follow-ups? This dismisses suggested, confirmed, and queued follow-ups across providers.",
    );
    if (!confirmed) {
      return;
    }

    void (async () => {
      const result = await runAction(
        "followup:clear-all",
        async () => {
          let totalCleared = 0;

          for (let i = 0; i < 20; i += 1) {
            const batch = (await clearAllFollowups({
              limit: 30,
            })) as ClearAllBatchResult;
            totalCleared += batch.cleared;

            if (!batch.hasMore || batch.cleared === 0) {
              break;
            }
          }

          return totalCleared;
        },
        {
          pendingLabel: "Clearing follow-ups…",
          suppressSuccessNotice: true,
        },
      );

      if (!result.executed || result.error) {
        return;
      }

      const totalCleared = result.value ?? 0;
      if (totalCleared > 0) {
        pushNotice("success", `Cleared ${totalCleared} follow-up${totalCleared === 1 ? "" : "s"}.`);
        return;
      }
      pushNotice("info", "No open follow-ups to clear.");
    })();
  };

  const onCreateAgenda = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void runAction(
      "agenda:create-range",
      async () => {
        const entries = buildAgendaEntries({
          startDate,
          endDate,
          time: agendaTime,
          weekdaysOnly,
        });
        const title = agendaTitle.trim().replace(/\s+/g, " ");
        if (!title) {
          throw new Error("Enter an agenda title.");
        }
        return await createAgendaRange({
          agenda: title,
          entries,
        });
      },
      {
        pendingLabel: "Creating agenda schedule…",
        suppressSuccessNotice: true,
      },
    ).then((outcome) => {
      if (!outcome.executed || outcome.error) {
        return;
      }
      const created = outcome.value?.created ?? 0;
      pushNotice("success", `Agenda scheduled for ${created} day${created === 1 ? "" : "s"}.`);
    });
  };

  const onMarkTodoDone = (todoId: string) => {
    void runAction(
      `agenda:done:${todoId}`,
      async () => {
        await setTodoStatus({ todoId: todoId as Id<"todos">, status: "done" });
      },
      {
        pendingLabel: "Marking done…",
        successMessage: "Agenda item marked done.",
      },
    );
  };

  const renderSection = (title: string, items: TimelineItem[]) => (
    <article className="panel-card">
      <h3>{title}</h3>
      <div className="stack">
        {loading ? <LoadingBlock label={`Loading ${title.toLowerCase()} follow-ups…`} rows={2} compact /> : null}
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
        <h3>Agenda Planner</h3>
        <p className="queue-meta">Select a calendar range and apply one agenda across the whole span.</p>
        <form className="stack" onSubmit={onCreateAgenda}>
          <label className="queue-meta" htmlFor="agenda-title-input">
            Agenda
          </label>
          <input
            id="agenda-title-input"
            className="input"
            placeholder="Morning deep work, outreach, and workout"
            value={agendaTitle}
            onChange={(event) => setAgendaTitle(event.target.value)}
          />
          <div className="queue-actions">
            <label className="queue-meta" htmlFor="agenda-start-date">
              Start
            </label>
            <input id="agenda-start-date" className="input" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
            <label className="queue-meta" htmlFor="agenda-end-date">
              End
            </label>
            <input id="agenda-end-date" className="input" type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
            <label className="queue-meta" htmlFor="agenda-time">
              Time
            </label>
            <input id="agenda-time" className="input" type="time" value={agendaTime} onChange={(event) => setAgendaTime(event.target.value)} />
          </div>
          <label className="queue-meta">
            <input
              type="checkbox"
              checked={weekdaysOnly}
              onChange={(event) => setWeekdaysOnly(event.target.checked)}
              style={{ marginRight: "0.5rem" }}
            />
            Weekdays only
          </label>
          <div className="queue-actions">
            <button
              type="submit"
              className="btn btn-primary"
              disabled={getRecord("agenda:create-range").pending}
              aria-disabled={getRecord("agenda:create-range").pending}
            >
              {getRecord("agenda:create-range").pending ? "Scheduling…" : "Schedule Agenda"}
            </button>
          </div>
        </form>

        <div className="stack">
          <p className="queue-meta">Open agenda items: {openAgendaTodos.length}</p>
          {openAgendaTodos.slice(0, 20).map((todo) => (
            <div key={todo._id} className="queue-item">
              <p className="queue-title">{todo.title}</p>
              <p className="queue-meta">
                {todo.dueAt ? `Due ${formatDateTimeWithRelative(todo.dueAt, Date.now())}` : "No due date"}
              </p>
              <div className="queue-actions">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => onMarkTodoDone(todo._id)}
                  disabled={getRecord(`agenda:done:${todo._id}`).pending}
                  aria-disabled={getRecord(`agenda:done:${todo._id}`).pending}
                >
                  {getRecord(`agenda:done:${todo._id}`).pending ? "Updating…" : "Mark done"}
                </button>
              </div>
            </div>
          ))}
          {openAgendaTodos.length > 20 ? (
            <p className="queue-meta">Showing first 20 items. Remaining: {openAgendaTodos.length - 20}.</p>
          ) : null}
          {openAgendaTodos.length === 0 ? <p className="empty-line">No open agenda items yet.</p> : null}
        </div>
      </article>

      <article className="panel-card">
        <h3>Timeline Overview</h3>
        <ProviderFilter
          value={providerFilter}
          onChange={setProviderFilter}
          label="Follow-ups provider filter"
        />
        <p className="queue-meta">
          Visible: {headerCounts.visible} · Overdue: {headerCounts.overdue} · Today: {headerCounts.today} · Upcoming: {headerCounts.upcoming}
        </p>
        <div className="queue-actions">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onClearAll}
            disabled={loading || clearAllRecord.pending}
            aria-disabled={loading || clearAllRecord.pending}
          >
            {clearAllRecord.pending ? "Clearing…" : "Clear all open"}
          </button>
        </div>
        {clearAllRecord.error ? (
          <p className="queue-meta action-inline-error" role="alert">
            {clearAllRecord.error}
          </p>
        ) : null}
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
        {loading ? <LoadingIndicator label="Loading follow-up timeline…" /> : null}
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
