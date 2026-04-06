"use client";

import { ActionNotices } from "@/components/action-notices";
import { useActionStateRegistry } from "@/lib/ui/action-state";
import { api } from "../../convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { FormEvent, useMemo, useState } from "react";

function RulesContent() {
  const upsertIgnoreRule = useMutation(api.rules.upsertIgnoreRule);
  const { runAction, getRecord, notices, dismissNotice } = useActionStateRegistry();

  const [targetValue, setTargetValue] = useState("");
  const key = "rules:add-ignore";

  const rules = useQuery(api.rules.list, {}) as
    | {
        ignoreRules: Array<{
          _id: string;
          targetType: string;
          targetValue: string;
          enabled: boolean;
        }>;
      }
    | undefined;

  const normalizedTarget = targetValue.trim();

  const duplicateActiveRule = useMemo(() => {
    if (!normalizedTarget) {
      return false;
    }

    return (rules?.ignoreRules || []).some(
      (rule) => rule.targetType === "contact" && rule.enabled && rule.targetValue === normalizedTarget,
    );
  }, [normalizedTarget, rules?.ignoreRules]);

  const record = getRecord(key);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!normalizedTarget || duplicateActiveRule) {
      return;
    }

    void runAction(
      key,
      async () => {
        await upsertIgnoreRule({
          targetType: "contact",
          targetValue: normalizedTarget,
          enabled: true,
        });
        setTargetValue("");
      },
      {
        pendingLabel: "Adding...",
        successMessage: "Ignore rule saved.",
      },
    );
  };

  return (
    <section className="panel-grid two-col">
      <article className="panel-card">
        <ActionNotices notices={notices} onDismiss={dismissNotice} />
        <h3>Add Ignore Contact</h3>
        <form onSubmit={onSubmit} className="stack compact" aria-busy={record.pending}>
          <input
            type="text"
            name="targetValue"
            placeholder="12345@s.whatsapp.net"
            value={targetValue}
            onChange={(event) => setTargetValue(event.target.value)}
            required
            aria-disabled={record.pending}
            disabled={record.pending}
          />
          <button
            type="submit"
            className="btn btn-primary"
            disabled={!normalizedTarget || duplicateActiveRule || record.pending}
            aria-disabled={!normalizedTarget || duplicateActiveRule || record.pending}
          >
            {record.pending ? "Adding..." : "Add Ignore Rule"}
          </button>
        </form>

        {duplicateActiveRule ? (
          <p className="queue-meta action-inline-error" role="status">
            This contact is already ignored.
          </p>
        ) : null}

        {record.error ? (
          <p className="queue-meta action-inline-error" role="alert">
            {record.error}
          </p>
        ) : null}
      </article>

      <article className="panel-card">
        <h3>Active Ignore Rules</h3>
        <div className="stack">
          {(rules?.ignoreRules || []).map((rule) => (
            <div key={rule._id} className="queue-item">
              <p className="queue-title">{rule.targetType}</p>
              <p className="queue-body">{rule.targetValue}</p>
              <p className="queue-meta">Enabled: {rule.enabled ? "Yes" : "No"}</p>
            </div>
          ))}
          {(rules?.ignoreRules || []).length === 0 ? <p className="empty-line">No ignore rules yet.</p> : null}
        </div>
      </article>
    </section>
  );
}

export function LiveRules() {
  return <RulesContent />;
}
