"use client";

import { LoadingBlock } from "@/components/loading-state";
import { formatDateTime } from "@/lib/format";
import { api } from "../../convex/_generated/api";
import { useQuery } from "convex/react";
import { useEffect, useMemo, useState } from "react";

type SpendingWindow = "7d" | "30d" | "90d" | "all";

const WINDOW_OPTIONS: Array<{ id: SpendingWindow; label: string }> = [
  { id: "7d", label: "7D" },
  { id: "30d", label: "30D" },
  { id: "90d", label: "90D" },
  { id: "all", label: "All" },
];

const MAX_DAILY_ROWS = 45;
const FALLBACK_INPUT_RATE_KEY = "spending:fallbackInputCostPer1MUsd";
const FALLBACK_OUTPUT_RATE_KEY = "spending:fallbackOutputCostPer1MUsd";

type SpendingAnalytics = {
  provider: "azure";
  window: SpendingWindow;
  windowLabel: string;
  windowStartAt: number | null;
  generatedAt: number;
  scannedRuns: number;
  runCap: number;
  truncated: boolean;
  totals: {
    runs: number;
    successRuns: number;
    errorRuns: number;
    successRate: number;
    pricedRuns: number;
    fallbackPricedRuns: number;
    costedRuns: number;
    unpricedRuns: number;
    tokenizedRuns: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCostUsd: number;
    fallbackEstimatedCostUsd: number;
    avgCostPerRunUsd: number;
    avgCostPer1kTokensUsd: number;
    avgLatencyMs: number;
  };
  pricing: {
    fallbackPricingEnabled: boolean;
    fallbackInputCostPer1MUsd: number | null;
    fallbackOutputCostPer1MUsd: number | null;
  };
  coverage: {
    earliestRunAt: number | null;
    latestRunAt: number | null;
  };
  daily: Array<{
    dayStartAt: number;
    date: string;
    runs: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCostUsd: number;
  }>;
  models: Array<{
    model: string;
    runs: number;
    successRuns: number;
    errorRuns: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCostUsd: number;
    pricedRuns: number;
    tokenizedRuns: number;
    avgLatencyMs: number;
  }>;
  statuses: Array<{
    status: "success" | "error";
    runs: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCostUsd: number;
  }>;
};

function formatUsd(value: number, maximumFractionDigits = 6) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits,
  }).format(value);
}

function formatInt(value: number) {
  return new Intl.NumberFormat().format(value);
}

function parseNonNegativeNumber(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return undefined;
  }
  return parsed;
}

function DailyCostBars({ days }: { days: SpendingAnalytics["daily"] }) {
  const visible = days.slice(-MAX_DAILY_ROWS).reverse();
  const maxCost = visible.reduce((max, entry) => Math.max(max, entry.estimatedCostUsd), 0);

  if (visible.length === 0) {
    return <p className="empty-line">No Azure runs in this window.</p>;
  }

  return (
    <div className="stack">
      {visible.map((entry) => {
        const ratio = maxCost > 0 ? entry.estimatedCostUsd / maxCost : 0;
        const widthPercent = ratio <= 0 ? 0 : Math.max(3, Math.round(ratio * 100));
        return (
          <div key={entry.date} className="queue-item">
            <p className="queue-title">{entry.date}</p>
            <p className="queue-meta">
              {formatUsd(entry.estimatedCostUsd)} · {formatInt(entry.runs)} runs · {formatInt(entry.totalTokens)} tok
            </p>
            <div
              aria-hidden="true"
              style={{
                marginTop: 8,
                height: 6,
                borderRadius: 999,
                background: "rgba(255,255,255,0.14)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${widthPercent}%`,
                  height: "100%",
                  background: "linear-gradient(90deg, rgba(72, 196, 255, 0.85), rgba(116, 232, 195, 0.85))",
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ModelBreakdown({ models, totalCost }: { models: SpendingAnalytics["models"]; totalCost: number }) {
  if (models.length === 0) {
    return <p className="empty-line">No model-level Azure usage captured yet.</p>;
  }

  return (
    <div className="stack">
      {models.map((model) => {
        const share = totalCost > 0 ? (model.estimatedCostUsd / totalCost) * 100 : 0;
        return (
          <div key={model.model} className="queue-item">
            <p className="queue-title">{model.model}</p>
            <p className="queue-meta">
              {formatUsd(model.estimatedCostUsd)} · {share.toFixed(1)}% · {formatInt(model.runs)} runs
            </p>
            <p className="queue-meta">
              Success/error: {model.successRuns}/{model.errorRuns} · Avg latency: {Math.round(model.avgLatencyMs)}ms
            </p>
            <p className="queue-meta">Tokens: {formatInt(model.totalTokens)} · Priced runs: {formatInt(model.pricedRuns)}</p>
          </div>
        );
      })}
    </div>
  );
}

function StatusBreakdown({ statuses }: { statuses: SpendingAnalytics["statuses"] }) {
  if (statuses.length === 0) {
    return <p className="empty-line">No status breakdown available yet.</p>;
  }

  return (
    <div className="stack">
      {statuses.map((status) => (
        <div key={status.status} className="queue-item">
          <p className="queue-title">{status.status.toUpperCase()}</p>
          <p className="queue-meta">
            {formatUsd(status.estimatedCostUsd)} · {formatInt(status.runs)} runs · {formatInt(status.totalTokens)} tok
          </p>
        </div>
      ))}
    </div>
  );
}

type LiveSpendingProps = {
  initialInputRatePer1MUsd?: number;
  initialOutputRatePer1MUsd?: number;
  hideManualPricingInputs?: boolean;
};

function SpendingContent(props: LiveSpendingProps) {
  const [selectedWindow, setSelectedWindow] = useState<SpendingWindow>("30d");
  const [fallbackInputRate, setFallbackInputRate] = useState(
    props.initialInputRatePer1MUsd !== undefined ? String(props.initialInputRatePer1MUsd) : "",
  );
  const [fallbackOutputRate, setFallbackOutputRate] = useState(
    props.initialOutputRatePer1MUsd !== undefined ? String(props.initialOutputRatePer1MUsd) : "",
  );
  const manualPricingHidden = Boolean(props.hideManualPricingInputs);

  useEffect(() => {
    if (manualPricingHidden) {
      return;
    }
    if (typeof globalThis.window === "undefined") {
      return;
    }
    const storedInputRate = globalThis.window.localStorage.getItem(FALLBACK_INPUT_RATE_KEY) || "";
    const storedOutputRate = globalThis.window.localStorage.getItem(FALLBACK_OUTPUT_RATE_KEY) || "";
    const timer = globalThis.window.setTimeout(() => {
      setFallbackInputRate(storedInputRate);
      setFallbackOutputRate(storedOutputRate);
    }, 0);
    return () => globalThis.window.clearTimeout(timer);
  }, [manualPricingHidden]);

  useEffect(() => {
    if (manualPricingHidden) {
      return;
    }
    if (typeof globalThis.window === "undefined") {
      return;
    }
    globalThis.window.localStorage.setItem(FALLBACK_INPUT_RATE_KEY, fallbackInputRate.trim());
  }, [fallbackInputRate, manualPricingHidden]);

  useEffect(() => {
    if (manualPricingHidden) {
      return;
    }
    if (typeof globalThis.window === "undefined") {
      return;
    }
    globalThis.window.localStorage.setItem(FALLBACK_OUTPUT_RATE_KEY, fallbackOutputRate.trim());
  }, [fallbackOutputRate, manualPricingHidden]);

  const parsedFallbackInputRate = useMemo(() => parseNonNegativeNumber(fallbackInputRate), [fallbackInputRate]);
  const parsedFallbackOutputRate = useMemo(() => parseNonNegativeNumber(fallbackOutputRate), [fallbackOutputRate]);

  const analytics = useQuery(api.system.azureSpendingAnalytics, {
    window: selectedWindow,
    ...(parsedFallbackInputRate === undefined ? {} : { fallbackInputCostPer1MUsd: parsedFallbackInputRate }),
    ...(parsedFallbackOutputRate === undefined ? {} : { fallbackOutputCostPer1MUsd: parsedFallbackOutputRate }),
  }) as SpendingAnalytics | undefined;

  const loading = analytics === undefined;
  const totalDays = analytics?.daily.length ?? 0;
  const visibleDays = Math.min(totalDays, MAX_DAILY_ROWS);
  const modelCoverageCount = analytics?.models.length ?? 0;

  const summaryRows = useMemo(() => {
    if (!analytics) {
      return [];
    }

    return [
      {
        label: "Estimated cost",
        value: formatUsd(analytics.totals.estimatedCostUsd),
        detail: `${analytics.windowLabel} Azure AI usage`,
      },
      {
        label: "Runs",
        value: formatInt(analytics.totals.runs),
        detail: `Success/error: ${analytics.totals.successRuns}/${analytics.totals.errorRuns} (${(analytics.totals.successRate * 100).toFixed(1)}% success) · Costed/unpriced: ${analytics.totals.costedRuns}/${analytics.totals.unpricedRuns}`,
      },
      {
        label: "Tokens",
        value: formatInt(analytics.totals.totalTokens),
        detail: `Input/output: ${formatInt(analytics.totals.inputTokens)}/${formatInt(analytics.totals.outputTokens)}`,
      },
      {
        label: "Cost efficiency",
        value: formatUsd(analytics.totals.avgCostPer1kTokensUsd),
        detail: `${formatUsd(analytics.totals.avgCostPerRunUsd)} per run · ${Math.round(analytics.totals.avgLatencyMs)}ms avg latency`,
      },
    ];
  }, [analytics]);

  return (
    <section className="stack">
      <div className="queue-focus-tabs" role="tablist" aria-label="Azure spending time window">
        {WINDOW_OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            role="tab"
            className={`btn ${selectedWindow === option.id ? "btn-primary" : "btn-ghost"}`}
            aria-selected={selectedWindow === option.id}
            onClick={() => setSelectedWindow(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>

      {!manualPricingHidden ? (
        <article className="panel-card">
          <h3>Token Pricing Inputs</h3>
          <p className="queue-meta">
            Enter USD rates per 1M tokens to backfill cost for runs that only have tokens (no provider cost).
          </p>
          <div className="stack compact" style={{ marginTop: 10 }}>
            <label className="stack compact">
              <span className="queue-meta">Input tokens (USD per 1M)</span>
              <input
                type="number"
                min="0"
                step="0.000001"
                value={fallbackInputRate}
                onChange={(event) => setFallbackInputRate(event.target.value)}
                placeholder="e.g. 1.25"
              />
            </label>
            <label className="stack compact">
              <span className="queue-meta">Output tokens (USD per 1M)</span>
              <input
                type="number"
                min="0"
                step="0.000001"
                value={fallbackOutputRate}
                onChange={(event) => setFallbackOutputRate(event.target.value)}
                placeholder="e.g. 10.00"
              />
            </label>
            <p className="queue-meta">
              {parsedFallbackInputRate !== undefined && parsedFallbackOutputRate !== undefined
                ? `Fallback pricing active: input ${formatUsd(parsedFallbackInputRate, 6)} / output ${formatUsd(parsedFallbackOutputRate, 6)} per 1M.`
                : "Fallback pricing is off until both rates are provided."}
            </p>
          </div>
        </article>
      ) : null}

      <div className="panel-grid two-col">
        <article className="panel-card">
          <h3>Azure Cost Summary</h3>
          {loading ? (
            <LoadingBlock label="Calculating Azure spend…" rows={4} />
          ) : analytics ? (
            <>
              <div className="stack">
                {summaryRows.map((row) => (
                  <div key={row.label} className="queue-item">
                    <p className="queue-title">{row.label}</p>
                    <p className="queue-body" style={{ marginTop: 4, marginBottom: 4 }}>
                      {row.value}
                    </p>
                    <p className="queue-meta">{row.detail}</p>
                  </div>
                ))}
              </div>
              <p className="queue-meta" style={{ marginTop: 10 }}>
                Coverage: {formatDateTime(analytics.coverage.earliestRunAt)} to {formatDateTime(analytics.coverage.latestRunAt)}
              </p>
              <p className="queue-meta">
                Provider-priced: {formatInt(analytics.totals.pricedRuns)} · Fallback-priced: {formatInt(analytics.totals.fallbackPricedRuns)} · Unpriced: {formatInt(analytics.totals.unpricedRuns)}
              </p>
              <p className="queue-meta">
                Tokenized runs: {formatInt(analytics.totals.tokenizedRuns)} · Scanned: {formatInt(analytics.scannedRuns)} · Fallback cost share: {formatUsd(analytics.totals.fallbackEstimatedCostUsd)}
              </p>
              {analytics.truncated ? (
                <p className="queue-meta" role="status">
                  Results hit cap ({formatInt(analytics.runCap)} runs). Increase cap in query args if you need full historical totals.
                </p>
              ) : null}
              {analytics.totals.unpricedRuns > 0 ? (
                <p className="queue-meta" role="status">
                  Some runs remain unpriced. Provide fallback rates above or configure runtime pricing env vars for new runs.
                </p>
              ) : null}
            </>
          ) : (
            <p className="empty-line">No Azure spending analytics available.</p>
          )}
        </article>

        <article className="panel-card">
          <h3>Model Breakdown</h3>
          {loading ? <LoadingBlock label="Loading model spend…" rows={4} compact /> : null}
          {!loading && analytics ? <ModelBreakdown models={analytics.models} totalCost={analytics.totals.estimatedCostUsd} /> : null}
          {!loading && analytics ? (
            <p className="queue-meta" style={{ marginTop: 10 }}>
              Showing top {formatInt(modelCoverageCount)} models by cost.
            </p>
          ) : null}
        </article>

        <article className="panel-card">
          <h3>Daily Spend Trend</h3>
          {loading ? <LoadingBlock label="Loading daily spend…" rows={5} compact /> : null}
          {!loading && analytics ? <DailyCostBars days={analytics.daily} /> : null}
          {!loading && analytics && totalDays > 0 ? (
            <p className="queue-meta" style={{ marginTop: 10 }}>
              Showing latest {formatInt(visibleDays)} of {formatInt(totalDays)} days in this window.
            </p>
          ) : null}
        </article>

        <article className="panel-card">
          <h3>Status Breakdown</h3>
          {loading ? <LoadingBlock label="Loading status breakdown…" rows={3} compact /> : null}
          {!loading && analytics ? <StatusBreakdown statuses={analytics.statuses} /> : null}
          {!loading && analytics ? (
            <p className="queue-meta" style={{ marginTop: 10 }}>
              Snapshot generated at {formatDateTime(analytics.generatedAt)}.
            </p>
          ) : null}
        </article>
      </div>
    </section>
  );
}

export function LiveSpending(props: LiveSpendingProps) {
  return <SpendingContent {...props} />;
}
