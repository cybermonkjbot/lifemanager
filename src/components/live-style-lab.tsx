"use client";

import { ActionNotices } from "@/components/action-notices";
import { useActionStateRegistry } from "@/lib/ui/action-state";
import { api } from "../../convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { FormEvent, useEffect, useMemo, useState } from "react";

function StyleLabContent() {
  const setMimicry = useMutation(api.style.setMimicry);
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

  const currentLevel = profile?.mimicryLevel ?? 0.72;
  const [mimicryLevel, setMimicryLevel] = useState(currentLevel);

  useEffect(() => {
    setMimicryLevel(currentLevel);
  }, [currentLevel]);

  const hasChanged = useMemo(() => {
    return Math.abs(mimicryLevel - currentLevel) >= 0.001;
  }, [mimicryLevel, currentLevel]);

  const record = getRecord(key);

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
        <p className="queue-meta">Current mimicry: {Math.round(currentLevel * 100)}%</p>
        <form onSubmit={onSubmit} className="stack compact" aria-busy={record.pending}>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            name="mimicryLevel"
            value={mimicryLevel}
            onChange={(event) => setMimicryLevel(Number(event.target.value))}
            disabled={record.pending}
            aria-disabled={record.pending}
          />
          <p className="queue-meta">Draft value: {Math.round(mimicryLevel * 100)}%</p>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={!hasChanged || record.pending}
            aria-disabled={!hasChanged || record.pending}
          >
            {record.pending ? "Saving..." : "Save Mimicry"}
          </button>
        </form>
        {record.error ? (
          <p className="queue-meta action-inline-error" role="alert">
            {record.error}
          </p>
        ) : null}
      </article>

      <article className="panel-card">
        <h3>Learned Traits</h3>
        <div className="stack">
          <p className="queue-meta">Common phrases</p>
          <p>{(profile?.commonPhrases || []).join(", ") || "Not enough data yet."}</p>

          <p className="queue-meta">Spelling style</p>
          <p>{(profile?.spellingNotes || []).join(", ") || "No spelling profile yet."}</p>

          <p className="queue-meta">Humor markers</p>
          <p>{(profile?.humorNotes || []).join(", ") || "No humor markers yet."}</p>
        </div>
      </article>
    </section>
  );
}

export function LiveStyleLab() {
  return <StyleLabContent />;
}
