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
  error,
  onToggle,
}: {
  autonomyPaused: boolean;
  pending: boolean;
  pendingLabel?: string;
  error?: string;
  onToggle?: () => void;
}) {
  return (
    <div className="topbar-controls" aria-busy={pending}>
      <span className={`status-pill ${autonomyPaused ? "status-paused" : "status-active"}`}>
        {autonomyPaused ? "Autonomy Paused" : "Autonomy Active"}
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
      ) : (
        <form action={autonomyPaused ? "/api/actions/resume-autonomy" : "/api/actions/pause-autonomy"} method="post">
          <button type="submit" className="btn btn-primary">
            {autonomyPaused ? "Resume" : "Pause"}
          </button>
        </form>
      )}

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

  const health = useQuery(api.system.health, {}) as
    | {
        config?: { autonomyPaused?: boolean };
      }
    | undefined;

  const autonomyPaused = health?.config?.autonomyPaused ?? fallbackPaused ?? false;
  const key = "autonomy:toggle";

  const { runAction, getRecord, notices, dismissNotice } = useActionStateRegistry();
  const record = getRecord(key);

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

  return (
    <div className="topbar-controls-shell">
      <ControlsView
        autonomyPaused={autonomyPaused}
        pending={record.pending}
        pendingLabel={record.pendingLabel}
        error={record.error}
        onToggle={toggle}
      />
      <ActionNotices notices={notices} onDismiss={dismissNotice} />
    </div>
  );
}

export function AutonomyControls({ realtimeEnabled, fallbackPaused }: AutonomyControlsProps) {
  if (!realtimeEnabled) {
    return (
      <div className="topbar-controls-shell">
        <ControlsView autonomyPaused={fallbackPaused ?? false} pending={false} />
      </div>
    );
  }

  return <ControlsRealtime fallbackPaused={fallbackPaused} />;
}
