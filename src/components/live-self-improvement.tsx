"use client";

import { LoadingBlock } from "@/components/loading-state";
import { formatDateTime, trim } from "@/lib/format";
import { useEffect, useMemo, useState } from "react";

type RunStatus = "success" | "warning" | "error" | "incomplete";
type RunMode = "once" | "daemon" | "unknown";

type RunSummary = {
  runId: string;
  status: RunStatus;
  runMode: RunMode;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  dryRun: boolean;
  codexModel: string | null;
  codexExitCode: number | null;
  codexErrorMessage: string | null;
  fatalErrorMessage: string | null;
  promptOverride: string | null;
  stats: {
    includedSources?: number;
    skippedOptionalSources?: number;
    contextChars?: number;
  } | null;
  hasReport: boolean;
  hasPrompt: boolean;
  hasContext: boolean;
  reportPreview: string | null;
};

type RunsResponse = {
  lock: {
    active: boolean;
    pid: number | null;
    startedAt: string | null;
  };
  runs: RunSummary[];
  detail:
    | {
        runId: string;
        meta: {
          runMode?: RunMode;
        } | null;
        codexResponse: string;
        report: string;
        prompt: string;
        contextPreview: string;
      }
    | null;
  fetchedAt: string;
};

function statusLabel(status: RunStatus) {
  if (status === "success") return "Success";
  if (status === "warning") return "Warning";
  if (status === "error") return "Error";
  return "Incomplete";
}

function durationLabel(durationMs: number | null) {
  if (typeof durationMs !== "number" || !Number.isFinite(durationMs)) {
    return "—";
  }
  if (durationMs < 1_000) {
    return `${durationMs}ms`;
  }
  return `${Math.round(durationMs / 1_000)}s`;
}

function modeLabel(mode: RunMode) {
  if (mode === "daemon") return "Auto";
  if (mode === "once") return "Manual/Once";
  return "Unknown";
}

function parseIsoToMs(value: string | null) {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function LiveSelfImprovement() {
  const [payload, setPayload] = useState<RunsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedRunId, setSelectedRunId] = useState("");

  const loadRuns = async (runId: string) => {
    const url = runId
      ? `/api/system/self-improvement/runs?limit=120&runId=${encodeURIComponent(runId)}`
      : "/api/system/self-improvement/runs?limit=120";
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Failed to load self-improvement runs (${response.status}).`);
    }
    return (await response.json()) as RunsResponse;
  };

  useEffect(() => {
    let cancelled = false;

    const refresh = async () => {
      try {
        const next = await loadRuns(selectedRunId);
        if (cancelled) {
          return;
        }
        setPayload(next);
        setError("");
        if (!selectedRunId && next.runs[0]?.runId) {
          setSelectedRunId(next.runs[0].runId);
        }
      } catch (err) {
        if (cancelled) {
          return;
        }
        const message = err instanceof Error ? err.message : "Failed to load runs.";
        setError(message);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void refresh();
    const timer = setInterval(() => {
      void refresh();
    }, 20_000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [selectedRunId]);

  const selectedSummary = useMemo(() => {
    if (!payload?.runs?.length) {
      return null;
    }
    if (!selectedRunId) {
      return payload.runs[0];
    }
    return payload.runs.find((run) => run.runId === selectedRunId) || payload.runs[0];
  }, [payload?.runs, selectedRunId]);

  return (
    <section className="panel-grid two-col self-improvement-view">
      <article className="panel-card self-improvement-panel">
        <h3>Self-Improvement Runs</h3>
        <p className="queue-meta">
          Track both manual (`once`) and automatic (`daemon`) cycles with success/error visibility.
        </p>
        {payload ? (
          <p className="queue-meta">
            Active now: {payload.lock.active ? "yes" : "no"}
            {payload.lock.pid ? ` · pid ${payload.lock.pid}` : ""}
            {payload.lock.startedAt ? ` · started ${formatDateTime(parseIsoToMs(payload.lock.startedAt))}` : ""}
          </p>
        ) : null}
        {error ? (
          <p className="queue-meta action-inline-error" role="alert">
            {error}
          </p>
        ) : null}
        {loading ? (
          <LoadingBlock label="Loading self-improvement runs…" rows={4} />
        ) : payload && payload.runs.length > 0 ? (
          <div className="stack self-improvement-scroll">
            {payload.runs.map((run) => {
              const active = selectedSummary?.runId === run.runId;
              return (
                <button
                  type="button"
                  key={run.runId}
                  className="queue-item"
                  style={
                    active
                      ? {
                          borderColor: "rgba(90, 170, 255, 0.75)",
                          boxShadow: "0 0 0 1px rgba(90, 170, 255, 0.55) inset",
                        }
                      : undefined
                  }
                  onClick={() => setSelectedRunId(run.runId)}
                >
                  <p className="queue-title">
                    {run.runId}
                    <span className="queue-meta"> · {statusLabel(run.status)} · {modeLabel(run.runMode)}</span>
                  </p>
                  <p className="queue-meta">
                    {run.startedAt ? formatDateTime(parseIsoToMs(run.startedAt)) : "unknown start"} · duration{" "}
                    {durationLabel(run.durationMs)}
                  </p>
                  <p className="queue-meta">
                    model {run.codexModel || "unknown"} · dryRun {run.dryRun ? "yes" : "no"}
                  </p>
                  {run.fatalErrorMessage || run.codexErrorMessage ? (
                    <p className="queue-body">{trim(run.fatalErrorMessage || run.codexErrorMessage || "", 220)}</p>
                  ) : run.reportPreview ? (
                    <p className="queue-body">{trim(run.reportPreview, 220)}</p>
                  ) : (
                    <p className="queue-meta">No Codex response captured.</p>
                  )}
                </button>
              );
            })}
          </div>
        ) : (
          <p className="empty-line">No runs found yet. Run `bun run self-improve` or start daemon mode.</p>
        )}
      </article>

      <article className="panel-card self-improvement-panel">
        <h3>Run Details</h3>
        {!payload?.detail || !selectedSummary ? (
          <p className="empty-line">Select a run to inspect full details.</p>
        ) : (
          <div className="stack self-improvement-scroll">
            <p className="queue-meta">
              Status: {statusLabel(selectedSummary.status)} · Mode: {modeLabel(selectedSummary.runMode)} · Duration:{" "}
              {durationLabel(selectedSummary.durationMs)}
            </p>
            {selectedSummary.promptOverride ? (
              <div className="queue-item">
                <p className="queue-title">Priority Prompt</p>
                <p className="queue-body">{selectedSummary.promptOverride}</p>
              </div>
            ) : null}
            {selectedSummary.stats ? (
              <div className="queue-item">
                <p className="queue-title">Run Stats</p>
                <p className="queue-meta">
                  Included sources: {selectedSummary.stats.includedSources ?? "—"} · Optional skipped:{" "}
                  {selectedSummary.stats.skippedOptionalSources ?? "—"} · Context chars:{" "}
                  {selectedSummary.stats.contextChars ?? "—"}
                </p>
              </div>
            ) : null}
            <details className="queue-item" open>
              <summary className="queue-title">Codex Response</summary>
              <pre className="queue-body self-improvement-preview">
                {payload.detail.codexResponse || payload.detail.report || "No response content."}
              </pre>
            </details>
            <details className="queue-item">
              <summary className="queue-title">Prompt Sent To Codex</summary>
              <pre className="queue-body self-improvement-preview">
                {payload.detail.prompt || "No prompt saved."}
              </pre>
            </details>
            <details className="queue-item">
              <summary className="queue-title">Context Preview</summary>
              <pre className="queue-body self-improvement-preview">
                {payload.detail.contextPreview || "No context snapshot available."}
              </pre>
            </details>
          </div>
        )}
      </article>
    </section>
  );
}
