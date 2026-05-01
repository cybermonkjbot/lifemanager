"use client";

import { SearchableSelect } from "@/components/app-ui";
import { useMemo, useState, type ReactNode } from "react";

export type AdminPlanId = "personal_connector" | "business_whatsapp" | "self_hosted";

export type AdminPlanConfig = {
  enabled: boolean;
  amount: number;
  currency: string;
  flutterwavePaymentPlanId: string;
  maxSeats: number;
  maxDevices: number;
  monthlyAiMessages: number;
  monthlyAiSpendUsd: number;
  whatsappEnabled: boolean;
  instagramEnabled: boolean;
  imessageEnabled: boolean;
  telegramEnabled: boolean;
  mediaEnabled: boolean;
  selfHostedEnabled: boolean;
};

export type AdminSubscriptionConfig = {
  trialDays: number;
  graceDays: number;
  dunningEmailEnabled: boolean;
  tenantReportsEnabled: boolean;
  plans: Record<AdminPlanId, AdminPlanConfig>;
};

export type AdminPlatformConfig = {
  aiFallbackMode: "all" | "azure_only";
  aiModelFirstEnabled: boolean;
  aiTemperature: number;
  aiMaxOutputTokens: number;
  aiMaxReplyChars: number;
  aiHistoryLineLimit: number;
  aiPrimaryConfidence: number;
  aiFallbackConfidence: number;
  outboxClaimLimit: number;
  outboxPollMs: number;
  inboundMergeWindowMs: number;
  inboundConcurrency: number;
  outboxSendConcurrency: number;
  sendRateWindowMinutes: number;
  sendMaxPerThreadInWindow: number;
  sendMaxGlobalInWindow: number;
  quietHoursEnabled: boolean;
  quietHoursStartHour: number;
  quietHoursEndHour: number;
  statusRetentionMs: number;
  statusCleanupIntervalMs: number;
  statusCleanupBatchLimit: number;
};

export type AdminUserRow = {
  email: string;
  source: "convex" | "bootstrap";
  canMasqueradeTenants: boolean;
  createdAt: number | null;
  updatedAt: number | null;
  createdBy?: string;
};

const PLAN_LABELS: Record<AdminPlanId, string> = {
  personal_connector: "Personal Connector",
  business_whatsapp: "Business WhatsApp",
  self_hosted: "Self Hosted",
};

const PLAN_IDS: AdminPlanId[] = ["personal_connector", "business_whatsapp", "self_hosted"];

function formatDate(value: number | null | undefined) {
  return value ? new Date(value).toLocaleString() : "n/a";
}

async function readJson<T>(response: Response, fallbackMessage: string) {
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(body.error || fallbackMessage);
  }
  return body;
}

function ToggleField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="admin-compact-checkbox">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

function NumberField({
  label,
  value,
  onChange,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  step?: number;
}) {
  return (
    <label className="admin-compact-field">
      <span>{label}</span>
      <input type="number" step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

function TextField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="admin-compact-field">
      <span>{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function AdminConfigToolbar({
  title,
  detail,
  action,
}: {
  title: string;
  detail: string;
  action: ReactNode;
}) {
  return (
    <div className="admin-config-toolbar">
      <div>
        <span>{title}</span>
        <strong>{detail}</strong>
      </div>
      {action}
    </div>
  );
}

export function AdminSubscriptionConfigDashboard({ initialConfig }: { initialConfig: AdminSubscriptionConfig }) {
  const [config, setConfig] = useState(initialConfig);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  async function saveConfig() {
    setSaving(true);
    setNotice("");
    setError("");
    try {
      await readJson(
        await fetch("/api/admin/subscription-config", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ config }),
        }),
        "Failed to save subscription config.",
      );
      setNotice("Subscription config saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save subscription config.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="admin-config-stack">
      {error ? <p className="admin-alert" role="alert">{error}</p> : null}
      {notice ? <p className="admin-notice" role="status">{notice}</p> : null}
      <AdminConfigToolbar
        title="Plan Setup"
        detail={`${PLAN_IDS.filter((planId) => config.plans[planId].enabled).length} plans enabled`}
        action={(
          <button className="btn admin-primary-action" type="button" onClick={saveConfig} disabled={saving}>
            {saving ? "Saving..." : "Save subscription config"}
          </button>
        )}
      />
      <section className="admin-data-panel admin-config-panel">
        <div className="admin-data-head admin-config-head">
          <span>Subscription Rules</span>
          <span>{config.trialDays} day trial / {config.graceDays} day grace</span>
        </div>
        <div className="admin-config-grid">
          <NumberField label="Trial days" value={config.trialDays} onChange={(trialDays) => setConfig((prev) => ({ ...prev, trialDays }))} />
          <NumberField label="Grace days" value={config.graceDays} onChange={(graceDays) => setConfig((prev) => ({ ...prev, graceDays }))} />
          <ToggleField label="Dunning email" checked={config.dunningEmailEnabled} onChange={(dunningEmailEnabled) => setConfig((prev) => ({ ...prev, dunningEmailEnabled }))} />
          <ToggleField label="Tenant reports" checked={config.tenantReportsEnabled} onChange={(tenantReportsEnabled) => setConfig((prev) => ({ ...prev, tenantReportsEnabled }))} />
        </div>
      </section>
      <div className="admin-config-grid admin-config-grid-three">
        {PLAN_IDS.map((planId) => {
          const plan = config.plans[planId];
          return (
            <section className="admin-data-panel admin-config-panel" key={planId}>
              <div className="admin-data-head admin-config-head">
                <span>{PLAN_LABELS[planId]}</span>
                <ToggleField label="Enabled" checked={plan.enabled} onChange={(enabled) => setConfig((prev) => ({
                  ...prev,
                  plans: { ...prev.plans, [planId]: { ...plan, enabled } },
                }))} />
              </div>
              <div className="admin-config-grid">
                <NumberField label="Amount" value={plan.amount} onChange={(amount) => setConfig((prev) => ({ ...prev, plans: { ...prev.plans, [planId]: { ...plan, amount } } }))} />
                <TextField label="Currency" value={plan.currency} onChange={(currency) => setConfig((prev) => ({ ...prev, plans: { ...prev.plans, [planId]: { ...plan, currency } } }))} />
                <TextField label="Flutterwave plan ID" value={plan.flutterwavePaymentPlanId} onChange={(flutterwavePaymentPlanId) => setConfig((prev) => ({ ...prev, plans: { ...prev.plans, [planId]: { ...plan, flutterwavePaymentPlanId } } }))} />
              </div>
            </section>
          );
        })}
      </div>
    </section>
  );
}

export function AdminEntitlementsDashboard({ initialConfig }: { initialConfig: AdminSubscriptionConfig }) {
  const [config, setConfig] = useState(initialConfig);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  async function saveConfig() {
    setSaving(true);
    setNotice("");
    setError("");
    try {
      await readJson(
        await fetch("/api/admin/subscription-config", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ config }),
        }),
        "Failed to save entitlements.",
      );
      setNotice("Entitlements saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save entitlements.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="admin-config-stack">
      {error ? <p className="admin-alert" role="alert">{error}</p> : null}
      {notice ? <p className="admin-notice" role="status">{notice}</p> : null}
      <AdminConfigToolbar
        title="Entitlement Matrix"
        detail="Seats, devices, channels, and monthly AI limits by plan"
        action={(
          <button className="btn admin-primary-action" type="button" onClick={saveConfig} disabled={saving}>
            {saving ? "Saving..." : "Save entitlements"}
          </button>
        )}
      />
      <div className="admin-config-grid admin-config-grid-three">
        {PLAN_IDS.map((planId) => {
          const plan = config.plans[planId];
          const updatePlan = (patch: Partial<AdminPlanConfig>) =>
            setConfig((prev) => ({ ...prev, plans: { ...prev.plans, [planId]: { ...plan, ...patch } } }));
          return (
            <section className="admin-data-panel admin-config-panel" key={planId}>
              <div className="admin-data-head admin-config-head">
                <span>{PLAN_LABELS[planId]}</span>
              </div>
              <div className="admin-config-grid">
                <NumberField label="Max seats" value={plan.maxSeats} onChange={(maxSeats) => updatePlan({ maxSeats })} />
                <NumberField label="Max devices" value={plan.maxDevices} onChange={(maxDevices) => updatePlan({ maxDevices })} />
                <NumberField label="Monthly AI messages" value={plan.monthlyAiMessages} onChange={(monthlyAiMessages) => updatePlan({ monthlyAiMessages })} />
                <NumberField label="Monthly spend USD" value={plan.monthlyAiSpendUsd} onChange={(monthlyAiSpendUsd) => updatePlan({ monthlyAiSpendUsd })} step={0.01} />
                <ToggleField label="WhatsApp" checked={plan.whatsappEnabled} onChange={(whatsappEnabled) => updatePlan({ whatsappEnabled })} />
                <ToggleField label="Instagram" checked={plan.instagramEnabled} onChange={(instagramEnabled) => updatePlan({ instagramEnabled })} />
                <ToggleField label="iMessage" checked={plan.imessageEnabled} onChange={(imessageEnabled) => updatePlan({ imessageEnabled })} />
                <ToggleField label="Telegram" checked={plan.telegramEnabled} onChange={(telegramEnabled) => updatePlan({ telegramEnabled })} />
                <ToggleField label="Media" checked={plan.mediaEnabled} onChange={(mediaEnabled) => updatePlan({ mediaEnabled })} />
                <ToggleField label="Self-hosted" checked={plan.selfHostedEnabled} onChange={(selfHostedEnabled) => updatePlan({ selfHostedEnabled })} />
              </div>
            </section>
          );
        })}
      </div>
    </section>
  );
}

export function AdminPlatformConfigDashboard({ initialConfig }: { initialConfig: AdminPlatformConfig }) {
  const [config, setConfig] = useState(initialConfig);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const update = (patch: Partial<AdminPlatformConfig>) => setConfig((prev) => ({ ...prev, ...patch }));

  const groups = useMemo(() => [
    {
      title: "AI Runtime",
      fields: (
        <>
          <label className="admin-compact-field">
            <span>Fallback mode</span>
            <SearchableSelect value={config.aiFallbackMode} onChange={(event) => update({ aiFallbackMode: event.target.value as AdminPlatformConfig["aiFallbackMode"] })}>
              <option value="all">All providers</option>
              <option value="azure_only">Azure only</option>
            </SearchableSelect>
          </label>
          <ToggleField label="Model first" checked={config.aiModelFirstEnabled} onChange={(aiModelFirstEnabled) => update({ aiModelFirstEnabled })} />
          <NumberField label="Temperature" value={config.aiTemperature} onChange={(aiTemperature) => update({ aiTemperature })} step={0.01} />
          <NumberField label="Max output tokens" value={config.aiMaxOutputTokens} onChange={(aiMaxOutputTokens) => update({ aiMaxOutputTokens })} />
          <NumberField label="Max reply chars" value={config.aiMaxReplyChars} onChange={(aiMaxReplyChars) => update({ aiMaxReplyChars })} />
          <NumberField label="History lines" value={config.aiHistoryLineLimit} onChange={(aiHistoryLineLimit) => update({ aiHistoryLineLimit })} />
          <NumberField label="Primary confidence" value={config.aiPrimaryConfidence} onChange={(aiPrimaryConfidence) => update({ aiPrimaryConfidence })} step={0.01} />
          <NumberField label="Fallback confidence" value={config.aiFallbackConfidence} onChange={(aiFallbackConfidence) => update({ aiFallbackConfidence })} step={0.01} />
        </>
      ),
    },
    {
      title: "Queues / Rate Limits",
      fields: (
        <>
          <NumberField label="Outbox claim limit" value={config.outboxClaimLimit} onChange={(outboxClaimLimit) => update({ outboxClaimLimit })} />
          <NumberField label="Outbox poll ms" value={config.outboxPollMs} onChange={(outboxPollMs) => update({ outboxPollMs })} />
          <NumberField label="Inbound merge ms" value={config.inboundMergeWindowMs} onChange={(inboundMergeWindowMs) => update({ inboundMergeWindowMs })} />
          <NumberField label="Inbound concurrency" value={config.inboundConcurrency} onChange={(inboundConcurrency) => update({ inboundConcurrency })} />
          <NumberField label="Send concurrency" value={config.outboxSendConcurrency} onChange={(outboxSendConcurrency) => update({ outboxSendConcurrency })} />
          <NumberField label="Rate window min" value={config.sendRateWindowMinutes} onChange={(sendRateWindowMinutes) => update({ sendRateWindowMinutes })} />
          <NumberField label="Thread max/window" value={config.sendMaxPerThreadInWindow} onChange={(sendMaxPerThreadInWindow) => update({ sendMaxPerThreadInWindow })} />
          <NumberField label="Global max/window" value={config.sendMaxGlobalInWindow} onChange={(sendMaxGlobalInWindow) => update({ sendMaxGlobalInWindow })} />
        </>
      ),
    },
    {
      title: "Retention / Quiet Hours",
      fields: (
        <>
          <ToggleField label="Quiet hours" checked={config.quietHoursEnabled} onChange={(quietHoursEnabled) => update({ quietHoursEnabled })} />
          <NumberField label="Quiet start" value={config.quietHoursStartHour} onChange={(quietHoursStartHour) => update({ quietHoursStartHour })} />
          <NumberField label="Quiet end" value={config.quietHoursEndHour} onChange={(quietHoursEndHour) => update({ quietHoursEndHour })} />
          <NumberField label="Status retention ms" value={config.statusRetentionMs} onChange={(statusRetentionMs) => update({ statusRetentionMs })} />
          <NumberField label="Cleanup interval ms" value={config.statusCleanupIntervalMs} onChange={(statusCleanupIntervalMs) => update({ statusCleanupIntervalMs })} />
          <NumberField label="Cleanup batch" value={config.statusCleanupBatchLimit} onChange={(statusCleanupBatchLimit) => update({ statusCleanupBatchLimit })} />
        </>
      ),
    },
  ], [config]);

  async function saveConfig() {
    setSaving(true);
    setNotice("");
    setError("");
    try {
      await readJson(
        await fetch("/api/admin/platform-config", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ config }),
        }),
        "Failed to save platform config.",
      );
      setNotice("Platform config saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save platform config.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="admin-config-stack">
      {error ? <p className="admin-alert" role="alert">{error}</p> : null}
      {notice ? <p className="admin-notice" role="status">{notice}</p> : null}
      <AdminConfigToolbar
        title="Runtime Controls"
        detail="AI behavior, queue limits, rate limits, and retention"
        action={(
          <button className="btn admin-primary-action" type="button" onClick={saveConfig} disabled={saving}>
            {saving ? "Saving..." : "Save platform config"}
          </button>
        )}
      />
      <div className="admin-config-grid admin-config-grid-three">
        {groups.map((group) => (
          <section className="admin-data-panel admin-config-panel" key={group.title}>
            <div className="admin-data-head admin-config-head">
              <span>{group.title}</span>
            </div>
            <div className="admin-config-grid">{group.fields}</div>
          </section>
        ))}
      </div>
    </section>
  );
}

export function AdminAccessDashboard({ initialAdmins }: { initialAdmins: AdminUserRow[] }) {
  const [admins, setAdmins] = useState(initialAdmins);
  const [email, setEmail] = useState("");
  const [pin, setPin] = useState("");
  const [canMasqueradeTenants, setCanMasqueradeTenants] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function saveAdmin() {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const body = await readJson<{ admins: AdminUserRow[] }>(
        await fetch("/api/admin/users", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, pin, canMasqueradeTenants }),
        }),
        "Failed to save admin.",
      );
      setAdmins(body.admins || []);
      setEmail("");
      setPin("");
      setCanMasqueradeTenants(false);
      setNotice("Admin access saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save admin.");
    } finally {
      setSaving(false);
    }
  }

  async function removeAdmin(targetEmail: string) {
    setError("");
    setNotice("");
    try {
      const body = await readJson<{ admins: AdminUserRow[] }>(
        await fetch("/api/admin/users", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: targetEmail }),
        }),
        "Failed to remove admin.",
      );
      setAdmins(body.admins || []);
      setNotice("Admin removed.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove admin.");
    }
  }

  return (
    <section className="admin-config-stack">
      {error ? <p className="admin-alert" role="alert">{error}</p> : null}
      {notice ? <p className="admin-notice" role="status">{notice}</p> : null}
      <div className="admin-stat-grid admin-access-stat-grid" aria-label="Admin access stats">
        <div><span>Total Admins</span><strong>{admins.length}</strong></div>
        <div><span>Masquerade Access</span><strong>{admins.filter((admin) => admin.canMasqueradeTenants).length}</strong></div>
        <div><span>Convex Managed</span><strong>{admins.filter((admin) => admin.source === "convex").length}</strong></div>
      </div>
      <section className="admin-data-panel admin-config-panel">
        <div className="admin-data-head admin-config-head">
          <span>Add / Update Admin</span>
          <button className="btn admin-primary-action" type="button" onClick={saveAdmin} disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
        <div className="admin-config-grid admin-config-grid-four">
          <TextField label="Email" value={email} onChange={setEmail} />
          <label className="admin-compact-field">
            <span>PIN</span>
            <input type="password" value={pin} onChange={(event) => setPin(event.target.value)} />
          </label>
          <ToggleField label="Masquerade tenants" checked={canMasqueradeTenants} onChange={setCanMasqueradeTenants} />
        </div>
      </section>
      <section className="admin-data-panel">
        <div className="admin-data-head admin-access-list-head">
          <span>Email</span>
          <span>Source</span>
          <span>Masquerade</span>
          <span>Updated</span>
          <span>Action</span>
        </div>
        <div className="admin-data-list">
          {admins.map((admin) => (
            <article className="admin-data-row admin-access-list-row" key={`${admin.source}:${admin.email}`}>
              <div><strong>{admin.email}</strong><span>{admin.createdBy ? `By ${admin.createdBy}` : "Admin"}</span></div>
              <div><strong>{admin.source}</strong><span>Created {formatDate(admin.createdAt)}</span></div>
              <div><strong>{admin.canMasqueradeTenants ? "Allowed" : "Blocked"}</strong><span>Tenant access</span></div>
              <div><strong>{formatDate(admin.updatedAt)}</strong><span>Last change</span></div>
              <div>
                <button className="btn" type="button" onClick={() => void removeAdmin(admin.email)} disabled={admin.source === "bootstrap"}>
                  Remove
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </section>
  );
}
