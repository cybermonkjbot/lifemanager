"use client";

import { ActionNotices } from "@/components/action-notices";
import { useActionStateRegistry } from "@/lib/ui/action-state";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { FormEvent, useEffect, useMemo, useState } from "react";

function StyleLabContent() {
  const setMimicry = useMutation(api.style.setMimicry);
  const rollbackHistory = useMutation(api.style.rollbackHistory);
  const { runAction, getRecord, notices, dismissNotice } = useActionStateRegistry();
  const key = "style:mimicry";

  const profile = useQuery(api.style.getProfile, {}) as
    | {
        mimicryLevel: number;
        commonPhrases: string[];
        spellingNotes: string[];
        humorNotes: string[];
      }
    | undefined;
  const profileLoading = profile === undefined;
  const history = useQuery(api.style.listHistory, { limit: 20 }) as
    | Array<{
        _id: string;
        mimicryLevel: number;
        reason?: string;
        createdAt: number;
      }>
    | undefined;

  const currentLevel = profile?.mimicryLevel ?? 0.72;
  const [mimicryLevel, setMimicryLevel] = useState(currentLevel);

  useEffect(() => {
    setMimicryLevel(currentLevel);
  }, [currentLevel]);

  const hasChanged = useMemo(() => {
    return Math.abs(mimicryLevel - currentLevel) >= 0.001;
  }, [mimicryLevel, currentLevel]);

  const record = getRecord(key);
  const rollbackRecord = getRecord("style:rollback");

  const previewNeutral = useMemo(() => {
    if (mimicryLevel <= 0.3) {
      return "Thanks for the update. I appreciate it.";
    }
    if (mimicryLevel <= 0.65) {
      return "Thanks for the update, got it. I appreciate you sharing.";
    }
    if (mimicryLevel <= 0.85) {
      return "Haha thanks for the update, got you. Appreciate you sharing this.";
    }
    return "Haha got you, thanks for the update. Really appreciate you sharing this with me.";
  }, [mimicryLevel]);

  const previewPlayful = useMemo(() => {
    if (mimicryLevel <= 0.3) {
      return "Sounds good. I can handle that.";
    }
    if (mimicryLevel <= 0.65) {
      return "Sounds good, I can handle that. Give me a little time.";
    }
    if (mimicryLevel <= 0.85) {
      return "Sounds good haha, I can handle that. Give me a little time and I’ll update you.";
    }
    return "Sounds good haha, I can handle that for sure. Give me a little time and I’ll update you asap.";
  }, [mimicryLevel]);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!hasChanged) {
      return;
    }

    void runAction(
      key,
      async () => {
        await setMimicry({ mimicryLevel });
      },
      {
        pendingLabel: "Saving...",
        successMessage: "Mimicry level updated.",
      },
    );
  };

  return (
    <section className="panel-grid two-col">
      <article className="panel-card">
        <ActionNotices notices={notices} onDismiss={dismissNotice} />
        <h3>Mimicry Control</h3>
        <p className="queue-meta">
          {profileLoading ? "Loading style profile..." : `Current mimicry: ${Math.round(currentLevel * 100)}%`}
        </p>
        <form onSubmit={onSubmit} className="stack compact" aria-busy={record.pending}>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            name="mimicryLevel"
            value={mimicryLevel}
            onChange={(event) => setMimicryLevel(Number(event.target.value))}
            disabled={record.pending || profileLoading}
            aria-disabled={record.pending || profileLoading}
          />
          <p className="queue-meta">Draft value: {Math.round(mimicryLevel * 100)}%</p>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={!hasChanged || record.pending || profileLoading}
            aria-disabled={!hasChanged || record.pending || profileLoading}
          >
            {record.pending ? "Saving..." : "Save Mimicry"}
          </button>
        </form>
        {record.error ? (
          <p className="queue-meta action-inline-error" role="alert">
            {record.error}
          </p>
        ) : null}

        <div className="stack">
          <p className="queue-meta">Preview: neutral context</p>
          <p>{previewNeutral}</p>
          <p className="queue-meta">Preview: playful context</p>
          <p>{previewPlayful}</p>
        </div>
      </article>

      <article className="panel-card">
        <h3>Learned Traits</h3>
        <div className="stack">
          {profileLoading ? (
            <p className="empty-line">Loading learned traits…</p>
          ) : (
            <>
              <p className="queue-meta">Common phrases</p>
              <p>{(profile?.commonPhrases || []).join(", ") || "Not enough data yet."}</p>

              <p className="queue-meta">Spelling style</p>
              <p>{(profile?.spellingNotes || []).join(", ") || "No spelling profile yet."}</p>

              <p className="queue-meta">Humor markers</p>
              <p>{(profile?.humorNotes || []).join(", ") || "No humor markers yet."}</p>
            </>
          )}
        </div>

        <h3>Mimicry History</h3>
        <div className="stack">
          {(history || []).map((item) => (
            <div key={item._id} className="queue-item">
              <p className="queue-title">{Math.round(item.mimicryLevel * 100)}%</p>
              <p className="queue-meta">
                {item.reason || "snapshot"} · {new Date(item.createdAt).toLocaleString()}
              </p>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() =>
                  void runAction(
                    "style:rollback",
                    async () => {
                      await rollbackHistory({ historyId: item._id as Id<"styleProfileHistory"> });
                    },
                    {
                      pendingLabel: "Rolling back style...",
                      successMessage: "Style profile rolled back.",
                    },
                  )
                }
                disabled={rollbackRecord.pending}
                aria-disabled={rollbackRecord.pending}
              >
                Rollback
              </button>
            </div>
          ))}
          {history !== undefined && history.length === 0 ? <p className="empty-line">No history yet.</p> : null}
        </div>
      </article>
    </section>
  );
}

export function LiveStyleLab() {
  return <StyleLabContent />;
}
