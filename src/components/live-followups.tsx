"use client";

import { ActionNotices } from "@/components/action-notices";
import { SegmentedControl } from "@/components/app-ui";
import { EmptyState } from "@/components/empty-state";
import { LoadingBlock, LoadingIndicator } from "@/components/loading-state";
import { ProviderFilter, type ProviderFilterValue } from "@/components/provider-filter";
import { useTenantScopeArgs } from "@/components/tenant-scope-provider";
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

function parseQuickRescheduleHours(input: string) {
  const normalized = input.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (normalized === "tomorrow") {
    return 24;
  }

  const match = normalized.match(/^(\d+)\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)$/);
  if (!match) {
    return null;
  }

  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }

  const unit = match[2];
  if (unit.startsWith("m")) {
    return Math.max(1, Math.ceil(amount / 60));
  }
  if (unit.startsWith("d")) {
    return amount * 24;
  }
  return amount;
}

function TimelineCard(args: {
  item: TimelineItem;
  now: number;
  tone?: "priority" | "standard";
  onConfirm: (id: string) => void;
  onSnooze: (id: string, minutes: number) => void;
  onReschedule: (id: string, hoursAhead: number) => void;
  onDismiss: (id: string) => void;
  getRecord: ReturnType<typeof useActionStateRegistry>["getRecord"];
}) {
  const { item, now, tone = "standard", onConfirm, onSnooze, onReschedule, onDismiss, getRecord } = args;
  const [quickReschedule, setQuickReschedule] = useState("");
  const confirmRecord = getRecord(`followup:${item._id}`);
  const snoozeRecord = getRecord(`followup:snooze:${item._id}`);
  const rescheduleRecord = getRecord(`followup:reschedule:${item._id}`);
  const dismissRecord = getRecord(`followup:cancel:${item._id}`);
  const busy = confirmRecord.pending || snoozeRecord.pending || rescheduleRecord.pending || dismissRecord.pending;
  const closed = item.status === "sent" || item.status === "failed" || item.status === "cancelled";
  const sourceText = item.sourceSnippet?.trim() || item.sourceMessage?.text?.trim() || "";
  const confidence = typeof item.confidence === "number" ? Math.round(item.confidence * 100) : null;
  const quickRescheduleHours = parseQuickRescheduleHours(quickReschedule);
  const quickRescheduleInvalid = quickReschedule.trim().length > 0 && quickRescheduleHours === null;
  const isPriority = tone === "priority";

  return (
    <div className={`followup-item ${isPriority ? "followup-item-priority" : ""}`} aria-busy={busy}>
      <div className="followup-item-copy">
        <p className="followup-item-kicker">{followupCommitmentLabel(item)}</p>
        <h3>{item.thread?.title || item.thread?.jid || "Unknown thread"}</h3>
        <p className="followup-item-due">
          {followupStatusLabel(item.status)} · Due {formatDateTimeWithRelative(item.dueAt, now)}
        </p>
        <p className="followup-item-reason">{item.reason}</p>
        {sourceText ? <p className="followup-item-source">Source: {trim(sourceText, isPriority ? 260 : 180)}</p> : null}
        {confidence !== null ? <p className="followup-item-source">Confidence: {confidence}%</p> : null}
        {quickRescheduleInvalid ? (
          <p className="queue-meta action-inline-error" role="status">
            Use values like `6h`, `2d`, `30m`, or `tomorrow`.
          </p>
        ) : null}
      </div>

      <div className="followup-item-actions">
        <div className="queue-actions followups-primary-actions">
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
        <div className="followups-reschedule-inline">
          <label htmlFor={`followup-reschedule-${item._id}`} className="sr-only">
            Quick reschedule
          </label>
          <input
            id={`followup-reschedule-${item._id}`}
            type="text"
            className="input"
            value={quickReschedule}
            onChange={(event) => setQuickReschedule(event.target.value)}
            placeholder="6h, 2d, tomorrow"
            aria-label="Quick reschedule"
            disabled={busy || closed}
          />
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              if (!quickRescheduleHours) {
                return;
              }
              onReschedule(item._id, quickRescheduleHours);
              setQuickReschedule("");
            }}
            disabled={busy || closed || quickRescheduleHours === null}
            aria-disabled={busy || closed || quickRescheduleHours === null}
          >
            Apply
          </button>
        </div>
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
  const tenantScope = useTenantScopeArgs();
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
    ...tenantScope,
    limit: 180,
    filter,
    provider: providerFilter,
  }) as TimelinePayload | undefined;
  const todoPayload = useQuery(api.todos.list, {
    ...tenantScope,
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
  const priorityFollowup = useMemo(() => {
    return sections.overdue[0] || sections.today[0] || sections.upcoming[0] || null;
  }, [sections.overdue, sections.today, sections.upcoming]);
  const prioritySection = useMemo(() => {
    if (!priorityFollowup) {
      return "";
    }
    if (sections.overdue.some((item) => item._id === priorityFollowup._id)) {
      return "Overdue";
    }
    if (sections.today.some((item) => item._id === priorityFollowup._id)) {
      return "Today";
    }
    return "Upcoming";
  }, [priorityFollowup, sections.overdue, sections.today]);
  const quietSections = useMemo(
    () => ({
      overdue: priorityFollowup
        ? sections.overdue.filter((item) => item._id !== priorityFollowup._id)
        : sections.overdue,
      today: priorityFollowup
        ? sections.today.filter((item) => item._id !== priorityFollowup._id)
        : sections.today,
      upcoming: priorityFollowup
        ? sections.upcoming.filter((item) => item._id !== priorityFollowup._id)
        : sections.upcoming,
    }),
    [priorityFollowup, sections.overdue, sections.today, sections.upcoming],
  );

  const headerCounts = useMemo(() => {
    return {
      overdue: sections.overdue.length,
      today: sections.today.length,
      upcoming: sections.upcoming.length,
      visible: timeline?.totals.visible || 0,
    };
  }, [sections.overdue.length, sections.today.length, sections.upcoming.length, timeline?.totals.visible]);
  const timelineFilters = [
    { id: "needs_review", label: "Needs review" },
    { id: "confirmed", label: "Confirmed" },
    { id: "queued_sent", label: "Queued/Sent" },
    { id: "failed", label: "Failed" },
    { id: "dismissed", label: "Dismissed" },
    { id: "all", label: "All" },
  ] satisfies Array<{ id: TimelineFilter; label: string }>;

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
      "Dismiss every open follow-up? Suggested, confirmed, and queued follow-ups across providers will be closed.",
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
              ...tenantScope,
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
          pendingLabel: "Dismissing follow-ups…",
          suppressSuccessNotice: true,
        },
      );

      if (!result.executed || result.error) {
        return;
      }

      const totalCleared = result.value ?? 0;
      if (totalCleared > 0) {
        pushNotice("success", `Dismissed ${totalCleared} follow-up${totalCleared === 1 ? "" : "s"}.`);
        return;
      }
      pushNotice("info", "No open follow-ups to dismiss.");
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
          ...tenantScope,
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
    <section className="followups-drip-section">
      <div className="followups-drip-heading">
        <h3>{title}</h3>
        <span>{items.length}</span>
      </div>
      <div className="followups-drip-list">
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
        {!loading && items.length === 0 && !priorityFollowup ? (
          <EmptyState
            variant="followups"
            compact
            title={`No ${title.toLowerCase()} follow-ups.`}
            description="Follow-ups will move into this section as they become due or need review."
          />
        ) : null}
      </div>
    </section>
  );

  return (
    <section className="followups-workspace">
      <ActionNotices notices={notices} onDismiss={dismissNotice} />

      <div className="followups-canvas">
        <div className="followups-main-stage">
          <section className="followups-priority-panel" aria-live="polite">
            <div className="followups-priority-head">
              <div>
                <p className="settings-eyebrow">Next follow-up</p>
                <h2>{priorityFollowup ? prioritySection : "Clear for now"}</h2>
              </div>
              <dl className="followups-priority-counts" aria-label="Follow-up counts">
                <div>
                  <dt>Overdue</dt>
                  <dd>{headerCounts.overdue}</dd>
                </div>
                <div>
                  <dt>Today</dt>
                  <dd>{headerCounts.today}</dd>
                </div>
                <div>
                  <dt>Later</dt>
                  <dd>{headerCounts.upcoming}</dd>
                </div>
              </dl>
            </div>
            {loading ? <LoadingBlock label="Loading next follow-up…" rows={3} /> : null}
            {!loading && priorityFollowup ? (
              <TimelineCard
                item={priorityFollowup}
                now={now}
                tone="priority"
                onConfirm={onConfirm}
                onSnooze={onSnooze}
                onReschedule={onReschedule}
                onDismiss={onDismiss}
                getRecord={getRecord}
              />
            ) : null}
            {!loading && !priorityFollowup ? (
              <EmptyState
                variant="followups"
                title="No follow-ups need attention."
                description="When a reminder needs review, it will appear here first."
              />
            ) : null}
          </section>

          <div className="followups-stream">
            <div className="followups-stream-head">
              <div>
                <p className="settings-eyebrow">Coming next</p>
                <h3>Everything else</h3>
              </div>
              {loading ? <LoadingIndicator label="Refreshing…" /> : null}
            </div>
            {renderSection("Overdue", quietSections.overdue)}
            {renderSection("Today", quietSections.today)}
            {renderSection("Upcoming", quietSections.upcoming)}
          </div>
        </div>

        <aside className="followups-command-rail" aria-label="Follow-up controls">
          <section className="followups-rail-section">
            <h3>View</h3>
            <ProviderFilter value={providerFilter} onChange={setProviderFilter} label="Follow-ups provider filter" />
            <SegmentedControl label="Follow-up timeline filters" value={filter} options={timelineFilters} onChange={setFilter} className="followups-tab-row" />
            <p className="queue-meta">
              {headerCounts.visible} visible · {openAgendaTodos.length} agenda item{openAgendaTodos.length === 1 ? "" : "s"}
            </p>
            {headerCounts.visible > 0 ? (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={onClearAll}
                disabled={loading || clearAllRecord.pending}
                aria-disabled={loading || clearAllRecord.pending}
              >
                {clearAllRecord.pending ? "Dismissing…" : "Dismiss all open"}
              </button>
            ) : null}
            {clearAllRecord.error ? (
              <p className="queue-meta action-inline-error" role="alert">
                {clearAllRecord.error}
              </p>
            ) : null}
          </section>

          <section className="followups-rail-section">
            <h3>Agenda</h3>
            <form className="stack followups-agenda-form" onSubmit={onCreateAgenda}>
              <label className="stack compact" htmlFor="agenda-title-input">
                <span className="queue-meta">Agenda</span>
                <input
                  id="agenda-title-input"
                  className="input"
                  placeholder="Morning deep work"
                  value={agendaTitle}
                  onChange={(event) => setAgendaTitle(event.target.value)}
                />
              </label>
              <div className="followups-agenda-grid">
                <label className="stack compact" htmlFor="agenda-start-date">
                  <span className="queue-meta">Start</span>
                  <input id="agenda-start-date" className="input" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
                </label>
                <label className="stack compact" htmlFor="agenda-end-date">
                  <span className="queue-meta">End</span>
                  <input id="agenda-end-date" className="input" type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
                </label>
                <label className="stack compact" htmlFor="agenda-time">
                  <span className="queue-meta">Time</span>
                  <input id="agenda-time" className="input" type="time" value={agendaTime} onChange={(event) => setAgendaTime(event.target.value)} />
                </label>
              </div>
              <label className="followups-weekdays-toggle">
                <input type="checkbox" checked={weekdaysOnly} onChange={(event) => setWeekdaysOnly(event.target.checked)} />
                <span>Weekdays only</span>
              </label>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={getRecord("agenda:create-range").pending}
                aria-disabled={getRecord("agenda:create-range").pending}
              >
                {getRecord("agenda:create-range").pending ? "Scheduling…" : "Schedule"}
              </button>
            </form>
          </section>

          <details className="followups-control-section">
            <summary className="followups-control-summary">Open agenda items ({openAgendaTodos.length})</summary>
            <div className="stack">
              {openAgendaTodos.slice(0, 20).map((todo) => (
                <div key={todo._id} className="followups-agenda-item">
                  <p className="queue-title">{todo.title}</p>
                  <p className="queue-meta">
                    {todo.dueAt ? `Due ${formatDateTimeWithRelative(todo.dueAt, now)}` : "No due date"}
                  </p>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => onMarkTodoDone(todo._id)}
                    disabled={getRecord(`agenda:done:${todo._id}`).pending}
                    aria-disabled={getRecord(`agenda:done:${todo._id}`).pending}
                  >
                    {getRecord(`agenda:done:${todo._id}`).pending ? "Updating…" : "Done"}
                  </button>
                </div>
              ))}
              {openAgendaTodos.length > 20 ? (
                <p className="queue-meta">Showing first 20 items. Remaining: {openAgendaTodos.length - 20}.</p>
              ) : null}
              {openAgendaTodos.length === 0 ? (
                <EmptyState
                  variant="tasks"
                  compact
                  title="No open agenda tasks yet."
                  description="Scheduled agenda items will collect here until they are completed."
                />
              ) : null}
            </div>
          </details>
        </aside>
      </div>
    </section>
  );
}

export function LiveFollowups() {
  return <FollowupsContent />;
}
