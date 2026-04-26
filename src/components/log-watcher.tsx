"use client";

import { LoadingBlock } from "@/components/loading-state";
import { formatDateTime, trim } from "@/lib/format";
import { api } from "../../convex/_generated/api";
import { useQuery } from "convex/react";
import { useState } from "react";

function sourceLabel(source: string) {
  if (source === "worker") return "Worker";
  if (source === "convex") return "Backend";
  if (source === "dashboard") return "UI";
  if (source === "ai") return "AI";
  return source;
}

type LogWatcherProps = {
  defaultExpanded?: boolean;
};

export function LogWatcher({ defaultExpanded = true }: LogWatcherProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const logs = useQuery(api.system.logFeed, { limit: 70 }) as
    | Array<{
        id: string;
        source: string;
        eventType: string;
        detail: string;
        createdAt: number;
        kind: "event" | "provider";
      }>
    | undefined;
  const logsLoading = logs === undefined;
  const logRows = logs || [];

  return (
    <section className={`logwatcher ${expanded ? "logwatcher-expanded" : "logwatcher-collapsed"}`} aria-live="polite">
      <div className="logwatcher-header">
        <div className="logwatcher-heading">
          <h3>Runtime Logs</h3>
          <p className="logwatcher-summary">
            {logsLoading ? "Connecting" : `${logRows.length} recent event${logRows.length === 1 ? "" : "s"}`}
          </p>
        </div>
        <button
          type="button"
          className="btn btn-icon logwatcher-toggle"
          aria-controls="runtime-log-list"
          aria-expanded={expanded}
          aria-label={expanded ? "Collapse runtime logs" : "Expand runtime logs"}
          onClick={() => setExpanded((current) => !current)}
        >
          <span className={`logwatcher-chevron ${expanded ? "logwatcher-chevron-down" : "logwatcher-chevron-up"}`} aria-hidden="true" />
        </button>
      </div>

      <div id="runtime-log-list" className="logwatcher-list" hidden={!expanded}>
        {logsLoading ? <LoadingBlock label="Connecting to runtime log stream…" rows={3} compact /> : null}
        {logRows.map((log) => (
          <div key={log.id} className="logwatcher-row">
            <p className="logwatcher-title">
              {sourceLabel(log.source)} · {log.eventType}
            </p>
            <p className="logwatcher-body">{trim(log.detail, 240)}</p>
            <p className="logwatcher-meta">{formatDateTime(log.createdAt)}</p>
          </div>
        ))}
        {!logsLoading && logRows.length === 0 ? <p className="empty-line">Waiting for runtime logs…</p> : null}
      </div>
    </section>
  );
}
