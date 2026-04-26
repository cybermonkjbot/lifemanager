"use client";

import { ActionNotices } from "@/components/action-notices";
import { LoadingBlock } from "@/components/loading-state";
import { SharedMediaPreview } from "@/components/media-preview";
import { ProviderFilter, type ProviderFilterValue } from "@/components/provider-filter";
import { UIModal } from "@/components/ui-modal";
import { formatDateTime, formatDateTimeWithRelative, trim } from "@/lib/format";
import { useActionStateRegistry } from "@/lib/ui/action-state";
import { followupRescheduleDueAt, generateFollowupReasonWithAi, type FollowupItem } from "@/lib/ui/followups";
import type { MediaPreviewResource } from "@/lib/ui/media";
import { generateTodoTitleWithAi } from "@/lib/ui/todos";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";

type NeedsReplyItem = {
  _id: string;
  messageProvider?: "whatsapp" | "instagram";
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

type FollowupConfirmationItem = FollowupItem;

type TodoCandidateItem = {
  _id: string;
  title: string;
  suggestedDueAt?: number;
  thread?: { _id?: string; title?: string; jid?: string } | null;
  sourceMessage?:
    | {
        _id?: string;
        text?: string;
        messageAt?: number;
        direction?: "inbound" | "outbound";
      }
    | null;
};

type OpenTodoItem = {
  _id: string;
  title: string;
  dueAt?: number;
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

function QueueContent() {
  const approveDraft = useMutation(api.draft.approve);
  const snoozeDraft = useMutation(api.draft.snooze);
  const rejectDraft = useMutation(api.draft.reject);
  const clearAllPendingDrafts = useMutation(api.draft.clearAllPending);
  const updateDraftContent = useMutation(api.draft.updateDraftContent);
  const confirmFollowup = useMutation(api.followups.confirm);
  const snoozeFollowup = useMutation(api.followups.snooze);
  const rescheduleFollowup = useMutation(api.followups.reschedule);
  const cancelFollowup = useMutation(api.followups.cancel);
  const clearAllFollowups = useMutation(api.followups.clearAll);
  const createTodoFromCandidate = useMutation(api.todos.fromCandidate);
  const setTodoStatus = useMutation(api.todos.setTodoStatus);
  const updateTodoCandidateTitle = useMutation(api.todos.updateCandidateTitle);
  const clearAllTodos = useMutation(api.todos.clearAll);
  const resolveGuardrail = useMutation(api.queue.resolveGuardrail);
  const clearAllGuardrails = useMutation(api.queue.clearAllGuardrails);
  const clearAllBacklog = useMutation(api.backlog.clearAll);

  const { runAction, getRecord, isPending, notices, dismissNotice, pushNotice } = useActionStateRegistry();
  const [tab, setTab] = useState<QueueTab>("needsReply");
  const [providerFilter, setProviderFilter] = useState<ProviderFilterValue>("all");
  const [reviewState, setReviewState] = useState<QueueReviewState>(null);
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
  const [editingDraftText, setEditingDraftText] = useState("");
  const [autoTodoTitles, setAutoTodoTitles] = useState<Record<string, string>>({});
  const [autoFollowupReasons, setAutoFollowupReasons] = useState<Record<string, string>>({});
  const autoTodoAttemptedRef = useRef<Set<string>>(new Set());
  const autoFollowupAttemptedRef = useRef<Set<string>>(new Set());

  const queue = useQuery(api.queue.list, { provider: providerFilter }) as QueueData | undefined;
  const todosData = useQuery(api.todos.list, { todoLimit: 120, candidateLimit: 1 }) as
    | { todos: OpenTodoItem[]; candidates: TodoCandidateItem[] }
    | undefined;
  const queueLoading = queue === undefined;
  const todosLoading = todosData === undefined;
  const needsReply = queue?.needsReply || [];
  const followupConfirmations = queue?.followupConfirmations || [];
  const todoCandidates = queue?.todoCandidates || [];
  const openTodos = todosData?.todos || [];
  const guardrailFlags = queue?.guardrailFlags || [];

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      for (const item of todoCandidates) {
        if (autoTodoAttemptedRef.current.has(item._id)) {
          continue;
        }
        autoTodoAttemptedRef.current.add(item._id);
        try {
          const generatedTitle = await generateTodoTitleWithAi({
            currentTitle: item.title,
            sourceText: item.sourceMessage?.text,
            threadId: item.thread?._id,
          });
          if (cancelled) {
            return;
          }
          setAutoTodoTitles((current) => ({
            ...current,
            [item._id]: generatedTitle,
          }));
          if (generatedTitle.trim() !== item.title.trim()) {
            await updateTodoCandidateTitle({
              candidateId: item._id as Id<"todoCandidates">,
              title: generatedTitle,
            });
          }
        } catch {
          // Best-effort background enhancement.
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [todoCandidates, updateTodoCandidateTitle]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      for (const item of followupConfirmations) {
        if (autoFollowupAttemptedRef.current.has(item._id)) {
          continue;
        }
        autoFollowupAttemptedRef.current.add(item._id);
        try {
          const generatedReason = await generateFollowupReasonWithAi({
            currentReason: item.reason,
            sourceText: item.sourceSnippet || item.sourceMessage?.text,
            dueAt: item.dueAt,
            threadId: item.thread?._id,
          });
          if (cancelled) {
            return;
          }
          setAutoFollowupReasons((current) => ({
            ...current,
            [item._id]: generatedReason,
          }));
        } catch {
          // Best-effort background enhancement.
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [followupConfirmations]);

  const counts = useMemo(
    () => ({
      needsReply: needsReply.length,
      followups: followupConfirmations.length,
      todos: todoCandidates.length + openTodos.length,
      guardrails: guardrailFlags.length,
    }),
    [followupConfirmations.length, guardrailFlags.length, needsReply.length, openTodos.length, todoCandidates.length],
  );

  const closeReviewOnSuccess = (
    kind: Exclude<QueueReviewState, null>["kind"],
    id: string,
    outcome: { executed: boolean; error?: string },
  ) => {
    if (!outcome.executed || outcome.error) {
      return;
    }
    setReviewState((current) => {
      if (!current || current.kind !== kind || current.item._id !== id) {
        return current;
      }
      return null;
    });
  };

  const onSend = (draftId: string) => {
    const key = `send:${draftId}`;
    void runAction(
      key,
      async () => {
        await approveDraft({ draftId: draftId as Id<"replyDrafts">, sendImmediately: true });
      },
      {
        pendingLabel: "Sending...",
        successMessage: "Reply approved and queued.",
      },
    ).then((outcome) => closeReviewOnSuccess("needsReply", draftId, outcome));
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
    ).then((outcome) => closeReviewOnSuccess("needsReply", draftId, outcome));
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
    ).then((outcome) => closeReviewOnSuccess("followups", followUpId, outcome));
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
    ).then((outcome) => closeReviewOnSuccess("followups", followUpId, outcome));
  };

  const onRescheduleFollowup = (followUpId: string, hoursAhead: number) => {
    const key = `followup:reschedule:${followUpId}`;
    void runAction(
      key,
      async () => {
        await rescheduleFollowup({
          followUpId: followUpId as Id<"followUps">,
          dueAt: followupRescheduleDueAt(hoursAhead),
        });
      },
      {
        pendingLabel: "Rescheduling...",
        successMessage: "Follow-up rescheduled.",
      },
    ).then((outcome) => closeReviewOnSuccess("followups", followUpId, outcome));
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
    ).then((outcome) => closeReviewOnSuccess("followups", followUpId, outcome));
  };

  const onConvertTodo = (item: TodoCandidateItem) => {
    const key = `todo:${item._id}`;
    void runAction(
      key,
      async () => {
        const generatedTitle = (autoTodoTitles[item._id] || item.title).trim();
        await updateTodoCandidateTitle({
          candidateId: item._id as Id<"todoCandidates">,
          title: generatedTitle,
        });
        await createTodoFromCandidate({ candidateId: item._id as Id<"todoCandidates"> });
      },
      {
        pendingLabel: "Adding TODO...",
        successMessage: "Task added.",
      },
    ).then((outcome) => closeReviewOnSuccess("todos", item._id, outcome));
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
    ).then((outcome) => closeReviewOnSuccess("needsReply", draftId, outcome));
  };

  const onMarkTodoDone = (todoId: string) => {
    const key = `todo:done:${todoId}`;
    void runAction(
      key,
      async () => {
        await setTodoStatus({
          todoId: todoId as Id<"todos">,
          status: "done",
        });
      },
      {
        pendingLabel: "Marking done...",
        successMessage: "Marked as done.",
      },
    );
  };

  const openEdit = (draftId: string, text: string) => {
    setEditingDraftId(draftId);
    setEditingDraftText(text || "");
  };

  const onSaveEdit = (draftId: string) => {
    const edited = editingDraftText.trim();
    if (!edited) {
      pushNotice("error", "Draft text cannot be empty.");
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
    ).then((outcome) => {
      if (!outcome.executed || outcome.error) {
        return;
      }
      setEditingDraftId((current) => (current === draftId ? null : current));
    });
  };

  const onCancelEdit = (draftId: string) => {
    setEditingDraftId((current) => (current === draftId ? null : current));
  };

  const onNeedsReplyShortcut = (event: KeyboardEvent<HTMLDivElement>, item: NeedsReplyItem) => {
    const target = event.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)
    ) {
      return;
    }

    const key = event.key.toLowerCase();
    if (key === "a") {
      event.preventDefault();
      onSend(item._id);
      return;
    }
    if (key === "s") {
      event.preventDefault();
      onSnooze(item._id);
      return;
    }
    if (key === "r") {
      event.preventDefault();
      onReject(item._id);
      return;
    }
    if (key === "e") {
      event.preventDefault();
      openEdit(item._id, item.text || "");
    }
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
        pendingLabel: "Resolving safety flag...",
        successMessage: "Safety flag resolved.",
      },
    ).then((outcome) => closeReviewOnSuccess("guardrails", guardrailEventId, outcome));
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
            await approveDraft({ draftId: id as Id<"replyDrafts">, sendImmediately: true });
          } else {
            await snoozeDraft({ draftId: id as Id<"replyDrafts">, minutes: 30 });
          }
        }
      },
      {
        pendingLabel: mode === "send" ? "Sending all review drafts..." : "Snoozing all review drafts...",
        successMessage: mode === "send" ? "All review drafts queued to send." : "All review drafts snoozed for 30 minutes.",
      },
    );
  };

  const onClearNeedsReply = () => {
    const confirmed = window.confirm("Discard every draft in Needs reply? This rejects all pending reply drafts.");
    if (!confirmed) {
      return;
    }
    void runAction(
      "queue:clear:needsReply",
      async () => {
        let cleared = 0;
        for (let pass = 0; pass < 20; pass += 1) {
          const result = await clearAllPendingDrafts({ limit: 80 });
          cleared += result.cleared;
          if (!result.hasMore) {
            break;
          }
        }
        await clearAllBacklog({});
        pushNotice("info", `Discarded ${cleared} pending draft${cleared === 1 ? "" : "s"}.`);
      },
      {
        pendingLabel: "Discarding reply drafts...",
        successMessage: "Reply drafts discarded.",
      },
    );
  };

  const onClearFollowups = () => {
    const confirmed = window.confirm("Dismiss every open follow-up? Suggested, confirmed, and queued follow-ups will be closed.");
    if (!confirmed) {
      return;
    }
    void runAction(
      "queue:clear:followups",
      async () => {
        let cleared = 0;
        for (let pass = 0; pass < 20; pass += 1) {
          const result = await clearAllFollowups({ limit: 60 });
          cleared += result.cleared;
          if (!result.hasMore) {
            break;
          }
        }
        pushNotice("info", `Dismissed ${cleared} follow-up${cleared === 1 ? "" : "s"}.`);
      },
      {
        pendingLabel: "Dismissing follow-ups...",
        successMessage: "Follow-ups dismissed.",
      },
    );
  };

  const onClearTodos = () => {
    const confirmed = window.confirm("Close every open task and task suggestion?");
    if (!confirmed) {
      return;
    }
    void runAction(
      "queue:clear:todos",
      async () => {
        let clearedTodos = 0;
        let clearedCandidates = 0;
        for (let pass = 0; pass < 20; pass += 1) {
          const result = await clearAllTodos({ limit: 80 });
          clearedTodos += result.clearedTodos;
          clearedCandidates += result.clearedCandidates;
          if (!result.hasMore) {
            break;
          }
        }
        pushNotice("info", `Closed ${clearedTodos} task${clearedTodos === 1 ? "" : "s"} and ${clearedCandidates} suggestion${clearedCandidates === 1 ? "" : "s"}.`);
      },
      {
        pendingLabel: "Closing tasks...",
        successMessage: "Tasks closed.",
      },
    );
  };

  const onClearGuardrails = () => {
    const confirmed = window.confirm("Resolve every safety flag? Related blocked drafts will be closed.");
    if (!confirmed) {
      return;
    }
    void runAction(
      "queue:clear:guardrails",
      async () => {
        let cleared = 0;
        let closedDrafts = 0;
        for (let pass = 0; pass < 20; pass += 1) {
          const result = await clearAllGuardrails({
            limit: 80,
            closeDraft: true,
            resolutionNote: "Bulk cleared from queue.",
          });
          cleared += result.cleared;
          closedDrafts += result.closedDrafts;
          if (!result.hasMore) {
            break;
          }
        }
        pushNotice("info", `Resolved ${cleared} safety flag${cleared === 1 ? "" : "s"}; closed ${closedDrafts} draft${closedDrafts === 1 ? "" : "s"}.`);
      },
      {
        pendingLabel: "Resolving safety flags...",
        successMessage: "Safety flags resolved.",
      },
    );
  };

  const renderNeedsReply = () => (
    <div className="stack">
      {queueLoading ? <LoadingBlock label="Loading reply queue…" rows={3} compact /> : null}
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
                Channel: {item.messageProvider || "whatsapp"} · Model: {item.provider} · Delay: {Math.round(item.delayMs / 1000)}s · Typing: {Math.round(item.typingMs / 1000)}s
              </p>
            </div>
            <button type="button" className="btn btn-primary" onClick={() => setReviewState({ kind: "needsReply", item })}>
              Review
            </button>
          </div>
        );
      })}
      {!queueLoading && needsReply.length === 0 ? <p className="empty-line">No reply drafts waiting for review.</p> : null}
    </div>
  );

  const renderFollowups = () => (
    <div className="stack">
      {queueLoading ? <LoadingBlock label="Loading follow-up confirmations…" rows={3} compact /> : null}
      {followupConfirmations.map((item) => {
        const key = `followup:${item._id}`;
        const record = getRecord(key);
        const dismissRecord = getRecord(`followup:cancel:${item._id}`);
        const busy = record.pending || dismissRecord.pending;
        const sourceText = item.sourceSnippet?.trim() || item.sourceMessage?.text?.trim() || "";
        const reasonText = autoFollowupReasons[item._id] || item.reason;
        return (
          <div key={item._id} className="queue-item queue-item-condensed" aria-busy={busy}>
            <div>
              <p className="queue-title">{item.thread?.title || item.thread?.jid || "Unknown thread"}</p>
              <p className="queue-meta">Due: {formatDateTimeWithRelative(item.dueAt)}</p>
              <p className="queue-body">{reasonText}</p>
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
      {!queueLoading && followupConfirmations.length === 0 ? <p className="empty-line">No follow-ups waiting for review.</p> : null}
    </div>
  );

  const renderTodos = () => (
    <div className="stack">
      <p className="queue-meta">Open tasks ({openTodos.length})</p>
      {todosLoading ? <LoadingBlock label="Loading open tasks…" rows={2} compact /> : null}
      {openTodos.map((item) => (
        <div key={item._id} className="queue-item queue-item-condensed" aria-busy={isPending(`todo:done:${item._id}`)}>
          <div>
            <p className="queue-title">{item.title}</p>
            <p className="queue-meta">Status: Open{item.dueAt ? ` · Due: ${formatDateTime(item.dueAt)}` : ""}</p>
          </div>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => onMarkTodoDone(item._id)}
            disabled={isPending(`todo:done:${item._id}`)}
            aria-disabled={isPending(`todo:done:${item._id}`)}
          >
            {isPending(`todo:done:${item._id}`) ? "Marking..." : "Mark done"}
          </button>
        </div>
      ))}
      {!todosLoading && openTodos.length === 0 ? <p className="empty-line">No open conversation tasks.</p> : null}

      <p className="queue-meta">Suggested tasks ({todoCandidates.length})</p>
      {queueLoading ? <LoadingBlock label="Loading task suggestions…" rows={2} compact /> : null}
      {todoCandidates.map((item) => {
        const key = `todo:${item._id}`;
        const record = getRecord(key);
        const title = autoTodoTitles[item._id] || item.title;
        const sourceText = item.sourceMessage?.text?.trim() || "";
        return (
          <div key={item._id} className="queue-item queue-item-condensed" aria-busy={record.pending}>
            <div>
              <p className="queue-title">{title}</p>
              <p className="queue-meta">Suggested from conversation context · Due: {formatDateTime(item.suggestedDueAt)}</p>
              {sourceText ? <p className="queue-meta">Context: {trim(sourceText, 180)}</p> : null}
            </div>
            <button type="button" className="btn btn-primary" onClick={() => setReviewState({ kind: "todos", item })}>
              Review
            </button>
          </div>
        );
      })}
      {!queueLoading && todoCandidates.length === 0 ? <p className="empty-line">No task suggestions need review.</p> : null}
    </div>
  );

  const renderGuardrails = () => (
    <div className="stack">
      {queueLoading ? <LoadingBlock label="Loading safety flags…" rows={2} compact /> : null}
      {guardrailFlags.map((item) => (
        <div key={item._id} className="queue-item queue-item-condensed">
          <div>
            <p className="queue-title">Safety flag: {item.severity}</p>
            <p className="queue-body">{item.reason}</p>
          </div>
          <button type="button" className="btn btn-ghost" onClick={() => setReviewState({ kind: "guardrails", item })}>
            Review
          </button>
        </div>
      ))}
      {!queueLoading && guardrailFlags.length === 0 ? <p className="empty-line">No safety flags need review.</p> : null}
    </div>
  );

  return (
    <>
      <ActionNotices notices={notices} onDismiss={dismissNotice} />

      <section className="panel-card queue-workspace">
        <div className="queue-control-deck">
          <ProviderFilter
            value={providerFilter}
            onChange={setProviderFilter}
            label="Queue provider filter"
          />
          <div className="queue-focus-tabs" role="tablist" aria-label="Action queue categories">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "needsReply"}
              className={`btn ${tab === "needsReply" ? "btn-primary" : "btn-ghost"}`}
              onClick={() => setTab("needsReply")}
            >
              Needs reply ({counts.needsReply})
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
              Tasks ({counts.todos})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "guardrails"}
              className={`btn ${tab === "guardrails" ? "btn-primary" : "btn-ghost"}`}
              onClick={() => setTab("guardrails")}
            >
              Safety ({counts.guardrails})
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
              Send all drafts
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => onBulkNeedsReply("snooze")}
                disabled={needsReply.length === 0 || getRecord("queue:bulk:snooze").pending}
                aria-disabled={needsReply.length === 0 || getRecord("queue:bulk:snooze").pending}
              >
                Snooze all 30m
              </button>
              <button
                type="button"
                className="btn btn-ghost queue-clear-all"
                onClick={onClearNeedsReply}
                disabled={getRecord("queue:clear:needsReply").pending}
                aria-disabled={getRecord("queue:clear:needsReply").pending}
              >
                {getRecord("queue:clear:needsReply").pending ? "Discarding..." : "Discard all drafts"}
              </button>
            </div>
          ) : null}

          {tab === "followups" ? (
            <div className="queue-actions">
              <button
                type="button"
                className="btn btn-ghost queue-clear-all"
                onClick={onClearFollowups}
                disabled={getRecord("queue:clear:followups").pending}
                aria-disabled={getRecord("queue:clear:followups").pending}
              >
                {getRecord("queue:clear:followups").pending ? "Dismissing..." : "Dismiss all follow-ups"}
              </button>
            </div>
          ) : null}

          {tab === "todos" ? (
            <div className="queue-actions">
              <button
                type="button"
                className="btn btn-ghost queue-clear-all"
                onClick={onClearTodos}
                disabled={getRecord("queue:clear:todos").pending}
                aria-disabled={getRecord("queue:clear:todos").pending}
              >
                {getRecord("queue:clear:todos").pending ? "Closing..." : "Close all tasks"}
              </button>
            </div>
          ) : null}

          {tab === "guardrails" ? (
            <div className="queue-actions">
              <button
                type="button"
                className="btn btn-ghost queue-clear-all"
                onClick={onClearGuardrails}
                disabled={getRecord("queue:clear:guardrails").pending}
                aria-disabled={getRecord("queue:clear:guardrails").pending}
              >
                {getRecord("queue:clear:guardrails").pending ? "Resolving..." : "Resolve all safety flags"}
              </button>
            </div>
          ) : null}
        </div>

        <div className="queue-content-panel">
          {tab === "needsReply" ? renderNeedsReply() : null}
          {tab === "followups" ? renderFollowups() : null}
          {tab === "todos" ? renderTodos() : null}
          {tab === "guardrails" ? renderGuardrails() : null}
        </div>
      </section>

      <UIModal
        open={Boolean(reviewState)}
        onClose={() => setReviewState(null)}
        title={
          reviewState?.kind === "needsReply"
            ? "Review reply"
            : reviewState?.kind === "followups"
              ? "Review follow-up"
              : reviewState?.kind === "todos"
                ? "Review task"
                : "Safety flag"
        }
      >
        {reviewState?.kind === "needsReply" ? (
          (() => {
            const sendOrSnoozePending = isPending(`send:${reviewState.item._id}`) || isPending(`snooze:${reviewState.item._id}`);
            return (
              <div className="stack compact" onKeyDown={(event) => onNeedsReplyShortcut(event, reviewState.item)}>
                <p className="queue-title">{reviewState.item.thread?.title || reviewState.item.thread?.jid || "Unknown contact"}</p>
                <p className="queue-body">{trim(reviewState.item.sourceMessage?.text || reviewState.item.text || "")}</p>
                <SharedMediaPreview
                  preview={reviewState.item.sourceMessage?.mediaPreview}
                  mediaAssetId={reviewState.item.sourceMessage?.mediaAssetId}
                />
                <p className="queue-meta">Draft type: {reviewState.item.sendKind || "text"}</p>
                {reviewState.item.text ? <p className="queue-body">{trim(reviewState.item.text, 240)}</p> : null}
                <SharedMediaPreview preview={reviewState.item.mediaPreview} mediaAssetId={reviewState.item.mediaAssetId} />
                {reviewState.item.mediaCaption?.trim() ? (
                  <p className="queue-meta">Media caption: {trim(reviewState.item.mediaCaption.trim(), 240)}</p>
                ) : null}
                <p className="queue-meta">
                  Channel: {reviewState.item.messageProvider || "whatsapp"} · Model: {reviewState.item.provider} · Delay: {Math.round(reviewState.item.delayMs / 1000)}s · Typing: {Math.round(reviewState.item.typingMs / 1000)}s
                </p>
                <p className="queue-meta">Keyboard shortcuts: A send · S snooze · R discard · E edit</p>
                {editingDraftId === reviewState.item._id ? (
                  <label className="stack compact">
                    <span className="queue-meta">Edit draft text</span>
                    <textarea
                      rows={4}
                      value={editingDraftText}
                      onChange={(event) => setEditingDraftText(event.target.value)}
                      aria-label="Edit draft text"
                    />
                  </label>
                ) : null}
                <div className="queue-actions">
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => onSend(reviewState.item._id)}
                    disabled={sendOrSnoozePending}
                    aria-disabled={sendOrSnoozePending}
                  >
                    Send
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => onSnooze(reviewState.item._id)}
                    disabled={sendOrSnoozePending}
                    aria-disabled={sendOrSnoozePending}
                  >
                    Snooze 30m
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => openEdit(reviewState.item._id, reviewState.item.text)}
                    disabled={isPending(`edit:${reviewState.item._id}`)}
                    aria-disabled={isPending(`edit:${reviewState.item._id}`)}
                  >
                    Edit
                  </button>
                  {editingDraftId === reviewState.item._id ? (
                    <>
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => onSaveEdit(reviewState.item._id)}
                        disabled={isPending(`edit:${reviewState.item._id}`)}
                        aria-disabled={isPending(`edit:${reviewState.item._id}`)}
                      >
                        {isPending(`edit:${reviewState.item._id}`) ? "Saving..." : "Save changes"}
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => onCancelEdit(reviewState.item._id)}
                        disabled={isPending(`edit:${reviewState.item._id}`)}
                        aria-disabled={isPending(`edit:${reviewState.item._id}`)}
                      >
                        Cancel
                      </button>
                    </>
                  ) : null}
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => onReject(reviewState.item._id)}
                    disabled={isPending(`reject:${reviewState.item._id}`)}
                    aria-disabled={isPending(`reject:${reviewState.item._id}`)}
                  >
                    Discard draft
                  </button>
                  {reviewState.item.thread?._id ? (
                    <Link href={`/conversations?threadId=${reviewState.item.thread._id}`} className="btn btn-ghost">
                      Open conversation
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
            );
          })()
        ) : null}

        {reviewState?.kind === "followups" ? (
          <div className="stack compact">
            <p className="queue-title">{reviewState.item.thread?.title || reviewState.item.thread?.jid || "Unknown thread"}</p>
            <p className="queue-meta">Due: {formatDateTimeWithRelative(reviewState.item.dueAt)}</p>
            <p className="queue-body">{autoFollowupReasons[reviewState.item._id] || reviewState.item.reason}</p>
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
                  Open conversation
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
            <p className="queue-title">{autoTodoTitles[reviewState.item._id] || reviewState.item.title}</p>
            <p className="queue-meta">Suggested due time: {formatDateTime(reviewState.item.suggestedDueAt)}</p>
            {reviewState.item.sourceMessage?.text?.trim() ? (
              <p className="queue-meta">Context: {trim(reviewState.item.sourceMessage.text.trim(), 260)}</p>
            ) : null}
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => onConvertTodo(reviewState.item)}
              disabled={getRecord(`todo:${reviewState.item._id}`).pending}
              aria-disabled={getRecord(`todo:${reviewState.item._id}`).pending}
            >
              {getRecord(`todo:${reviewState.item._id}`).pending ? "Adding..." : "Add task"}
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
            <p className="queue-title">Safety flag: {reviewState.item.severity}</p>
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
