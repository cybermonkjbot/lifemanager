"use client";

import { ActionNotices } from "@/components/action-notices";
import { useActionStateRegistry } from "@/lib/ui/action-state";
import { api } from "../../convex/_generated/api";
import { useMutation, useQuery } from "convex/react";

type AutonomyControlsProps = {
  realtimeEnabled: boolean;
  fallbackPaused?: boolean;
};

function ControlsView({
  autonomyPaused,
  pending,
  pendingLabel,
  restartPending,
  restartPendingLabel,
  canRestartWorker,
  error,
  onToggle,
  onRestartWorker,
  showFormFallback = false,
  statusLabel,
}: {
  autonomyPaused: boolean;
  pending: boolean;
  pendingLabel?: string;
  restartPending?: boolean;
  restartPendingLabel?: string;
  canRestartWorker?: boolean;
  error?: string;
  onToggle?: () => void;
  onRestartWorker?: () => void;
  showFormFallback?: boolean;
  statusLabel?: string;
}) {
  return (
    <div className="topbar-controls" aria-busy={pending}>
      <span className={`status-pill ${autonomyPaused ? "status-paused" : "status-active"}`}>
        {statusLabel || (autonomyPaused ? "Autonomy Paused" : "Autonomy Active")}
      </span>

      {onToggle ? (
        <button
          type="button"
          className="btn btn-primary"
          onClick={onToggle}
          disabled={pending}
          aria-disabled={pending}
        >
          {pending ? pendingLabel || "Working..." : autonomyPaused ? "Resume" : "Pause"}
        </button>
      ) : showFormFallback ? (
        <form action={autonomyPaused ? "/api/actions/resume-autonomy" : "/api/actions/pause-autonomy"} method="post">
          <button type="submit" className="btn btn-primary">
            {autonomyPaused ? "Resume" : "Pause"}
          </button>
        </form>
      ) : (
        <button type="button" className="btn btn-primary" disabled aria-disabled>
          {pending ? pendingLabel || "Loading..." : "Loading..."}
        </button>
      )}

      {onRestartWorker ? (
        <button
          type="button"
          className="btn btn-ghost"
          onClick={onRestartWorker}
          disabled={restartPending || !canRestartWorker}
          aria-disabled={restartPending || !canRestartWorker}
        >
          {restartPending ? restartPendingLabel || "Restarting..." : "Restart Worker"}
        </button>
      ) : null}

      {error ? (
        <p className="queue-meta action-inline-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function ControlsRealtime({ fallbackPaused }: { fallbackPaused?: boolean }) {
  const pauseAutonomy = useMutation(api.system.pauseAutonomy);
  const resumeAutonomy = useMutation(api.system.resumeAutonomy);
  const setup = useQuery(api.system.setupStatus, {}) as
    | {
        hasAuth?: boolean;
      }
    | null
    | undefined;

  const health = useQuery(api.system.health, {}) as
    | {
        config?: { autonomyPaused?: boolean };
      }
    | undefined;
  const healthLoading = health === undefined;
  const setupLoading = setup === undefined;

  const autonomyPaused = health?.config?.autonomyPaused ?? fallbackPaused ?? false;
  const key = "autonomy:toggle";
  const restartKey = "worker:restart";

  const { runAction, getRecord, notices, dismissNotice } = useActionStateRegistry();
  const record = getRecord(key);
  const restartRecord = getRecord(restartKey);
  const canRestartWorker = Boolean(setup?.hasAuth);

  const toggle = () => {
    void runAction(
      key,
      async () => {
        if (autonomyPaused) {
          await resumeAutonomy({});
        } else {
          await pauseAutonomy({});
        }
      },
      {
        pendingLabel: autonomyPaused ? "Resuming..." : "Pausing...",
        successMessage: autonomyPaused ? "Autonomy resumed." : "Autonomy paused.",
      },
    );
  };

  const restartWorker = () => {
    void runAction(
      restartKey,
      async () => {
        const response = await fetch("/api/setup/whatsapp/restart-worker", {
          method: "POST",
        });
        const payload = (await response.json()) as { status?: string; message?: string };
        if (!response.ok || payload.status === "error") {
          throw new Error(payload.message || "Failed to restart worker.");
        }
      },
      {
        pendingLabel: "Restarting worker...",
        successMessage: "Worker restart requested.",
      },
    );
  };

  return (
    <div className="topbar-controls-shell">
      <ControlsView
        autonomyPaused={autonomyPaused}
        pending={record.pending || healthLoading}
        pendingLabel={record.pendingLabel}
        restartPending={restartRecord.pending || setupLoading}
        restartPendingLabel={restartRecord.pendingLabel}
        canRestartWorker={canRestartWorker && !setupLoading}
        error={record.error}
        onToggle={healthLoading ? undefined : toggle}
        onRestartWorker={setupLoading ? undefined : restartWorker}
        statusLabel={healthLoading ? "Loading Autonomy..." : undefined}
      />
      <ActionNotices notices={notices} onDismiss={dismissNotice} />
    </div>
  );
}

export function AutonomyControls({ realtimeEnabled, fallbackPaused }: AutonomyControlsProps) {
  if (!realtimeEnabled) {
    return (
      <div className="topbar-controls-shell">
        <ControlsView autonomyPaused={fallbackPaused ?? false} pending={false} showFormFallback />
      </div>
    );
  }

  return <ControlsRealtime fallbackPaused={fallbackPaused} />;
}
