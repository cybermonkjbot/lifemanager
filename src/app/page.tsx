import { DashboardShell } from "@/components/dashboard-shell";
import { SetupNotice } from "@/components/setup-notice";
import { getQueuePageData, getSystemPageData } from "@/lib/data";
import { formatDateTime, trim } from "@/lib/format";

type QueueReplyItem = {
  _id: string;
  provider: string;
  delayMs: number;
  typingMs: number;
  text: string;
  sourceMessage?: { text?: string } | null;
  thread?: { title?: string; jid?: string } | null;
};

type QueueFollowupItem = {
  _id: string;
  reason: string;
  dueAt: number;
};

type QueueTodoCandidate = {
  _id: string;
  title: string;
  suggestedDueAt?: number;
};

type QueueGuardrailItem = {
  _id: string;
  severity: string;
  reason: string;
};

export default async function QueuePage() {
  const [queueData, systemData] = await Promise.all([getQueuePageData(), getSystemPageData()]);
  const autonomyPaused = Boolean(systemData.health?.config?.autonomyPaused);

  return (
    <DashboardShell
      title="Action Queue"
      subtitle="Process replies, confirmations, TODOs, and safety flags fast."
      autonomyPaused={autonomyPaused}
    >
      {!queueData.ready ? <SetupNotice error={queueData.error} /> : null}

      <section className="panel-grid two-col">
        <article className="panel-card">
          <h3>Needs Reply</h3>
          <div className="stack">
            {((queueData.queue?.needsReply || []) as QueueReplyItem[]).map((item) => (
              <div key={item._id} className="queue-item">
                <p className="queue-title">{item.thread?.title || item.thread?.jid || "Unknown contact"}</p>
                <p className="queue-body">{trim(item.sourceMessage?.text || item.text || "")}</p>
                <p className="queue-meta">
                  Provider: {item.provider} · Delay: {Math.round(item.delayMs / 1000)}s · Typing: {Math.round(item.typingMs / 1000)}s
                </p>
                <div className="queue-actions">
                  <form action="/api/actions/approve-draft" method="post">
                    <input type="hidden" name="draftId" value={item._id} />
                    <button type="submit" className="btn btn-primary">
                      Send
                    </button>
                  </form>
                  <form action="/api/actions/snooze-draft" method="post">
                    <input type="hidden" name="draftId" value={item._id} />
                    <input type="hidden" name="minutes" value="30" />
                    <button type="submit" className="btn btn-ghost">
                      Snooze 30m
                    </button>
                  </form>
                </div>
              </div>
            ))}
            {(queueData.queue?.needsReply || []).length === 0 ? <p className="empty-line">No pending replies.</p> : null}
          </div>
        </article>

        <article className="panel-card">
          <h3>Follow-up Confirmations</h3>
          <div className="stack">
            {((queueData.queue?.followupConfirmations || []) as QueueFollowupItem[]).map((item) => (
              <div key={item._id} className="queue-item">
                <p className="queue-title">{item.reason}</p>
                <p className="queue-body">Due: {formatDateTime(item.dueAt)}</p>
                <form action="/api/actions/confirm-followup" method="post">
                  <input type="hidden" name="followUpId" value={item._id} />
                  <button type="submit" className="btn btn-primary">
                    Confirm Follow-up
                  </button>
                </form>
              </div>
            ))}
            {(queueData.queue?.followupConfirmations || []).length === 0 ? (
              <p className="empty-line">No follow-up confirmations pending.</p>
            ) : null}
          </div>
        </article>
      </section>

      <section className="panel-grid two-col">
        <article className="panel-card">
          <h3>TODO Candidates</h3>
          <div className="stack">
            {((queueData.queue?.todoCandidates || []) as QueueTodoCandidate[]).map((item) => (
              <div key={item._id} className="queue-item">
                <p className="queue-title">{item.title}</p>
                <p className="queue-meta">Suggested due: {formatDateTime(item.suggestedDueAt)}</p>
                <form action="/api/actions/todo-from-candidate" method="post">
                  <input type="hidden" name="candidateId" value={item._id} />
                  <button type="submit" className="btn btn-primary">
                    Convert to TODO
                  </button>
                </form>
              </div>
            ))}
            {(queueData.queue?.todoCandidates || []).length === 0 ? <p className="empty-line">No todo candidates.</p> : null}
          </div>
        </article>

        <article className="panel-card">
          <h3>Guardrail Flags</h3>
          <div className="stack">
            {((queueData.queue?.guardrailFlags || []) as QueueGuardrailItem[]).map((item) => (
              <div key={item._id} className="queue-item">
                <p className="queue-title">Severity: {item.severity}</p>
                <p className="queue-body">{item.reason}</p>
              </div>
            ))}
            {(queueData.queue?.guardrailFlags || []).length === 0 ? <p className="empty-line">No active safety flags.</p> : null}
          </div>
        </article>
      </section>
    </DashboardShell>
  );
}
