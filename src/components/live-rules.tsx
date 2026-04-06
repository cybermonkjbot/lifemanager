"use client";

import { ActionNotices } from "@/components/action-notices";
import { useActionStateRegistry } from "@/lib/ui/action-state";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { FormEvent, useMemo, useState } from "react";

type KnownContact = {
  _id: string;
  jid: string;
  title?: string;
  isIgnored?: boolean;
};

function RulesContent() {
  const upsertIgnoreRule = useMutation(api.rules.upsertIgnoreRule);
  const setIgnoreRuleEnabled = useMutation(api.rules.setIgnoreRuleEnabled);
  const deleteIgnoreRule = useMutation(api.rules.deleteIgnoreRule);
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
  const contacts = useQuery(api.threads.listContacts, { limit: 250 }) as KnownContact[] | undefined;
  const rulesLoading = rules === undefined;
  const contactsLoading = contacts === undefined;
  const ignoreRules = useMemo(() => rules?.ignoreRules || [], [rules]);
  const knownContacts = useMemo(() => contacts || [], [contacts]);

  const normalizedTarget = targetValue.trim();

  const duplicateActiveRule = useMemo(() => {
    if (!normalizedTarget) {
      return false;
    }

    return ignoreRules.some(
      (rule) => rule.targetType === "contact" && rule.enabled && rule.targetValue === normalizedTarget,
    );
  }, [ignoreRules, normalizedTarget]);

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
          <label className="stack compact">
            <span className="queue-meta">Select from previous contacts</span>
            <select
              value=""
              onChange={(event) => {
                if (!event.target.value) {
                  return;
                }
                setTargetValue(event.target.value);
              }}
              disabled={record.pending || contactsLoading}
              aria-disabled={record.pending || contactsLoading}
            >
              <option value="">{contactsLoading ? "Loading contacts..." : "Choose a contact"}</option>
              {knownContacts.map((contact) => (
                <option key={contact._id} value={contact.jid}>
                  {contact.title ? `${contact.title} (${contact.jid})` : contact.jid}
                </option>
              ))}
            </select>
          </label>

          <input
            type="text"
            name="targetValue"
            placeholder="12345@s.whatsapp.net"
            value={targetValue}
            onChange={(event) => setTargetValue(event.target.value)}
            required
            aria-disabled={record.pending || rulesLoading || contactsLoading}
            disabled={record.pending || rulesLoading || contactsLoading}
          />
          <button
            type="submit"
            className="btn btn-primary"
            disabled={!normalizedTarget || duplicateActiveRule || record.pending || rulesLoading || contactsLoading}
            aria-disabled={!normalizedTarget || duplicateActiveRule || record.pending || rulesLoading || contactsLoading}
          >
            {record.pending ? "Adding..." : "Add Ignore Rule"}
          </button>
        </form>
        {rulesLoading ? <p className="empty-line">Loading rules…</p> : null}
        {contactsLoading ? <p className="empty-line">Loading previous contacts…</p> : null}

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
          {rulesLoading ? <p className="empty-line">Loading active ignore rules…</p> : null}
          {ignoreRules.map((rule) => (
            <div key={rule._id} className="queue-item">
              <p className="queue-title">{rule.targetType}</p>
              <p className="queue-body">{rule.targetValue}</p>
              <p className="queue-meta">Enabled: {rule.enabled ? "Yes" : "No"}</p>
              <div className="queue-actions">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() =>
                    void runAction(
                      `rules:toggle:${rule._id}`,
                      async () => {
                        await setIgnoreRuleEnabled({
                          ruleId: rule._id as Id<"ignoreRules">,
                          enabled: !rule.enabled,
                        });
                      },
                      {
                        pendingLabel: rule.enabled ? "Disabling..." : "Enabling...",
                        successMessage: rule.enabled ? "Rule disabled." : "Rule enabled.",
                      },
                    )
                  }
                  disabled={getRecord(`rules:toggle:${rule._id}`).pending}
                  aria-disabled={getRecord(`rules:toggle:${rule._id}`).pending}
                >
                  {rule.enabled ? "Disable" : "Enable"}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() =>
                    void runAction(
                      `rules:delete:${rule._id}`,
                      async () => {
                        await deleteIgnoreRule({
                          ruleId: rule._id as Id<"ignoreRules">,
                        });
                      },
                      {
                        pendingLabel: "Deleting...",
                        successMessage: "Rule deleted.",
                      },
                    )
                  }
                  disabled={getRecord(`rules:delete:${rule._id}`).pending}
                  aria-disabled={getRecord(`rules:delete:${rule._id}`).pending}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
          {!rulesLoading && ignoreRules.length === 0 ? <p className="empty-line">No ignore rules yet.</p> : null}
        </div>
      </article>
    </section>
  );
}

export function LiveRules() {
  return <RulesContent />;
}
