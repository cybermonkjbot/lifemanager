"use client";

import { ActionNotices } from "@/components/action-notices";
import { formatDateTime, trim } from "@/lib/format";
import { useActionStateRegistry } from "@/lib/ui/action-state";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

type BacklogTab = "all" | "critical" | "answer" | "restart" | "snoozed";
type SortMode = "importance" | "oldest" | "newest" | "relationship" | "activity";
type RelationshipValue = "girlfriend" | "relationship" | "friendship" | "casual" | "family" | "business";
type ImportanceValue = "critical" | "high" | "medium" | "low";

type BacklogItem = {
  threadId: string;
  stateId: string;
  title?: string;
  jid: string;
  isIgnored: boolean;
  unresolvedCount: number;
  pendingSince?: number;
  latestUnresolvedAt?: number;
  latestUnresolvedText: string;
  relationship: RelationshipValue;
  relationshipOverride?: RelationshipValue;
  importance: ImportanceValue;
  importanceOverride?: ImportanceValue;
  recommendation: "answer" | "answer_with_ack" | "restart" | "already_queued";
  score: number;
  snoozedUntil?: number;
  snoozeReason?: string;
  isSnoozed: boolean;
  pendingAgeMs: number;
};

function formatPendingAge(ms: number) {
  if (!ms || ms <= 0) {
    return "just now";
  }

  const totalHours = Math.floor(ms / (60 * 60 * 1000));
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;

  if (days > 0) {
    return `${days}d ${hours}h`;
  }

  if (totalHours > 0) {
    return `${totalHours}h`;
  }

  const minutes = Math.max(1, Math.floor(ms / (60 * 1000)));
  return `${minutes}m`;
}

function recommendationLabel(value: BacklogItem["recommendation"]) {
  if (value === "restart") {
    return "Kickstart";
  }
  if (value === "answer_with_ack") {
    return "Answer (with ack)";
  }
  if (value === "already_queued") {
    return "Already queued";
  }
  return "Answer now";
}

function tabFromCounts(items: BacklogItem[]) {
  const totals = {
    all: 0,
    critical: 0,
    answer: 0,
    restart: 0,
    snoozed: 0,
  };

  for (const item of items) {
    totals.all += 1;
    if (item.importance === "critical") {
      totals.critical += 1;
    }
    if (item.recommendation === "restart") {
      totals.restart += 1;
    }
    if (item.recommendation === "answer" || item.recommendation === "answer_with_ack") {
      totals.answer += 1;
    }
    if (item.isSnoozed) {
      totals.snoozed += 1;
    }
  }

  return totals;
}

function BacklogContent() {
  const refreshRecent = useMutation(api.backlog.refreshRecent);
  const createDraft = useMutation(api.backlog.createDraft);
  const setImportance = useMutation(api.backlog.setImportanceOverride);
  const setRelationship = useMutation(api.backlog.setRelationshipOverride);
  const snooze = useMutation(api.backlog.snooze);
  const unsnooze = useMutation(api.backlog.unsnooze);
  const ignoreThread = useMutation(api.backlog.ignoreThread);

  const { runAction, getRecord, notices, dismissNotice } = useActionStateRegistry();

  const [tab, setTab] = useState<BacklogTab>("all");
  const [sort, setSort] = useState<SortMode>("importance");
  const [relationshipFilter, setRelationshipFilter] = useState<"all" | RelationshipValue>("all");
  const hasHydratedRef = useRef(false);

  const queryArgs = useMemo(() => {
    return {
      limit: 240,
      importance: "all",
      recommendation: "all",
      relationship: relationshipFilter,
      scope: "all",
      sort,
      includeIgnored: true,
    } as const;
  }, [relationshipFilter, sort]);

  const backlog = useQuery(api.backlog.list, queryArgs) as BacklogItem[] | undefined;
  const loading = backlog === undefined;
  const items = useMemo(() => backlog || [], [backlog]);

  useEffect(() => {
    if (hasHydratedRef.current) {
      return;
    }

    hasHydratedRef.current = true;
    void runAction(
      "backlog:bootstrap-refresh",
      async () => {
        await refreshRecent({ limit: 360 });
      },
      {
        pendingLabel: "Refreshing backlog...",
        suppressSuccessNotice: true,
      },
    );
  }, [refreshRecent, runAction]);

  const counts = useMemo(() => tabFromCounts(items), [items]);

  const visibleItems = useMemo(() => {
    if (tab === "critical") {
      return items.filter((item) => item.importance === "critical");
    }

    if (tab === "answer") {
      return items.filter((item) => item.recommendation === "answer" || item.recommendation === "answer_with_ack");
    }

    if (tab === "restart") {
      return items.filter((item) => item.recommendation === "restart");
    }

    if (tab === "snoozed") {
      return items.filter((item) => item.isSnoozed);
    }

    return items.filter((item) => !item.isSnoozed);
  }, [items, tab]);

  const onRefresh = () => {
    void runAction(
      "backlog:refresh",
      async () => {
        await refreshRecent({ limit: 360 });
      },
      {
        pendingLabel: "Refreshing...",
        successMessage: "Backlog refreshed.",
      },
    );
  };

  const onCreateDraft = (threadId: string, mode: "answer" | "restart") => {
    const key = `backlog:draft:${mode}:${threadId}`;
    void runAction(
      key,
      async () => {
        await createDraft({
          threadId: threadId as Id<"threads">,
          mode,
        });
      },
      {
        pendingLabel: mode === "restart" ? "Creating kickstart draft..." : "Creating answer draft...",
        successMessage: mode === "restart" ? "Kickstart draft added to queue." : "Answer draft added to queue.",
      },
    );
  };

  const onSnooze = (threadId: string, minutes: number) => {
    const key = `backlog:snooze:${threadId}`;
    void runAction(
      key,
      async () => {
        await snooze({
          threadId: threadId as Id<"threads">,
          minutes,
        });
      },
      {
        pendingLabel: "Snoozing...",
        successMessage: "Thread snoozed.",
      },
    );
  };

  const onUnsnooze = (threadId: string) => {
    const key = `backlog:unsnooze:${threadId}`;
    void runAction(
      key,
      async () => {
        await unsnooze({ threadId: threadId as Id<"threads"> });
      },
      {
        pendingLabel: "Unsnoozing...",
        successMessage: "Thread is active again.",
      },
    );
  };

  const onIgnoreToggle = (threadId: string, enabled: boolean) => {
    const key = `backlog:ignore:${threadId}`;
    void runAction(
      key,
      async () => {
        await ignoreThread({
          threadId: threadId as Id<"threads">,
          enabled,
        });
      },
      {
        pendingLabel: enabled ? "Ignoring..." : "Unignoring...",
        successMessage: enabled ? "Thread ignored." : "Thread restored.",
      },
    );
  };

  const onImportanceChange = (threadId: string, value: string) => {
    const key = `backlog:importance:${threadId}`;
    void runAction(
      key,
      async () => {
        await setImportance({
          threadId: threadId as Id<"threads">,
          importance: value === "__auto" ? undefined : (value as ImportanceValue),
        });
      },
      {
        pendingLabel: "Saving importance...",
        successMessage: "Importance updated.",
      },
    );
  };

  const onRelationshipChange = (threadId: string, value: string) => {
    const key = `backlog:relationship:${threadId}`;
    void runAction(
      key,
      async () => {
        await setRelationship({
          threadId: threadId as Id<"threads">,
          relationship: value === "__auto" ? undefined : (value as RelationshipValue),
        });
      },
      {
        pendingLabel: "Saving relationship...",
        successMessage: "Relationship updated.",
      },
    );
  };

  return (
    <section className="panel-card">
      <ActionNotices notices={notices} onDismiss={dismissNotice} />
      <div className="backlog-toolbar">
        <div className="backlog-tabs">
          <button type="button" className={`btn ${tab === "all" ? "btn-primary" : "btn-ghost"}`} onClick={() => setTab("all")}>
            Active ({counts.all - counts.snoozed})
          </button>
          <button type="button" className={`btn ${tab === "critical" ? "btn-primary" : "btn-ghost"}`} onClick={() => setTab("critical")}>
            Critical ({counts.critical})
          </button>
          <button type="button" className={`btn ${tab === "answer" ? "btn-primary" : "btn-ghost"}`} onClick={() => setTab("answer")}>
            Answer ({counts.answer})
          </button>
          <button type="button" className={`btn ${tab === "restart" ? "btn-primary" : "btn-ghost"}`} onClick={() => setTab("restart")}>
            Kickstart ({counts.restart})
          </button>
          <button type="button" className={`btn ${tab === "snoozed" ? "btn-primary" : "btn-ghost"}`} onClick={() => setTab("snoozed")}>
            Snoozed ({counts.snoozed})
          </button>
        </div>

        <div className="backlog-filters">
          <label className="setup-input-group inline">
            <span className="queue-meta">Relationship</span>
            <select value={relationshipFilter} onChange={(event) => setRelationshipFilter(event.target.value as "all" | RelationshipValue)}>
              <option value="all">All</option>
              <option value="girlfriend">Girlfriend/Boyfriend</option>
              <option value="relationship">Romantic</option>
              <option value="friendship">Friendship</option>
              <option value="family">Family</option>
              <option value="business">Business</option>
              <option value="casual">Casual</option>
            </select>
          </label>

          <label className="setup-input-group inline">
            <span className="queue-meta">Sort</span>
            <select value={sort} onChange={(event) => setSort(event.target.value as SortMode)}>
              <option value="importance">Importance</option>
              <option value="oldest">Oldest pending</option>
              <option value="newest">Newest pending</option>
              <option value="relationship">Relationship</option>
              <option value="activity">Recent activity</option>
            </select>
          </label>

          <button
            type="button"
            className="btn btn-ghost"
            onClick={onRefresh}
            disabled={getRecord("backlog:refresh").pending}
            aria-disabled={getRecord("backlog:refresh").pending}
          >
            {getRecord("backlog:refresh").pending ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>

      <div className="stack">
        {loading ? <p className="empty-line">Loading unread backlog…</p> : null}

        {visibleItems.map((item) => {
          const answerKey = `backlog:draft:answer:${item.threadId}`;
          const restartKey = `backlog:draft:restart:${item.threadId}`;
          const snoozeKey = `backlog:snooze:${item.threadId}`;
          const unsnoozeKey = `backlog:unsnooze:${item.threadId}`;
          const ignoreKey = `backlog:ignore:${item.threadId}`;
          const importanceKey = `backlog:importance:${item.threadId}`;
          const relationshipKey = `backlog:relationship:${item.threadId}`;

          const isPending =
            getRecord(answerKey).pending ||
            getRecord(restartKey).pending ||
            getRecord(snoozeKey).pending ||
            getRecord(unsnoozeKey).pending ||
            getRecord(ignoreKey).pending ||
            getRecord(importanceKey).pending ||
            getRecord(relationshipKey).pending;

          const recommendedMode = item.recommendation === "restart" ? "restart" : "answer";

          return (
            <div key={item.stateId} className="queue-item" aria-busy={isPending}>
              <div className="backlog-row-head">
                <p className="queue-title">{item.title || item.jid}</p>
                <div className="backlog-badges">
                  <span className={`backlog-badge importance-${item.importance}`}>{item.importance}</span>
                  <span className="backlog-badge">{item.relationship}</span>
                  <span className="backlog-badge">{recommendationLabel(item.recommendation)}</span>
                </div>
              </div>

              <p className="queue-body">{trim(item.latestUnresolvedText || "(No text body)", 220)}</p>
              <p className="queue-meta">
                Pending: {formatPendingAge(item.pendingAgeMs)} · Unresolved: {item.unresolvedCount} · Last inbound: {formatDateTime(item.latestUnresolvedAt)} · Score: {item.score}
              </p>

              {item.isSnoozed ? (
                <p className="queue-meta">
                  Snoozed until {formatDateTime(item.snoozedUntil)}{item.snoozeReason ? ` · ${item.snoozeReason}` : ""}
                </p>
              ) : null}

              <div className="queue-actions">
                <button
                  type="button"
                  className={`btn ${recommendedMode === "answer" ? "btn-primary" : "btn-ghost"}`}
                  onClick={() => onCreateDraft(item.threadId, "answer")}
                  disabled={isPending || item.recommendation === "already_queued"}
                  aria-disabled={isPending || item.recommendation === "already_queued"}
                >
                  Answer Draft
                </button>
                <button
                  type="button"
                  className={`btn ${recommendedMode === "restart" ? "btn-primary" : "btn-ghost"}`}
                  onClick={() => onCreateDraft(item.threadId, "restart")}
                  disabled={isPending || item.recommendation === "already_queued"}
                  aria-disabled={isPending || item.recommendation === "already_queued"}
                >
                  Kickstart Draft
                </button>

                {item.isSnoozed ? (
                  <button type="button" className="btn btn-ghost" onClick={() => onUnsnooze(item.threadId)} disabled={isPending} aria-disabled={isPending}>
                    Unsnooze
                  </button>
                ) : (
                  <button type="button" className="btn btn-ghost" onClick={() => onSnooze(item.threadId, 24 * 60)} disabled={isPending} aria-disabled={isPending}>
                    Snooze 1d
                  </button>
                )}

                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => onIgnoreToggle(item.threadId, !item.isIgnored)}
                  disabled={isPending}
                  aria-disabled={isPending}
                >
                  {item.isIgnored ? "Unignore" : "Ignore"}
                </button>

                <Link href={`/conversations?threadId=${item.threadId}`} className="btn btn-ghost">
                  Open
                </Link>
              </div>

              <div className="backlog-overrides">
                <label className="setup-input-group inline">
                  <span className="queue-meta">Importance</span>
                  <select
                    value={item.importanceOverride || "__auto"}
                    onChange={(event) => onImportanceChange(item.threadId, event.target.value)}
                    disabled={isPending}
                    aria-disabled={isPending}
                  >
                    <option value="__auto">Auto</option>
                    <option value="critical">Critical</option>
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                </label>

                <label className="setup-input-group inline">
                  <span className="queue-meta">Relationship</span>
                  <select
                    value={item.relationshipOverride || "__auto"}
                    onChange={(event) => onRelationshipChange(item.threadId, event.target.value)}
                    disabled={isPending}
                    aria-disabled={isPending}
                  >
                    <option value="__auto">Auto</option>
                    <option value="girlfriend">Girlfriend/Boyfriend</option>
                    <option value="relationship">Romantic</option>
                    <option value="friendship">Friendship</option>
                    <option value="family">Family</option>
                    <option value="business">Business</option>
                    <option value="casual">Casual</option>
                  </select>
                </label>
              </div>
            </div>
          );
        })}

        {!loading && visibleItems.length === 0 ? <p className="empty-line">No backlog threads match this view.</p> : null}
      </div>
    </section>
  );
}

export function LiveBacklog() {
  return <BacklogContent />;
}
