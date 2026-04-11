"use client";

import { LoadingBlock } from "@/components/loading-state";
import { formatDateTime, trim } from "@/lib/format";
import { api } from "../../convex/_generated/api";
import { useQuery } from "convex/react";
import { useMemo, useState } from "react";

type ServiceLogRow = {
  id: string;
  source: string;
  eventType: string;
  detail: string;
  createdAt: number;
  kind: "event" | "provider";
};

type ServiceNode = {
  id: string;
  label: string;
  size: "xl" | "lg" | "md" | "sm" | "xs";
  zone: string;
  description: string;
  x: number;
  y: number;
  sources: string[];
  keywords: string[];
  sourceFallback?: boolean;
};

type ServiceLink = {
  from: string;
  to: string;
};

const SERVICES: ServiceNode[] = [
  {
    id: "contacts",
    label: "External Contacts",
    size: "md",
    zone: "Ingress",
    description: "Real users sending text or voice messages into the system entry point.",
    x: 7,
    y: 50,
    sources: ["worker"],
    keywords: ["inbound", "contact", "jid", "message"],
    sourceFallback: false,
  },
  {
    id: "whatsapp",
    label: "WhatsApp Bridge",
    size: "lg",
    zone: "Ingress",
    description: "Maintains the WhatsApp session and receives events before internal processing.",
    x: 19,
    y: 50,
    sources: ["worker"],
    keywords: ["whatsapp", "socket", "session", "pair", "qr", "auth"],
    sourceFallback: true,
  },
  {
    id: "setup-runtime",
    label: "Setup Runtime",
    size: "xs",
    zone: "Setup",
    description: "Handles QR/pairing orchestration and listener state while bootstrapping connectivity.",
    x: 19,
    y: 23,
    sources: ["dashboard", "worker"],
    keywords: ["setup", "pairing", "qr", "listener", "connected", "session"],
    sourceFallback: true,
  },
  {
    id: "worker",
    label: "Worker Runtime",
    size: "xl",
    zone: "Orchestration",
    description: "Coordinates jobs, runs handlers, and fans events out to AI, rules, and storage.",
    x: 33,
    y: 24,
    sources: ["worker"],
    keywords: ["worker", "queue", "runtime", "job", "dispatch", "thread"],
    sourceFallback: true,
  },
  {
    id: "inbound-ingest",
    label: "Inbound Ingest",
    size: "sm",
    zone: "Ingestion",
    description: "Normalizes inbound payloads, deduplicates messages, and prepares thread state for processing.",
    x: 33,
    y: 49,
    sources: ["worker", "convex"],
    keywords: ["inbound.", "ingest", "duplicate", "thread", "unsupported"],
    sourceFallback: false,
  },
  {
    id: "history-sync",
    label: "History Sync",
    size: "xs",
    zone: "Memory",
    description: "Backfills historical conversation data for stronger context recall.",
    x: 33,
    y: 86,
    sources: ["worker", "convex"],
    keywords: ["history", "sync", "backfill", "history_fetch", "history_sync"],
    sourceFallback: false,
  },
  {
    id: "transcription",
    label: "Transcription",
    size: "md",
    zone: "Media",
    description: "Converts inbound audio into text that downstream systems can reason about.",
    x: 33,
    y: 72,
    sources: ["worker", "convex"],
    keywords: ["audio", "transcription", "transcribed", "stt", "voice"],
    sourceFallback: false,
  },
  {
    id: "status-policy",
    label: "Status Policy",
    size: "xs",
    zone: "Policy",
    description: "Applies status-specific reaction and skip rules before generating full replies.",
    x: 17,
    y: 73,
    sources: ["worker"],
    keywords: ["inbound.status", "status.", "reaction", "sticker", "status@broadcast"],
    sourceFallback: false,
  },
  {
    id: "rules",
    label: "Rules + Guardrails",
    size: "xl",
    zone: "Policy",
    description: "Applies safety checks and communication boundaries before messages ship.",
    x: 51,
    y: 24,
    sources: ["convex", "worker", "ai"],
    keywords: ["guardrail", "rule", "policy", "blocked", "safe", "violation"],
    sourceFallback: false,
  },
  {
    id: "context-memory",
    label: "Context Memory",
    size: "sm",
    zone: "Reasoning",
    description: "Builds recall windows from chat history, embeddings, and retrieval heuristics.",
    x: 51,
    y: 45,
    sources: ["worker", "convex", "ai"],
    keywords: ["context", "recall", "history", "search", "memory", "embedding", "rerank"],
    sourceFallback: false,
  },
  {
    id: "ai",
    label: "AI Providers",
    size: "xl",
    zone: "Reasoning",
    description: "Runs model inference with Azure/Codex/heuristic fallback and provider telemetry.",
    x: 69,
    y: 24,
    sources: ["ai"],
    keywords: ["provider.", "azure", "codex", "heuristic", "model"],
    sourceFallback: true,
  },
  {
    id: "quality-gate",
    label: "Quality Gate",
    size: "xs",
    zone: "Policy",
    description: "Scores drafts for tone/risk alignment and triggers manual review when confidence drops.",
    x: 69,
    y: 41,
    sources: ["worker", "ai"],
    keywords: ["quality", "manual review", "rewrite", "score", "blocked"],
    sourceFallback: false,
  },
  {
    id: "convex",
    label: "Convex Backend",
    size: "xl",
    zone: "Data",
    description: "Holds system state, queue records, and health traces for all services.",
    x: 51,
    y: 63,
    sources: ["convex"],
    keywords: [],
    sourceFallback: true,
  },
  {
    id: "persona-style",
    label: "Persona Style",
    size: "xs",
    zone: "Tone",
    description: "Maintains persona packs, style memory, and humor-learning controls used during generation.",
    x: 51,
    y: 83,
    sources: ["convex"],
    keywords: ["persona", "style", "humor", "profile", "tone"],
    sourceFallback: false,
  },
  {
    id: "outbox",
    label: "Outbox Scheduler",
    size: "lg",
    zone: "Delivery",
    description: "Schedules and dispatches pending messages while tracking retry and failure state.",
    x: 69,
    y: 63,
    sources: ["convex", "worker"],
    keywords: ["outbox", "send", "delivery", "dispatch", "failed", "typing", "deferred", "claim"],
    sourceFallback: false,
  },
  {
    id: "ghost-mode",
    label: "Ghost Mode",
    size: "xs",
    zone: "Safety",
    description: "Suppresses sends after manual interruption and protects against accidental follow-on replies.",
    x: 83,
    y: 50,
    sources: ["convex"],
    keywords: ["ghost_mode", "manual_intervention", "suppressed"],
    sourceFallback: false,
  },
  {
    id: "followups",
    label: "Follow-up Promoter",
    size: "md",
    zone: "Retention",
    description: "Promotes due reminders into actionable outreach tasks for the operator.",
    x: 85,
    y: 63,
    sources: ["convex", "worker", "dashboard"],
    keywords: ["followup.", "follow-up", "promote", "snooze", "reschedule", "overdue", "dismissed", "confirmed"],
    sourceFallback: false,
  },
  {
    id: "todo-candidates",
    label: "TODO Candidates",
    size: "xs",
    zone: "Planning",
    description: "Extracts actionable todo suggestions from conversation turns and follow-up intent.",
    x: 85,
    y: 81,
    sources: ["convex"],
    keywords: ["todo", "task", "candidate", "actionable"],
    sourceFallback: false,
  },
  {
    id: "outreach-cron",
    label: "Outreach Cron",
    size: "xs",
    zone: "Retention",
    description: "Runs scheduled proactive check-ins and queues outreach batches when cadence rules allow.",
    x: 69,
    y: 82,
    sources: ["convex", "worker"],
    keywords: ["outreach", "proactive", "batch", "queued", "cadence"],
    sourceFallback: false,
  },
  {
    id: "dashboard",
    label: "Dashboard UI",
    size: "lg",
    zone: "Operator",
    description: "Where operators inspect state, approve actions, and trigger workflow controls.",
    x: 86,
    y: 24,
    sources: ["dashboard"],
    keywords: ["autonomy", "dashboard", "operator", "action", "approve", "pause"],
    sourceFallback: true,
  },
];

const LINKS: ServiceLink[] = [
  { from: "contacts", to: "whatsapp" },
  { from: "dashboard", to: "setup-runtime" },
  { from: "setup-runtime", to: "whatsapp" },
  { from: "whatsapp", to: "worker" },
  { from: "whatsapp", to: "inbound-ingest" },
  { from: "worker", to: "inbound-ingest" },
  { from: "inbound-ingest", to: "history-sync" },
  { from: "inbound-ingest", to: "transcription" },
  { from: "inbound-ingest", to: "status-policy" },
  { from: "inbound-ingest", to: "rules" },
  { from: "transcription", to: "rules" },
  { from: "status-policy", to: "rules" },
  { from: "worker", to: "context-memory" },
  { from: "history-sync", to: "context-memory" },
  { from: "rules", to: "context-memory" },
  { from: "context-memory", to: "ai" },
  { from: "rules", to: "ai" },
  { from: "ai", to: "quality-gate" },
  { from: "quality-gate", to: "convex" },
  { from: "ai", to: "convex" },
  { from: "convex", to: "persona-style" },
  { from: "persona-style", to: "ai" },
  { from: "rules", to: "outbox" },
  { from: "convex", to: "outbox" },
  { from: "outbox", to: "ghost-mode" },
  { from: "ghost-mode", to: "followups" },
  { from: "outbox", to: "followups" },
  { from: "followups", to: "todo-candidates" },
  { from: "convex", to: "todo-candidates" },
  { from: "convex", to: "outreach-cron" },
  { from: "outreach-cron", to: "outbox" },
  { from: "ai", to: "dashboard" },
  { from: "convex", to: "dashboard" },
  { from: "followups", to: "dashboard" },
  { from: "todo-candidates", to: "dashboard" },
];

const EMPTY_LOGS: ServiceLogRow[] = [];
const COMPACT_SIZES = new Set<ServiceNode["size"]>(["sm", "xs"]);

function matchesServiceLog(service: ServiceNode, row: ServiceLogRow) {
  if (!service.sources.includes(row.source)) {
    return false;
  }

  if (service.keywords.length === 0) {
    return true;
  }

  const haystack = `${row.eventType} ${row.detail}`.toLowerCase();
  const keywordMatch = service.keywords.some((keyword) => haystack.includes(keyword));

  if (keywordMatch) {
    return true;
  }

  return Boolean(service.sourceFallback);
}

function classifyNodeStatus(latestAt: number | undefined) {
  if (!latestAt) return "idle";
  const minutesAgo = (Date.now() - latestAt) / 1000 / 60;
  if (minutesAgo <= 10) return "active";
  if (minutesAgo <= 45) return "warm";
  return "quiet";
}

function statusLabel(status: string) {
  if (status === "active") return "Live";
  if (status === "warm") return "Warm";
  if (status === "quiet") return "Quiet";
  return "Idle";
}

function describeLink(a: string, b: string) {
  const source = SERVICES.find((service) => service.id === a);
  const target = SERVICES.find((service) => service.id === b);
  if (!source || !target) return `${a} -> ${b}`;
  return `${source.label} -> ${target.label}`;
}

function isCompactSize(size: ServiceNode["size"]) {
  return COMPACT_SIZES.has(size);
}

export function LiveSystemsDesign() {
  const logs = useQuery(api.system.logFeed, { limit: 160 }) as ServiceLogRow[] | undefined;
  const rows = logs ?? EMPTY_LOGS;
  const loading = logs === undefined;

  const logsByService = useMemo(() => {
    const next: Record<string, ServiceLogRow[]> = {};
    for (const service of SERVICES) {
      next[service.id] = rows.filter((row) => matchesServiceLog(service, row)).slice(0, 24);
    }
    return next;
  }, [rows]);

  const [activeServiceId, setActiveServiceId] = useState<string>(SERVICES[0].id);
  const activeService = SERVICES.find((service) => service.id === activeServiceId) || SERVICES[0];
  const activeLogs = logsByService[activeService.id] || [];
  const relatedLinks = LINKS.filter((link) => link.from === activeService.id || link.to === activeService.id);
  const connectedServiceIds = Array.from(
    new Set(
      relatedLinks.flatMap((link) => {
        if (link.from === activeService.id) return [link.to];
        if (link.to === activeService.id) return [link.from];
        return [];
      }),
    ),
  );

  return (
    <section className="systems-design-shell">
      <article className="panel-card">
        <h3>Topology Canvas</h3>
        <p className="queue-meta">
          Click any node to inspect its role and latest runtime logs.
        </p>
      </article>

      <section className="systems-design-stage" aria-live="polite">
        <div className="systems-design-canvas" role="region" aria-label="System topology canvas">
          <svg className="systems-link-layer" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            {LINKS.map((link) => {
              const from = SERVICES.find((service) => service.id === link.from);
              const to = SERVICES.find((service) => service.id === link.to);
              if (!from || !to) return null;
              const fromCompact = isCompactSize(from.size);
              const toCompact = isCompactSize(to.size);
              const involvesCompact = fromCompact || toCompact;
              const compactEndpointSelected =
                (fromCompact && link.from === activeService.id) || (toCompact && link.to === activeService.id);
              if (involvesCompact && !compactEndpointSelected) {
                return null;
              }
              const active = link.from === activeService.id || link.to === activeService.id;
              const compact = fromCompact || toCompact;
              const dotRadius = compact ? (active ? 0.6 : 0.45) : active ? 0.75 : 0.6;
              return (
                <g key={`${link.from}:${link.to}`}>
                  <line
                    x1={from.x}
                    y1={from.y}
                    x2={to.x}
                    y2={to.y}
                    className={`systems-link ${compact ? "systems-link-compact" : ""} ${active ? "systems-link-active" : ""}`}
                  />
                  <circle
                    cx={to.x}
                    cy={to.y}
                    r={dotRadius}
                    className={`systems-link-dot ${compact ? "systems-link-dot-compact" : ""} ${active ? "systems-link-dot-active" : ""}`}
                  />
                </g>
              );
            })}
          </svg>

          {SERVICES.map((service) => {
            const serviceLogs = logsByService[service.id] || [];
            const status = classifyNodeStatus(serviceLogs[0]?.createdAt);
            const active = service.id === activeService.id;
            const compact = isCompactSize(service.size) && !active;
            return (
              <button
                key={service.id}
                type="button"
                className={`system-node system-node-size-${service.size} ${compact ? "system-node-compact" : ""} ${active ? "system-node-active" : ""}`}
                style={{ left: `${service.x}%`, top: `${service.y}%` }}
                onClick={() => setActiveServiceId(service.id)}
                aria-label={`Open details for ${service.label}`}
                aria-pressed={active}
              >
                <span className={`system-node-status status-${status}`}>{statusLabel(status)}</span>
                <span className="system-node-zone">{service.zone}</span>
                <strong className="system-node-label">{service.label}</strong>
                <span className="system-node-meta">{serviceLogs.length} recent log{serviceLogs.length === 1 ? "" : "s"}</span>
              </button>
            );
          })}
        </div>

        <aside className="systems-inspector" aria-label={`${activeService.label} details`}>
          <div className="systems-inspector-header">
            <p className="panel-kicker">Selected Service</p>
            <h4>{activeService.label}</h4>
            <p>{activeService.description}</p>
          </div>

          <div className="systems-chip-row" role="list" aria-label="Connected services">
            {connectedServiceIds.length === 0 ? (
              <span className="systems-chip">No direct links</span>
            ) : (
              connectedServiceIds.map((serviceId) => {
                const linked = SERVICES.find((service) => service.id === serviceId);
                if (!linked) return null;
                return (
                  <button
                    key={linked.id}
                    type="button"
                    className="systems-chip systems-chip-button"
                    onClick={() => setActiveServiceId(linked.id)}
                  >
                    {linked.label}
                  </button>
                );
              })
            )}
          </div>

          <div className="systems-link-list">
            {relatedLinks.map((link) => (
              <p key={`${link.from}:${link.to}`} className="queue-meta">
                {describeLink(link.from, link.to)}
              </p>
            ))}
          </div>

          <div className="systems-log-list">
            <p className="queue-title">Recent Logs</p>
            {loading ? <LoadingBlock label="Loading live logs…" rows={3} compact /> : null}
            {!loading && activeLogs.length === 0 ? <p className="empty-line">No logs mapped yet for this service.</p> : null}
            {activeLogs.slice(0, 10).map((row) => (
              <article key={`${row.id}:${row.createdAt}`} className="queue-item">
                <p className="queue-title">{row.eventType}</p>
                <p className="queue-body">{trim(row.detail, 220)}</p>
                <p className="queue-meta">
                  {row.source.toUpperCase()} · {formatDateTime(row.createdAt)}
                </p>
              </article>
            ))}
          </div>
        </aside>
      </section>
    </section>
  );
}
