"use client";

import { SearchableSelect } from "@/components/app-ui";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { AdminMasqueradeBanner } from "@/components/admin-masquerade-banner";
import { AdminConsoleShell } from "@/components/admin-console-shell";
import { UIModal } from "@/components/ui-modal";
import type { AdminMasqueradeSession } from "@/lib/admin-masquerade";

type TenantRow = {
  _id: string;
  email: string;
  displayName?: string;
  serviceMode: "hosted" | "self_hosted";
  plan: string;
  billingStatus: string;
  subscriptionProvider?: string;
  subscriptionExpiresAt?: number;
  subscriptionPausedAt?: number;
  subscriptionPauseReason?: string;
  flutterwaveSubscriptionId?: string;
  flutterwavePaymentPlanId?: string;
  pinConfigured?: boolean;
  pinUpdatedAt?: number;
  trialStartedAt: number;
  trialEndsAt: number;
  createdAt: number;
  updatedAt: number;
};

type MasqueradeState = {
  adminEmail: string;
  tenantId: string;
  tenantEmail: string;
  expiresAt?: number;
} | null;

type TenantUserRow = {
  _id: string;
  email: string;
  displayName?: string;
  role: "owner" | "admin" | "member";
  isSuperAdmin: boolean;
  pinConfigured: boolean;
  pinUpdatedAt?: number;
  createdAt: number;
  updatedAt: number;
};

type TenantDeviceRow = {
  _id: string;
  deviceId: string;
  label?: string;
  lastSeenAt: number;
  createdAt: number;
  updatedAt: number;
};

type TenantConnectorTokenRow = {
  _id: string;
  deviceId: string;
  tokenPreview: string;
  status: "active" | "revoked";
  scopes: string[];
  lastUsedAt?: number;
  expiresAt?: number;
  createdAt: number;
  updatedAt: number;
};

type TenantConnectedAccountRow = {
  _id: string;
  deviceId: string;
  provider: "whatsapp" | "instagram" | "imessage" | "telegram";
  providerAccountId: string;
  accountLabel?: string;
  displayName?: string;
  phoneNumberMasked?: string;
  username?: string;
  authState: "connected" | "disconnected" | "expired" | "unknown";
  connectedAt?: number;
  disconnectedAt?: number;
  lastSeenAt?: number;
  createdAt: number;
  updatedAt: number;
};

type TenantSubscriptionRow = {
  _id: string;
  provider: "flutterwave" | "manual";
  plan: string;
  status: string;
  amount?: number;
  currency?: string;
  providerPaymentPlanId?: string;
  providerSubscriptionId?: string;
  providerCustomerId?: string;
  txRef?: string;
  transactionId?: string;
  paymentLink?: string;
  currentPeriodStartedAt?: number;
  currentPeriodEndsAt?: number;
  lastPaymentAt?: number;
  lastWebhookAt?: number;
  cancelAt?: number;
  canceledAt?: number;
  pausedAt?: number;
  pauseReason?: string;
  createdAt: number;
  updatedAt: number;
};

type TenantSubscriptionEventRow = {
  _id: string;
  subscriptionId?: string;
  provider: "flutterwave" | "resend" | "system";
  eventType: string;
  providerEventId?: string;
  txRef?: string;
  transactionId?: string;
  status?: string;
  detail: string;
  createdAt: number;
};

type TenantDetail = {
  tenant: TenantRow;
  users: TenantUserRow[];
  devices: TenantDeviceRow[];
  connectorTokens: TenantConnectorTokenRow[];
  connectedAccounts: TenantConnectedAccountRow[];
  subscriptions: TenantSubscriptionRow[];
  subscriptionEvents: TenantSubscriptionEventRow[];
};

const PLAN_OPTIONS = ["personal_connector", "business_whatsapp", "self_hosted"] as const;
const BILLING_STATUS_OPTIONS = ["trialing", "active", "past_due", "paused", "canceled"] as const;
const TENANT_ROLE_OPTIONS = ["owner", "admin", "member"] as const;

function formatDate(value: number) {
  return Number.isFinite(value) ? new Date(value).toLocaleString() : "n/a";
}

function formatOptionalDate(value?: number) {
  return typeof value === "number" ? formatDate(value) : "n/a";
}

function formatAmount(value?: number, currency?: string) {
  if (typeof value !== "number") {
    return "No amount";
  }
  return `${currency || "USD"} ${value.toLocaleString()}`;
}

function toDateTimeLocal(value: number) {
  if (!Number.isFinite(value)) {
    return "";
  }
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function fromDateTimeLocal(value: string) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : Date.now();
}

function emptyUserDraft() {
  return {
    email: "",
    displayName: "",
    role: "member" as TenantUserRow["role"],
    isSuperAdmin: false,
    pin: "",
  };
}

type SubscriptionDraft = {
  plan: string;
  billingStatus: string;
  trialEndsAt: string;
  subscriptionExpiresAt: string;
  subscriptionPauseReason: string;
};

type UserDraft = ReturnType<typeof emptyUserDraft>;

type AdminTenantsDashboardProps = {
  masqueradeSession?: AdminMasqueradeSession | null;
};

type AdminTenantDetailModalProps = {
  open: boolean;
  tenantDetail: TenantDetail | null;
  detailNotice: string;
  detailLoading: boolean;
  pendingUserId: string;
  onClose: () => void;
  onEditBilling: () => void;
  onCreateUser: () => void;
  onRefresh: (tenantId: string) => void;
  onEditUser: (user: TenantUserRow) => void;
  onRemoveUser: (userId: string) => void;
};

function AdminTenantDetailModal({
  open,
  tenantDetail,
  detailNotice,
  detailLoading,
  pendingUserId,
  onClose,
  onEditBilling,
  onCreateUser,
  onRefresh,
  onEditUser,
  onRemoveUser,
}: AdminTenantDetailModalProps) {
  return (
    <UIModal
      open={open && Boolean(tenantDetail)}
      onClose={onClose}
      title={tenantDetail?.tenant.email || "Tenant"}
      size="wide"
    >
      <div className="admin-access-head">
        {tenantDetail ? (
          <div className="admin-panel-action-row">
            <button className="btn btn-secondary" type="button" onClick={onEditBilling}>
              Edit billing
            </button>
            <button className="btn btn-primary admin-primary-action" type="button" onClick={onCreateUser}>
              Add user
            </button>
            <button className="btn btn-ghost" type="button" disabled={detailLoading} onClick={() => onRefresh(tenantDetail.tenant._id)}>
              Refresh
            </button>
          </div>
        ) : null}
      </div>

      {detailNotice ? <p className="admin-notice admin-management-notice" role="status">{detailNotice}</p> : null}

      {tenantDetail ? (
        <div className="admin-management-grid">
          <div className="admin-management-form">
            <div className="admin-management-title">
              <strong>Subscription</strong>
              <span>{tenantDetail.tenant.serviceMode.replace("_", " ")}</span>
            </div>
            <dl className="admin-detail-list">
              <div>
                <dt>Plan</dt>
                <dd>{tenantDetail.tenant.plan.replace("_", " ")}</dd>
              </div>
              <div>
                <dt>Billing</dt>
                <dd>{tenantDetail.tenant.billingStatus.replace("_", " ")}</dd>
              </div>
              <div>
                <dt>Trial ends</dt>
                <dd>{formatDate(tenantDetail.tenant.trialEndsAt)}</dd>
              </div>
              <div>
                <dt>Subscription expires</dt>
                <dd>{tenantDetail.tenant.subscriptionExpiresAt ? formatDate(tenantDetail.tenant.subscriptionExpiresAt) : "Not set"}</dd>
              </div>
            </dl>
            {tenantDetail.tenant.subscriptionProvider || tenantDetail.tenant.flutterwaveSubscriptionId ? (
              <div className="admin-management-title">
                <strong>{tenantDetail.tenant.subscriptionProvider || "manual"}</strong>
                <span>{tenantDetail.tenant.flutterwaveSubscriptionId || "No Flutterwave subscription ID"}</span>
              </div>
            ) : null}
          </div>

          <div className="admin-management-form">
            <div className="admin-management-title">
              <strong>Tenant users</strong>
              <span>{tenantDetail.users.length} configured</span>
            </div>
            <div className="admin-data-list admin-tenant-user-list">
              {tenantDetail.users.map((user) => (
                <article className="admin-data-row admin-tenant-user-row" key={user._id}>
                  <div>
                    <strong>{user.email}</strong>
                    <span>{user.displayName || "No name"}</span>
                  </div>
                  <div>
                    <strong>{user.role}{user.isSuperAdmin ? " / super admin" : ""}</strong>
                    <span>{user.pinConfigured ? "PIN configured" : "PIN missing"}</span>
                  </div>
                  <div>
                    <strong>{user.pinUpdatedAt ? formatDate(user.pinUpdatedAt) : "No PIN update"}</strong>
                    <span>Updated {formatDate(user.updatedAt)}</span>
                  </div>
                  <div className="admin-tenant-user-actions">
                    <button className="btn btn-secondary" type="button" onClick={() => onEditUser(user)}>
                      Edit
                    </button>
                    <button
                      className="btn btn-ghost"
                      type="button"
                      disabled={pendingUserId === user._id}
                      onClick={() => onRemoveUser(user._id)}
                    >
                      {pendingUserId === user._id ? "Removing..." : "Remove"}
                    </button>
                  </div>
                </article>
              ))}
              {tenantDetail.users.length === 0 ? <p className="admin-empty-state">No tenant users have been configured yet.</p> : null}
            </div>
          </div>

          <div className="admin-management-form">
            <div className="admin-management-title">
              <strong>Connected accounts</strong>
              <span>{tenantDetail.connectedAccounts.length} linked</span>
            </div>
            <div className="admin-data-list admin-tenant-user-list">
              {tenantDetail.connectedAccounts.map((account) => (
                <article className="admin-data-row admin-tenant-runtime-row" key={account._id}>
                  <div>
                    <strong>{account.provider}</strong>
                    <span>{account.displayName || account.accountLabel || account.username || account.phoneNumberMasked || account.providerAccountId}</span>
                  </div>
                  <div>
                    <strong>{account.authState}</strong>
                    <span>Device {account.deviceId}</span>
                  </div>
                  <div>
                    <strong>{formatOptionalDate(account.lastSeenAt)}</strong>
                    <span>Updated {formatDate(account.updatedAt)}</span>
                  </div>
                </article>
              ))}
              {tenantDetail.connectedAccounts.length === 0 ? <p className="admin-empty-state">No WhatsApp or Instagram accounts linked yet.</p> : null}
            </div>
          </div>

          <div className="admin-management-form">
            <div className="admin-management-title">
              <strong>Devices and tokens</strong>
              <span>{tenantDetail.devices.length} devices / {tenantDetail.connectorTokens.length} tokens</span>
            </div>
            <div className="admin-data-list admin-tenant-user-list">
              {tenantDetail.devices.map((device) => (
                <article className="admin-data-row admin-tenant-runtime-row" key={device._id}>
                  <div>
                    <strong>{device.label || device.deviceId}</strong>
                    <span>{device.deviceId}</span>
                  </div>
                  <div>
                    <strong>Last seen {formatDate(device.lastSeenAt)}</strong>
                    <span>Updated {formatDate(device.updatedAt)}</span>
                  </div>
                  <div>
                    <strong>{tenantDetail.connectorTokens.filter((token) => token.deviceId === device.deviceId).length} tokens</strong>
                    <span>
                      {tenantDetail.connectorTokens
                        .filter((token) => token.deviceId === device.deviceId)
                        .map((token) => `${token.status} ${token.tokenPreview}`)
                        .join(", ") || "No connector token"}
                    </span>
                  </div>
                </article>
              ))}
              {tenantDetail.devices.length === 0 ? <p className="admin-empty-state">No registered devices yet.</p> : null}
            </div>
          </div>

          <div className="admin-management-form">
            <div className="admin-management-title">
              <strong>Subscriptions</strong>
              <span>{tenantDetail.subscriptions.length} records</span>
            </div>
            <div className="admin-data-list admin-tenant-user-list">
              {tenantDetail.subscriptions.map((subscription) => (
                <article className="admin-data-row admin-tenant-runtime-row" key={subscription._id}>
                  <div>
                    <strong>{subscription.provider} / {subscription.status}</strong>
                    <span>{subscription.plan.replace("_", " ")}</span>
                  </div>
                  <div>
                    <strong>{formatAmount(subscription.amount, subscription.currency)}</strong>
                    <span>{subscription.txRef || subscription.providerSubscriptionId || "No provider reference"}</span>
                  </div>
                  <div>
                    <strong>Period ends {formatOptionalDate(subscription.currentPeriodEndsAt)}</strong>
                    <span>Last payment {formatOptionalDate(subscription.lastPaymentAt)}</span>
                    {subscription.paymentLink ? <a href={subscription.paymentLink} target="_blank" rel="noreferrer">Payment link</a> : null}
                  </div>
                </article>
              ))}
              {tenantDetail.subscriptions.length === 0 ? <p className="admin-empty-state">No subscription records yet.</p> : null}
            </div>
          </div>

          <div className="admin-management-form admin-tenant-events-panel">
            <div className="admin-management-title">
              <strong>Billing events</strong>
              <span>{tenantDetail.subscriptionEvents.length} recent</span>
            </div>
            <div className="admin-data-list admin-tenant-user-list">
              {tenantDetail.subscriptionEvents.map((event) => (
                <article className="admin-data-row admin-tenant-event-row" key={event._id}>
                  <div>
                    <strong>{event.eventType}</strong>
                    <span>{event.provider}{event.status ? ` / ${event.status}` : ""}</span>
                  </div>
                  <div>
                    <strong>{formatDate(event.createdAt)}</strong>
                    <span>{event.txRef || event.transactionId || event.providerEventId || "No provider reference"}</span>
                  </div>
                  <div>
                    <span>{event.detail}</span>
                  </div>
                </article>
              ))}
              {tenantDetail.subscriptionEvents.length === 0 ? <p className="admin-empty-state">No billing events recorded yet.</p> : null}
            </div>
          </div>
        </div>
      ) : null}
    </UIModal>
  );
}

type AdminSubscriptionModalProps = {
  open: boolean;
  tenantDetail: TenantDetail | null;
  draft: SubscriptionDraft;
  loading: boolean;
  onClose: () => void;
  onDraftChange: (draft: SubscriptionDraft) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

function AdminSubscriptionModal({
  open,
  tenantDetail,
  draft,
  loading,
  onClose,
  onDraftChange,
  onSubmit,
}: AdminSubscriptionModalProps) {
  return (
    <UIModal open={open && Boolean(tenantDetail)} onClose={onClose} title="Edit Subscription" size="wide">
      {tenantDetail ? (
        <form className="admin-modal-form admin-modal-grid-form" onSubmit={onSubmit}>
          <label>
            <span>Plan</span>
            <SearchableSelect value={draft.plan} onChange={(event) => onDraftChange({ ...draft, plan: event.target.value })}>
              {PLAN_OPTIONS.map((plan) => (
                <option key={plan} value={plan}>{plan.replace("_", " ")}</option>
              ))}
            </SearchableSelect>
          </label>
          <label>
            <span>Billing status</span>
            <SearchableSelect value={draft.billingStatus} onChange={(event) => onDraftChange({ ...draft, billingStatus: event.target.value })}>
              {BILLING_STATUS_OPTIONS.map((status) => (
                <option key={status} value={status}>{status.replace("_", " ")}</option>
              ))}
            </SearchableSelect>
          </label>
          <label>
            <span>Trial ends</span>
            <input
              type="datetime-local"
              value={draft.trialEndsAt}
              onChange={(event) => onDraftChange({ ...draft, trialEndsAt: event.target.value })}
            />
          </label>
          <label>
            <span>Subscription expires</span>
            <input
              type="datetime-local"
              value={draft.subscriptionExpiresAt}
              onChange={(event) => onDraftChange({ ...draft, subscriptionExpiresAt: event.target.value })}
            />
          </label>
          <label className="admin-modal-full">
            <span>Pause reason</span>
            <input
              value={draft.subscriptionPauseReason}
              onChange={(event) => onDraftChange({ ...draft, subscriptionPauseReason: event.target.value })}
              placeholder="Optional"
            />
          </label>
          <div className="admin-modal-actions admin-modal-full">
            <button className="btn btn-ghost" type="button" onClick={onClose}>
              Cancel
            </button>
            <button className="btn btn-primary" type="submit" disabled={loading}>
              {loading ? "Saving..." : "Save subscription"}
            </button>
          </div>
        </form>
      ) : null}
    </UIModal>
  );
}

type AdminTenantUserModalProps = {
  open: boolean;
  tenantDetail: TenantDetail | null;
  draft: UserDraft;
  pendingUserId: string;
  onClose: () => void;
  onDraftChange: (draft: UserDraft) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

function AdminTenantUserModal({
  open,
  tenantDetail,
  draft,
  pendingUserId,
  onClose,
  onDraftChange,
  onSubmit,
}: AdminTenantUserModalProps) {
  return (
    <UIModal
      open={open && Boolean(tenantDetail)}
      onClose={onClose}
      title={draft.email ? "Edit Tenant User" : "Add Tenant User"}
    >
      <form className="admin-modal-form" onSubmit={onSubmit}>
        <label>
          <span>Email</span>
          <input
            type="email"
            value={draft.email}
            onChange={(event) => onDraftChange({ ...draft, email: event.target.value })}
            placeholder="user@example.com"
          />
        </label>
        <label>
          <span>Name</span>
          <input
            value={draft.displayName}
            onChange={(event) => onDraftChange({ ...draft, displayName: event.target.value })}
            placeholder="Optional"
          />
        </label>
        <label>
          <span>Role</span>
          <SearchableSelect
            value={draft.role}
            onChange={(event) => onDraftChange({ ...draft, role: event.target.value as TenantUserRow["role"] })}
          >
            {TENANT_ROLE_OPTIONS.map((role) => (
              <option key={role} value={role}>{role}</option>
            ))}
          </SearchableSelect>
        </label>
        <label>
          <span>PIN</span>
          <input
            type="password"
            value={draft.pin}
            onChange={(event) => onDraftChange({ ...draft, pin: event.target.value })}
            placeholder="Set or reset PIN"
          />
        </label>
        <label className="admin-checkbox-line">
          <input
            type="checkbox"
            checked={draft.isSuperAdmin}
            onChange={(event) => onDraftChange({ ...draft, isSuperAdmin: event.target.checked })}
          />
          <span>Tenant super admin</span>
        </label>
        <div className="admin-modal-actions">
          <button className="btn btn-ghost" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" type="submit" disabled={pendingUserId === "save"}>
            {pendingUserId === "save" ? "Saving..." : "Save user"}
          </button>
        </div>
      </form>
    </UIModal>
  );
}

type AdminRemoveTenantUserModalProps = {
  removingUser: TenantUserRow | null;
  pendingUserId: string;
  onClose: () => void;
  onRemove: (user: TenantUserRow) => void;
};

function AdminRemoveTenantUserModal({ removingUser, pendingUserId, onClose, onRemove }: AdminRemoveTenantUserModalProps) {
  return (
    <UIModal
      open={Boolean(removingUser)}
      onClose={onClose}
      title="Remove Tenant User"
      description={removingUser ? `Remove ${removingUser.email} from this tenant.` : undefined}
    >
      <p className="ui-modal-confirmation-copy">
        This user will lose access to the tenant account immediately.
      </p>
      <div className="admin-modal-actions">
        <button className="btn btn-ghost" type="button" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn btn-danger-ghost"
          type="button"
          disabled={!removingUser || pendingUserId === removingUser._id}
          onClick={() => removingUser ? onRemove(removingUser) : undefined}
        >
          {removingUser && pendingUserId === removingUser._id ? "Removing..." : "Remove user"}
        </button>
      </div>
    </UIModal>
  );
}

type AdminStartMasqueradeModalProps = {
  masqueradeTenant: TenantRow | null;
  pendingTenantId: string;
  onClose: () => void;
  onStart: (tenant: TenantRow) => void;
};

function AdminStartMasqueradeModal({ masqueradeTenant, pendingTenantId, onClose, onStart }: AdminStartMasqueradeModalProps) {
  return (
    <UIModal
      open={Boolean(masqueradeTenant)}
      onClose={onClose}
      title="Start Masquerade"
      description={masqueradeTenant ? `Switch admin context into ${masqueradeTenant.email}.` : undefined}
    >
      <p className="ui-modal-confirmation-copy">
        Use this only for support or verification work. Your admin session can be stopped from the banner.
      </p>
      <div className="admin-modal-actions">
        <button className="btn btn-ghost" type="button" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn btn-primary"
          type="button"
          disabled={!masqueradeTenant || pendingTenantId === masqueradeTenant._id}
          onClick={() => masqueradeTenant ? onStart(masqueradeTenant) : undefined}
        >
          {masqueradeTenant && pendingTenantId === masqueradeTenant._id ? "Starting..." : "Start masquerade"}
        </button>
      </div>
    </UIModal>
  );
}

type AdminStopMasqueradeModalProps = {
  open: boolean;
  pendingTenantId: string;
  onClose: () => void;
  onStop: () => void;
};

function AdminStopMasqueradeModal({ open, pendingTenantId, onClose, onStop }: AdminStopMasqueradeModalProps) {
  return (
    <UIModal open={open} onClose={onClose} title="Stop Masquerade" description="Return to your super admin context.">
      <p className="ui-modal-confirmation-copy">
        Current tenant-specific access will end and the dashboard will refresh.
      </p>
      <div className="admin-modal-actions">
        <button className="btn btn-ghost" type="button" onClick={onClose}>
          Cancel
        </button>
        <button className="btn btn-primary" type="button" disabled={pendingTenantId === "stop"} onClick={onStop}>
          {pendingTenantId === "stop" ? "Stopping..." : "Stop masquerade"}
        </button>
      </div>
    </UIModal>
  );
}

export function AdminTenantsDashboard({ masqueradeSession }: AdminTenantsDashboardProps) {
  const router = useRouter();
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [tenantSearch, setTenantSearch] = useState("");
  const [billingFilter, setBillingFilter] = useState("all");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [masquerade, setMasquerade] = useState<MasqueradeState>(null);
  const [canMasqueradeTenants, setCanMasqueradeTenants] = useState(false);
  const [pendingTenantId, setPendingTenantId] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedTenantId, setSelectedTenantId] = useState("");
  const [tenantDetail, setTenantDetail] = useState<TenantDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailNotice, setDetailNotice] = useState("");
  const [subscriptionDraft, setSubscriptionDraft] = useState({
    plan: "personal_connector",
    billingStatus: "trialing",
    trialEndsAt: "",
    subscriptionExpiresAt: "",
    subscriptionPauseReason: "",
  });
  const [userDraft, setUserDraft] = useState(emptyUserDraft);
  const [pendingUserId, setPendingUserId] = useState("");
  const [subscriptionModalOpen, setSubscriptionModalOpen] = useState(false);
  const [userModalOpen, setUserModalOpen] = useState(false);
  const [tenantDetailModalOpen, setTenantDetailModalOpen] = useState(false);
  const [removeUserId, setRemoveUserId] = useState("");
  const [masqueradeTenantId, setMasqueradeTenantId] = useState("");
  const [stopMasqueradeOpen, setStopMasqueradeOpen] = useState(false);
  const initialLoadRef = useRef(false);

  const removingUser = tenantDetail?.users.find((user) => user._id === removeUserId) || null;
  const masqueradeTenant = tenants.find((tenant) => tenant._id === masqueradeTenantId) || null;
  const tenantStats = useMemo(() => {
    const activeStatuses = new Set(["active", "trialing"]);
    return {
      total: tenants.length,
      active: tenants.filter((tenant) => activeStatuses.has(tenant.billingStatus)).length,
      needsAttention: tenants.filter((tenant) => ["past_due", "paused"].includes(tenant.billingStatus) || !tenant.pinConfigured).length,
      hosted: tenants.filter((tenant) => tenant.serviceMode === "hosted").length,
    };
  }, [tenants]);
  const visibleTenants = useMemo(() => {
    const query = tenantSearch.trim().toLowerCase();
    return tenants.filter((tenant) => {
      const matchesStatus = billingFilter === "all" || tenant.billingStatus === billingFilter;
      const matchesQuery = !query || [
        tenant.email,
        tenant.displayName,
        tenant.plan,
        tenant.serviceMode,
        tenant.billingStatus,
        tenant.flutterwaveSubscriptionId,
      ].some((value) => value?.toLowerCase().includes(query));
      return matchesStatus && matchesQuery;
    });
  }, [billingFilter, tenantSearch, tenants]);

  const applyTenantDetail = useCallback((detail: TenantDetail) => {
    setTenantDetail(detail);
    setSelectedTenantId(detail.tenant._id);
    setSubscriptionDraft({
      plan: detail.tenant.plan,
      billingStatus: detail.tenant.billingStatus,
      trialEndsAt: toDateTimeLocal(detail.tenant.trialEndsAt),
      subscriptionExpiresAt: detail.tenant.subscriptionExpiresAt ? toDateTimeLocal(detail.tenant.subscriptionExpiresAt) : "",
      subscriptionPauseReason: detail.tenant.subscriptionPauseReason || "",
    });
    setTenants((current) => current.map((tenant) => (tenant._id === detail.tenant._id ? detail.tenant : tenant)));
  }, []);

  const loadMasqueradeStatus = useCallback(async () => {
    const response = await fetch("/api/admin/masquerade", { cache: "no-store" });
    const body = (await response.json()) as {
      masquerade?: MasqueradeState;
      canMasqueradeTenants?: boolean;
      error?: string;
    };
    if (!response.ok) {
      throw new Error(body.error || "Failed to load masquerade status.");
    }
    setMasquerade(body.masquerade || null);
    setCanMasqueradeTenants(body.canMasqueradeTenants === true);
  }, []);

  const loadTenantDetail = useCallback(async (tenantId: string, options: { quiet?: boolean } = {}) => {
    setDetailLoading(true);
    if (!options.quiet) {
      setDetailNotice("");
    }
    setError("");
    try {
      const response = await fetch(`/api/admin/tenant-management?tenantId=${encodeURIComponent(tenantId)}`, {
        cache: "no-store",
      });
      const body = (await response.json()) as { detail?: TenantDetail; error?: string };
      if (!response.ok || !body.detail) {
        throw new Error(body.error || "Failed to load tenant detail.");
      }
      applyTenantDetail(body.detail);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load tenant detail.");
      return false;
    } finally {
      setDetailLoading(false);
    }
  }, [applyTenantDetail]);

  const loadTenants = useCallback(async (options: { quiet?: boolean } = {}) => {
    setLoading(true);
    if (!options.quiet) {
      setError("");
    }
    try {
      const response = await fetch("/api/admin/tenants", {
        cache: "no-store",
      });
      const body = (await response.json()) as { tenants?: TenantRow[]; error?: string };
      if (!response.ok || !body.tenants) {
        throw new Error(body.error || `Failed to load tenants (${response.status})`);
      }
      setTenants(body.tenants);
      if (selectedTenantId) {
        await loadTenantDetail(selectedTenantId, { quiet: true });
      }
      await loadMasqueradeStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load tenants.");
    } finally {
      setLoading(false);
    }
  }, [loadMasqueradeStatus, loadTenantDetail, selectedTenantId]);

  useEffect(() => {
    if (initialLoadRef.current) {
      return;
    }
    initialLoadRef.current = true;
    void loadTenants({ quiet: true });
  }, [loadTenants]);

  const saveSubscription = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!tenantDetail) {
      return;
    }
    setDetailLoading(true);
    setError("");
    setDetailNotice("");
    try {
      const response = await fetch("/api/admin/tenant-management", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tenantId: tenantDetail.tenant._id,
          plan: subscriptionDraft.plan,
          billingStatus: subscriptionDraft.billingStatus,
          trialEndsAt: fromDateTimeLocal(subscriptionDraft.trialEndsAt),
          subscriptionExpiresAt: subscriptionDraft.subscriptionExpiresAt ? fromDateTimeLocal(subscriptionDraft.subscriptionExpiresAt) : undefined,
          subscriptionPauseReason: subscriptionDraft.subscriptionPauseReason,
        }),
      });
      const body = (await response.json()) as { detail?: TenantDetail; error?: string };
      if (!response.ok || !body.detail) {
        throw new Error(body.error || "Failed to update subscription.");
      }
      applyTenantDetail(body.detail);
      setSubscriptionModalOpen(false);
      setDetailNotice("Subscription updated.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update subscription.");
    } finally {
      setDetailLoading(false);
    }
  };

  const saveTenantUser = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!tenantDetail) {
      return;
    }
    setPendingUserId("save");
    setError("");
    setDetailNotice("");
    try {
      const response = await fetch("/api/admin/tenant-management", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tenantId: tenantDetail.tenant._id,
          ...userDraft,
        }),
      });
      const body = (await response.json()) as { detail?: TenantDetail; error?: string };
      if (!response.ok || !body.detail) {
        throw new Error(body.error || "Failed to save tenant user.");
      }
      applyTenantDetail(body.detail);
      setUserDraft(emptyUserDraft());
      setUserModalOpen(false);
      setDetailNotice("Tenant user saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save tenant user.");
    } finally {
      setPendingUserId("");
    }
  };

  const editTenantUser = (user: TenantUserRow) => {
    setUserDraft({
      email: user.email,
      displayName: user.displayName || "",
      role: user.role,
      isSuperAdmin: user.isSuperAdmin,
      pin: "",
    });
    setUserModalOpen(true);
    setDetailNotice("Editing tenant user. Leave PIN blank to keep their current PIN.");
  };

  const createTenantUser = () => {
    setUserDraft(emptyUserDraft());
    setUserModalOpen(true);
    setDetailNotice("");
  };

  const openTenantManagement = async (tenantId: string) => {
    const loaded = await loadTenantDetail(tenantId, { quiet: true });
    if (loaded) {
      setTenantDetailModalOpen(true);
      setDetailNotice("");
    }
  };

  const removeTenantUser = async (user: TenantUserRow) => {
    if (!tenantDetail) {
      return;
    }
    setPendingUserId(user._id);
    setError("");
    setDetailNotice("");
    try {
      const response = await fetch("/api/admin/tenant-management", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tenantId: tenantDetail.tenant._id,
          userId: user._id,
        }),
      });
      const body = (await response.json()) as { detail?: TenantDetail; error?: string };
      if (!response.ok || !body.detail) {
        throw new Error(body.error || "Failed to remove tenant user.");
      }
      applyTenantDetail(body.detail);
      setRemoveUserId("");
      setDetailNotice("Tenant user removed.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove tenant user.");
    } finally {
      setPendingUserId("");
    }
  };

  const startMasquerade = async (tenant: TenantRow) => {
    setPendingTenantId(tenant._id);
    setNotice("");
    setError("");
    try {
      const response = await fetch("/api/admin/masquerade", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tenantId: tenant._id }),
      });
      const body = (await response.json()) as { masquerade?: MasqueradeState; error?: string };
      if (!response.ok || !body.masquerade) {
        throw new Error(body.error || "Failed to start masquerade.");
      }
      setMasquerade(body.masquerade);
      setMasqueradeTenantId("");
      setNotice(`Masquerading as ${tenant.email}.`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start masquerade.");
    } finally {
      setPendingTenantId("");
    }
  };

  const stopMasquerade = async () => {
    setPendingTenantId("stop");
    setNotice("");
    setError("");
    try {
      const response = await fetch("/api/admin/masquerade", { method: "DELETE" });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error || "Failed to stop masquerade.");
      }
      setMasquerade(null);
      setStopMasqueradeOpen(false);
      setNotice("Tenant masquerade stopped.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to stop masquerade.");
    } finally {
      setPendingTenantId("");
    }
  };

  return (
    <AdminConsoleShell>
        {masqueradeSession ? <AdminMasqueradeBanner session={masqueradeSession} /> : null}
        <header className="admin-console-header">
          <div>
            <p className="admin-kicker">Account Operations</p>
            <h1>Tenant Accounts</h1>
            <p>Manage tenant access, subscriptions, connector devices, masquerade sessions, and billing events.</p>
          </div>
          <button className="btn btn-primary admin-primary-action" type="button" disabled={loading} onClick={() => void loadTenants()}>
            {loading ? "Refreshing..." : tenants.length > 0 ? "Refresh tenants" : "Load tenants"}
          </button>
        </header>

        {error ? <p className="admin-alert" role="alert">{error}</p> : null}
        {notice ? <p className="admin-notice" role="status">{notice}</p> : null}

        <div className="admin-stat-grid admin-tenant-stat-grid" aria-label="Tenant account stats">
          <div><span>Total Tenants</span><strong>{tenantStats.total}</strong></div>
          <div><span>Active / Trial</span><strong>{tenantStats.active}</strong></div>
          <div><span>Needs Attention</span><strong>{tenantStats.needsAttention}</strong></div>
          <div><span>Hosted</span><strong>{tenantStats.hosted}</strong></div>
        </div>

        <div className="admin-masquerade-strip">
          <div>
            <span>Masquerade</span>
            <strong>{masquerade ? masquerade.tenantEmail : "Not active"}</strong>
          </div>
          <button className="btn btn-ghost" type="button" disabled={!masquerade || pendingTenantId === "stop"} onClick={() => setStopMasqueradeOpen(true)}>
            Stop masquerade
          </button>
        </div>

        <div className="admin-data-panel">
          <div className="admin-table-toolbar">
            <div>
              <span>Tenant Directory</span>
              <strong>{visibleTenants.length} shown</strong>
            </div>
            <div className="admin-filter-controls">
              <label>
                <span>Search</span>
                <input
                  value={tenantSearch}
                  onChange={(event) => setTenantSearch(event.target.value)}
                  placeholder="Email, name, plan, reference"
                />
              </label>
              <label>
                <span>Billing</span>
                <SearchableSelect value={billingFilter} onChange={(event) => setBillingFilter(event.target.value)}>
                  <option value="all">All statuses</option>
                  {BILLING_STATUS_OPTIONS.map((status) => (
                    <option key={status} value={status}>{status.replace("_", " ")}</option>
                  ))}
                </SearchableSelect>
              </label>
            </div>
          </div>
          <div className="admin-data-head">
            <span>Account</span>
            <span>Mode</span>
            <span>Trial Window</span>
            <span>Security</span>
          </div>
          <div className="admin-data-list">
            {visibleTenants.map((tenant) => (
              <article className="admin-data-row" key={tenant._id}>
                <div>
                  <strong>{tenant.email}</strong>
                  <span>{tenant.displayName || "No name"}</span>
                </div>
                <div>
                  <strong>{tenant.serviceMode.replace("_", " ")}</strong>
                  <span>{tenant.plan} / {tenant.billingStatus}</span>
                  {tenant.flutterwaveSubscriptionId ? <span>FLW {tenant.flutterwaveSubscriptionId}</span> : null}
                </div>
                <div>
                  <strong>{formatDate(tenant.trialStartedAt)}</strong>
                  <span>Ends {formatDate(tenant.trialEndsAt)}</span>
                  {tenant.subscriptionExpiresAt ? <span>Paid until {formatDate(tenant.subscriptionExpiresAt)}</span> : null}
                </div>
                <div>
                  <strong>{tenant.pinConfigured ? "PIN configured" : "PIN missing"}</strong>
                  <span>{tenant.pinUpdatedAt ? formatDate(tenant.pinUpdatedAt) : "No recent update"}</span>
                  <div className="admin-row-actions">
                    <button
                      className="btn btn-secondary"
                      type="button"
                      disabled={detailLoading && selectedTenantId === tenant._id}
                      onClick={() => void openTenantManagement(tenant._id)}
                    >
                      {detailLoading && selectedTenantId === tenant._id ? "Opening..." : "Open"}
                    </button>
                    <button
                      className="btn btn-ghost"
                      type="button"
                      disabled={!canMasqueradeTenants || pendingTenantId === tenant._id}
                      onClick={() => setMasqueradeTenantId(tenant._id)}
                    >
                      {pendingTenantId === tenant._id ? "Starting..." : "Masquerade"}
                    </button>
                  </div>
                </div>
              </article>
            ))}
            {tenants.length === 0 ? <p className="admin-empty-state">{loading ? "Loading tenants..." : "No tenant accounts found."}</p> : null}
            {tenants.length > 0 && visibleTenants.length === 0 ? <p className="admin-empty-state">No tenants match the current filters.</p> : null}
          </div>
        </div>

        <AdminTenantDetailModal
          open={tenantDetailModalOpen}
          tenantDetail={tenantDetail}
          detailNotice={detailNotice}
          detailLoading={detailLoading}
          pendingUserId={pendingUserId}
          onClose={() => setTenantDetailModalOpen(false)}
          onEditBilling={() => setSubscriptionModalOpen(true)}
          onCreateUser={createTenantUser}
          onRefresh={(tenantId) => void loadTenantDetail(tenantId)}
          onEditUser={editTenantUser}
          onRemoveUser={setRemoveUserId}
        />

      <AdminSubscriptionModal
        open={subscriptionModalOpen}
        tenantDetail={tenantDetail}
        draft={subscriptionDraft}
        loading={detailLoading}
        onClose={() => setSubscriptionModalOpen(false)}
        onDraftChange={setSubscriptionDraft}
        onSubmit={(event) => void saveSubscription(event)}
      />

      <AdminTenantUserModal
        open={userModalOpen}
        tenantDetail={tenantDetail}
        draft={userDraft}
        pendingUserId={pendingUserId}
        onClose={() => setUserModalOpen(false)}
        onDraftChange={setUserDraft}
        onSubmit={(event) => void saveTenantUser(event)}
      />

      <AdminRemoveTenantUserModal
        removingUser={removingUser}
        pendingUserId={pendingUserId}
        onClose={() => setRemoveUserId("")}
        onRemove={(user) => void removeTenantUser(user)}
      />

      <AdminStartMasqueradeModal
        masqueradeTenant={masqueradeTenant}
        pendingTenantId={pendingTenantId}
        onClose={() => setMasqueradeTenantId("")}
        onStart={(tenant) => void startMasquerade(tenant)}
      />

      <AdminStopMasqueradeModal
        open={stopMasqueradeOpen}
        pendingTenantId={pendingTenantId}
        onClose={() => setStopMasqueradeOpen(false)}
        onStop={() => void stopMasquerade()}
      />
    </AdminConsoleShell>
  );
}
