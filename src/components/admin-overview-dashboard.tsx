"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { LoadingIndicator } from "@/components/loading-state";

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
  metrics: OverviewMetrics | null;
};

const BILLING_ORDER = ["trialing", "active", "past_due", "paused", "canceled"] as const;
const DAY_MS = 24 * 60 * 60 * 1000;

type OverviewMetricDay = {
  dayStartAt: number;
  date: string;
  inboundMessages: number;
  outboundMessages: number;
  totalMessages: number;
  aiRuns: number;
  aiErrors: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
};

export type OverviewMetrics = {
  totals: {
    inboundMessages: number;
    outboundMessages: number;
    totalMessages: number;
    aiRuns: number;
    aiErrors: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCostUsd: number;
  };
  daily: OverviewMetricDay[];
};

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

type OverlapBarDatum = {
  key: string;
  label: string;
  primary: number;
  secondary: number;
};

function formatCompact(value: number) {
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function formatMoney(value: number) {
  if (value >= 1) {
    return `$${value.toFixed(2)}`;
  }
  if (value > 0) {
    return `$${value.toFixed(4)}`;
  }
  return "$0";
}

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

function AdminOverlapBarChart({
  title,
  unit,
  bars,
  primaryLabel,
  secondaryLabel,
  primaryTone = "green",
  axisFormatter = formatCompact,
  primaryFormatter = formatCompact,
  secondaryFormatter = formatCompact,
  normalizeIndependently = false,
}: {
  title: string;
  unit: string;
  bars: OverlapBarDatum[];
  primaryLabel: string;
  secondaryLabel: string;
  primaryTone?: "blue" | "green";
  axisFormatter?: (value: number) => string;
  primaryFormatter?: (value: number) => string;
  secondaryFormatter?: (value: number) => string;
  normalizeIndependently?: boolean;
}) {
  const primaryMax = Math.max(1, ...bars.map((bar) => bar.primary));
  const secondaryMax = Math.max(1, ...bars.map((bar) => bar.secondary));
  const maxValue = normalizeIndependently ? primaryMax : Math.max(primaryMax, secondaryMax);
  const midValue = Math.ceil(maxValue / 2);

  return (
    <section className={`admin-data-panel admin-chart-panel admin-overlap-chart admin-chart-panel-${primaryTone}`} aria-label={title}>
      <div className="admin-chart-title-row">
        <h2>{title}</h2>
        <span>{unit}</span>
      </div>
      <div className="admin-chart-legend" aria-hidden="true">
        <span className="primary">{primaryLabel}</span>
        <span className="secondary">{secondaryLabel}</span>
      </div>
      <div className="admin-chart-plot">
        <div className="admin-chart-gridlines" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div className="admin-chart-y-axis" aria-hidden="true">
          <span>{axisFormatter(maxValue)}</span>
          <span>{axisFormatter(midValue)}</span>
          <span>{axisFormatter(0)}</span>
        </div>
        <div className="admin-chart-bars">
          {bars.map((bar) => {
            const primaryHeight = Math.max(bar.primary > 0 ? 3 : 0, (bar.primary / maxValue) * 100);
            const secondaryBasis = normalizeIndependently ? secondaryMax : maxValue;
            const secondaryHeight = Math.max(bar.secondary > 0 ? 3 : 0, (bar.secondary / secondaryBasis) * 100);
            return (
              <div className="admin-chart-bar-cell" key={bar.key}>
                <span className="admin-overlap-bar-track">
                  <i
                    className="admin-overlap-bar-primary"
                    style={{ "--admin-bar-height": `${primaryHeight}%` } as CSSProperties}
                    title={`${bar.label}: ${primaryLabel} ${primaryFormatter(bar.primary)}`}
                  />
                  <i
                    className="admin-overlap-bar-secondary"
                    style={{ "--admin-bar-height": `${secondaryHeight}%` } as CSSProperties}
                    title={`${bar.label}: ${secondaryLabel} ${secondaryFormatter(bar.secondary)}`}
                  />
                </span>
                <span className="admin-chart-x-label">{bar.label}</span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export function AdminOverviewDashboard({
  initialMetrics = null,
  initialMetricsError = "",
}: {
  initialMetrics?: OverviewMetrics | null;
  initialMetricsError?: string;
}) {
  const [state, setState] = useState<OverviewState>({ tenants: [], secrets: [], metrics: initialMetrics });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(initialMetricsError);

  useEffect(() => {
    let active = true;

    async function loadOverview() {
      setLoading(true);
      setError(initialMetricsError);
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
          metrics: initialMetrics,
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
  }, [initialMetrics, initialMetricsError]);

  const stats = useMemo(() => {
    const tenants = state.tenants;
    const billingCounts = new Map<string, number>();
    tenants.forEach((tenant) => billingCounts.set(tenant.billingStatus, (billingCounts.get(tenant.billingStatus) || 0) + 1));
    const configuredSecrets = state.secrets.filter((secret) => secret.configuredInConvex || secret.envFallbackConfigured).length;
    const missingSecrets = Math.max(0, state.secrets.length - configuredSecrets);
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
    const metricDays = state.metrics?.daily || [];
    const messageBars = metricDays.map((day, index) => ({
      key: day.date,
      label: index % 3 === 1 || index === metricDays.length - 1 ? shortDayLabel(day.dayStartAt) : "",
      primary: day.inboundMessages,
      secondary: day.outboundMessages,
    }));
    const aiSpendBars = metricDays.map((day, index) => ({
      key: day.date,
      label: index % 3 === 1 || index === metricDays.length - 1 ? shortDayLabel(day.dayStartAt) : "",
      primary: day.totalMessages,
      secondary: day.estimatedCostUsd,
    }));
    const tokenBars = metricDays.map((day, index) => ({
      key: day.date,
      label: index % 3 === 1 || index === metricDays.length - 1 ? shortDayLabel(day.dayStartAt) : "",
      primary: day.inputTokens,
      secondary: day.outputTokens,
    }));
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
      activeTenants: (billingCounts.get("active") || 0) + (billingCounts.get("trialing") || 0),
      pastDueTenants: billingCounts.get("past_due") || 0,
      configuredSecrets,
      missingSecrets,
      recentTenants,
      tenantActivity,
      billingBars,
      secretBars,
      messageBars,
      aiSpendBars,
      tokenBars,
    };
  }, [state]);

  return (
    <section className="admin-overview-dashboard" aria-busy={loading}>
      {error ? <p className="admin-alert" role="alert">{error}</p> : null}
      {loading ? <LoadingIndicator label="Loading overview" className="admin-overview-loading" /> : null}

      <div className="admin-stat-grid admin-stat-grid-six" aria-label="Platform stats">
        <div>
          <span>Tenants</span>
          <strong>{formatCompact(stats.totalTenants)}</strong>
        </div>
        <div>
          <span>Live</span>
          <strong>{formatCompact(stats.activeTenants)}</strong>
        </div>
        <div>
          <span>Past Due</span>
          <strong>{formatCompact(stats.pastDueTenants)}</strong>
        </div>
        <div>
          <span>Secrets</span>
          <strong>{stats.configuredSecrets}/{state.secrets.length}</strong>
        </div>
        <div>
          <span>Missing</span>
          <strong>{formatCompact(stats.missingSecrets)}</strong>
        </div>
        <div>
          <span>Processed</span>
          <strong>{formatCompact(state.metrics?.totals.totalMessages || 0)}</strong>
        </div>
        <div>
          <span>Inbound</span>
          <strong>{formatCompact(state.metrics?.totals.inboundMessages || 0)}</strong>
        </div>
        <div>
          <span>Outbound</span>
          <strong>{formatCompact(state.metrics?.totals.outboundMessages || 0)}</strong>
        </div>
        <div>
          <span>AI Runs</span>
          <strong>{formatCompact(state.metrics?.totals.aiRuns || 0)}</strong>
        </div>
        <div>
          <span>AI Errors</span>
          <strong>{formatCompact(state.metrics?.totals.aiErrors || 0)}</strong>
        </div>
        <div>
          <span>Tokens</span>
          <strong>{formatCompact(state.metrics?.totals.totalTokens || 0)}</strong>
        </div>
        <div>
          <span>Spend</span>
          <strong>{formatMoney(state.metrics?.totals.estimatedCostUsd || 0)}</strong>
        </div>
      </div>

      <div className="admin-overview-chart-grid">
        <AdminOverlapBarChart
          title="AI Spend / Messages"
          unit="14d"
          bars={stats.aiSpendBars}
          primaryLabel="Messages"
          secondaryLabel="Spend"
          normalizeIndependently
          axisFormatter={formatCompact}
          primaryFormatter={formatCompact}
          secondaryFormatter={formatMoney}
        />
        <AdminOverlapBarChart
          title="Messages Processed"
          unit="inbound / outbound"
          bars={stats.messageBars}
          primaryLabel="Inbound"
          secondaryLabel="Outbound"
          primaryTone="blue"
        />
        <AdminOverlapBarChart
          title="AI Token Use"
          unit="input / output"
          bars={stats.tokenBars}
          primaryLabel="Input"
          secondaryLabel="Output"
        />
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
