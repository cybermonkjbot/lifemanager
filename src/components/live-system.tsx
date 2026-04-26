"use client";

import { ActionNotices } from "@/components/action-notices";
import { LoadingBlock } from "@/components/loading-state";
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
    | `${string}_judge_azure`
    | `${string}_judge_codex`;
  model: string;
  status: "success" | "error";
  latencyMs: number;
  error?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  usageSource?: "provider" | "estimated";
  estimatedCostUsd?: number;
  costCurrency?: "USD";
  pricingVersion?: string;
};

type TestResult = {
  replyText: string;
  provider: "azure" | "codex" | "heuristic";
  model: string;
  latencyMs: number;
  guardrailBlocked: boolean;
  guardrailReason?: string;
  attempts: TestAttempt[];
  contextToolCalls?: Array<{
    name: string;
    latencyMs: number;
    input?: Record<string, unknown>;
    output?: Record<string, unknown>;
  }>;
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
  activeDynamicStylePackIds?: string[];
  conversationStyleMatrix?: {
    relationship: string;
    register: string;
    politeness: string;
    energy: string;
    localeDialect: string;
    interactionMove: string;
    riskSensitivity: string;
    confidence: number;
    reasonCodes: string[];
    dynamicStylePackIds: string[];
    emojiTextPolicy: string;
  } | null;
  createdAt: number;
  usedThreadContext: boolean;
};

type KnownContact = {
  _id: string;
  jid: string;
  title?: string;
};

type SystemTab = "overview" | "testAi" | "runs" | "events";

const SYSTEM_TABS: Array<{ id: SystemTab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "testAi", label: "AI Test" },
  { id: "runs", label: "Runs" },
  { id: "events", label: "Events" },
];
const MAX_TEST_AI_MESSAGE_CHARS = 8000;

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
            maxLength={MAX_TEST_AI_MESSAGE_CHARS}
            disabled={record.pending}
            aria-disabled={record.pending}
          />
          <span className="queue-meta">
            {message.length}/{MAX_TEST_AI_MESSAGE_CHARS} characters
          </span>
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
            {result.conversationStyleMatrix ? (
              <p className="queue-meta">
                Style matrix: {result.conversationStyleMatrix.relationship} · {result.conversationStyleMatrix.register} ·{" "}
                {result.conversationStyleMatrix.interactionMove} · {result.conversationStyleMatrix.riskSensitivity} · emoji{" "}
                {result.conversationStyleMatrix.emojiTextPolicy}
              </p>
            ) : null}
            {result.activeDynamicStylePackIds?.length ? (
              <p className="queue-meta">Dynamic packs: {result.activeDynamicStylePackIds.join(", ")}</p>
            ) : null}
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
            {result.guardrailBlocked ? <p className="queue-meta">Safety rule: {result.guardrailReason || "Manual review required."}</p> : null}
          </div>

          {result.attempts.map((attempt, index) => (
            <div key={`${attempt.stage}:${index}`} className="queue-item">
              <p className="queue-title">
                Attempt {index + 1}: {attempt.stage}
              </p>
              <p className="queue-meta">
                {attempt.provider.toUpperCase()} · {attempt.model} · {attempt.status} · {attempt.latencyMs}ms
              </p>
              {attempt.totalTokens !== undefined || attempt.inputTokens !== undefined || attempt.outputTokens !== undefined ? (
                <p className="queue-meta">
                  Tokens in/out/total: {attempt.inputTokens ?? 0}/{attempt.outputTokens ?? 0}/
                  {attempt.totalTokens ?? (attempt.inputTokens ?? 0) + (attempt.outputTokens ?? 0)}
                  {attempt.usageSource ? ` · ${attempt.usageSource}` : ""}
                </p>
              ) : null}
              {attempt.estimatedCostUsd !== undefined ? (
                <p className="queue-meta">Estimated cost: ${attempt.estimatedCostUsd.toFixed(6)}</p>
              ) : null}
              {attempt.error ? <p className="queue-body">{trim(attempt.error, 220)}</p> : null}
            </div>
          ))}

          {Array.isArray(result.contextToolCalls) && result.contextToolCalls.length > 0 ? (
            <div className="queue-item">
              <p className="queue-title">Tool Calls</p>
              <div className="stack compact">
                {result.contextToolCalls.map((call, index) => {
                  const toolRationale =
                    call.input && typeof call.input.toolRationale === "string" ? call.input.toolRationale : "";
                  const reasoningSummary =
                    call.input && typeof call.input.reasoningSummary === "string" ? call.input.reasoningSummary : "";
                  const safeInput = JSON.stringify(call.input || {});
                  const safeOutput = JSON.stringify(call.output || {});
                  return (
                    <div key={`${call.name}:${index}`} className="stack compact">
                      <p className="queue-meta">
                        {index + 1}. {call.name} · {call.latencyMs}ms
                      </p>
                      {toolRationale ? <p className="queue-meta">Rationale: {trim(toolRationale, 220)}</p> : null}
                      {reasoningSummary ? <p className="queue-meta">Reasoning summary: {trim(reasoningSummary, 220)}</p> : null}
                      <p className="queue-meta">Input: {trim(safeInput, 260)}</p>
                      <p className="queue-meta">Output: {trim(safeOutput, 260)}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="empty-line">Run a test to inspect provider attempts and generated text.</p>
      )}
    </article>
  );
}

function SystemContent() {
  const [tab, setTab] = useState<SystemTab>("overview");
  const health = useQuery(api.system.health, {}) as
    | {
        metrics?: {
          providerRunsWindow: number;
          providerSuccess: number;
          providerErrors: number;
          providerErrorRate: number;
          providerFallbackRate: number;
          providerP95LatencyMs: number;
          providerInputTokens: number;
          providerOutputTokens: number;
          providerTotalTokens: number;
          providerTokenizedRuns: number;
          providerEstimatedCostUsd: number;
          providerPricedRuns: number;
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
          inputTokens?: number;
          outputTokens?: number;
          totalTokens?: number;
          usageSource?: "provider" | "estimated";
          estimatedCostUsd?: number;
          costCurrency?: "USD";
          pricingVersion?: string;
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
  const showOverview = tab === "overview";
  const showTestAi = tab === "testAi";
  const showRuns = tab === "runs";
  const showEvents = tab === "events";

  return (
    <section className="stack">
      <div className="queue-focus-tabs" role="tablist" aria-label="System sections">
        {SYSTEM_TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={`btn ${tab === item.id ? "btn-primary" : "btn-ghost"}`}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="panel-grid two-col">
        {showTestAi ? <AiTestBench /> : null}

        {showOverview ? (
          <article className="panel-card">
            <h3>SLO Snapshot</h3>
            {healthLoading ? (
              <LoadingBlock label="Loading SLO metrics…" rows={4} />
            ) : metrics ? (
              <div className="stack">
                <p className="queue-meta">
                  Provider success/error: {metrics.providerSuccess}/{metrics.providerErrors} (window {metrics.providerRunsWindow})
                </p>
                <p className="queue-meta">Provider error rate: {(metrics.providerErrorRate * 100).toFixed(1)}%</p>
                <p className="queue-meta">Fallback rate: {(metrics.providerFallbackRate * 100).toFixed(1)}%</p>
                <p className="queue-meta">P95 provider latency: {Math.round(metrics.providerP95LatencyMs)}ms</p>
                <p className="queue-meta">
                  Provider tokens (in/out/total): {metrics.providerInputTokens}/{metrics.providerOutputTokens}/{metrics.providerTotalTokens}
                </p>
                <p className="queue-meta">
                  Estimated AI cost (window): ${metrics.providerEstimatedCostUsd.toFixed(6)} ({metrics.providerPricedRuns} priced runs)
                </p>
                <p className="queue-meta">Open safety flags: {metrics.openGuardrails}</p>
                <p className="queue-meta">Outbox pending/due: {metrics.pendingOutbox}/{metrics.dueOutbox}</p>
                <p className="queue-meta">Recent failed outbox items: {metrics.failedOutboxRecent}</p>
                <p className="queue-meta">Follow-up detections: {metrics.followupDetections}</p>
                <p className="queue-meta">Follow-up confirmation rate: {(metrics.followupConfirmationRate * 100).toFixed(1)}%</p>
                <p className="queue-meta">Follow-up dismissal rate: {(metrics.followupDismissalRate * 100).toFixed(1)}%</p>
                <p className="queue-meta">Follow-up sent/failed: {metrics.followupSent}/{metrics.followupFailed}</p>
                <p className="queue-meta">Overdue follow-ups: {metrics.followupOverdueCount}</p>
              </div>
            ) : (
              <p className="empty-line">No runtime metrics captured yet.</p>
            )}
          </article>
        ) : null}

        {showOverview ? (
          <article className="panel-card">
            <h3>Active Alerts</h3>
            <div className="stack">
              {healthLoading ? <LoadingBlock label="Loading alerts…" rows={2} compact /> : null}
              {alerts.map((alert, index) => (
                <div key={`${index}:${alert}`} className="queue-item">
                  <p className="queue-body">{alert}</p>
                </div>
              ))}
              {!healthLoading && alerts.length === 0 ? <p className="empty-line">No active system alerts.</p> : null}
            </div>
          </article>
        ) : null}

        {showRuns ? (
          <article className="panel-card">
            <h3>Provider Runs</h3>
            <div className="stack">
              {healthLoading ? <LoadingBlock label="Loading provider runs…" rows={3} compact /> : null}
              {providerRuns.map((run) => (
                <div key={run._id} className="queue-item">
                  <p className="queue-title">
                    {run.provider.toUpperCase()} · {run.status}
                  </p>
                  <p className="queue-meta">
                    Model: {run.model} · Latency: {run.latencyMs}ms · {formatDateTime(run.createdAt)}
                  </p>
                  {run.totalTokens !== undefined || run.inputTokens !== undefined || run.outputTokens !== undefined ? (
                    <p className="queue-meta">
                      Tokens in/out/total: {run.inputTokens ?? 0}/{run.outputTokens ?? 0}/
                      {run.totalTokens ?? (run.inputTokens ?? 0) + (run.outputTokens ?? 0)}
                      {run.usageSource ? ` · ${run.usageSource}` : ""}
                    </p>
                  ) : null}
                  {run.estimatedCostUsd !== undefined ? <p className="queue-meta">Estimated cost: ${run.estimatedCostUsd.toFixed(6)}</p> : null}
                  {run.error ? <p className="queue-body">{trim(run.error, 180)}</p> : null}
                </div>
              ))}
              {!healthLoading && providerRuns.length === 0 ? <p className="empty-line">No provider attempts logged yet.</p> : null}
            </div>
          </article>
        ) : null}

        {showRuns ? (
          <article className="panel-card">
            <h3>Transcription Runs</h3>
            <div className="stack">
              {healthLoading ? <LoadingBlock label="Loading transcription runs…" rows={2} compact /> : null}
              {latestTranscriptions.map((event) => (
                <div key={event._id} className="queue-item">
                  <p className="queue-title">{event.eventType}</p>
                  <p className="queue-body">{trim(event.detail, 520)}</p>
                  <p className="queue-meta">{formatDateTime(event.createdAt)}</p>
                </div>
              ))}
              {!healthLoading && latestTranscriptions.length === 0 ? (
                <p className="empty-line">No transcription attempts captured yet.</p>
              ) : null}
            </div>
          </article>
        ) : null}

        {showEvents ? (
          <article className="panel-card">
            <h3>System Events</h3>
            <div className="stack">
              {healthLoading ? <LoadingBlock label="Loading system events…" rows={3} compact /> : null}
              {latestEvents.map((event) => (
                <div key={event._id} className="queue-item">
                  <p className="queue-title">
                    {event.source} · {event.eventType}
                  </p>
                  <p className="queue-body">{trim(event.detail, 180)}</p>
                  <p className="queue-meta">{formatDateTime(event.createdAt)}</p>
                </div>
              ))}
              {!healthLoading && latestEvents.length === 0 ? <p className="empty-line">No system events captured yet.</p> : null}
            </div>
          </article>
        ) : null}

        {showEvents ? (
          <article className="panel-card">
            <h3>Runbooks</h3>
            <div className="stack">
              {healthLoading ? <LoadingBlock label="Loading runbooks…" rows={2} compact /> : null}
              {runbooks.map((book) => (
                <div key={book.key} className="queue-item">
                  <p className="queue-title">{book.title}</p>
                  <p className="queue-body">{book.steps}</p>
                </div>
              ))}
              {!healthLoading && runbooks.length === 0 ? <p className="empty-line">No runbooks defined.</p> : null}
            </div>
          </article>
        ) : null}

        {showTestAi && !healthLoading && providerRuns.length === 0 && latestEvents.length === 0 ? (
          <article className="panel-card">
            <h3>System Snapshot</h3>
            <p className="empty-line">Runtime health data will appear here once provider and event logs are available.</p>
          </article>
        ) : null}
      </div>
    </section>
  );
}

export function LiveSystem() {
  return <SystemContent />;
}
