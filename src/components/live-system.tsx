"use client";

import { ActionNotices } from "@/components/action-notices";
import { formatDateTime, trim } from "@/lib/format";
import { useActionStateRegistry } from "@/lib/ui/action-state";
import { api } from "../../convex/_generated/api";
import { useQuery } from "convex/react";
import { FormEvent, useState } from "react";

type TestAttempt = {
  provider: "azure" | "codex" | "heuristic";
  stage:
    | "azure_sdk"
    | "azure_http"
    | "azure_responses"
    | "codex_cli"
    | "heuristic_guardrail"
    | "heuristic_fallback"
    | "humor_judge_azure"
    | "humor_judge_codex";
  model: string;
  status: "success" | "error";
  latencyMs: number;
  error?: string;
};

type TestResult = {
  replyText: string;
  provider: "azure" | "codex" | "heuristic";
  model: string;
  latencyMs: number;
  guardrailBlocked: boolean;
  guardrailReason?: string;
  attempts: TestAttempt[];
  qualityScore?: number;
  qualityChecks?: Array<{
    id: string;
    label: string;
    score: number;
    passed: boolean;
    detail: string;
  }>;
  qualityRewriteApplied?: boolean;
  activePersonaPackId?: string | null;
  createdAt: number;
  usedThreadContext: boolean;
};

type KnownContact = {
  _id: string;
  jid: string;
  title?: string;
};

async function readApiError(response: Response) {
  try {
    const payload = (await response.json()) as { error?: string };
    if (payload?.error && payload.error.trim()) {
      return payload.error;
    }
  } catch {
    // ignore non-JSON responses
  }

  return `Request failed (${response.status}).`;
}

function AiTestBench() {
  const contacts = useQuery(api.threads.listContacts, { limit: 200 }) as KnownContact[] | undefined;
  const contactsLoading = contacts === undefined;
  const contactOptions = contacts || [];

  const { runAction, getRecord, notices, dismissNotice } = useActionStateRegistry();
  const [message, setMessage] = useState("");
  const [threadId, setThreadId] = useState("none");
  const [result, setResult] = useState<TestResult | null>(null);

  const key = "system:test-ai";
  const record = getRecord(key);
  const canSubmit = message.trim().length > 0 && !record.pending;

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!message.trim()) {
      return;
    }

    void runAction(
      key,
      async () => {
        const response = await fetch("/api/actions/test-ai", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            message,
            threadId: threadId === "none" ? undefined : threadId,
          }),
        });

        if (!response.ok) {
          throw new Error(await readApiError(response));
        }

        const payload = (await response.json()) as TestResult;
        setResult({
          ...payload,
          createdAt: payload.createdAt || Date.now(),
        });
        return payload;
      },
      {
        pendingLabel: "Generating test reply...",
        successMessage: "AI test reply generated.",
      },
    );
  };

  return (
    <article className="panel-card">
      <ActionNotices notices={notices} onDismiss={dismissNotice} />
      <h3>Test AI Reply</h3>
      <p className="queue-meta">Send a mock inbound message and preview what the AI would reply.</p>

      <form onSubmit={onSubmit} className="stack compact" aria-busy={record.pending}>
        <label className="stack compact">
          <span className="queue-meta">Inbound test message</span>
          <textarea
            rows={4}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Type a message your contact might send..."
            disabled={record.pending}
            aria-disabled={record.pending}
          />
        </label>

        <label className="stack compact">
          <span className="queue-meta">Conversation context (optional)</span>
          <select
            value={threadId}
            onChange={(event) => setThreadId(event.target.value)}
            disabled={record.pending || contactsLoading}
            aria-disabled={record.pending || contactsLoading}
          >
            <option value="none">No conversation context</option>
            {contactOptions.map((contact) => (
              <option key={contact._id} value={contact._id}>
                {(contact.title?.trim() || contact.jid).slice(0, 100)}
              </option>
            ))}
          </select>
        </label>

        <button type="submit" className="btn btn-primary" disabled={!canSubmit} aria-disabled={!canSubmit}>
          {record.pending ? "Generating..." : "Generate Test Reply"}
        </button>
      </form>

      {record.pendingLabel ? <p className="action-pending-label">{record.pendingLabel}</p> : null}
      {record.error ? (
        <p className="queue-meta action-inline-error" role="alert">
          {record.error}
        </p>
      ) : null}

      {result ? (
        <div className="stack">
          <div className="queue-item">
            <p className="queue-title">Generated Reply</p>
            <p className="queue-body">{result.replyText}</p>
            <p className="queue-meta">
              {result.provider.toUpperCase()} · {result.model} · {result.latencyMs}ms · {formatDateTime(result.createdAt)}
            </p>
            <p className="queue-meta">{result.usedThreadContext ? "Used conversation context." : "No conversation context used."}</p>
            {result.activePersonaPackId ? <p className="queue-meta">Persona pack: {result.activePersonaPackId}</p> : null}
            {typeof result.qualityScore === "number" ? (
              <p className="queue-meta">
                Quality score: {(result.qualityScore * 100).toFixed(0)}%{result.qualityRewriteApplied ? " · rewritten once" : ""}
              </p>
            ) : null}
            {Array.isArray(result.qualityChecks) && result.qualityChecks.length > 0 ? (
              <div className="stack compact">
                {result.qualityChecks.map((check) => (
                  <p key={check.id} className="queue-meta">
                    {check.passed ? "PASS" : "FAIL"} · {check.label} · {(check.score * 100).toFixed(0)}%
                  </p>
                ))}
              </div>
            ) : null}
            {result.guardrailBlocked ? <p className="queue-meta">Guardrail: {result.guardrailReason || "Manual review required."}</p> : null}
          </div>

          {result.attempts.map((attempt, index) => (
            <div key={`${attempt.stage}:${index}`} className="queue-item">
              <p className="queue-title">
                Attempt {index + 1}: {attempt.stage}
              </p>
              <p className="queue-meta">
                {attempt.provider.toUpperCase()} · {attempt.model} · {attempt.status} · {attempt.latencyMs}ms
              </p>
              {attempt.error ? <p className="queue-body">{trim(attempt.error, 220)}</p> : null}
            </div>
          ))}
        </div>
      ) : (
        <p className="empty-line">Run a test to inspect provider attempts and generated text.</p>
      )}
    </article>
  );
}

function SystemContent() {
  const health = useQuery(api.system.health, {}) as
    | {
        metrics?: {
          providerRunsWindow: number;
          providerSuccess: number;
          providerErrors: number;
          providerErrorRate: number;
          providerFallbackRate: number;
          providerP95LatencyMs: number;
          openGuardrails: number;
          pendingOutbox: number;
          dueOutbox: number;
          failedOutboxRecent: number;
          followupDetections: number;
          followupConfirmationRate: number;
          followupDismissalRate: number;
          followupSent: number;
          followupFailed: number;
          followupOverdueCount: number;
        };
        alerts?: string[];
        runbooks?: Array<{
          title: string;
          key: string;
          steps: string;
        }>;
        latestProviderRuns: Array<{
          _id: string;
          provider: string;
          status: string;
          model: string;
          latencyMs: number;
          createdAt: number;
          error?: string;
        }>;
        latestEvents: Array<{
          _id: string;
          source: string;
          eventType: string;
          detail: string;
          createdAt: number;
        }>;
        latestTranscriptions?: Array<{
          _id: string;
          source: string;
          eventType: string;
          detail: string;
          createdAt: number;
        }>;
      }
    | undefined;
  const healthLoading = health === undefined;
  const providerRuns = health?.latestProviderRuns || [];
  const latestEvents = health?.latestEvents || [];
  const latestTranscriptions = health?.latestTranscriptions || [];
  const metrics = health?.metrics;
  const alerts = health?.alerts || [];
  const runbooks = health?.runbooks || [];

  return (
    <section className="panel-grid two-col">
      <AiTestBench />

      <article className="panel-card">
        <h3>SLO Snapshot</h3>
        {healthLoading ? (
          <p className="empty-line">Loading SLO metrics…</p>
        ) : metrics ? (
          <div className="stack">
            <p className="queue-meta">
              Provider success/error: {metrics.providerSuccess}/{metrics.providerErrors} (window {metrics.providerRunsWindow})
            </p>
            <p className="queue-meta">Provider error rate: {(metrics.providerErrorRate * 100).toFixed(1)}%</p>
            <p className="queue-meta">Fallback rate: {(metrics.providerFallbackRate * 100).toFixed(1)}%</p>
            <p className="queue-meta">P95 provider latency: {Math.round(metrics.providerP95LatencyMs)}ms</p>
            <p className="queue-meta">Open guardrails: {metrics.openGuardrails}</p>
            <p className="queue-meta">Outbox pending/due: {metrics.pendingOutbox}/{metrics.dueOutbox}</p>
            <p className="queue-meta">Recent failed outbox items: {metrics.failedOutboxRecent}</p>
            <p className="queue-meta">Follow-up detections: {metrics.followupDetections}</p>
            <p className="queue-meta">Follow-up confirmation rate: {(metrics.followupConfirmationRate * 100).toFixed(1)}%</p>
            <p className="queue-meta">Follow-up dismissal rate: {(metrics.followupDismissalRate * 100).toFixed(1)}%</p>
            <p className="queue-meta">Follow-up sent/failed: {metrics.followupSent}/{metrics.followupFailed}</p>
            <p className="queue-meta">Overdue follow-ups: {metrics.followupOverdueCount}</p>
          </div>
        ) : (
          <p className="empty-line">No metrics yet.</p>
        )}
      </article>

      <article className="panel-card">
        <h3>Active Alerts</h3>
        <div className="stack">
          {healthLoading ? <p className="empty-line">Loading alerts…</p> : null}
          {alerts.map((alert, index) => (
            <div key={`${index}:${alert}`} className="queue-item">
              <p className="queue-body">{alert}</p>
            </div>
          ))}
          {!healthLoading && alerts.length === 0 ? <p className="empty-line">No active alerts.</p> : null}
        </div>
      </article>

      <article className="panel-card">
        <h3>Provider Runs</h3>
        <div className="stack">
          {healthLoading ? <p className="empty-line">Loading provider runs…</p> : null}
          {providerRuns.map((run) => (
            <div key={run._id} className="queue-item">
              <p className="queue-title">
                {run.provider.toUpperCase()} · {run.status}
              </p>
              <p className="queue-meta">
                Model: {run.model} · Latency: {run.latencyMs}ms · {formatDateTime(run.createdAt)}
              </p>
              {run.error ? <p className="queue-body">{trim(run.error, 180)}</p> : null}
            </div>
          ))}
          {!healthLoading && providerRuns.length === 0 ? <p className="empty-line">No provider runs logged yet.</p> : null}
        </div>
      </article>

      <article className="panel-card">
        <h3>Transcription Runs</h3>
        <div className="stack">
          {healthLoading ? <p className="empty-line">Loading transcription runs…</p> : null}
          {latestTranscriptions.map((event) => (
            <div key={event._id} className="queue-item">
              <p className="queue-title">{event.eventType}</p>
              <p className="queue-body">{trim(event.detail, 520)}</p>
              <p className="queue-meta">{formatDateTime(event.createdAt)}</p>
            </div>
          ))}
          {!healthLoading && latestTranscriptions.length === 0 ? (
            <p className="empty-line">No transcription runs captured yet.</p>
          ) : null}
        </div>
      </article>

      <article className="panel-card">
        <h3>System Events</h3>
        <div className="stack">
          {healthLoading ? <p className="empty-line">Loading system events…</p> : null}
          {latestEvents.map((event) => (
            <div key={event._id} className="queue-item">
              <p className="queue-title">
                {event.source} · {event.eventType}
              </p>
              <p className="queue-body">{trim(event.detail, 180)}</p>
              <p className="queue-meta">{formatDateTime(event.createdAt)}</p>
            </div>
          ))}
          {!healthLoading && latestEvents.length === 0 ? <p className="empty-line">No events captured yet.</p> : null}
        </div>
      </article>

      <article className="panel-card">
        <h3>Runbooks</h3>
        <div className="stack">
          {healthLoading ? <p className="empty-line">Loading runbooks…</p> : null}
          {runbooks.map((book) => (
            <div key={book.key} className="queue-item">
              <p className="queue-title">{book.title}</p>
              <p className="queue-body">{book.steps}</p>
            </div>
          ))}
          {!healthLoading && runbooks.length === 0 ? <p className="empty-line">No runbooks defined.</p> : null}
        </div>
      </article>
    </section>
  );
}

export function LiveSystem() {
  return <SystemContent />;
}
