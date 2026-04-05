import { DashboardShell } from "@/components/dashboard-shell";
import { SetupNotice } from "@/components/setup-notice";
import { getFollowupsPageData, getSystemPageData } from "@/lib/data";
import { formatDateTime } from "@/lib/format";

type FollowupItem = {
  _id: string;
  reason: string;
  dueAt: number;
  status: string;
  thread?: { title?: string; jid?: string } | null;
};

export default async function FollowupsPage() {
  const [data, systemData] = await Promise.all([getFollowupsPageData(), getSystemPageData()]);
  const autonomyPaused = Boolean(systemData.health?.config?.autonomyPaused);

  return (
    <DashboardShell
      title="Follow-ups"
      subtitle="Track promise-based outreach and confirm before send."
      autonomyPaused={autonomyPaused}
    >
      {!data.ready ? <SetupNotice error={data.error} /> : null}

      <section className="panel-card">
        <h3>Follow-up Timeline</h3>
        <div className="stack">
          {((data.followups || []) as FollowupItem[]).map((item) => (
            <div key={item._id} className="queue-item">
              <p className="queue-title">{item.thread?.title || item.thread?.jid || "Unknown thread"}</p>
              <p className="queue-body">{item.reason}</p>
              <p className="queue-meta">
                Due: {formatDateTime(item.dueAt)} · Status: {item.status}
              </p>
              {item.status === "suggested" ? (
                <form action="/api/actions/confirm-followup" method="post">
                  <input type="hidden" name="followUpId" value={item._id} />
                  <button type="submit" className="btn btn-primary">
                    Confirm
                  </button>
                </form>
              ) : null}
            </div>
          ))}
          {(data.followups || []).length === 0 ? <p className="empty-line">No follow-ups yet.</p> : null}
        </div>
      </section>
    </DashboardShell>
  );
}
