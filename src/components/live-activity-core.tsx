"use client";

import { formatDateTime, trim } from "@/lib/format";
import { api } from "../../convex/_generated/api";
import { useQuery } from "convex/react";
import dynamic from "next/dynamic";
import { CSSProperties, useMemo } from "react";

type ActivityStatus = "active" | "paused" | "non-active";

type ActivityLogRow = {
  id: string;
  source: string;
  eventType: string;
  detail: string;
  createdAt: number;
};

type LiveActivityCoreProps = {
  splineSceneUrl: string;
};

const Spline = dynamic(() => import("@splinetool/react-spline"), { ssr: false });

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
  return source;
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

function polarPlacement(index: number, total: number) {
  const safeTotal = Math.max(total, 1);
  const ring = index % 4;
  const ringRadius = 150 + ring * 44;
  const angle = (index / safeTotal) * Math.PI * 2;
  const x = Math.round(Math.cos(angle) * ringRadius);
  const y = Math.round(Math.sin(angle) * ringRadius);
  return {
    left: `calc(50% + ${x}px)`,
    top: `calc(50% + ${y}px)`,
    animationDelay: `${index * 90}ms`,
  };
}

export function LiveActivityCore({ splineSceneUrl }: LiveActivityCoreProps) {
  const logs = useQuery(api.system.logFeed, { limit: 36 }) as ActivityLogRow[] | undefined;
  const rows = logs || [];
  const loading = logs === undefined;
  const splineSource = useMemo(() => resolveSplineSource(splineSceneUrl), [splineSceneUrl]);

  const statusCounts = {
    active: 0,
    paused: 0,
    "non-active": 0,
  };

  const logsWithStatus = rows.map((row) => {
    const status = classifyActivityStatus(row.eventType, row.detail);
    statusCounts[status] += 1;
    return {
      ...row,
      status,
    };
  });

  const activeScale = 1 + Math.min(statusCounts.active, 16) * 0.04;
  const pausedScale = 1 + Math.min(statusCounts.paused, 16) * 0.04;
  const nonActiveScale = 1 + Math.min(statusCounts["non-active"], 16) * 0.04;

  const stageStyle: CSSProperties = {
    position: "relative",
    minHeight: "min(74vh, 780px)",
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

  return (
    <section className="activity-core-shell">
      <div className="activity-core-stage" style={stageStyle} aria-live="polite">
        <div className="activity-core-background" style={{ position: "absolute", inset: 0, zIndex: 1, pointerEvents: "none" }} aria-hidden="true">
          {logsWithStatus.map((log, index) => (
            <article
              key={log.id}
              className={`activity-log-node status-${log.status}`}
              style={{ ...baseNodeStyle, ...statusNodeStyle[log.status], ...polarPlacement(index, logsWithStatus.length) }}
            >
              <p style={{ margin: 0, fontSize: "0.79rem", color: "#f4f4f4", fontWeight: 700 }}>
                {sourceLabel(log.source)} · {log.eventType}
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

      {loading ? <p className="empty-line">Streaming activity logs and status glow states…</p> : null}
    </section>
  );
}
