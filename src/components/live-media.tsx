"use client";

import { UIModal } from "@/components/ui-modal";
import { formatDateTime, trim } from "@/lib/format";
import { api } from "../../convex/_generated/api";
import { useQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";

type MediaFilter = "all" | "stickers" | "memes" | "images" | "video" | "audio" | "documents";

type UnifiedMediaItem = {
  id: string;
  assetId: string;
  source: "message" | "library";
  createdAt: number;
  kind: "sticker" | "meme" | "image" | "video" | "audio" | "document";
  mimeType: string;
  label: string;
  url: string | null;
  enabled: boolean;
  tags: string[];
  contextSummary?: string;
  contextTags?: string[];
  contextTriggers?: string[];
  contextAvoid?: string[];
  contextConfidence?: number;
  thread?: { _id: string; jid: string; title?: string } | null;
  message?:
    | {
        _id: string;
        direction: "inbound" | "outbound";
        text: string;
        messageType: string;
        mediaCaption?: string;
        messageAt: number;
      }
    | null;
};

type MediaPreview = {
  url: string;
  label: string;
  mimeType: string;
};

const FILTERS: Array<{ id: MediaFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "stickers", label: "Stickers" },
  { id: "memes", label: "Memes" },
  { id: "images", label: "Images" },
  { id: "video", label: "Video" },
  { id: "audio", label: "Audio" },
  { id: "documents", label: "Documents" },
];

function renderMediaPreview(item: UnifiedMediaItem, onOpenPreview: (preview: MediaPreview) => void) {
  if (!item.url) {
    return <p className="queue-meta">Media URL unavailable.</p>;
  }

  const mimeType = item.mimeType.toLowerCase();
  if (mimeType.startsWith("image/") || item.kind === "sticker" || item.kind === "meme" || item.kind === "image") {
    return (
      <button
        type="button"
        className="message-media-open media-dashboard-preview"
        onClick={() => onOpenPreview({ url: item.url!, label: item.label, mimeType: item.mimeType })}
        aria-label={`Open ${item.label || item.kind}`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={item.url} alt={item.label || item.kind} className="message-media-image" loading="lazy" />
      </button>
    );
  }
  if (mimeType.startsWith("video/") || item.kind === "video") {
    return <video src={item.url} controls preload="metadata" className="message-media-video" />;
  }
  if (mimeType.startsWith("audio/") || item.kind === "audio") {
    return <audio src={item.url} controls preload="none" className="message-media-audio" />;
  }
  return (
    <a href={item.url} target="_blank" rel="noreferrer" className="message-media-link">
      Open attachment
    </a>
  );
}

export function LiveMedia() {
  const [filter, setFilter] = useState<MediaFilter>("all");
  const [limit, setLimit] = useState(240);
  const [mediaPreview, setMediaPreview] = useState<MediaPreview | null>(null);

  const mediaItems = useQuery(api.media.listUnifiedMedia, {
    filter,
    limit,
  }) as UnifiedMediaItem[] | undefined;

  const loading = mediaItems === undefined;

  return (
    <section className="panel-grid">
      <article className="panel-card">
        <h3>Unified Media Dashboard</h3>
        <p className="queue-meta">
          Browse captured stickers and media from message threads, preview/play inline, and jump directly to where each item appears.
        </p>

        <div className="queue-focus-tabs media-filter-tabs">
          {FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`btn ${filter === item.id ? "btn-primary" : "btn-ghost"}`}
              onClick={() => setFilter(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="thread-list-footer">
          <button type="button" className="btn btn-ghost" onClick={() => setLimit((prev) => Math.min(prev + 160, 400))}>
            Load More
          </button>
        </div>

        {loading ? <p className="empty-line">Loading media dashboard...</p> : null}
        {!loading && (mediaItems || []).length === 0 ? <p className="empty-line">No media found for this filter yet.</p> : null}

        <div className="stack">
          {(mediaItems || []).map((item) => {
            const caption = item.message?.mediaCaption?.trim();
            const messageText = item.message?.text?.trim();
            const showMessageText = Boolean(messageText && messageText !== caption);
            const showCaption = Boolean(caption && caption !== messageText);

            return (
              <div key={item.id} className="queue-item media-dashboard-item">
                <div className="media-dashboard-main">
                  {renderMediaPreview(item, setMediaPreview)}
                  <div className="media-dashboard-content">
                    <p className="queue-title">
                      {item.label || item.kind} · {item.kind}
                    </p>
                    <p className="queue-meta">
                      {item.source === "message" ? "Message timeline" : "Media library"} · {formatDateTime(item.createdAt)} ·{" "}
                      {item.enabled ? "Enabled" : "Disabled"}
                    </p>
                    <p className="queue-meta">{item.mimeType || "unknown mime type"}</p>
                    {item.tags?.length ? <p className="queue-meta">Tags: {item.tags.join(", ")}</p> : null}
                    {showMessageText ? <p className="queue-body">{trim(messageText || "", 420)}</p> : null}
                    {showCaption ? <p className="queue-meta">Caption: {trim(caption || "", 260)}</p> : null}

                    {item.contextSummary ? <p className="queue-body">{trim(item.contextSummary, 240)}</p> : null}
                    {item.contextTags?.length ? <p className="queue-meta">Context tags: {item.contextTags.join(", ")}</p> : null}
                    {item.contextTriggers?.length ? <p className="queue-meta">Use when: {item.contextTriggers.join(", ")}</p> : null}
                    {item.contextAvoid?.length ? <p className="queue-meta">Avoid when: {item.contextAvoid.join(", ")}</p> : null}
                    {typeof item.contextConfidence === "number" ? (
                      <p className="queue-meta">Context confidence: {(item.contextConfidence * 100).toFixed(0)}%</p>
                    ) : null}

                    <div className="queue-actions">
                      {item.url ? (
                        <a href={item.url} target="_blank" rel="noreferrer" className="btn btn-ghost">
                          Open Raw
                        </a>
                      ) : null}
                      {item.thread?._id ? (
                        <Link href={`/conversations?threadId=${item.thread._id}`} className="btn btn-ghost">
                          Open Thread
                        </Link>
                      ) : null}
                    </div>
                    {item.thread ? <p className="queue-meta">{item.thread.title || item.thread.jid}</p> : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </article>

      <UIModal
        open={Boolean(mediaPreview)}
        onClose={() => setMediaPreview(null)}
        title={mediaPreview?.label || "Media Preview"}
        description={mediaPreview?.mimeType || "Preview the selected media asset."}
      >
        {mediaPreview?.url ? (
          <div className="stack compact">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={mediaPreview.url} alt={mediaPreview.label || "Media preview"} className="message-media-image modal-preview-image" />
            <a href={mediaPreview.url} target="_blank" rel="noreferrer" className="message-media-link">
              Open full size
            </a>
          </div>
        ) : (
          <p className="empty-line">Media preview unavailable.</p>
        )}
      </UIModal>
    </section>
  );
}
