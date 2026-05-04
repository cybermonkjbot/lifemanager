"use client";

import { ActionNotices } from "@/components/action-notices";
import { useRuntimeStatus } from "@/components/runtime-status-provider";
import { useTenantScopeArgs } from "@/components/tenant-scope-provider";
import { useActionStateRegistry } from "@/lib/ui/action-state";
import { api } from "../../convex/_generated/api";
import { useMutation } from "convex/react";

type AutonomyControlsProps = {
  realtimeEnabled: boolean;
  fallbackPaused?: boolean;
};

function ControlsView({
  autonomyPaused,
  statusTone,
  toggleDisabled,
  toggleLabel,
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
  statusTone?: "active" | "paused";
  toggleDisabled?: boolean;
  toggleLabel?: string;
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
  const effectiveStatusTone = statusTone ?? (autonomyPaused ? "paused" : "active");
  const toggleIsDisabled = pending || Boolean(toggleDisabled);

  return (
    <div className="topbar-controls" aria-busy={pending}>
      <span className={`status-pill ${effectiveStatusTone === "active" ? "status-active" : "status-paused"}`}>
        {statusLabel || (autonomyPaused ? "Automation Paused" : "Automation Active")}
      </span>

      {onToggle ? (
        <button
          type="button"
          className="btn btn-primary"
          onClick={onToggle}
          disabled={toggleIsDisabled}
          aria-disabled={toggleIsDisabled}
        >
          {pending ? pendingLabel || "Working..." : toggleLabel || (autonomyPaused ? "Resume" : "Pause")}
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
  const tenantScope = useTenantScopeArgs();
  const runtimeStatus = useRuntimeStatus();
  const pauseAutonomy = useMutation(api.system.pauseAutonomy);
  const resumeAutonomy = useMutation(api.system.resumeAutonomy);
  const setup = runtimeStatus?.providers.whatsapp;
  const statusLoading = runtimeStatus === undefined;

  const billingBlocked = runtimeStatus?.billing.blocked === true;
  const autonomyPaused = billingBlocked || (runtimeStatus?.autonomyPaused ?? fallbackPaused ?? false);
  const anyWorkerConnected = runtimeStatus?.anyWorkerConnected === true;
  const statusLabel = statusLoading
    ? "Loading..."
    : billingBlocked
      ? "Automation Billing Blocked"
    : autonomyPaused
      ? "Automation Paused"
      : anyWorkerConnected
        ? "Automation Active"
        : "Automation Offline";
  const statusTone = !autonomyPaused && anyWorkerConnected ? "active" : "paused";
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
          await resumeAutonomy(tenantScope);
        } else {
          await pauseAutonomy(tenantScope);
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
        const payload = (await response.json()) as { status?: string; message?: string; error?: string };
        if (!response.ok || payload.status === "error") {
          throw new Error(payload.message || payload.error || "Failed to restart worker.");
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
        statusTone={statusTone}
        toggleDisabled={billingBlocked}
        toggleLabel={billingBlocked ? "Billing Required" : undefined}
        pending={record.pending || statusLoading}
        pendingLabel={record.pendingLabel}
        restartPending={restartRecord.pending || statusLoading}
        restartPendingLabel={restartRecord.pendingLabel}
        canRestartWorker={canRestartWorker && !statusLoading}
        error={record.error || (billingBlocked ? runtimeStatus?.billing.reason : undefined)}
        onToggle={statusLoading ? undefined : toggle}
        onRestartWorker={statusLoading ? undefined : restartWorker}
        statusLabel={statusLabel}
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
