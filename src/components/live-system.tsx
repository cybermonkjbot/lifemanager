"use client";

import { formatDateTime, trim } from "@/lib/format";
import { api } from "../../convex/_generated/api";
import { useQuery } from "convex/react";

function SystemContent() {
  const health = useQuery(api.system.health, {}) as
    | {
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
      }
    | undefined;

  return (
    <section className="panel-grid two-col">
      <article className="panel-card">
        <h3>Provider Runs</h3>
        <div className="stack">
          {(health?.latestProviderRuns || []).map((run) => (
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
          {(health?.latestProviderRuns || []).length === 0 ? <p className="empty-line">No provider runs logged yet.</p> : null}
        </div>
      </article>

      <article className="panel-card">
        <h3>System Events</h3>
        <div className="stack">
          {(health?.latestEvents || []).map((event) => (
            <div key={event._id} className="queue-item">
              <p className="queue-title">
                {event.source} · {event.eventType}
              </p>
              <p className="queue-body">{trim(event.detail, 180)}</p>
              <p className="queue-meta">{formatDateTime(event.createdAt)}</p>
            </div>
          ))}
          {(health?.latestEvents || []).length === 0 ? <p className="empty-line">No events captured yet.</p> : null}
        </div>
      </article>
    </section>
  );
}

export function LiveSystem() {
  return <SystemContent />;
}
