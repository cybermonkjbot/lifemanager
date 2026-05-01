"use client";

import { ActionNotices } from "@/components/action-notices";
import { SearchableSelect } from "@/components/app-ui";
import { EmptyState } from "@/components/empty-state";
import { LoadingBlock, LoadingIndicator } from "@/components/loading-state";
import { useTenantScopeArgs } from "@/components/tenant-scope-provider";
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
  provider?: "whatsapp" | "instagram" | "imessage" | "telegram";
  threadKind?: "direct" | "group" | "broadcast_or_system";
};

type IgnoreProvider = NonNullable<KnownContact["provider"]>;

function inferProviderFromTarget(targetValue: string): IgnoreProvider {
  const normalized = normalizeTarget(targetValue);
  if (normalized.startsWith("ig:") || normalized.startsWith("instagram:")) {
    return "instagram";
  }
  if (normalized.startsWith("imessage:")) {
    return "imessage";
  }
  if (normalized.startsWith("telegram:")) {
    return "telegram";
  }
  return "whatsapp";
}

function inferTargetType(targetValue: string, provider: IgnoreProvider): "contact" | "group" {
  return provider === "whatsapp" && targetValue.endsWith("@g.us") ? "group" : "contact";
}

function formatTargetType(targetType: "contact" | "group") {
  return targetType === "group" ? "Group" : "Contact";
}

function formatProvider(provider?: IgnoreProvider) {
  if (provider === "instagram") {
    return "Instagram";
  }
  if (provider === "imessage") {
    return "iMessage";
  }
  if (provider === "telegram") {
    return "Telegram";
  }
  return "WhatsApp";
}

function normalizeTarget(value: string) {
  return value.trim().toLowerCase();
}

function targetFallbackName(value: string) {
  const normalized = normalizeTarget(value);
  if (normalized === "status@broadcast") {
    return "WhatsApp Status";
  }
  if (normalized === "ig:story:broadcast") {
    return "Instagram Story";
  }
  const local = normalized.split("@")[0] || normalized;
  if (/^\d+$/.test(local)) {
    return `+${local}`;
  }
  return local.replace(/[-_.]+/g, " ");
}

function contactName(contact?: KnownContact | null, targetValue?: string) {
  return contact?.title?.trim() || targetFallbackName(contact?.jid || targetValue || "");
}

function isLikelyTargetJid(value: string) {
  const normalized = normalizeTarget(value);
  if (normalized.startsWith("ig:") || normalized.startsWith("instagram:")) {
    return normalized.length > 3;
  }
  if (normalized.startsWith("imessage:") || normalized.startsWith("telegram:")) {
    return normalized.includes(":") && normalized.split(":").some((part) => part.length > 0);
  }
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
  const tenantScope = useTenantScopeArgs();
  const upsertIgnoreRule = useMutation(api.rules.upsertIgnoreRule);
  const setIgnoreRuleEnabled = useMutation(api.rules.setIgnoreRuleEnabled);
  const deleteIgnoreRule = useMutation(api.rules.deleteIgnoreRule);
  const { runAction, getRecord, notices, dismissNotice } = useActionStateRegistry();

  const [targetValue, setTargetValue] = useState("");
  const [targetProvider, setTargetProvider] = useState<IgnoreProvider | undefined>(undefined);
  const [search, setSearch] = useState("");
  const key = "rules:add-ignore";

  const rules = useQuery(api.rules.list, tenantScope) as
    | {
        ignoreRules: Array<{
          _id: string;
          targetType: string;
          targetValue: string;
          enabled: boolean;
        }>;
      }
    | undefined;
  const contacts = useQuery(api.threads.list, { ...tenantScope, limit: 250 }) as KnownContact[] | undefined;
  const rulesLoading = rules === undefined;
  const contactsLoading = contacts === undefined;
  const ignoreRules = useMemo(() => rules?.ignoreRules || [], [rules]);
  const knownContacts = useMemo(
    () => (contacts || []).filter((contact) => (contact.threadKind || "direct") !== "broadcast_or_system"),
    [contacts],
  );
  const contactByTarget = useMemo(() => {
    const map = new Map<string, KnownContact>();
    for (const contact of knownContacts) {
      map.set(normalizeTarget(contact.jid), contact);
    }
    return map;
  }, [knownContacts]);

  const normalizedTarget = normalizeTarget(targetValue);
  const inferredProvider = targetProvider || inferProviderFromTarget(normalizedTarget);
  const inferredTargetType = inferTargetType(normalizedTarget, inferredProvider);
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
      const targetContact = contactByTarget.get(normalizeTarget(rule.targetValue));
      const haystack = `${rule.targetType} ${rule.targetValue} ${contactName(targetContact, rule.targetValue)} ${rule.enabled ? "enabled" : "disabled"}`.toLowerCase();
      return haystack.includes(normalizedSearch);
    });
  }, [contactByTarget, ignoreRules, normalizedSearch]);
  const enabledRulesCount = useMemo(() => ignoreRules.filter((rule) => rule.enabled).length, [ignoreRules]);
  const disabledRulesCount = ignoreRules.length - enabledRulesCount;

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
          ...tenantScope,
          targetValue: normalizedTarget,
          provider: inferredProvider,
          enabled: true,
        });
        setTargetValue("");
        setTargetProvider(undefined);
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
          <p className="queue-meta">Choose an existing conversation or paste a contact address.</p>
          <form onSubmit={onSubmit} className="stack compact rules-form" aria-busy={record.pending}>
            <label className="stack compact">
              <span className="queue-meta">Select from previous conversations</span>
              <SearchableSelect
                value=""
                onChange={(event) => {
                  if (!event.target.value) {
                    return;
                  }
                  const contact = knownContacts.find((item) => item._id === event.target.value);
                  if (!contact) {
                    return;
                  }
                  setTargetValue(contact.jid);
                  setTargetProvider(contact.provider || "whatsapp");
                }}
                disabled={record.pending || contactsLoading}
                aria-disabled={record.pending || contactsLoading}
              >
                <option value="">{contactsLoading ? "Loading conversations..." : "Choose a conversation"}</option>
                {knownContacts.map((contact) => (
                  <option key={contact._id} value={contact._id}>
                    {contactName(contact)} · {formatProvider(contact.provider)} ·{" "}
                    {formatTargetType(contact.threadKind === "group" ? "group" : "contact")}
                  </option>
                ))}
              </SearchableSelect>
            </label>

            <label className="stack compact">
              <span className="queue-meta">Manual contact address</span>
              <input
                type="text"
                name="targetValue"
                placeholder="Paste a WhatsApp, Instagram, iMessage, or Telegram address"
                value={targetValue}
                onChange={(event) => {
                  setTargetValue(event.target.value);
                  setTargetProvider(undefined);
                }}
                aria-disabled={record.pending || rulesLoading || contactsLoading}
                disabled={record.pending || rulesLoading || contactsLoading}
              />
            </label>

            <p className="queue-meta">
              Detected: {formatProvider(inferredProvider)} {formatTargetType(inferredTargetType).toLowerCase()}
            </p>
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
              Enter a valid contact or group address.
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
            <div>
              <h3>Ignored Conversations</h3>
              <p className="queue-meta">Contacts and groups Odogwu should leave alone.</p>
            </div>
            <div className="rules-summary-pills" aria-label="Ignore rule summary">
              <span className="rules-summary-pill rules-summary-pill-strong">
                <strong>{enabledRulesCount}</strong>
                On
              </span>
              <span className="rules-summary-pill">
                <strong>{disabledRulesCount}</strong>
                Paused
              </span>
              <span className="rules-summary-pill">
                <strong>{ignoreRules.length}</strong>
                Total
              </span>
            </div>
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
          <div className="rules-list" role="list">
            {rulesLoading ? <LoadingBlock label="Loading active ignore rules…" rows={3} compact /> : null}
            {visibleRules.map((rule) => {
              const targetContact = contactByTarget.get(normalizeTarget(rule.targetValue));
              const targetType = rule.targetType === "group" ? "group" : "contact";
              const toggleRecord = getRecord(`rules:toggle:${rule._id}`);
              const deleteRecord = getRecord(`rules:delete:${rule._id}`);
              return (
                <article key={rule._id} className={`rules-row ${rule.enabled ? "" : "rules-row-disabled"}`} role="listitem">
                  <div className="rules-row-main">
                    <span className={`rules-type-pill rules-type-${targetType}`}>{formatTargetType(targetType)}</span>
                    <span className={`rules-state-pill ${rule.enabled ? "rules-state-on" : "rules-state-off"}`}>
                      {rule.enabled ? "Ignored" : "Paused"}
                    </span>
                    <div className="recipient-chip-list rules-target-chip-list">
                      <span className="recipient-chip">
                        <span className="recipient-chip-copy">
                          <strong>{contactName(targetContact, rule.targetValue)}</strong>
                          <small>{normalizeTarget(rule.targetValue)}</small>
                        </span>
                      </span>
                    </div>
                  </div>
                  <div className="queue-actions rules-item-actions">
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() =>
                        void runAction(
                          `rules:toggle:${rule._id}`,
                          async () => {
                            await setIgnoreRuleEnabled({
                              ...tenantScope,
                              ruleId: rule._id as Id<"ignoreRules">,
                              enabled: !rule.enabled,
                            });
                          },
                          {
                            pendingLabel: rule.enabled ? "Pausing..." : "Resuming...",
                            successMessage: rule.enabled ? "Rule paused." : "Rule resumed.",
                          },
                        )
                      }
                      disabled={toggleRecord.pending}
                      aria-disabled={toggleRecord.pending}
                    >
                      {rule.enabled ? "Pause" : "Resume"}
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() =>
                        void runAction(
                          `rules:delete:${rule._id}`,
                          async () => {
                            await deleteIgnoreRule({
                              ...tenantScope,
                              ruleId: rule._id as Id<"ignoreRules">,
                            });
                          },
                          {
                            pendingLabel: "Removing...",
                            successMessage: "Rule removed.",
                          },
                        )
                      }
                      disabled={deleteRecord.pending}
                      aria-disabled={deleteRecord.pending}
                    >
                      Remove
                    </button>
                  </div>
                </article>
              );
            })}
            {!rulesLoading && visibleRules.length === 0 ? (
              <EmptyState
                variant="rules"
                title="No ignore rules match this search."
                description="Rules you add for contacts and groups will appear here for quick enable, disable, or delete actions."
              />
            ) : null}
          </div>
        </article>
      </div>
    </section>
  );
}

export function LiveRules() {
  return <RulesContent />;
}
