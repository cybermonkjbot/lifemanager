"use client";

import { SegmentedControl } from "@/components/app-ui";
import { EmptyState } from "@/components/empty-state";
import { LoadingBlock } from "@/components/loading-state";
import { SharedMediaPreview } from "@/components/media-preview";
import { useTenantScopeArgs } from "@/components/tenant-scope-provider";
import { UIModal } from "@/components/ui-modal";
import { formatDateTime, trim } from "@/lib/format";
import type { UnifiedMediaItem } from "@/lib/ui/media";
import { api } from "../../convex/_generated/api";
import { useQuery } from "convex/react";
import Link from "next/link";
import { useMemo, useState } from "react";

type MediaFilter = "all" | "stickers" | "memes" | "images" | "video" | "audio" | "documents";

type MediaPreview = {
  url: string;
  label: string;
  mimeType: string;
  kind: UnifiedMediaItem["kind"];
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

export function LiveMedia() {
  const tenantScope = useTenantScopeArgs();
  const [filter, setFilter] = useState<MediaFilter>("all");
  const [limit, setLimit] = useState(240);
  const [search, setSearch] = useState("");
  const [mediaPreview, setMediaPreview] = useState<MediaPreview | null>(null);

  const mediaItems = useQuery(api.media.listUnifiedMedia, {
    ...tenantScope,
    filter,
    limit,
  }) as UnifiedMediaItem[] | undefined;

  const loading = mediaItems === undefined;
  const normalizedSearch = search.trim().toLowerCase();
  const visibleItems = useMemo(() => {
    const rows = mediaItems || [];
    if (!normalizedSearch) {
      return rows;
    }
    return rows.filter((item) => {
      const haystack = [
        item.label,
        item.kind,
        item.mimeType,
        item.source,
        item.thread?.title,
        item.thread?.jid,
        item.message?.text,
        item.message?.mediaCaption,
        item.contextSummary,
        item.tags?.join(" "),
        item.contextTags?.join(" "),
        item.contextTriggers?.join(" "),
        item.contextAvoid?.join(" "),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalizedSearch);
    });
  }, [mediaItems, normalizedSearch]);

  return (
    <section className="panel-grid media-workspace">
      <article className="panel-card">
        <h3>Library Feed</h3>
        <p className="queue-meta">
          Browse captured media, preview inline, and jump to the source thread.
        </p>
        <p className="queue-meta">
          Labels, tags, and availability now live in <Link href="/settings?section=media">Media Settings</Link>.
        </p>

        <SegmentedControl label="Media filters" value={filter} options={FILTERS} onChange={setFilter} className="media-filter-tabs" />

        <div className="thread-list-footer">
          <input
            type="search"
            className="input"
            placeholder="Search media, tags, thread, or context..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label="Search media library"
          />
          {(mediaItems || []).length >= limit && limit < 400 ? (
            <button type="button" className="btn btn-ghost" onClick={() => setLimit((prev) => Math.min(prev + 160, 400))}>
              Load more
            </button>
          ) : null}
        </div>
        <p className="queue-meta">
          Showing {visibleItems.length} of {(mediaItems || []).length} item{(mediaItems || []).length === 1 ? "" : "s"}
        </p>

        {loading ? <LoadingBlock label="Loading media…" rows={4} /> : null}
        {!loading && visibleItems.length === 0 ? (
          <EmptyState
            variant="media"
            title="No captured media matches this view."
            description="Try another filter or search. New stickers, memes, images, and files will appear here after they are captured."
          />
        ) : null}

        <div className="stack">
          {visibleItems.map((item) => {
            const caption = item.message?.mediaCaption?.trim();
            const messageText = item.message?.text?.trim();
            const showMessageText = Boolean(messageText && messageText !== caption);
            const showCaption = Boolean(caption && caption !== messageText);

            return (
              <div key={item.id} className="queue-item media-dashboard-item">
                <div className="media-dashboard-main">
                  <SharedMediaPreview
                    preview={{
                      assetId: item.assetId || item.id,
                      kind: item.kind,
                      mimeType: item.mimeType,
                      label: item.label,
                      url: item.url,
                    }}
                    mediaAssetId={item.assetId || item.id}
                    onOpenImagePreview={(preview) =>
                      setMediaPreview({
                        url: preview.url,
                        label: preview.label,
                        mimeType: preview.mimeType,
                        kind: preview.kind,
                      })
                    }
                    imageButtonClassName="message-media-open media-dashboard-preview"
                  />
                  <div className="media-dashboard-content">
                    <p className="queue-title">
                      {item.label || item.kind} · {item.kind}
                    </p>
                    <p className="queue-meta">
                      {item.source === "message" ? "Message timeline" : "Media library"} · {formatDateTime(item.createdAt)}
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
            <SharedMediaPreview
              preview={{
                assetId: "modal-preview",
                kind: mediaPreview.kind,
                mimeType: mediaPreview.mimeType,
                label: mediaPreview.label,
                url: mediaPreview.url,
              }}
              mediaAssetId="modal-preview"
              imageClassName="message-media-image modal-preview-image"
              attachmentText="Open full size"
            />
            <a href={mediaPreview.url} target="_blank" rel="noreferrer" className="message-media-link">
              Open full size
            </a>
          </div>
        ) : (
          <EmptyState
            variant="media"
            compact
            title="Media preview unavailable."
            description="The file can stay listed even when a preview URL is missing."
          />
        )}
      </UIModal>
    </section>
  );
}
