"use client";

import { ActionNotices } from "@/components/action-notices";
import { useActionStateRegistry } from "@/lib/ui/action-state";
import { api } from "../../convex/_generated/api";
import { useQuery } from "convex/react";
import Image from "next/image";
import { useEffect, useMemo, useState } from "react";

type SetupStatus = "idle" | "starting" | "qr_ready" | "code_ready" | "syncing" | "connected" | "error";
type SetupMode = "qr" | "pairing_code";

type SetupState = {
  status: SetupStatus;
  mode: SetupMode;
  message: string;
  qrDataUrl?: string;
  pairingCode?: string;
  listenerActive?: boolean;
  listenerWorkerId?: string;
  listenerMessage?: string;
  listenerLastSeenAt?: number;
  updatedAt: number;
  hasAuth: boolean;
};

type SetupWizardProps = {
  realtimeEnabled: boolean;
};

function statusLabel(status: SetupStatus) {
  if (status === "idle") return "Idle";
  if (status === "starting") return "Starting";
  if (status === "qr_ready") return "QR Ready";
  if (status === "code_ready") return "Code Ready";
  if (status === "syncing") return "Syncing";
  if (status === "connected") return "Connected";
  return "Error";
}

function getRetryGuidance(state: SetupState | null) {
  if (!state || state.status !== "starting") {
    return null;
  }

  const message = state.message.toLowerCase();
  const isRetrying = message.includes("retrying");
  if (!isRetrying) {
    return null;
  }

  if (state.mode === "pairing_code") {
    return "Pairing code session expired. Auto-retrying now. Keep this page open and enter the newest code as soon as it appears.";
  }

  return "QR session expired. Auto-retrying now. Keep this page open and scan the next QR as soon as it appears.";
}

function getRevokedGuidance(state: SetupState | null) {
  if (!state) {
    return null;
  }

  const text = `${state.message} ${state.listenerMessage || ""}`.toLowerCase();
  const revokedByMessage =
    text.includes("signed this device out") ||
    text.includes("logged out this device") ||
    text.includes("credentials were cleared") ||
    text.includes("credentials were invalidated");

  if (!revokedByMessage) {
    return null;
  }

  return "WhatsApp revoked this linked device session. Credentials were invalidated. Run setup again to pair a new session.";
}

async function readSetupResponse(response: Response) {
  let body: SetupState | null = null;

  try {
    body = (await response.json()) as SetupState;
  } catch {
    // fallback handled below
  }

  if (!response.ok) {
    const reason = body?.message || `Setup request failed (${response.status})`;
    throw new Error(reason);
  }

  if (!body) {
    throw new Error("Setup request returned an empty response.");
  }

  return body;
}

function SetupWizardContent({
  liveState,
  realtimeEnabled,
}: {
  liveState: SetupState | null | undefined;
  realtimeEnabled: boolean;
}) {
  const [localState, setLocalState] = useState<SetupState | null>(null);
  const [phoneNumber, setPhoneNumber] = useState("");

  const { runAction, isPending, anyPending, notices, dismissNotice } = useActionStateRegistry();

  const state = useMemo(() => {
    if (!liveState) {
      return localState;
    }
    if (!localState) {
      return liveState;
    }
    return localState.updatedAt > liveState.updatedAt ? localState : liveState;
  }, [liveState, localState]);
  const status = state?.status ?? "idle";
  const isConnected = status === "connected" || state?.listenerActive === true;
  const isSyncing = status === "syncing";
  const showPairingCode = state?.mode === "pairing_code" && status === "code_ready" && Boolean(state?.pairingCode);
  const showQrCode = state?.mode === "qr" && status === "qr_ready" && Boolean(state?.qrDataUrl);
  const retryGuidance = getRetryGuidance(state);
  const revokedGuidance = getRevokedGuidance(state);

  const pendingStartQr = isPending("setup:start_qr");
  const pendingStartCode = isPending("setup:start_code");
  const pendingRefresh = isPending("setup:refresh");
  const pendingStop = isPending("setup:stop");
  const pendingReset = isPending("setup:reset");

  const normalizedPhone = phoneNumber.replace(/[^\d]/g, "");
  const hasPhoneForPairing = normalizedPhone.length >= 8;

  const controls = useMemo(() => {
    const isIdleOrError = status === "idle" || status === "error";
    const isStarting = status === "starting";
    const isSyncing = status === "syncing";
    const isReady = status === "qr_ready" || status === "code_ready";
    const hasActiveQrSession = state?.mode === "qr" && status === "qr_ready";
    const hasActiveSetupState =
      isStarting ||
      isSyncing ||
      isReady ||
      isConnected ||
      Boolean(state?.listenerActive) ||
      pendingStartQr ||
      pendingStartCode;

    const allowStart = !anyPending && (isIdleOrError || isReady);

    return {
      canStartQr: allowStart && !isConnected && !hasActiveQrSession,
      canStartCode: allowStart && !isConnected,
      canRefresh: !anyPending,
      canStop: !pendingStop && !pendingReset && hasActiveSetupState,
      canReset: !anyPending && (isIdleOrError || isConnected),
      canEditPhone: !anyPending,
    };
  }, [
    anyPending,
    isConnected,
    pendingReset,
    pendingStartCode,
    pendingStartQr,
    pendingStop,
    state?.listenerActive,
    state?.mode,
    status,
  ]);

  const pendingLabel = useMemo(() => {
    if (pendingStartQr) return "Starting QR session...";
    if (pendingStartCode) return "Starting pairing-code session...";
    if (pendingRefresh) return "Refreshing status...";
    if (pendingStop) return "Stopping setup session...";
    if (pendingReset) return "Resetting credentials...";
    return "";
  }, [pendingRefresh, pendingReset, pendingStartCode, pendingStartQr, pendingStop]);

  const refresh = () => {
    void runAction(
      "setup:refresh",
      async () => {
        const response = await fetch("/api/setup/whatsapp/status", { cache: "no-store" });
        const next = await readSetupResponse(response);
        setLocalState(next);
      },
      {
        pendingLabel: "Refreshing...",
        suppressSuccessNotice: true,
      },
    );
  };

  const startSetup = (mode: SetupMode) => {
    const key = mode === "qr" ? "setup:start_qr" : "setup:start_code";

    void runAction(
      key,
      async () => {
        const response = await fetch("/api/setup/whatsapp/start", {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            mode,
            phoneNumber: normalizedPhone,
          }),
        });

        const next = await readSetupResponse(response);
        setLocalState(next);
      },
      {
        pendingLabel: mode === "qr" ? "Starting QR..." : "Starting pairing code...",
      },
    );
  };

  const stopSetup = () => {
    void runAction(
      "setup:stop",
      async () => {
        const response = await fetch("/api/setup/whatsapp/stop", {
          method: "POST",
        });

        const next = await readSetupResponse(response);
        setLocalState(next);
      },
      {
        pendingLabel: "Stopping...",
      },
    );
  };

  const resetSetup = () => {
    void runAction(
      "setup:reset",
      async () => {
        const response = await fetch("/api/setup/whatsapp/reset", {
          method: "POST",
        });

        const next = await readSetupResponse(response);
        setLocalState(next);
      },
      {
        pendingLabel: "Resetting...",
      },
    );
  };

  useEffect(() => {
    if (!realtimeEnabled) {
      refresh();
    }
    // only on mount/fallback mode change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [realtimeEnabled]);

  useEffect(() => {
    const shouldPollForAutoStart = status === "connected" && !state?.listenerActive;
    const shouldPoll = realtimeEnabled
      ? ((status === "starting" || status === "syncing") && !state?.qrDataUrl && !state?.pairingCode) || shouldPollForAutoStart
      : status === "starting" ||
          status === "syncing" ||
          status === "qr_ready" ||
          status === "code_ready" ||
          shouldPollForAutoStart;

    if (!shouldPoll) {
      return;
    }

    let cancelled = false;
    const interval = setInterval(async () => {
      try {
        const response = await fetch("/api/setup/whatsapp/status", { cache: "no-store" });
        const next = await readSetupResponse(response);
        if (!cancelled) {
          setLocalState(next);
        }
      } catch {
        // best effort background sync only
      }
    }, status === "connected" ? 1200 : realtimeEnabled ? 2200 : 1500);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [realtimeEnabled, state?.listenerActive, state?.pairingCode, state?.qrDataUrl, status]);

  return (
    <section className="setup-wizard" aria-busy={anyPending}>
      <div className="setup-wizard-card">
        <ActionNotices notices={notices} onDismiss={dismissNotice} />
        <p className="queue-meta">Wizard Status</p>
        <h3>WhatsApp Connection Setup</h3>
        <p className="queue-body">
          Use this wizard to pair WhatsApp and persist credentials for the worker. If QR keeps dropping, switch to pairing code mode.
        </p>

        <div className="setup-status-row">
          <span
            className={`status-pill ${
              state?.listenerActive || status === "connected"
                ? "status-active"
                : isSyncing
                  ? "status-syncing"
                  : "status-paused"
            }`}
          >
            {state?.listenerActive ? "Connected" : statusLabel(status)}
          </span>
          <span className="queue-meta">{state?.message || "Loading status..."}</span>
        </div>

        <p className="queue-meta">
          Listener: {state?.listenerActive ? "Active" : "Offline"}
          {state?.listenerWorkerId ? ` (${state.listenerWorkerId})` : ""}
        </p>
        {state?.listenerMessage ? <p className="queue-meta">{state.listenerMessage}</p> : null}

        {retryGuidance ? (
          <p className="setup-retry-notice" role="status" aria-live="polite">
            {retryGuidance}
          </p>
        ) : null}

        {revokedGuidance ? (
          <p className="setup-revoked-notice" role="alert" aria-live="assertive">
            {revokedGuidance}
          </p>
        ) : null}

        {pendingLabel ? (
          <p className="queue-meta action-pending-label" aria-live="polite">
            {pendingLabel}
          </p>
        ) : null}

        <div className="wizard-actions">
          <button
            className="btn btn-primary"
            type="button"
            onClick={() => startSetup("qr")}
            disabled={!controls.canStartQr}
            aria-disabled={!controls.canStartQr}
          >
            {pendingStartQr ? "Starting..." : "Start QR Session"}
          </button>
          <button
            className="btn btn-ghost"
            type="button"
            onClick={() => startSetup("pairing_code")}
            disabled={!controls.canStartCode || !hasPhoneForPairing}
            aria-disabled={!controls.canStartCode || !hasPhoneForPairing}
          >
            {pendingStartCode ? "Starting..." : "Get Pairing Code"}
          </button>
          <button
            className="btn btn-ghost"
            type="button"
            onClick={refresh}
            disabled={!controls.canRefresh}
            aria-disabled={!controls.canRefresh}
          >
            {pendingRefresh ? "Refreshing..." : "Refresh"}
          </button>
          <button
            className="btn btn-ghost"
            type="button"
            onClick={stopSetup}
            disabled={!controls.canStop}
            aria-disabled={!controls.canStop}
          >
            {pendingStop ? "Stopping..." : "Stop Session"}
          </button>
          <button
            className="btn btn-ghost"
            type="button"
            onClick={resetSetup}
            disabled={!controls.canReset}
            aria-disabled={!controls.canReset}
          >
            {pendingReset ? "Resetting..." : "Reset Credentials"}
          </button>
        </div>

        <label className="setup-input-group">
          <span className="queue-meta">Phone Number (for pairing code mode)</span>
          <input
            type="text"
            inputMode="tel"
            placeholder="2348012345678"
            value={phoneNumber}
            onChange={(event) => setPhoneNumber(event.target.value)}
            disabled={!controls.canEditPhone}
            aria-disabled={!controls.canEditPhone}
          />
        </label>

        {state?.status === "error" ? (
          <p className="queue-meta">
            If this keeps failing, stop <code>bun run worker</code>, click <strong>Reset Credentials</strong>, then retry with
            <strong> Get Pairing Code</strong>.
          </p>
        ) : null}

        <div className="wizard-steps">
          <article className="wizard-step">
            <p className="queue-title">Step 1</p>
            <p className="queue-body">
              Try <strong>Start QR Session</strong> first.
            </p>
          </article>
          <article className="wizard-step">
            <p className="queue-title">Step 2</p>
            <p className="queue-body">
              If QR fails, use <strong>Get Pairing Code</strong> with your number.
            </p>
          </article>
          <article className="wizard-step">
            <p className="queue-title">Step 3</p>
            <p className="queue-body">
              After <strong>Connected</strong>, worker auto-starts. If not, run <code>bun run worker</code>.
            </p>
          </article>
        </div>
      </div>

      <div className="setup-wizard-card">
        <p className="queue-meta">Pairing</p>
        <h3>{state?.mode === "pairing_code" ? "Pairing Code" : "QR Code"}</h3>

        {showPairingCode ? <p className="pairing-code">{state?.pairingCode}</p> : null}

        {showQrCode ? (
          <div className={`qr-frame ${isConnected ? "qr-frame-connected" : ""}`}>
            <Image src={state!.qrDataUrl!} width={320} height={320} alt="WhatsApp setup QR code" unoptimized />
            {isConnected ? (
              <div className="qr-frame-overlay" aria-hidden="true">
                <span>QR Code</span>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="empty-line">
            {state?.mode === "pairing_code"
              ? "Pairing code will appear here after requesting it."
              : "QR code will appear here after starting setup."}
          </p>
        )}

        <p className="queue-meta">Credentials found: {state?.hasAuth ? "Yes" : "No"}</p>
      </div>
    </section>
  );
}

function SetupWizardRealtime() {
  const liveState = useQuery(api.system.setupStatus, {}) as SetupState | null | undefined;
  return <SetupWizardContent liveState={liveState} realtimeEnabled />;
}

export function SetupWizard({ realtimeEnabled }: SetupWizardProps) {
  if (!realtimeEnabled) {
    return <SetupWizardContent liveState={null} realtimeEnabled={false} />;
  }

  return <SetupWizardRealtime />;
}
