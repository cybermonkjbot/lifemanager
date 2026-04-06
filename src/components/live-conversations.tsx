"use client";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useQuery } from "convex/react";
import Link from "next/link";
import { formatDateTime, trim } from "@/lib/format";

type LiveConversationsProps = {
  initialThreadId?: string;
};

function ConversationsContent({ initialThreadId }: { initialThreadId?: string }) {
  const threads = useQuery(api.threads.list, { limit: 50 }) as
    | Array<{
        _id: string;
        title?: string;
        jid: string;
        lastMessageAt: number;
        latestDraft?: { text?: string } | null;
      }>
    | undefined;

  const selectedThreadId = initialThreadId || threads?.[0]?._id;
  const thread = useQuery(
    api.threads.get,
    selectedThreadId ? { threadId: selectedThreadId as Id<"threads"> } : "skip",
  ) as
    | {
        thread: { title?: string; jid: string };
        messages: Array<{
          _id: string;
          direction: "inbound" | "outbound";
          text: string;
          messageAt: number;
        }>;
      }
    | null
    | undefined;

  return (
    <section className="panel-grid split-view">
      <article className="panel-card">
        <h3>Threads</h3>
        <div className="stack">
          {(threads || []).map((item) => (
            <Link key={item._id} href={`/conversations?threadId=${item._id}`} className="thread-row">
              <p className="queue-title">{item.title || item.jid}</p>
              <p className="queue-body">{trim(item.latestDraft?.text || "No draft yet")}</p>
              <p className="queue-meta">Last activity: {formatDateTime(item.lastMessageAt)}</p>
            </Link>
          ))}
          {(threads || []).length === 0 ? <p className="empty-line">No threads yet.</p> : null}
        </div>
      </article>

      <article className="panel-card" aria-busy={Boolean(selectedThreadId && !thread)}>
        <h3>Timeline</h3>
        {thread ? (
          <div className="stack">
            <p className="queue-meta">Thread: {thread.thread.title || thread.thread.jid}</p>
            {(thread.messages || []).map((message) => (
              <div key={message._id} className={`message-bubble ${message.direction === "outbound" ? "outbound" : "inbound"}`}>
                <p>{message.text}</p>
                <span>{formatDateTime(message.messageAt)}</span>
              </div>
            ))}
          </div>
        ) : selectedThreadId ? (
          <p className="empty-line">Loading timeline...</p>
        ) : (
          <p className="empty-line">Choose a thread from the left.</p>
        )}
      </article>
    </section>
  );
}

export function LiveConversations({ initialThreadId }: LiveConversationsProps) {
  return <ConversationsContent initialThreadId={initialThreadId} />;
}
