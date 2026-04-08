"use client";

import { formatDateTime, trim } from "@/lib/format";
import { api } from "../../convex/_generated/api";
import { useQuery } from "convex/react";

function sourceLabel(source: string) {
  if (source === "worker") return "Worker";
  if (source === "convex") return "Backend";
  if (source === "dashboard") return "UI";
  if (source === "ai") return "AI";
  return source;
}

export function LogWatcher() {
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
    <section className="logwatcher" aria-live="polite">
      <div className="logwatcher-header">
        <h3>Runtime Logs</h3>
      </div>

      <div className="logwatcher-list">
        {logsLoading ? <p className="empty-line">Connecting to runtime log stream…</p> : null}
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
