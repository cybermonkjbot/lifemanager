"use client";

import { formatDateTime, trim } from "@/lib/format";
import { isImageLikeMedia, type UnifiedMediaItem } from "@/lib/ui/media";
import { LoadingIndicator } from "@/components/loading-state";
import { ModalTabs, UIModal } from "@/components/ui-modal";
import { api } from "../../convex/_generated/api";
import { useQuery } from "convex/react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { CSSProperties, useMemo, useRef, useState } from "react";

type ActivityStatus = "active" | "paused" | "non-active";
type ActivityFeedFilter = "all" | "activity" | "media";
type MediaFilter = "all" | "stickers" | "memes" | "images" | "video" | "audio" | "documents";

type ActivityLogRow = {
  id: string;
  source: string;
  eventType: string;
  detail: string;
  createdAt: number;
};

type ActivityCoreNode = {
  id: string;
  source: string;
  title: string;
  detail: string;
  createdAt: number;
  status: ActivityStatus;
  stream: "activity" | "media";
  mediaKind?: UnifiedMediaItem["kind"];
  mediaPreviewUrl?: string | null;
  eventType?: string;
  mediaDetails?: {
    source: "message" | "library";
    kind: UnifiedMediaItem["kind"];
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
    threadId?: string;
    threadJid?: string;
    threadTitle?: string;
    messageText?: string;
    messageCaption?: string;
    messageType?: string;
    messageDirection?: "inbound" | "outbound";
    messageAt?: number;
  };
};

type LiveActivityCoreProps = {
  splineSceneUrl: string;
};

const Spline = dynamic(() => import("@splinetool/react-spline"), { ssr: false });
const MAX_CORE_NODES = 44;
const DEFAULT_CORE_ZOOM = 1;
const MIN_CORE_ZOOM = 0.7;
const MAX_CORE_ZOOM = 1.6;
const DEFAULT_MEDIA_ZOOM = 0.84;
const MIN_MEDIA_ZOOM = 0.6;
const MAX_MEDIA_ZOOM = 5;

const FEED_FILTERS: Array<{ id: ActivityFeedFilter; label: string }> = [
  { id: "all", label: "All Signals" },
  { id: "activity", label: "Activity" },
  { id: "media", label: "Media" },
];

const MEDIA_FILTERS: Array<{ id: MediaFilter; label: string }> = [
  { id: "all", label: "All Media" },
  { id: "stickers", label: "Stickers" },
  { id: "memes", label: "Memes" },
  { id: "images", label: "Images" },
  { id: "video", label: "Video" },
  { id: "audio", label: "Audio" },
  { id: "documents", label: "Documents" },
];

function classifyActivityStatus(eventType: string, detail: string): ActivityStatus {
  const signal = `${eventType} ${detail}`.toLowerCase();

  if (signal.includes("paused") || signal.includes("autonomy.paused")) {
    return "paused";
  }

  if (signal.includes("error") || signal.includes("failed") || signal.includes("disconnect") || signal.includes("stopped")) {
    return "non-active";
  }

  if (
    signal.includes("active") ||
    signal.includes("running") ||
    signal.includes("connected") ||
    signal.includes("resumed") ||
    signal.includes("success") ||
    signal.includes("queued")
  ) {
    return "active";
  }

  return "non-active";
}

function sourceLabel(source: string) {
  if (source === "worker") return "Worker";
  if (source === "convex") return "Backend";
  if (source === "dashboard") return "UI";
  if (source === "ai") return "AI";
  if (source === "media") return "Media";
  return source;
}

function mediaKindLabel(kind: UnifiedMediaItem["kind"]) {
  if (kind === "sticker") return "Sticker";
  if (kind === "meme") return "Meme";
  if (kind === "image") return "Image";
  if (kind === "video") return "Video";
  if (kind === "audio") return "Audio";
  return "Document";
}

function classifyMediaStatus(item: UnifiedMediaItem): ActivityStatus {
  if (!item.enabled) {
    return "paused";
  }
  if (item.source === "message") {
    return "active";
  }
  return "non-active";
}

function mediaNodeDetail(item: UnifiedMediaItem) {
  const threadLabel = item.thread?.title || item.thread?.jid;
  const sourceLabelValue = item.source === "message" ? "Message timeline" : "Media library";
  const caption = item.message?.mediaCaption?.trim();

  const fragments = [item.label || mediaKindLabel(item.kind), item.mimeType || "unknown mime", sourceLabelValue];
  if (threadLabel) {
    fragments.push(threadLabel);
  }
  if (caption) {
    fragments.push(trim(caption, 80));
  }

  return fragments.join(" · ");
}

function canRenderInlineMediaPreview(item: UnifiedMediaItem) {
  return Boolean(item.url) && isImageLikeMedia(item.kind, item.mimeType);
}

function isZoomableMediaImage(kind: UnifiedMediaItem["kind"], mimeType: string) {
  return isImageLikeMedia(kind, mimeType);
}

function resolveSplineSource(rawUrl: string): { kind: "scene"; url: string } | { kind: "iframe"; url: string } | null {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.includes(".splinecode")) {
    return { kind: "scene", url: trimmed };
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.hostname === "my.spline.design") {
      return { kind: "iframe", url: parsed.toString() };
    }
  } catch {
    // Keep user-provided values untouched if they are not parseable URLs.
  }

  return { kind: "scene", url: trimmed };
}

function polarPlacement(index: number, total: number, mediaSpreadMode: boolean) {
  const safeTotal = Math.max(total, 1);
  const ringCount = mediaSpreadMode ? 6 : 4;
  const ring = index % ringCount;
  const baseRadius = mediaSpreadMode ? 210 : 150;
  const ringStep = mediaSpreadMode ? 62 : 44;
  const ringRadius = baseRadius + ring * ringStep;
  const angle = (index / safeTotal) * Math.PI * 2 + (mediaSpreadMode ? ring * 0.14 : 0);
  const x = Math.round(Math.cos(angle) * ringRadius);
  const y = Math.round(Math.sin(angle) * ringRadius * (mediaSpreadMode ? 0.92 : 1));
  return {
    left: `calc(50% + ${x}px)`,
    top: `calc(50% + ${y}px)`,
    animationDelay: `${index * 90}ms`,
  };
}

export function LiveActivityCore({ splineSceneUrl }: LiveActivityCoreProps) {
  const [feedFilter, setFeedFilter] = useState<ActivityFeedFilter>("all");
  const [mediaFilter, setMediaFilter] = useState<MediaFilter>("all");
  const [coreZoom, setCoreZoom] = useState(DEFAULT_CORE_ZOOM);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<ActivityCoreNode | null>(null);
  const [mediaZoom, setMediaZoom] = useState(DEFAULT_MEDIA_ZOOM);
  const [mediaPan, setMediaPan] = useState({ x: 0, y: 0 });
  const [mediaDragState, setMediaDragState] = useState<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);
  const mediaViewportRef = useRef<HTMLDivElement | null>(null);

  const logs = useQuery(api.system.logFeed, { limit: 56 }) as ActivityLogRow[] | undefined;
  const mediaItems = useQuery(api.media.listUnifiedMedia, { filter: mediaFilter, limit: 120 }) as UnifiedMediaItem[] | undefined;
  const splineSource = useMemo(() => resolveSplineSource(splineSceneUrl), [splineSceneUrl]);

  const activityNodes = useMemo<ActivityCoreNode[]>(
    () =>
      (logs || []).map((row) => ({
        id: row.id,
        source: row.source,
        title: row.eventType,
        detail: row.detail,
        createdAt: row.createdAt,
        status: classifyActivityStatus(row.eventType, row.detail),
        stream: "activity",
        eventType: row.eventType,
      })),
    [logs],
  );

  const mediaNodes = useMemo<ActivityCoreNode[]>(
    () =>
      (mediaItems || []).map((item) => ({
        id: item.id,
        source: "media",
        title: `${mediaKindLabel(item.kind)} · ${item.source === "message" ? "Message" : "Library"}`,
        detail: mediaNodeDetail(item),
        createdAt: item.createdAt,
        status: classifyMediaStatus(item),
        stream: "media",
        mediaKind: item.kind,
        mediaPreviewUrl: canRenderInlineMediaPreview(item) ? item.url : null,
        mediaDetails: {
          source: item.source,
          kind: item.kind,
          mimeType: item.mimeType,
          label: item.label,
          url: item.url,
          enabled: item.enabled,
          tags: item.tags || [],
          contextSummary: item.contextSummary,
          contextTags: item.contextTags,
          contextTriggers: item.contextTriggers,
          contextAvoid: item.contextAvoid,
          contextConfidence: item.contextConfidence,
          threadId: item.thread?._id,
          threadJid: item.thread?.jid,
          threadTitle: item.thread?.title,
          messageText: item.message?.text,
          messageCaption: item.message?.mediaCaption,
          messageType: item.message?.messageType,
          messageDirection: item.message?.direction,
          messageAt: item.message?.messageAt,
        },
      })),
    [mediaItems],
  );

  const filteredNodes = useMemo(() => {
    const base =
      feedFilter === "activity"
        ? activityNodes
        : feedFilter === "media"
          ? mediaNodes
          : [...activityNodes, ...mediaNodes];
    return [...base].sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX_CORE_NODES);
  }, [activityNodes, feedFilter, mediaNodes]);

  const logsLoading = logs === undefined;
  const mediaLoading = mediaItems === undefined;
  const loading = feedFilter === "activity" ? logsLoading : feedFilter === "media" ? mediaLoading : logsLoading || mediaLoading;

  const statusCounts = useMemo(() => {
    const counts: Record<ActivityStatus, number> = {
      active: 0,
      paused: 0,
      "non-active": 0,
    };
    for (const row of filteredNodes) {
      counts[row.status] += 1;
    }
    return counts;
  }, [filteredNodes]);

  const activeScale = 1 + Math.min(statusCounts.active, 16) * 0.04;
  const pausedScale = 1 + Math.min(statusCounts.paused, 16) * 0.04;
  const nonActiveScale = 1 + Math.min(statusCounts["non-active"], 16) * 0.04;
  const mediaSpreadMode = feedFilter === "media";

  const stageStyle: CSSProperties = {
    position: "relative",
    minHeight: mediaSpreadMode ? "min(80vh, 900px)" : "min(74vh, 780px)",
    border: "1px solid rgba(255, 255, 255, 0.24)",
    borderRadius: 24,
    overflow: "hidden",
    background:
      "radial-gradient(circle at 48% 46%, rgba(255, 255, 255, 0.1), transparent 42%), radial-gradient(circle at 12% 18%, rgba(85, 255, 154, 0.08), transparent 36%), radial-gradient(circle at 86% 84%, rgba(83, 124, 255, 0.09), transparent 42%), rgba(4, 4, 4, 0.84)",
  };

  const baseNodeStyle: CSSProperties = {
    position: "absolute",
    transform: "translate(-50%, -50%)",
    width: "min(310px, 44vw)",
    padding: "8px 10px",
    borderRadius: 12,
    border: "1px solid rgba(255, 255, 255, 0.24)",
    backdropFilter: "blur(2px)",
    background: "rgba(5, 8, 9, 0.5)",
    animation: "drift-node 6.8s ease-in-out infinite",
    textShadow: "0 0 12px rgba(0, 0, 0, 0.75)",
    pointerEvents: "auto",
    zIndex: 1,
  };

  const statusNodeStyle: Record<ActivityStatus, CSSProperties> = {
    active: {
      borderColor: "rgba(95, 255, 172, 0.48)",
      boxShadow: "0 0 22px rgba(95, 255, 172, 0.2)",
    },
    paused: {
      borderColor: "rgba(255, 199, 102, 0.5)",
      boxShadow: "0 0 22px rgba(255, 199, 102, 0.17)",
    },
    "non-active": {
      borderColor: "rgba(125, 167, 255, 0.5)",
      boxShadow: "0 0 22px rgba(125, 167, 255, 0.19)",
    },
  };

  const selectedMediaDetails = selectedNode?.stream === "media" ? selectedNode.mediaDetails : undefined;
  const selectedMediaIsZoomableImage = Boolean(
    selectedMediaDetails?.url && isZoomableMediaImage(selectedMediaDetails.kind, selectedMediaDetails.mimeType),
  );

  const resetMediaView = () => {
    setMediaZoom(DEFAULT_MEDIA_ZOOM);
    setMediaPan({ x: 0, y: 0 });
    setMediaDragState(null);
  };

  const openNodeDetails = (node: ActivityCoreNode) => {
    resetMediaView();
    setSelectedNode(node);
  };

  const closeNodeDetails = () => {
    setSelectedNode(null);
    resetMediaView();
  };

  const clampMediaPan = (pan: { x: number; y: number }, zoomLevel: number) => {
    const viewport = mediaViewportRef.current;
    if (!viewport || zoomLevel <= 1) {
      return { x: 0, y: 0 };
    }
    const maxX = (viewport.clientWidth * (zoomLevel - 1)) / 2;
    const maxY = (viewport.clientHeight * (zoomLevel - 1)) / 2;
    return {
      x: Math.max(-maxX, Math.min(maxX, pan.x)),
      y: Math.max(-maxY, Math.min(maxY, pan.y)),
    };
  };

  const applyZoom = (nextZoomRaw: number) => {
    const nextZoom = Math.max(MIN_MEDIA_ZOOM, Math.min(MAX_MEDIA_ZOOM, Number(nextZoomRaw.toFixed(2))));
    setMediaZoom(nextZoom);
    setMediaPan((current) => clampMediaPan(current, nextZoom));
    if (nextZoom <= 1) {
      setMediaDragState(null);
    }
  };

  const applyCoreZoom = (nextZoomRaw: number) => {
    const nextZoom = Math.max(MIN_CORE_ZOOM, Math.min(MAX_CORE_ZOOM, Number(nextZoomRaw.toFixed(2))));
    setCoreZoom(nextZoom);
  };

  return (
    <section className="activity-core-shell">
      <div className="activity-core-stage" style={stageStyle} aria-live="polite">
        <div className="activity-core-zoom-layer" style={{ transform: `scale(${coreZoom})` }}>
          <div className="activity-core-background" style={{ position: "absolute", inset: 0, zIndex: 1, pointerEvents: "none" }} aria-hidden="true">
            {filteredNodes.map((log, index) => (
              <article
                key={log.id}
                className={`activity-log-node status-${log.status}`}
                style={{
                  ...baseNodeStyle,
                  ...(mediaSpreadMode ? { width: "min(275px, 38vw)" } : null),
                  ...statusNodeStyle[log.status],
                  ...polarPlacement(index, filteredNodes.length, mediaSpreadMode),
                  zIndex: hoveredNodeId === log.id ? 12 : 1,
                  cursor: "pointer",
                }}
                onMouseEnter={() => setHoveredNodeId(log.id)}
                onMouseLeave={() => setHoveredNodeId((current) => (current === log.id ? null : current))}
                onFocus={() => setHoveredNodeId(log.id)}
                onBlur={() => setHoveredNodeId((current) => (current === log.id ? null : current))}
                onClick={() => openNodeDetails(log)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    openNodeDetails(log);
                  }
                }}
                role="button"
                tabIndex={0}
                aria-label={`Open details for ${sourceLabel(log.source)} ${log.title}`}
              >
                {log.stream === "media" && log.mediaPreviewUrl ? (
                  <div className="activity-node-media-preview" aria-hidden="true">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={log.mediaPreviewUrl} alt={`${log.mediaKind || "media"} preview`} loading="lazy" />
                  </div>
                ) : null}
                <p style={{ margin: 0, fontSize: "0.79rem", color: "#f4f4f4", fontWeight: 700 }}>
                  {sourceLabel(log.source)} · {log.title}
                </p>
                <span style={{ margin: 0, fontSize: "0.72rem", color: "#dadada", lineHeight: 1.35, display: "block" }}>
                  {trim(log.detail, 84)} · {formatDateTime(log.createdAt)}
                </span>
              </article>
            ))}
          </div>

          <div className="activity-halo-cloud" aria-hidden="true">
            <div
              className="activity-halo halo-active"
              style={{
                left: "50%",
                top: "50%",
                width: 380,
                height: 380,
                position: "absolute",
                borderRadius: 999,
                filter: "blur(36px)",
                background: "radial-gradient(circle, rgba(83, 247, 148, 0.32) 0%, rgba(83, 247, 148, 0) 65%)",
                transform: `translate(-50%, -50%) scale(${activeScale})`,
              }}
            />
            <div
              className="activity-halo halo-paused"
              style={{
                left: "50%",
                top: "50%",
                width: 380,
                height: 380,
                position: "absolute",
                borderRadius: 999,
                filter: "blur(36px)",
                background: "radial-gradient(circle, rgba(255, 194, 94, 0.24) 0%, rgba(255, 194, 94, 0) 65%)",
                transform: `translate(-50%, -50%) scale(${pausedScale})`,
              }}
            />
            <div
              className="activity-halo halo-non-active"
              style={{
                left: "50%",
                top: "50%",
                width: 380,
                height: 380,
                position: "absolute",
                borderRadius: 999,
                filter: "blur(36px)",
                background: "radial-gradient(circle, rgba(102, 160, 255, 0.24) 0%, rgba(102, 160, 255, 0) 65%)",
                transform: `translate(-50%, -50%) scale(${nonActiveScale})`,
              }}
            />
          </div>

          <div
            className="activity-core-object-wrap"
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              width: "min(640px, 100%)",
              height: "min(640px, 100%)",
              transform: "translate(-50%, -50%)",
              zIndex: 3,
              display: "grid",
              placeItems: "center",
            }}
          >
            <div
              className="activity-core-object"
              aria-hidden="true"
              style={{
                width: "min(560px, 96vw)",
                height: "min(560px, 96vw)",
                filter: "drop-shadow(0 0 34px rgba(255, 255, 255, 0.34))",
              }}
            >
              {splineSource?.kind === "scene" ? (
                <Spline scene={splineSource.url} />
              ) : splineSource?.kind === "iframe" ? (
                <iframe
                  title="Spline activity object"
                  src={splineSource.url}
                  style={{ width: "100%", height: "100%", border: 0, background: "transparent" }}
                  loading="lazy"
                  allow="fullscreen"
                />
              ) : (
                <div style={{ color: "#d4e3ff", fontSize: "0.9rem" }}>Missing Spline scene URL.</div>
              )}
            </div>
          </div>
        </div>

        <div className="activity-core-canvas-zoom-controls" aria-label="Activity Core zoom controls">
          <button type="button" className="activity-core-filter-chip" onClick={() => applyCoreZoom(coreZoom - 0.1)} disabled={coreZoom <= MIN_CORE_ZOOM}>
            Zoom Out
          </button>
          <button type="button" className="activity-core-filter-chip" onClick={() => applyCoreZoom(coreZoom + 0.1)} disabled={coreZoom >= MAX_CORE_ZOOM}>
            Zoom In
          </button>
          <button
            type="button"
            className="activity-core-filter-chip"
            onClick={() => setCoreZoom(DEFAULT_CORE_ZOOM)}
            disabled={Math.abs(coreZoom - DEFAULT_CORE_ZOOM) < 0.001}
          >
            Reset Zoom
          </button>
          <p className="activity-core-filter-note">Core zoom: {(coreZoom * 100).toFixed(0)}%</p>
        </div>
      </div>

      <div className="activity-core-filter-panel">
        <div className="activity-core-filter-row">
          {FEED_FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`activity-core-filter-chip ${feedFilter === item.id ? "is-active" : ""}`}
              onClick={() => setFeedFilter(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="activity-core-filter-row">
          {MEDIA_FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`activity-core-filter-chip ${mediaFilter === item.id ? "is-active" : ""}`}
              onClick={() => setMediaFilter(item.id)}
              disabled={feedFilter === "activity"}
            >
              {item.label}
            </button>
          ))}
        </div>
        <p className="activity-core-filter-note">
          Showing {filteredNodes.length} node{filteredNodes.length === 1 ? "" : "s"} · Feed: {feedFilter}
          {feedFilter !== "activity" ? ` · Media: ${mediaFilter}` : ""}
        </p>
      </div>

      <div className="activity-status-bar" style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <p
          className="activity-status-pill status-active"
          style={{
            margin: 0,
            border: "1px solid rgba(95, 255, 172, 0.58)",
            borderRadius: 999,
            padding: "6px 10px",
            fontSize: "0.8rem",
            letterSpacing: "0.02em",
            boxShadow: "0 0 16px rgba(95, 255, 172, 0.28)",
            background: "rgba(20, 41, 29, 0.45)",
            color: "#d7ffec",
          }}
        >
          Active · {statusCounts.active}
        </p>
        <p
          className="activity-status-pill status-paused"
          style={{
            margin: 0,
            border: "1px solid rgba(255, 199, 102, 0.56)",
            borderRadius: 999,
            padding: "6px 10px",
            fontSize: "0.8rem",
            letterSpacing: "0.02em",
            boxShadow: "0 0 16px rgba(255, 199, 102, 0.25)",
            background: "rgba(47, 33, 10, 0.42)",
            color: "#ffe9ba",
          }}
        >
          Paused · {statusCounts.paused}
        </p>
        <p
          className="activity-status-pill status-non-active"
          style={{
            margin: 0,
            border: "1px solid rgba(125, 167, 255, 0.58)",
            borderRadius: 999,
            padding: "6px 10px",
            fontSize: "0.8rem",
            letterSpacing: "0.02em",
            boxShadow: "0 0 16px rgba(125, 167, 255, 0.24)",
            background: "rgba(17, 24, 44, 0.48)",
            color: "#d4e3ff",
          }}
        >
          Non active · {statusCounts["non-active"]}
        </p>
      </div>

      {loading ? <LoadingIndicator label="Loading activity…" /> : null}
      {!loading && filteredNodes.length === 0 ? <p className="empty-line">No activity nodes match the current filters yet.</p> : null}

      <UIModal
        open={Boolean(selectedNode)}
        onClose={closeNodeDetails}
        title={selectedNode?.title || "Activity Detail"}
        description={selectedNode ? `${sourceLabel(selectedNode.source)} · ${formatDateTime(selectedNode.createdAt)}` : undefined}
        size="wide"
      >
        {selectedNode ? (
          <ModalTabs
            label="Activity detail sections"
            tabs={[
              {
                id: "overview",
                label: "Overview",
                content: (
                  <div className="queue-item">
                    <p className="queue-title">{selectedNode.title}</p>
                    <p className="queue-body">{selectedNode.detail}</p>
                    <p className="queue-meta">
                      Stream: {selectedNode.stream} · Source: {sourceLabel(selectedNode.source)} · Status: {selectedNode.status}
                    </p>
                    <p className="queue-meta">Created: {formatDateTime(selectedNode.createdAt)}</p>
                    {selectedNode.eventType ? <p className="queue-meta">Event type: {selectedNode.eventType}</p> : null}
                  </div>
                ),
              },
              ...(selectedNode.stream === "media" && selectedNode.mediaDetails
                ? [
                    {
                      id: "media",
                      label: "Media",
                      content: (
                        <div className="queue-item">
                          {selectedNode.mediaDetails.url ? (
                            selectedMediaIsZoomableImage ? (
                              <div className="activity-modal-media-zoom">
                                <div className="queue-actions">
                                  <button
                                    type="button"
                                    className="btn btn-ghost"
                                    onClick={() => applyZoom(mediaZoom - 0.25)}
                                    disabled={mediaZoom <= MIN_MEDIA_ZOOM}
                                  >
                                    Zoom Out
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-ghost"
                                    onClick={() => applyZoom(mediaZoom + 0.25)}
                                    disabled={mediaZoom >= MAX_MEDIA_ZOOM}
                                  >
                                    Zoom In
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-ghost"
                                    onClick={resetMediaView}
                                    disabled={Math.abs(mediaZoom - DEFAULT_MEDIA_ZOOM) < 0.001 && mediaPan.x === 0 && mediaPan.y === 0}
                                  >
                                    Reset View
                                  </button>
                                  <p className="queue-meta">Zoom: {(mediaZoom * 100).toFixed(0)}%</p>
                                </div>
                                <div
                                  ref={mediaViewportRef}
                                  className={`activity-modal-zoom-viewport ${mediaDragState ? "is-dragging" : ""}`}
                                  onWheel={(event) => {
                                    event.preventDefault();
                                    applyZoom(mediaZoom + (event.deltaY < 0 ? 0.2 : -0.2));
                                  }}
                                  onPointerDown={(event) => {
                                    if (mediaZoom <= 1) {
                                      return;
                                    }
                                    event.currentTarget.setPointerCapture(event.pointerId);
                                    setMediaDragState({
                                      pointerId: event.pointerId,
                                      startX: event.clientX,
                                      startY: event.clientY,
                                      originX: mediaPan.x,
                                      originY: mediaPan.y,
                                    });
                                  }}
                                  onPointerMove={(event) => {
                                    setMediaDragState((current) => {
                                      if (!current || current.pointerId !== event.pointerId) {
                                        return current;
                                      }
                                      const dx = event.clientX - current.startX;
                                      const dy = event.clientY - current.startY;
                                      setMediaPan(clampMediaPan({ x: current.originX + dx, y: current.originY + dy }, mediaZoom));
                                      return current;
                                    });
                                  }}
                                  onPointerUp={(event) => {
                                    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                                      event.currentTarget.releasePointerCapture(event.pointerId);
                                    }
                                    setMediaDragState((current) => (current?.pointerId === event.pointerId ? null : current));
                                  }}
                                  onPointerCancel={(event) => {
                                    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                                      event.currentTarget.releasePointerCapture(event.pointerId);
                                    }
                                    setMediaDragState((current) => (current?.pointerId === event.pointerId ? null : current));
                                  }}
                                  style={{ cursor: mediaZoom > 1 ? (mediaDragState ? "grabbing" : "grab") : "zoom-in" }}
                                >
                                  <div
                                    className="activity-modal-zoom-canvas"
                                    style={{ transform: `translate3d(${mediaPan.x}px, ${mediaPan.y}px, 0) scale(${mediaZoom})` }}
                                  >
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                      src={selectedNode.mediaDetails.url}
                                      alt={selectedNode.mediaDetails.label || `${selectedNode.mediaDetails.kind} preview`}
                                      className="message-media-image modal-preview-image"
                                      draggable={false}
                                    />
                                  </div>
                                </div>
                                <p className="queue-meta">Use mouse wheel to zoom and drag to pan while zoomed in.</p>
                              </div>
                            ) : selectedNode.mediaDetails.mimeType.toLowerCase().startsWith("video/") ||
                              selectedNode.mediaDetails.kind === "video" ? (
                              <video src={selectedNode.mediaDetails.url} controls preload="metadata" className="message-media-video" />
                            ) : selectedNode.mediaDetails.mimeType.toLowerCase().startsWith("audio/") ||
                              selectedNode.mediaDetails.kind === "audio" ? (
                              <audio src={selectedNode.mediaDetails.url} controls preload="none" className="message-media-audio" />
                            ) : (
                              <a href={selectedNode.mediaDetails.url} target="_blank" rel="noreferrer" className="message-media-link">
                                Open attachment
                              </a>
                            )
                          ) : (
                            <p className="empty-line">Media URL unavailable.</p>
                          )}

                          <div className="queue-actions">
                            {selectedNode.mediaDetails.url ? (
                              <a href={selectedNode.mediaDetails.url} target="_blank" rel="noreferrer" className="btn btn-ghost">
                                Open Raw
                              </a>
                            ) : null}
                            {selectedNode.mediaDetails.threadId ? (
                              <Link href={`/conversations?threadId=${selectedNode.mediaDetails.threadId}`} className="btn btn-ghost">
                                Open Thread
                              </Link>
                            ) : null}
                          </div>
                        </div>
                      ),
                    },
                    {
                      id: "context",
                      label: "Context",
                      content: (
                        <div className="queue-item">
                          <p className="queue-meta">
                            Kind: {selectedNode.mediaDetails.kind} · MIME: {selectedNode.mediaDetails.mimeType || "unknown"} ·{" "}
                            {selectedNode.mediaDetails.enabled ? "Enabled" : "Disabled"}
                          </p>
                          <p className="queue-meta">
                            Source: {selectedNode.mediaDetails.source === "message" ? "Message timeline" : "Media library"}
                          </p>
                          {selectedNode.mediaDetails.tags.length ? (
                            <p className="queue-meta">Tags: {selectedNode.mediaDetails.tags.join(", ")}</p>
                          ) : null}
                          {selectedNode.mediaDetails.messageText ? (
                            <p className="queue-body">Message: {trim(selectedNode.mediaDetails.messageText, 500)}</p>
                          ) : null}
                          {selectedNode.mediaDetails.messageCaption ? (
                            <p className="queue-meta">Caption: {trim(selectedNode.mediaDetails.messageCaption, 320)}</p>
                          ) : null}
                          {selectedNode.mediaDetails.messageType ? (
                            <p className="queue-meta">Message type: {selectedNode.mediaDetails.messageType}</p>
                          ) : null}
                          {selectedNode.mediaDetails.messageDirection ? (
                            <p className="queue-meta">Direction: {selectedNode.mediaDetails.messageDirection}</p>
                          ) : null}
                          {selectedNode.mediaDetails.messageAt ? (
                            <p className="queue-meta">Message time: {formatDateTime(selectedNode.mediaDetails.messageAt)}</p>
                          ) : null}
                          {selectedNode.mediaDetails.contextSummary ? (
                            <p className="queue-body">Context summary: {trim(selectedNode.mediaDetails.contextSummary, 360)}</p>
                          ) : null}
                          {selectedNode.mediaDetails.contextTags?.length ? (
                            <p className="queue-meta">Context tags: {selectedNode.mediaDetails.contextTags.join(", ")}</p>
                          ) : null}
                          {selectedNode.mediaDetails.contextTriggers?.length ? (
                            <p className="queue-meta">Use when: {selectedNode.mediaDetails.contextTriggers.join(", ")}</p>
                          ) : null}
                          {selectedNode.mediaDetails.contextAvoid?.length ? (
                            <p className="queue-meta">Avoid when: {selectedNode.mediaDetails.contextAvoid.join(", ")}</p>
                          ) : null}
                          {typeof selectedNode.mediaDetails.contextConfidence === "number" ? (
                            <p className="queue-meta">Context confidence: {(selectedNode.mediaDetails.contextConfidence * 100).toFixed(0)}%</p>
                          ) : null}
                          {selectedNode.mediaDetails.threadTitle || selectedNode.mediaDetails.threadJid ? (
                            <p className="queue-meta">{selectedNode.mediaDetails.threadTitle || selectedNode.mediaDetails.threadJid}</p>
                          ) : null}
                        </div>
                      ),
                    },
                  ]
                : []),
            ]}
          />
        ) : null}
      </UIModal>
    </section>
  );
}
