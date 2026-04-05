import { DashboardShell } from "@/components/dashboard-shell";
import { SetupNotice } from "@/components/setup-notice";
import { getSystemPageData } from "@/lib/data";
import { formatDateTime, trim } from "@/lib/format";

type ProviderRun = {
  _id: string;
  provider: string;
  status: string;
  model: string;
  latencyMs: number;
  createdAt: number;
  error?: string;
};

type SystemEvent = {
  _id: string;
  source: string;
  eventType: string;
  detail: string;
  createdAt: number;
};

export default async function SystemPage() {
  const data = await getSystemPageData();
  const autonomyPaused = Boolean(data.health?.config?.autonomyPaused);

  return (
    <DashboardShell
      title="System"
      subtitle="Watch runtime health, provider traces, and message lifecycle events."
      autonomyPaused={autonomyPaused}
    >
      {!data.ready ? <SetupNotice error={data.error} /> : null}

      <section className="panel-grid two-col">
        <article className="panel-card">
          <h3>Provider Runs</h3>
          <div className="stack">
            {((data.health?.latestProviderRuns || []) as ProviderRun[]).map((run) => (
              <div key={run._id} className="queue-item">
                <p className="queue-title">{run.provider.toUpperCase()} · {run.status}</p>
                <p className="queue-meta">
                  Model: {run.model} · Latency: {run.latencyMs}ms · {formatDateTime(run.createdAt)}
                </p>
                {run.error ? <p className="queue-body">{trim(run.error, 180)}</p> : null}
              </div>
            ))}
            {(data.health?.latestProviderRuns || []).length === 0 ? <p className="empty-line">No provider runs logged yet.</p> : null}
          </div>
        </article>

        <article className="panel-card">
          <h3>System Events</h3>
          <div className="stack">
            {((data.health?.latestEvents || []) as SystemEvent[]).map((event) => (
              <div key={event._id} className="queue-item">
                <p className="queue-title">{event.source} · {event.eventType}</p>
                <p className="queue-body">{trim(event.detail, 180)}</p>
                <p className="queue-meta">{formatDateTime(event.createdAt)}</p>
              </div>
            ))}
            {(data.health?.latestEvents || []).length === 0 ? <p className="empty-line">No events captured yet.</p> : null}
          </div>
        </article>
      </section>
    </DashboardShell>
  );
}
