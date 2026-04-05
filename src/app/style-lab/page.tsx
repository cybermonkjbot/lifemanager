import { DashboardShell } from "@/components/dashboard-shell";
import { SetupNotice } from "@/components/setup-notice";
import { getStyleLabPageData, getSystemPageData } from "@/lib/data";

export default async function StyleLabPage() {
  const [data, systemData] = await Promise.all([getStyleLabPageData(), getSystemPageData()]);
  const autonomyPaused = Boolean(systemData.health?.config?.autonomyPaused);

  return (
    <DashboardShell
      title="Style Lab"
      subtitle="Tune mimicry and inspect learned writing traits."
      autonomyPaused={autonomyPaused}
    >
      {!data.ready ? <SetupNotice error={data.error} /> : null}

      <section className="panel-grid two-col">
        <article className="panel-card">
          <h3>Mimicry Control</h3>
          <p className="queue-meta">
            Current mimicry: {Math.round((data.profile?.mimicryLevel ?? 0.72) * 100)}%
          </p>
          <form action="/api/actions/set-mimicry" method="post" className="stack compact">
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              name="mimicryLevel"
              defaultValue={data.profile?.mimicryLevel ?? 0.72}
            />
            <button type="submit" className="btn btn-primary">
              Save Mimicry
            </button>
          </form>
        </article>

        <article className="panel-card">
          <h3>Learned Traits</h3>
          <div className="stack">
            <p className="queue-meta">Common phrases</p>
            <p>{(data.profile?.commonPhrases || []).join(", ") || "Not enough data yet."}</p>

            <p className="queue-meta">Spelling style</p>
            <p>{(data.profile?.spellingNotes || []).join(", ") || "No spelling profile yet."}</p>

            <p className="queue-meta">Humor markers</p>
            <p>{(data.profile?.humorNotes || []).join(", ") || "No humor markers yet."}</p>
          </div>
        </article>
      </section>
    </DashboardShell>
  );
}
