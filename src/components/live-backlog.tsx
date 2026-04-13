"use client";

import { ActionNotices } from "@/components/action-notices";
import { LoadingBlock } from "@/components/loading-state";
import { ProviderFilter, type ProviderFilterValue } from "@/components/provider-filter";
import { formatDateTime, trim } from "@/lib/format";
import { useActionStateRegistry } from "@/lib/ui/action-state";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

type BacklogTab = "all" | "critical" | "answer" | "restart" | "snoozed";
type SortMode = "importance" | "oldest" | "newest" | "relationship" | "activity";
type RelationshipValue = "girlfriend" | "relationship" | "friendship" | "casual" | "family" | "business";
type ImportanceValue = "critical" | "high" | "medium" | "low";

const RELATIONSHIP_OPTIONS: Array<{ value: RelationshipValue; label: string }> = [
  { value: "girlfriend", label: "Girlfriend/Boyfriend" },
  { value: "relationship", label: "Romantic" },
  { value: "friendship", label: "Friendship" },
  { value: "family", label: "Family" },
  { value: "business", label: "Business" },
  { value: "casual", label: "Casual" },
];

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
    return "Reconnect";
  }
  if (value === "answer_with_ack") {
    return "Reply with acknowledgement";
  }
  if (value === "already_queued") {
    return "Already queued";
  }
  return "Reply now";
}

function draftModeLabel(mode: "answer" | "restart") {
  return mode === "restart" ? "Reconnect Draft" : "Reply Draft";
}

function recommendationHint(item: BacklogItem) {
  if (item.recommendation === "restart") {
    return "Use a gentle check-in to reopen the thread before diving into details.";
  }
  if (item.recommendation === "answer_with_ack") {
    return "A short delay acknowledgement is added before the direct reply.";
  }
  if (item.recommendation === "already_queued") {
    return "There is already a pending send for this thread.";
  }
  return "A direct response is likely the fastest way to resolve this thread.";
}

function emptyStateMessage(tab: BacklogTab) {
  if (tab === "critical") {
    return "No critical backlog threads right now.";
  }
  if (tab === "answer") {
    return "No threads need direct replies in this view.";
  }
  if (tab === "restart") {
    return "No threads need a reconnect draft right now.";
  }
  if (tab === "snoozed") {
    return "Nothing is snoozed right now.";
  }
  return "No active backlog threads match these filters.";
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
  const clearAll = useMutation(api.backlog.clearAll);
  const createDraft = useMutation(api.backlog.createDraft);
  const setImportance = useMutation(api.backlog.setImportanceOverride);
  const setRelationship = useMutation(api.backlog.setRelationshipOverride);
  const snooze = useMutation(api.backlog.snooze);
  const unsnooze = useMutation(api.backlog.unsnooze);
  const ignoreThread = useMutation(api.backlog.ignoreThread);

  const { runAction, getRecord, notices, dismissNotice, pushNotice } = useActionStateRegistry();

  const [tab, setTab] = useState<BacklogTab>("all");
  const [providerFilter, setProviderFilter] = useState<ProviderFilterValue>("all");
  const [sort, setSort] = useState<SortMode>("importance");
  const [relationshipFilter, setRelationshipFilter] = useState<"all" | RelationshipValue>("all");
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(120);
  const [snoozeMinutes, setSnoozeMinutes] = useState(24 * 60);
  const [snoozeReason, setSnoozeReason] = useState("");
  const [selectedThreadIds, setSelectedThreadIds] = useState<string[]>([]);
  const hasHydratedRef = useRef(false);

  const queryArgs = useMemo(() => {
    return {
      limit,
      provider: providerFilter,
      importance: "all",
      recommendation: "all",
      relationship: relationshipFilter,
      scope: "all",
      sort,
      includeIgnored: true,
      search,
    } as const;
  }, [limit, providerFilter, relationshipFilter, search, sort]);

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
  const visibleThreadIds = useMemo(() => new Set(visibleItems.map((item) => item.threadId)), [visibleItems]);
  const selectedVisibleThreadIds = useMemo(
    () => selectedThreadIds.filter((threadId) => visibleThreadIds.has(threadId)),
    [selectedThreadIds, visibleThreadIds],
  );
  const allVisibleSelected =
    visibleItems.length > 0 && visibleItems.every((item) => selectedVisibleThreadIds.includes(item.threadId));
  const selectedCount = selectedVisibleThreadIds.length;

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

  const onClearAll = () => {
    const confirmed = window.confirm(
      "Clear the entire backlog now? This resets backlog history so old unresolved messages will not reappear.",
    );
    if (!confirmed) {
      return;
    }

    void runAction(
      "backlog:clear-all",
      async () => {
        const result = await clearAll({});
        setSelectedThreadIds([]);
        if (result.continuing) {
          pushNotice("info", "Large backlog clear is continuing in the background.");
        }
      },
      {
        pendingLabel: "Clearing backlog...",
        successMessage: "Backlog cleared.",
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
        await refreshRecent({ limit: 180 });
      },
      {
        pendingLabel: mode === "restart" ? "Creating reconnect draft..." : "Creating reply draft...",
        successMessage:
          mode === "restart" ? "Reconnect draft added to review queue." : "Reply draft added to review queue.",
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
          reason: snoozeReason.trim() || undefined,
        });
      },
      {
        pendingLabel: "Snoozing...",
        successMessage: "Thread snoozed.",
      },
    );
  };

  const bulkSnooze = () => {
    const targets = [...selectedVisibleThreadIds];
    if (targets.length === 0) {
      return;
    }
    void runAction(
      "backlog:bulk-snooze",
      async () => {
        for (const threadId of targets) {
          await snooze({
            threadId: threadId as Id<"threads">,
            minutes: Math.max(5, Math.round(snoozeMinutes)),
            reason: snoozeReason.trim() || undefined,
          });
        }
      },
      {
        pendingLabel: "Snoozing selected threads...",
        successMessage: `Snoozed ${targets.length} thread${targets.length === 1 ? "" : "s"}.`,
      },
    );
  };

  const bulkIgnore = (enabled: boolean) => {
    const targets = [...selectedVisibleThreadIds];
    if (targets.length === 0) {
      return;
    }
    void runAction(
      enabled ? "backlog:bulk-ignore" : "backlog:bulk-unignore",
      async () => {
        for (const threadId of targets) {
          await ignoreThread({
            threadId: threadId as Id<"threads">,
            enabled,
          });
        }
      },
      {
        pendingLabel: enabled ? "Ignoring selected threads..." : "Restoring selected threads...",
        successMessage: enabled
          ? `Ignored ${targets.length} thread${targets.length === 1 ? "" : "s"}.`
          : `Restored ${targets.length} thread${targets.length === 1 ? "" : "s"}.`,
      },
    );
  };

  const toggleSelected = (threadId: string, checked: boolean) => {
    setSelectedThreadIds((prev) => {
      if (checked) {
        return prev.includes(threadId) ? prev : [...prev, threadId];
      }
      return prev.filter((id) => id !== threadId);
    });
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
    <section className="panel-card backlog-workspace">
      <ActionNotices notices={notices} onDismiss={dismissNotice} />

      <header className="backlog-command-header">
        <div className="backlog-command-copy">
          <p className="backlog-kicker">Unread backlog</p>
          <h1 className="backlog-command-title">Triage stale threads before they cool off.</h1>
          <p className="queue-meta backlog-command-subtitle">
            Reply Draft answers the latest unresolved message. Reconnect Draft starts with a warm check-in for stale threads.
            Both are queued for review before sending.
          </p>
        </div>
        <div className="backlog-command-metrics" aria-label="Backlog summary">
          <p className="backlog-metric-value">{counts.all - counts.snoozed}</p>
          <p className="backlog-metric-label">Active threads</p>
          <p className="backlog-metric-divider" aria-hidden="true" />
          <p className="backlog-metric-value">{counts.critical}</p>
          <p className="backlog-metric-label">Critical now</p>
          <p className="backlog-metric-divider" aria-hidden="true" />
          <p className="backlog-metric-value">{counts.restart}</p>
          <p className="backlog-metric-label">Need reconnect</p>
        </div>
      </header>

      <div className="backlog-operating-grid">
        <section className="backlog-side-rail">
          <div className="backlog-control-deck">
            <div className="backlog-control-topline">
              <ProviderFilter value={providerFilter} onChange={setProviderFilter} label="Backlog provider filter" />
              <div className="backlog-tabs" role="group" aria-label="Backlog scope tabs">
                <button type="button" className={`btn ${tab === "all" ? "btn-primary" : "btn-ghost"}`} onClick={() => setTab("all")}>
                  Active ({counts.all - counts.snoozed})
                </button>
                <button type="button" className={`btn ${tab === "critical" ? "btn-primary" : "btn-ghost"}`} onClick={() => setTab("critical")}>
                  Critical ({counts.critical})
                </button>
                <button type="button" className={`btn ${tab === "answer" ? "btn-primary" : "btn-ghost"}`} onClick={() => setTab("answer")}>
                  Reply ({counts.answer})
                </button>
                <button type="button" className={`btn ${tab === "restart" ? "btn-primary" : "btn-ghost"}`} onClick={() => setTab("restart")}>
                  Reconnect ({counts.restart})
                </button>
                <button type="button" className={`btn ${tab === "snoozed" ? "btn-primary" : "btn-ghost"}`} onClick={() => setTab("snoozed")}>
                  Snoozed ({counts.snoozed})
                </button>
              </div>
            </div>

            <div className="backlog-filters">
              <label className="setup-input-group inline">
                <span className="queue-meta">Search</span>
                <input
                  type="text"
                  value={search}
                  placeholder="Search contact, JID, or latest message..."
                  onChange={(event) => {
                    setSearch(event.target.value);
                    setLimit(120);
                  }}
                />
              </label>

              <label className="setup-input-group inline">
                <span className="queue-meta">Relationship</span>
                <select value={relationshipFilter} onChange={(event) => setRelationshipFilter(event.target.value as "all" | RelationshipValue)}>
                  <option value="all">All</option>
                  {RELATIONSHIP_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
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

              <button type="button" className="btn btn-ghost" onClick={() => setLimit((prev) => Math.min(prev + 120, 480))}>
                Load More
              </button>
            </div>
          </div>

          <div className="queue-actions backlog-bulk-actions">
            <label className="queue-meta backlog-select-toggle">
              <input
                type="checkbox"
                checked={allVisibleSelected}
                onChange={(event) =>
                  setSelectedThreadIds(event.target.checked ? visibleItems.map((item) => item.threadId) : [])
                }
              />{" "}
              Select visible threads
            </label>

            <p className="queue-meta backlog-selection-count">{selectedCount} selected</p>

            <label className="setup-input-group inline">
              <span className="queue-meta">Snooze for (minutes)</span>
              <input
                type="number"
                min={5}
                step={5}
                value={snoozeMinutes}
                onChange={(event) => setSnoozeMinutes(Number(event.target.value) || 5)}
              />
            </label>

            <label className="setup-input-group inline">
              <span className="queue-meta">Snooze note</span>
              <input type="text" value={snoozeReason} onChange={(event) => setSnoozeReason(event.target.value)} placeholder="Optional context" />
            </label>

            <button type="button" className="btn btn-ghost" onClick={bulkSnooze} disabled={selectedCount === 0}>
              Snooze Selection
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => bulkIgnore(true)} disabled={selectedCount === 0}>
              Ignore Selection
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => bulkIgnore(false)} disabled={selectedCount === 0}>
              Unignore Selection
            </button>
            <button
              type="button"
              className="btn btn-ghost backlog-clear-all"
              onClick={onClearAll}
              disabled={getRecord("backlog:clear-all").pending}
              aria-disabled={getRecord("backlog:clear-all").pending}
            >
              {getRecord("backlog:clear-all").pending ? "Clearing..." : "Clear Entire Backlog"}
            </button>
          </div>
        </section>

        <section className="backlog-main-rail">
          <div className="backlog-main-head">
            <p className="queue-meta">
              Showing {visibleItems.length} thread{visibleItems.length === 1 ? "" : "s"}
            </p>
            <p className="queue-meta">Tab: {tab === "all" ? "active" : tab}</p>
          </div>

          <div className="stack backlog-stream">
            {loading ? <LoadingBlock label="Loading unread backlog..." rows={4} /> : null}

            {visibleItems.map((item, index) => {
              const answerKey = `backlog:draft:answer:${item.threadId}`;
              const restartKey = `backlog:draft:restart:${item.threadId}`;
              const snoozeKey = `backlog:snooze:${item.threadId}`;
              const unsnoozeKey = `backlog:unsnooze:${item.threadId}`;
              const ignoreKey = `backlog:ignore:${item.threadId}`;
              const importanceKey = `backlog:importance:${item.threadId}`;
              const relationshipKey = `backlog:relationship:${item.threadId}`;
              const draftError = getRecord(answerKey).error || getRecord(restartKey).error;

              const isPending =
                getRecord(answerKey).pending ||
                getRecord(restartKey).pending ||
                getRecord(snoozeKey).pending ||
                getRecord(unsnoozeKey).pending ||
                getRecord(ignoreKey).pending ||
                getRecord(importanceKey).pending ||
                getRecord(relationshipKey).pending;

              const recommendedMode = item.recommendation === "restart" ? "restart" : "answer";
              const recommendedLabel = draftModeLabel(recommendedMode);
              const alreadyQueued = item.recommendation === "already_queued";

              return (
                <article
                  key={item.stateId}
                  className={`queue-item backlog-item ${
                    recommendedMode === "restart" ? "backlog-item-reconnect" : "backlog-item-reply"
                  } ${alreadyQueued ? "backlog-item-queued" : ""}`}
                  aria-busy={isPending}
                  style={{ "--item-index": index } as CSSProperties}
                >
                  <div className="backlog-row-head">
                    <div className="backlog-thread-main">
                      <label className="queue-meta backlog-select-toggle">
                        <input
                          type="checkbox"
                          checked={selectedThreadIds.includes(item.threadId)}
                          onChange={(event) => toggleSelected(item.threadId, event.target.checked)}
                          disabled={isPending}
                        />{" "}
                        Select
                      </label>
                      <p className="queue-title">{item.title || item.jid}</p>
                      <div className="backlog-badges">
                        <span className={`backlog-badge importance-${item.importance}`}>{item.importance}</span>
                        <span className="backlog-badge">{item.relationship}</span>
                        <span className="backlog-badge">{recommendationLabel(item.recommendation)}</span>
                      </div>
                    </div>
                    <div className="backlog-row-signal">
                      <p className="backlog-age-value">{formatPendingAge(item.pendingAgeMs)}</p>
                      <p className="backlog-age-label">pending</p>
                    </div>
                  </div>

                  <p className="queue-body">{trim(item.latestUnresolvedText || "(No text body)", 220)}</p>
                  <p className="queue-meta">
                    Unresolved: {item.unresolvedCount} · Last inbound: {formatDateTime(item.latestUnresolvedAt)} · Score: {item.score}
                  </p>
                  <p className="queue-meta backlog-recommendation-line">
                    {alreadyQueued
                      ? "A draft is already queued for this thread. Review it in Queue before adding another."
                      : `Recommended: ${recommendedLabel}. ${recommendationHint(item)}`}
                  </p>

                  {item.isSnoozed ? (
                    <p className="queue-meta">
                      Snoozed until {formatDateTime(item.snoozedUntil)}{item.snoozeReason ? ` · ${item.snoozeReason}` : ""}
                    </p>
                  ) : null}

                  <div className="queue-actions backlog-actions">
                    <div className="backlog-primary-actions">
                      <button
                        type="button"
                        className={`btn ${recommendedMode === "answer" ? "btn-primary" : "btn-ghost"}`}
                        onClick={() => onCreateDraft(item.threadId, "answer")}
                        disabled={isPending || alreadyQueued}
                        aria-disabled={isPending || alreadyQueued}
                        title="Reply directly to the latest unresolved message."
                      >
                        Reply Draft
                      </button>
                      <button
                        type="button"
                        className={`btn ${recommendedMode === "restart" ? "btn-primary" : "btn-ghost"}`}
                        onClick={() => onCreateDraft(item.threadId, "restart")}
                        disabled={isPending || alreadyQueued}
                        aria-disabled={isPending || alreadyQueued}
                        title="Start with a warm reconnection opener for stale threads."
                      >
                        Reconnect Draft
                      </button>
                    </div>
                    <p className="queue-meta backlog-draft-help">
                      Reply Draft responds directly. Reconnect Draft reopens the conversation gently.
                    </p>
                    <div className="backlog-secondary-actions">
                      {item.isSnoozed ? (
                        <button type="button" className="btn btn-ghost" onClick={() => onUnsnooze(item.threadId)} disabled={isPending} aria-disabled={isPending}>
                          Unsnooze
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => onSnooze(item.threadId, Math.max(5, Math.round(snoozeMinutes)))}
                          disabled={isPending}
                          aria-disabled={isPending}
                        >
                          Snooze
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
                        Open Thread
                      </Link>
                    </div>
                    {draftError ? (
                      <p className="queue-meta action-inline-error" role="alert">
                        {draftError}
                      </p>
                    ) : null}
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
                        {RELATIONSHIP_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                </article>
              );
            })}

            {!loading && visibleItems.length === 0 ? <p className="empty-line">{emptyStateMessage(tab)}</p> : null}
          </div>
        </section>
      </div>
    </section>
  );
}

export function LiveBacklog() {
  return <BacklogContent />;
}
