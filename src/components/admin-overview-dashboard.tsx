"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";

type TenantRow = {
  _id: string;
  email: string;
  displayName?: string;
  serviceMode: "hosted" | "self_hosted";
  plan: string;
  billingStatus: string;
  pinConfigured?: boolean;
  trialEndsAt: number;
  createdAt: number;
  updatedAt: number;
};

type SecretStatus = {
  key: string;
  configuredInConvex: boolean;
  envFallbackConfigured: boolean;
};

type OverviewState = {
  tenants: TenantRow[];
  secrets: SecretStatus[];
};

const BILLING_ORDER = ["trialing", "active", "past_due", "paused", "canceled"] as const;
const DAY_MS = 24 * 60 * 60 * 1000;

function formatDate(value: number) {
  return Number.isFinite(value) ? new Date(value).toLocaleDateString() : "n/a";
}

function shortDayLabel(value: number) {
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

async function readJson<T>(response: Response, fallbackMessage: string) {
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(body.error || fallbackMessage);
  }
  return body;
}

type BarDatum = {
  key: string;
  label: string;
  value: number;
};

function AdminBarChart({
  title,
  unit,
  bars,
  tone = "blue",
}: {
  title: string;
  unit: string;
  bars: BarDatum[];
  tone?: "blue" | "green";
}) {
  const maxValue = Math.max(1, ...bars.map((bar) => bar.value));
  const midValue = Math.ceil(maxValue / 2);

  return (
    <section className={`admin-data-panel admin-chart-panel admin-chart-panel-${tone}`} aria-label={title}>
      <div className="admin-chart-title-row">
        <h2>{title}</h2>
        <span>{unit}</span>
      </div>
      <div className="admin-chart-plot">
        <div className="admin-chart-gridlines" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div className="admin-chart-y-axis" aria-hidden="true">
          <span>{maxValue}</span>
          <span>{midValue}</span>
          <span>0</span>
        </div>
        <div className="admin-chart-bars">
          {bars.map((bar) => {
            const height = Math.max(bar.value > 0 ? 3 : 0, (bar.value / maxValue) * 100);
            return (
              <div className="admin-chart-bar-cell" key={bar.key}>
                <span className="admin-chart-bar" style={{ "--admin-bar-height": `${height}%` } as CSSProperties} title={`${bar.label}: ${bar.value}`} />
                <span className="admin-chart-x-label">{bar.label}</span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export function AdminOverviewDashboard() {
  const [state, setState] = useState<OverviewState>({ tenants: [], secrets: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    async function loadOverview() {
      setLoading(true);
      setError("");
      try {
        const [tenantsBody, secretsBody] = await Promise.all([
          fetch("/api/admin/tenants", { cache: "no-store" }).then((response) =>
            readJson<{ tenants?: TenantRow[] }>(response, "Failed to load tenants."),
          ),
          fetch("/api/admin/managed-secrets", { cache: "no-store" }).then((response) =>
            readJson<{ secrets?: SecretStatus[] }>(response, "Failed to load secrets."),
          ),
        ]);

        if (!active) {
          return;
        }

        setState({
          tenants: tenantsBody.tenants || [],
          secrets: secretsBody.secrets || [],
        });
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : "Failed to load overview.");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadOverview();
    return () => {
      active = false;
    };
  }, []);

  const stats = useMemo(() => {
    const tenants = state.tenants;
    const hosted = tenants.filter((tenant) => tenant.serviceMode === "hosted").length;
    const pinReady = tenants.filter((tenant) => tenant.pinConfigured).length;
    const billingCounts = new Map<string, number>();
    tenants.forEach((tenant) => billingCounts.set(tenant.billingStatus, (billingCounts.get(tenant.billingStatus) || 0) + 1));
    const configuredSecrets = state.secrets.filter((secret) => secret.configuredInConvex || secret.envFallbackConfigured).length;
    const secretCoverage = state.secrets.length > 0 ? Math.round((configuredSecrets / state.secrets.length) * 100) : 0;
    const recentTenants = [...tenants].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 6);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tenantActivity = Array.from({ length: 14 }, (_, index) => {
      const start = today.getTime() - (13 - index) * DAY_MS;
      const end = start + DAY_MS;
      return {
        key: String(start),
        label: index % 3 === 1 || index === 13 ? shortDayLabel(start) : "",
        value: tenants.filter((tenant) => tenant.updatedAt >= start && tenant.updatedAt < end).length,
      };
    });
    const billingBars = BILLING_ORDER.map((status) => ({
      key: status,
      label: status.replace("_", " "),
      value: billingCounts.get(status) || 0,
    }));
    const secretBars = [
      { key: "configured", label: "Configured", value: configuredSecrets },
      { key: "missing", label: "Missing", value: Math.max(0, state.secrets.length - configuredSecrets) },
    ];

    return {
      totalTenants: tenants.length,
      hosted,
      pinReady,
      billingCounts,
      configuredSecrets,
      secretCoverage,
      recentTenants,
      tenantActivity,
      billingBars,
      secretBars,
    };
  }, [state]);

  return (
    <section className="admin-overview-dashboard" aria-busy={loading}>
      {error ? <p className="admin-alert" role="alert">{error}</p> : null}
      {loading ? <p className="admin-notice" role="status">Loading overview...</p> : null}

      <div className="admin-stat-grid" aria-label="Platform stats">
        <div>
          <span>Tenants</span>
          <strong>{stats.totalTenants}</strong>
        </div>
        <div>
          <span>Hosted</span>
          <strong>{stats.hosted}</strong>
        </div>
        <div>
          <span>PIN Ready</span>
          <strong>{stats.pinReady}</strong>
        </div>
        <div>
          <span>Secrets</span>
          <strong>{stats.secretCoverage}%</strong>
        </div>
      </div>

      <div className="admin-overview-chart-grid">
        <AdminBarChart title="Tenant Updates" unit="14d" bars={stats.tenantActivity} tone="green" />
        <AdminBarChart title="Billing Status" unit="tenants" bars={stats.billingBars} />
        <AdminBarChart title="Secret Readiness" unit="definitions" bars={stats.secretBars} />
      </div>

      <section className="admin-data-panel" aria-label="Recent tenants">
        <div className="admin-data-head admin-overview-tenant-head">
          <span>Tenant</span>
          <span>Billing</span>
          <span>Updated</span>
        </div>
        <div className="admin-data-list">
          {stats.recentTenants.map((tenant) => (
            <article className="admin-data-row admin-overview-tenant-row" key={tenant._id}>
              <div>
                <strong>{tenant.email}</strong>
                <span>{tenant.displayName || tenant.serviceMode.replace("_", " ")}</span>
              </div>
              <div>
                <strong>{tenant.billingStatus.replace("_", " ")}</strong>
                <span>{tenant.plan.replace("_", " ")}</span>
              </div>
              <div>
                <strong>{formatDate(tenant.updatedAt)}</strong>
                <span>Trial ends {formatDate(tenant.trialEndsAt)}</span>
              </div>
            </article>
          ))}
          {!loading && stats.recentTenants.length === 0 ? <p className="admin-empty-state">No tenants found.</p> : null}
        </div>
      </section>
    </section>
  );
}
