import { DashboardShell } from "@/components/dashboard-shell";
import { SetupNotice } from "@/components/setup-notice";
import { getConversationsPageData, getSystemPageData } from "@/lib/data";
import { formatDateTime, trim } from "@/lib/format";
import Link from "next/link";

type ThreadRow = {
  _id: string;
  title?: string;
  jid: string;
  lastMessageAt: number;
  latestDraft?: { text?: string } | null;
};

type ThreadMessage = {
  _id: string;
  direction: "inbound" | "outbound";
  text: string;
  messageAt: number;
};

export default async function ConversationsPage({
  searchParams,
}: {
  searchParams: Promise<{ threadId?: string }>;
}) {
  const params = await searchParams;
  const [data, systemData] = await Promise.all([
    getConversationsPageData(params.threadId),
    getSystemPageData(),
  ]);
  const autonomyPaused = Boolean(systemData.health?.config?.autonomyPaused);

  return (
    <DashboardShell
      title="Conversations"
      subtitle="Read full context and inspect generated replies."
      autonomyPaused={autonomyPaused}
    >
      {!data.ready ? <SetupNotice error={data.error} /> : null}

      <section className="panel-grid split-view">
        <article className="panel-card">
          <h3>Threads</h3>
          <div className="stack">
            {((data.threads || []) as ThreadRow[]).map((thread) => (
              <Link key={thread._id} href={`/conversations?threadId=${thread._id}`} className="thread-row">
                <p className="queue-title">{thread.title || thread.jid}</p>
                <p className="queue-body">{trim(thread.latestDraft?.text || "No draft yet")}</p>
                <p className="queue-meta">Last activity: {formatDateTime(thread.lastMessageAt)}</p>
              </Link>
            ))}
          </div>
        </article>

        <article className="panel-card">
          <h3>Timeline</h3>
          {data.thread ? (
            <div className="stack">
              <p className="queue-meta">Thread: {data.thread.thread.title || data.thread.thread.jid}</p>
              {((data.thread.messages || []) as ThreadMessage[]).map((message) => (
                <div key={message._id} className={`message-bubble ${message.direction === "outbound" ? "outbound" : "inbound"}`}>
                  <p>{message.text}</p>
                  <span>{formatDateTime(message.messageAt)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="empty-line">Choose a thread from the left.</p>
          )}
        </article>
      </section>
    </DashboardShell>
  );
}
