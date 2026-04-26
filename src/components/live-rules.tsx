"use client";

import { ActionNotices } from "@/components/action-notices";
import { LoadingBlock, LoadingIndicator } from "@/components/loading-state";
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
  threadKind?: "direct" | "group" | "broadcast_or_system";
};

function inferTargetType(targetValue: string): "contact" | "group" {
  return targetValue.endsWith("@g.us") ? "group" : "contact";
}

function formatTargetType(targetType: "contact" | "group") {
  return targetType === "group" ? "Group" : "Contact";
}

function normalizeTarget(value: string) {
  return value.trim().toLowerCase();
}

function isLikelyTargetJid(value: string) {
  const normalized = normalizeTarget(value);
  if (!normalized.includes("@")) {
    return false;
  }
  if (normalized.endsWith("@s.whatsapp.net") || normalized.endsWith("@g.us")) {
    return true;
  }
  if (normalized === "status@broadcast" || normalized === "ig:story:broadcast") {
    return true;
  }
  return false;
}

function RulesContent() {
  const upsertIgnoreRule = useMutation(api.rules.upsertIgnoreRule);
  const setIgnoreRuleEnabled = useMutation(api.rules.setIgnoreRuleEnabled);
  const deleteIgnoreRule = useMutation(api.rules.deleteIgnoreRule);
  const { runAction, getRecord, notices, dismissNotice } = useActionStateRegistry();

  const [targetValue, setTargetValue] = useState("");
  const [search, setSearch] = useState("");
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
  const contacts = useQuery(api.threads.list, { limit: 250 }) as KnownContact[] | undefined;
  const rulesLoading = rules === undefined;
  const contactsLoading = contacts === undefined;
  const ignoreRules = useMemo(() => rules?.ignoreRules || [], [rules]);
  const knownContacts = useMemo(
    () => (contacts || []).filter((contact) => (contact.threadKind || "direct") !== "broadcast_or_system"),
    [contacts],
  );

  const normalizedTarget = normalizeTarget(targetValue);
  const inferredTargetType = inferTargetType(normalizedTarget);
  const invalidTarget = normalizedTarget.length > 0 && !isLikelyTargetJid(normalizedTarget);

  const duplicateActiveRule = useMemo(() => {
    if (!normalizedTarget) {
      return false;
    }

    return ignoreRules.some(
      (rule) =>
        rule.targetType === inferredTargetType && rule.enabled && normalizeTarget(rule.targetValue) === normalizedTarget,
    );
  }, [ignoreRules, inferredTargetType, normalizedTarget]);
  const normalizedSearch = search.trim().toLowerCase();
  const visibleRules = useMemo(() => {
    if (!normalizedSearch) {
      return ignoreRules;
    }
    return ignoreRules.filter((rule) => {
      const haystack = `${rule.targetType} ${rule.targetValue} ${rule.enabled ? "enabled" : "disabled"}`.toLowerCase();
      return haystack.includes(normalizedSearch);
    });
  }, [ignoreRules, normalizedSearch]);
  const enabledRulesCount = useMemo(() => ignoreRules.filter((rule) => rule.enabled).length, [ignoreRules]);

  const record = getRecord(key);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!normalizedTarget || duplicateActiveRule || invalidTarget) {
      return;
    }

    void runAction(
      key,
      async () => {
        await upsertIgnoreRule({
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
    <section className="rules-workspace">
      <ActionNotices notices={notices} onDismiss={dismissNotice} />

      <div className="panel-grid two-col rules-control-grid">
        <article className="panel-card rules-add-card">
          <h3>Add Ignore Target</h3>
          <p className="queue-meta">Choose an existing conversation or paste a target JID.</p>
          <form onSubmit={onSubmit} className="stack compact rules-form" aria-busy={record.pending}>
            <label className="stack compact">
              <span className="queue-meta">Select from previous conversations</span>
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
                <option value="">{contactsLoading ? "Loading conversations..." : "Choose a conversation"}</option>
                {knownContacts.map((contact) => (
                  <option key={contact._id} value={contact.jid}>
                    {contact.title ? `${contact.title} (${contact.jid})` : contact.jid}
                    {` · ${formatTargetType(contact.threadKind === "group" ? "group" : "contact")}`}
                  </option>
                ))}
              </select>
            </label>

            <label className="stack compact">
              <span className="queue-meta">Manual target JID</span>
              <input
                type="text"
                name="targetValue"
                placeholder="12345@s.whatsapp.net or 12345@g.us"
                value={targetValue}
                onChange={(event) => setTargetValue(event.target.value)}
                aria-disabled={record.pending || rulesLoading || contactsLoading}
                disabled={record.pending || rulesLoading || contactsLoading}
              />
            </label>

            <p className="queue-meta">Detected type: {formatTargetType(inferredTargetType)}</p>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!normalizedTarget || duplicateActiveRule || invalidTarget || record.pending || rulesLoading || contactsLoading}
              aria-disabled={!normalizedTarget || duplicateActiveRule || invalidTarget || record.pending || rulesLoading || contactsLoading}
            >
              {record.pending ? "Adding..." : "Add Ignore Rule"}
            </button>
          </form>
          {rulesLoading || contactsLoading ? <LoadingIndicator label="Loading rules…" /> : null}

          {duplicateActiveRule ? (
            <p className="queue-meta action-inline-error" role="status">
              This {inferredTargetType === "group" ? "group" : "contact"} is already ignored.
            </p>
          ) : null}
          {invalidTarget ? (
            <p className="queue-meta action-inline-error" role="status">
              Enter a valid target JID like `2348012345678@s.whatsapp.net` or `1234567890-123456@g.us`.
            </p>
          ) : null}

          {record.error ? (
            <p className="queue-meta action-inline-error" role="alert">
              {record.error}
            </p>
          ) : null}
        </article>

        <article className="panel-card rules-list-card">
          <div className="rules-list-heading">
            <h3>Active Ignore Rules</h3>
            <p className="queue-meta">
              Total: {ignoreRules.length} · Enabled: {enabledRulesCount}
            </p>
          </div>
          <label className="stack compact search-field-group">
            <span className="queue-meta">Search rules</span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by target or type..."
            />
          </label>
          <div className="stack rules-list">
            {rulesLoading ? <LoadingBlock label="Loading active ignore rules…" rows={3} compact /> : null}
            {visibleRules.map((rule) => (
              <div key={rule._id} className="queue-item rules-row">
                <p className="queue-title">{rule.targetType}</p>
                <p className="queue-body">{rule.targetValue}</p>
                <p className="queue-meta">Enabled: {rule.enabled ? "Yes" : "No"}</p>
                <div className="queue-actions rules-item-actions">
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
            {!rulesLoading && visibleRules.length === 0 ? <p className="empty-line">No ignore rules match this search.</p> : null}
          </div>
        </article>
      </div>
    </section>
  );
}

export function LiveRules() {
  return <RulesContent />;
}
