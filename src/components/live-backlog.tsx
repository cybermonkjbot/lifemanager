"use client";

import { ActionNotices } from "@/components/action-notices";
import { confirmAppDialog } from "@/components/app-confirm-dialog";
import { SegmentedControl } from "@/components/app-ui";
import { EmptyState } from "@/components/empty-state";
import { LoadingBlock } from "@/components/loading-state";
import { SharedMediaPreview } from "@/components/media-preview";
import { ProviderFilter, type ProviderFilterValue } from "@/components/provider-filter";
import { useTenantScopeArgs } from "@/components/tenant-scope-provider";
import { UIModal } from "@/components/ui-modal";
import { formatDateTime, trim } from "@/lib/format";
import { useActionStateRegistry } from "@/lib/ui/action-state";
import type { MediaPreviewResource } from "@/lib/ui/media";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

type BacklogTab = "all" | "answer" | "restart";
type RelationshipValue = "girlfriend" | "relationship" | "friendship" | "casual" | "family" | "business";
type BacklogPreset = "custom" | "reconnect_only";
const BACKLOG_PRESET_STORAGE_KEY = "slm.backlog.preset";

function readStoredBacklogPreset(): BacklogPreset {
  if (typeof window === "undefined") {
    return "custom";
  }
  const value = window.localStorage.getItem(BACKLOG_PRESET_STORAGE_KEY);
  if (value === "reconnect_only" || value === "custom") {
    return value;
  }
  return "custom";
}

function tabFromPreset(preset: BacklogPreset): BacklogTab {
  if (preset === "reconnect_only") return "restart";
  return "all";
}

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
  recommendation: "answer" | "answer_with_ack" | "restart" | "already_queued";
  score: number;
  businessIntent?: string;
  businessSignalLabels?: string[];
  businessSignalUrgent?: boolean;
  snoozedUntil?: number;
  snoozeReason?: string;
  isSnoozed: boolean;
  pendingAgeMs: number;
};

type NeedsReplyItem = {
  _id: string;
  messageProvider?: "whatsapp" | "instagram" | "imessage" | "telegram";
  provider: string;
  delayMs: number;
  typingMs: number;
  text: string;
  sendKind?: "text" | "reaction" | "sticker" | "meme" | "voice_note";
  mediaAssetId?: string;
  mediaCaption?: string;
  mediaPreview?: MediaPreviewResource | null;
  sourceMessage?:
    | {
        text?: string;
        mediaAssetId?: string;
        mediaCaption?: string;
        mediaPreview?: MediaPreviewResource | null;
      }
    | null;
  thread?: { _id?: string; title?: string; jid?: string } | null;
};

type QueueData = {
  needsReply: NeedsReplyItem[];
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
    return "Reply with context";
  }
  if (value === "already_queued") {
    return "Already in Review";
  }
  return "Reply";
}

function businessRecommendationLabel(value: BacklogItem["recommendation"]) {
  if (value === "restart") {
    return "Follow up";
  }
  if (value === "answer_with_ack") {
    return "Reply with context";
  }
  if (value === "already_queued") {
    return "Already in Sales Review";
  }
  return "Reply";
}

function draftModeLabel(mode: "answer" | "restart") {
  return mode === "restart" ? "Reconnect" : "Reply";
}

function businessDraftModeLabel(mode: "answer" | "restart") {
  return mode === "restart" ? "Follow up" : "Reply";
}

function recommendationHint(item: BacklogItem) {
  if (item.recommendation === "restart") {
    return "This conversation has cooled off. Start with a light check-in.";
  }
  if (item.recommendation === "answer_with_ack") {
    return "Acknowledge the wait, then answer directly.";
  }
  if (item.recommendation === "already_queued") {
    return "A reply is already waiting in Review.";
  }
  return "A direct reply should clear this.";
}

function businessRecommendationHint(item: BacklogItem) {
  const labels = item.businessSignalLabels || [];
  if (labels.length > 0) {
    return `${labels.slice(0, 2).join(" · ")} detected. Keep the next step clear and brand-safe.`;
  }
  if (item.recommendation === "restart") {
    return "This customer thread has cooled off. Follow up with a light next step.";
  }
  if (item.recommendation === "already_queued") {
    return "A customer reply is already waiting in Sales Review.";
  }
  return "Reply clearly and avoid promises that need confirmation.";
}

function formatRelationship(value: RelationshipValue) {
  const match = RELATIONSHIP_OPTIONS.find((option) => option.value === value);
  return match?.label || value;
}

function contactFallbackName(value: string) {
  const normalized = value.trim().toLowerCase();
  const local = normalized.split("@")[0] || normalized;
  if (/^\d+$/.test(local)) {
    return `+${local}`;
  }
  return local.replace(/[-_.]+/g, " ");
}

function threadDisplayName(item: BacklogItem) {
  return item.title?.trim() || contactFallbackName(item.jid);
}

function emptyStateMessage(tab: BacklogTab) {
  if (tab === "answer") {
    return "No conversations need a direct reply here.";
  }
  if (tab === "restart") {
    return "No cooled-off conversations need reconnecting.";
  }
  return "No conversations match these filters.";
}

function tabFromCounts(items: BacklogItem[]) {
  const totals = {
    all: 0,
    answer: 0,
    restart: 0,
    snoozed: 0,
  };

  for (const item of items) {
    totals.all += 1;
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
  const tenantScope = useTenantScopeArgs();
  const refreshRecent = useMutation(api.backlog.refreshRecent);
  const clearAll = useMutation(api.backlog.clearAll);
  const createDraft = useMutation(api.backlog.createDraft);
  const approveDraft = useMutation(api.draft.approve);
  const rejectDraft = useMutation(api.draft.reject);
  const updateDraftContent = useMutation(api.draft.updateDraftContent);

  const { runAction, getRecord, notices, dismissNotice, pushNotice } = useActionStateRegistry();

  const [preset, setPreset] = useState<BacklogPreset>(() => readStoredBacklogPreset());
  const [tab, setTab] = useState<BacklogTab>(() => tabFromPreset(readStoredBacklogPreset()));
  const [providerFilter, setProviderFilter] = useState<ProviderFilterValue>("all");
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(120);
  const [reviewThreadId, setReviewThreadId] = useState<string | null>(null);
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
  const [editingDraftText, setEditingDraftText] = useState("");
  const hasHydratedRef = useRef(false);

  const queryArgs = useMemo(() => {
    return {
      limit,
      ...tenantScope,
      provider: providerFilter,
      importance: "all",
      recommendation: "all",
      relationship: "all",
      scope: "all",
      sort: "oldest",
      includeIgnored: true,
      search,
    } as const;
  }, [limit, providerFilter, search, tenantScope]);

  const backlog = useQuery(api.backlog.list, queryArgs) as BacklogItem[] | undefined;
  const queue = useQuery(api.queue.list, { ...tenantScope, provider: providerFilter }) as QueueData | undefined;
  const settings = useQuery(api.settings.get, tenantScope) as { productUse?: "personal" | "business" } | undefined;
  const isBusiness = settings?.productUse === "business";
  const loading = backlog === undefined;
  const items = useMemo(() => backlog || [], [backlog]);
  const reviewDrafts = useMemo(
    () => (queue?.needsReply || []).filter((draft) => draft.thread?._id === reviewThreadId),
    [queue?.needsReply, reviewThreadId],
  );
  const reviewDraft = reviewDrafts[0];

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
        pendingLabel: "Refreshing catch-up list...",
        suppressSuccessNotice: true,
      },
    );
  }, [refreshRecent, runAction]);

  const counts = useMemo(() => tabFromCounts(items), [items]);

  const visibleItems = useMemo(() => {
    if (tab === "answer") {
      return items.filter((item) => item.recommendation === "answer" || item.recommendation === "answer_with_ack");
    }

    if (tab === "restart") {
      return items.filter((item) => item.recommendation === "restart");
    }

    return items.filter((item) => !item.isSnoozed);
  }, [items, tab]);
  const leadItemId = visibleItems[0]?.stateId || "";
  const backlogTabs = [
    { id: "all", label: isBusiness ? "Leads waiting" : "Needs attention", count: counts.all - counts.snoozed },
    { id: "answer", label: "Reply", count: counts.answer },
    { id: "restart", label: isBusiness ? "Follow up" : "Reconnect", count: counts.restart },
  ] satisfies Array<{ id: BacklogTab; label: string; count: number }>;

  const onRefresh = () => {
    void runAction(
      "backlog:refresh",
      async () => {
        await refreshRecent({ limit: 360 });
      },
      {
        pendingLabel: "Refreshing...",
        successMessage: "Catch-up list refreshed.",
      },
    );
  };

  const applyPreset = (nextPreset: BacklogPreset) => {
    setPreset(nextPreset);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(BACKLOG_PRESET_STORAGE_KEY, nextPreset);
    }
    if (nextPreset === "reconnect_only") {
      setTab("restart");
      setSearch("");
      setLimit(120);
      return;
    }
  };

  const onClearAll = async () => {
    const confirmed = await confirmAppDialog({
      title: "Clear catch-up list?",
      message: "Old unresolved messages will not reappear.",
      confirmLabel: "Clear list",
      tone: "danger",
    });
    if (!confirmed) {
      return;
    }

    void runAction(
      "backlog:clear-all",
      async () => {
        const result = await clearAll({});
        if (result.continuing) {
          pushNotice("info", "Large catch-up clear is continuing in the background.");
        }
      },
      {
        pendingLabel: "Clearing catch-up list...",
        successMessage: "Catch-up list clear requested.",
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
        pendingLabel: mode === "restart" ? "Creating reconnect..." : "Creating reply...",
        successMessage:
          mode === "restart" ? "Reconnect added to Review." : "Reply added to Review.",
      },
    );
  };

  const openReviewModal = (threadId: string) => {
    setEditingDraftId(null);
    setEditingDraftText("");
    setReviewThreadId(threadId);
  };

  const closeReviewModal = () => {
    setReviewThreadId(null);
    setEditingDraftId(null);
    setEditingDraftText("");
  };

  const closeReviewOnSuccess = (draftId: string, outcome: { executed: boolean; error?: string }) => {
    if (!outcome.executed || outcome.error) {
      return;
    }
    if (reviewDrafts.length <= 1 || reviewDraft?._id === draftId) {
      closeReviewModal();
    }
  };

  const onSendReviewDraft = (draftId: string) => {
    void runAction(
      `review:send:${draftId}`,
      async () => {
        await approveDraft({ draftId: draftId as Id<"replyDrafts">, sendImmediately: true });
        await refreshRecent({ limit: 180 });
      },
      {
        pendingLabel: "Sending...",
        successMessage: "Reply approved and queued.",
      },
    ).then((outcome) => closeReviewOnSuccess(draftId, outcome));
  };

  const onRejectReviewDraft = (draftId: string) => {
    void runAction(
      `review:reject:${draftId}`,
      async () => {
        await rejectDraft({ draftId: draftId as Id<"replyDrafts"> });
        await refreshRecent({ limit: 180 });
      },
      {
        pendingLabel: "Discarding...",
        successMessage: "Draft discarded.",
      },
    ).then((outcome) => closeReviewOnSuccess(draftId, outcome));
  };

  const openDraftEdit = (draft: NeedsReplyItem) => {
    setEditingDraftId(draft._id);
    setEditingDraftText(draft.text || "");
  };

  const onSaveDraftEdit = (draftId: string) => {
    const edited = editingDraftText.trim();
    if (!edited) {
      pushNotice("error", "Draft text cannot be empty.");
      return;
    }

    void runAction(
      `review:edit:${draftId}`,
      async () => {
        await updateDraftContent({ draftId: draftId as Id<"replyDrafts">, text: edited });
      },
      {
        pendingLabel: "Saving...",
        successMessage: "Draft updated.",
      },
    ).then((outcome) => {
      if (!outcome.executed || outcome.error) {
        return;
      }
      setEditingDraftId(null);
    });
  };

  return (
    <section className="backlog-workspace">
      <ActionNotices notices={notices} onDismiss={dismissNotice} />

      <div className="backlog-operating-grid">
        <section className="backlog-main-rail">
          <div className="backlog-main-head">
            <div>
              <p className="settings-eyebrow">Start here</p>
              <h2>{visibleItems.length > 0 ? "Pick up the next conversation" : "All caught up"}</h2>
            </div>
            <p className="queue-meta">
              Showing {visibleItems.length} conversation{visibleItems.length === 1 ? "" : "s"}
            </p>
          </div>

          <div className="stack backlog-stream">
            {loading ? <LoadingBlock label="Loading conversations..." rows={4} /> : null}

            {visibleItems.map((item, index) => {
              const answerKey = `backlog:draft:answer:${item.threadId}`;
              const restartKey = `backlog:draft:restart:${item.threadId}`;
              const draftError = getRecord(answerKey).error || getRecord(restartKey).error;

              const isPending =
                getRecord(answerKey).pending ||
                getRecord(restartKey).pending;

              const recommendedMode = item.recommendation === "restart" ? "restart" : "answer";
              const recommendedLabel = isBusiness ? businessDraftModeLabel(recommendedMode) : draftModeLabel(recommendedMode);
              const alreadyQueued = item.recommendation === "already_queued";
              const displayName = threadDisplayName(item);
              const signalLabels = isBusiness ? item.businessSignalLabels || [] : [];

              return (
                <article
                  key={item.stateId}
                  className={`backlog-item ${
                    recommendedMode === "restart" ? "backlog-item-reconnect" : "backlog-item-reply"
                  } ${alreadyQueued ? "backlog-item-queued" : ""} ${item.stateId === leadItemId ? "backlog-item-priority" : ""}`}
                  aria-busy={isPending}
                  style={{ "--item-index": index } as CSSProperties}
                >
                  <div className="backlog-item-copy">
                    <div className="backlog-row-head">
                      <div className="backlog-thread-main">
                        <div className="backlog-title-line">
                          <p className="queue-title">{displayName}</p>
                        </div>
                        <div className="backlog-badges">
                          <span className="backlog-badge">{formatRelationship(item.relationship)}</span>
                          <span className="backlog-badge">
                            {isBusiness ? businessRecommendationLabel(item.recommendation) : recommendationLabel(item.recommendation)}
                          </span>
                          {signalLabels.slice(0, 2).map((label) => (
                            <span className={`backlog-badge ${item.businessSignalUrgent ? "warn" : ""}`} key={label}>
                              {label}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="backlog-row-signal">
                        <p className="backlog-age-value">{formatPendingAge(item.pendingAgeMs)}</p>
                        <p className="backlog-age-label">waiting</p>
                      </div>
                    </div>

                    <div className="backlog-message-block">
                      <p className="backlog-message-label">Latest unanswered message</p>
                      <p className="queue-body">{trim(item.latestUnresolvedText || "(No message text)", item.stateId === leadItemId ? 320 : 190)}</p>
                    </div>

                    <p className="queue-meta">
                      {item.unresolvedCount} unanswered · Last message {formatDateTime(item.latestUnresolvedAt)}
                    </p>
                    <p className="queue-meta backlog-recommendation-line">
                      <strong>{alreadyQueued ? "Already in Review" : `${recommendedLabel} suggested`}</strong>
                      <span>
                        {alreadyQueued
                          ? isBusiness
                            ? "Open Sales Review before creating another customer reply."
                            : "Open Review before creating another reply."
                          : isBusiness
                            ? businessRecommendationHint(item)
                            : recommendationHint(item)}
                      </span>
                    </p>

                  </div>

                  <footer className="backlog-item-footer">
                    <div className="queue-actions backlog-actions">
                      <div className="backlog-primary-actions">
                        {alreadyQueued ? (
                          <button type="button" className="btn btn-primary" onClick={() => openReviewModal(item.threadId)}>
                            Open Review
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="btn btn-primary"
                            onClick={() => onCreateDraft(item.threadId, recommendedMode)}
                            disabled={isPending}
                            aria-disabled={isPending}
                          >
                            {recommendedMode === "restart"
                              ? isBusiness
                                ? "Create follow-up"
                                : "Create reconnect"
                              : "Create reply"}
                          </button>
                        )}
                      </div>
                      {draftError ? (
                        <p className="queue-meta action-inline-error" role="alert">
                          {draftError}
                        </p>
                      ) : null}
                    </div>

                  </footer>
                </article>
              );
            })}

            {!loading && visibleItems.length === 0 ? (
              <EmptyState
                variant="backlog"
                title={emptyStateMessage(tab)}
                description={
                  isBusiness
                    ? "When a customer or lead needs price, payment, delivery, or follow-up attention, it will appear here."
                    : "When a conversation needs a reply or a gentle reconnect, it will appear here."
                }
              />
            ) : null}
          </div>
        </section>

        <aside className="backlog-side-rail" aria-label="Catch-up controls">
          <div className="backlog-control-deck">
            <h2 className="backlog-rail-title">{isBusiness ? "Choose which leads to recover" : "Choose what to catch up on"}</h2>
            <div className="backlog-control-topline">
              <ProviderFilter value={providerFilter} onChange={setProviderFilter} label="Conversation source" />
              <SegmentedControl label="Catch-up views" value={tab} options={backlogTabs} onChange={setTab} className="backlog-tabs" />
            </div>

            <div className="backlog-filters">
              <div className="backlog-quick-views" aria-label="Quick views">
                {[
                  { id: "custom", label: "Custom" },
                  { id: "reconnect_only", label: isBusiness ? "Follow-up only" : "Reconnect only" },
                ].map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`btn ${preset === item.id ? "btn-primary" : "btn-ghost"}`}
                    onClick={() => applyPreset(item.id as BacklogPreset)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <label className="setup-input-group inline search-field-group">
                <span className="queue-meta">Search</span>
                <input
                  type="text"
                  value={search}
                  placeholder="Search name or latest message..."
                  onChange={(event) => {
                    setSearch(event.target.value);
                    setLimit(120);
                    setPreset("custom");
                  }}
                />
              </label>
              <div className="backlog-filter-actions">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={onRefresh}
                  disabled={getRecord("backlog:refresh").pending}
                  aria-disabled={getRecord("backlog:refresh").pending}
                >
                  {getRecord("backlog:refresh").pending ? "Refreshing..." : "Refresh"}
                </button>

                {visibleItems.length > 0 && items.length >= limit ? (
                  <button type="button" className="btn btn-ghost" onClick={() => setLimit((prev) => Math.min(prev + 120, 480))}>
                    Load more
                  </button>
                ) : null}
              </div>
            </div>
          </div>

          <button
            type="button"
            className="btn btn-ghost backlog-clear-all"
            onClick={onClearAll}
            disabled={getRecord("backlog:clear-all").pending}
            aria-disabled={getRecord("backlog:clear-all").pending}
          >
            {getRecord("backlog:clear-all").pending ? "Clearing..." : isBusiness ? "Clear lead list" : "Clear catch-up list"}
          </button>
        </aside>
      </div>

      <UIModal
        open={Boolean(reviewThreadId)}
        onClose={closeReviewModal}
        title={isBusiness ? "Review customer reply" : "Review reply"}
        description={isBusiness ? "Check the customer draft, then send, edit, or discard it." : "Check the draft, then send, edit, or discard it."}
        size="wide"
      >
        {queue === undefined ? <LoadingBlock label="Loading draft..." rows={2} compact /> : null}

        {queue !== undefined && !reviewDraft ? (
          <EmptyState
            variant="queue"
            compact
            title="No draft is waiting here."
            description="It may have already been sent, snoozed, or discarded."
          />
        ) : null}

        {reviewDraft ? (
          <div className="stack compact backlog-review-modal">
            <div>
              <p className="queue-title">{reviewDraft.thread?.title || reviewDraft.thread?.jid || "Unknown contact"}</p>
              <p className="queue-meta">
                Channel: {reviewDraft.messageProvider || "whatsapp"} · Model: {reviewDraft.provider} · Delay:{" "}
                {Math.round(reviewDraft.delayMs / 1000)}s · Typing: {Math.round(reviewDraft.typingMs / 1000)}s
              </p>
            </div>

            {reviewDraft.sourceMessage?.text ? (
              <div className="queue-item queue-item-condensed">
                <div>
                  <p className="queue-meta">Latest message</p>
                  <p className="queue-body">{trim(reviewDraft.sourceMessage.text, 260)}</p>
                  <SharedMediaPreview
                    preview={reviewDraft.sourceMessage.mediaPreview}
                    mediaAssetId={reviewDraft.sourceMessage.mediaAssetId}
                  />
                </div>
              </div>
            ) : null}

            <div className="queue-item queue-item-condensed">
              <div className="stack compact">
                <p className="queue-meta">Draft reply</p>
                {editingDraftId === reviewDraft._id ? (
                  <textarea
                    rows={5}
                    value={editingDraftText}
                    onChange={(event) => setEditingDraftText(event.target.value)}
                    aria-label="Edit draft reply"
                  />
                ) : (
                  <p className="queue-body">{trim(reviewDraft.text || "", 360)}</p>
                )}
                <SharedMediaPreview preview={reviewDraft.mediaPreview} mediaAssetId={reviewDraft.mediaAssetId} />
                {reviewDraft.mediaCaption?.trim() ? (
                  <p className="queue-meta">Media caption: {trim(reviewDraft.mediaCaption.trim(), 220)}</p>
                ) : null}
              </div>
            </div>

            <div className="queue-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => onSendReviewDraft(reviewDraft._id)}
                disabled={getRecord(`review:send:${reviewDraft._id}`).pending}
                aria-disabled={getRecord(`review:send:${reviewDraft._id}`).pending}
              >
                {getRecord(`review:send:${reviewDraft._id}`).pending ? "Sending..." : "Send reply"}
              </button>
              {editingDraftId === reviewDraft._id ? (
                <>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => onSaveDraftEdit(reviewDraft._id)}
                    disabled={getRecord(`review:edit:${reviewDraft._id}`).pending}
                    aria-disabled={getRecord(`review:edit:${reviewDraft._id}`).pending}
                  >
                    {getRecord(`review:edit:${reviewDraft._id}`).pending ? "Saving..." : "Save changes"}
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={() => setEditingDraftId(null)}>
                    Cancel
                  </button>
                </>
              ) : (
                <button type="button" className="btn btn-ghost" onClick={() => openDraftEdit(reviewDraft)}>
                  Edit
                </button>
              )}
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => onRejectReviewDraft(reviewDraft._id)}
                disabled={getRecord(`review:reject:${reviewDraft._id}`).pending}
                aria-disabled={getRecord(`review:reject:${reviewDraft._id}`).pending}
              >
                {getRecord(`review:reject:${reviewDraft._id}`).pending ? "Discarding..." : "Discard"}
              </button>
            </div>

            {getRecord(`review:send:${reviewDraft._id}`).error ||
            getRecord(`review:reject:${reviewDraft._id}`).error ||
            getRecord(`review:edit:${reviewDraft._id}`).error ? (
              <p className="queue-meta action-inline-error" role="alert">
                {getRecord(`review:send:${reviewDraft._id}`).error ||
                  getRecord(`review:reject:${reviewDraft._id}`).error ||
                  getRecord(`review:edit:${reviewDraft._id}`).error}
              </p>
            ) : null}
          </div>
        ) : null}
      </UIModal>
    </section>
  );
}

export function LiveBacklog() {
  return <BacklogContent />;
}
