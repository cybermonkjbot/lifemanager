import { DashboardShell } from "@/components/dashboard-shell";
import { SetupNotice } from "@/components/setup-notice";
import { getRulesPageData, getSystemPageData } from "@/lib/data";

export default async function RulesPage() {
  const [data, systemData] = await Promise.all([getRulesPageData(), getSystemPageData()]);
  const autonomyPaused = Boolean(systemData.health?.config?.autonomyPaused);

  return (
    <DashboardShell
      title="Rules"
      subtitle="Control ignores, initiation boundaries, and safety defaults."
      autonomyPaused={autonomyPaused}
    >
      {!data.ready ? <SetupNotice error={data.error} /> : null}

      <section className="panel-grid two-col">
        <article className="panel-card">
          <h3>Add Ignore Contact</h3>
          <form action="/api/actions/toggle-ignore-contact" method="post" className="stack compact">
            <input type="text" name="targetValue" placeholder="12345@s.whatsapp.net" required />
            <input type="hidden" name="enabled" value="true" />
            <button type="submit" className="btn btn-primary">
              Add Ignore Rule
            </button>
          </form>
        </article>

        <article className="panel-card">
          <h3>Active Ignore Rules</h3>
          <div className="stack">
            {(data.rules?.ignoreRules || []).map((rule: any) => (
              <div key={rule._id} className="queue-item">
                <p className="queue-title">{rule.targetType}</p>
                <p className="queue-body">{rule.targetValue}</p>
                <p className="queue-meta">Enabled: {rule.enabled ? "Yes" : "No"}</p>
              </div>
            ))}
            {(data.rules?.ignoreRules || []).length === 0 ? <p className="empty-line">No ignore rules yet.</p> : null}
          </div>
        </article>
      </section>
    </DashboardShell>
  );
}
