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

type MessageProvider = "whatsapp" | "instagram" | "imessage" | "telegram";

type SetupSnapshot = {
  hasAuth?: boolean;
  listenerActive?: boolean;
} | null;

const PROVIDERS: MessageProvider[] = ["whatsapp", "instagram", "imessage", "telegram"];

function providerLabel(provider: MessageProvider) {
  if (provider === "instagram") {
    return "Instagram";
  }
  if (provider === "imessage") {
    return "iMessage";
  }
  if (provider === "telegram") {
    return "Telegram";
  }
  return "WhatsApp";
}

function ControlsView({
  autonomyPaused,
  statusTone,
  toggleDisabled,
  toggleLabel,
  pending,
  pendingLabel,
  restartPending,
  restartPendingLabel,
  restartLabel,
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
  restartLabel?: string;
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
          {restartPending ? restartPendingLabel || "Restarting..." : restartLabel || "Restart Worker"}
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
  const statusLoading = runtimeStatus === undefined;
  const setupByProvider: Record<MessageProvider, SetupSnapshot | undefined> = {
    whatsapp: runtimeStatus?.providers.whatsapp,
    instagram: runtimeStatus?.providers.instagram,
    imessage: runtimeStatus?.providers.imessage,
    telegram: runtimeStatus?.providers.telegram,
  };
  const restartableProviders = PROVIDERS.filter((provider) => setupByProvider[provider]?.hasAuth === true);

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
  const canRestartWorker = restartableProviders.length > 0;
  const restartLabel =
    restartableProviders.length === 1 ? `Restart ${providerLabel(restartableProviders[0])}` : "Restart Workers";

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
        if (restartableProviders.length === 0) {
          throw new Error("No connected providers have saved credentials to restart.");
        }
        const results = await Promise.all(
          restartableProviders.map(async (provider) => {
            const response = await fetch(`/api/setup/${provider}/restart-worker`, {
              method: "POST",
            });
            const payload = (await response.json()) as { status?: string; message?: string; error?: string };
            if (!response.ok || payload.status === "error") {
              throw new Error(`${providerLabel(provider)}: ${payload.message || payload.error || "Failed to restart worker."}`);
            }
            return provider;
          }),
        );
        if (results.length === 0) {
          throw new Error("No workers were restarted.");
        }
      },
      {
        pendingLabel: restartableProviders.length === 1 ? `Restarting ${providerLabel(restartableProviders[0])}...` : "Restarting workers...",
        successMessage: restartableProviders.length === 1 ? `${providerLabel(restartableProviders[0])} restart requested.` : "Worker restarts requested.",
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
        restartLabel={restartLabel}
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
