"use client";

import { ActionNotices } from "@/components/action-notices";
import { LoadingIndicator } from "@/components/loading-state";
import { useActionStateRegistry } from "@/lib/ui/action-state";
import { api } from "../../convex/_generated/api";
import { useQuery } from "convex/react";
import Image from "next/image";
import { useEffect, useMemo, useState } from "react";

type SetupStatus =
  | "idle"
  | "starting"
  | "authenticating"
  | "qr_ready"
  | "code_ready"
  | "challenge_required"
  | "syncing"
  | "connected"
  | "error";
type SetupMode = "qr" | "pairing_code" | "password" | "challenge_code";
type WhatsAppSetupMode = "qr" | "pairing_code";

type SetupState = {
  status: SetupStatus;
  mode: SetupMode;
  message: string;
  qrDataUrl?: string;
  pairingCode?: string;
  challengeContactPoint?: string;
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

type SetupWizardScreen = "options" | "whatsapp" | "pairing" | "instagram";

const setupWizardScreens: Record<
  SetupWizardScreen,
  {
    title: string;
    description: string;
  }
> = {
  options: {
    title: "Setup Wizard",
    description: "Choose which connection to configure first. You will see one focused screen at a time.",
  },
  whatsapp: {
    title: "WhatsApp Setup",
    description: "Start pairing first, then complete scan/code on the pairing screen.",
  },
  pairing: {
    title: "WhatsApp Pairing",
    description: "Use this screen only to scan QR or copy pairing code.",
  },
  instagram: {
    title: "Instagram Setup",
    description: "Sign in, then submit a challenge code only if Instagram asks for one.",
  },
};

function statusToneClass(status: SetupStatus, listenerActive?: boolean) {
  if (listenerActive || status === "connected") {
    return "status-active";
  }

  if (
    status === "starting" ||
    status === "authenticating" ||
    status === "qr_ready" ||
    status === "code_ready" ||
    status === "challenge_required" ||
    status === "syncing"
  ) {
    return "status-syncing";
  }

  return "status-paused";
}

function statusLabel(status: SetupStatus) {
  if (status === "idle") return "Idle";
  if (status === "starting") return "Starting";
  if (status === "authenticating") return "Authenticating";
  if (status === "qr_ready") return "QR Ready";
  if (status === "code_ready") return "Code Ready";
  if (status === "challenge_required") return "Challenge Required";
  if (status === "syncing") return "Syncing";
  if (status === "connected") return "Connected";
  return "Error";
}

function simplifySetupMessage(message?: string) {
  if (!message) {
    return "Loading status...";
  }

  let next = message.replace(/\s+\(PID\s+\d+\)\.?/gi, ".").trim();
  next = next.replace(/run\s+`bun run worker`\s+manually\.?/gi, "Please try again.");
  next = next.replace(/run\s+`bun run worker:instagram`\s+manually\.?/gi, "Please try again.");
  next = next.replace(/worker listener is offline\.?/gi, "Connection is idle.");
  return next;
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

  if (state.status === "starting" || state.status === "qr_ready" || state.status === "code_ready" || state.status === "syncing") {
    return null;
  }

  const statusMessage = state.message.toLowerCase();
  const manualStopOrReset =
    statusMessage.includes("setup session stopped") ||
    statusMessage.includes("credentials reset");
  if (manualStopOrReset) {
    return null;
  }

  const text = `${state.message} ${state.listenerMessage || ""}`.toLowerCase();
  const revokedByMessage =
    text.includes("signed this device out") ||
    text.includes("logged out this device") ||
    text.includes("credentials were cleared") ||
    text.includes("credentials were invalidated");

  if (!revokedByMessage || state.hasAuth) {
    return null;
  }

  return "WhatsApp revoked this linked device session. Credentials were invalidated. Run setup again to pair a new session.";
}

function getFailureChecklist(state: SetupState | null) {
  if (!state) {
    return [];
  }

  const text = `${state.message} ${state.listenerMessage || ""}`.toLowerCase();
  const checks: string[] = [];
  if (text.includes("timed out") || text.includes("expired")) {
    checks.push("Session expired. Start a fresh QR/pairing session and complete pairing immediately.");
  }
  if (text.includes("network") || text.includes("socket") || text.includes("connection")) {
    checks.push("Connection instability detected. Keep this page open and retry once network is stable.");
  }
  if (text.includes("credentials") || text.includes("logged out") || text.includes("signed this device out")) {
    checks.push("Credentials are invalid. Use Reset Credentials, then pair again.");
  }
  if (text.includes("worker") && text.includes("offline")) {
    checks.push("Worker listener is offline. Restart worker after successful pairing.");
  }
  if (checks.length === 0 && state.status === "error") {
    checks.push("Unknown setup error. Refresh status, retry pairing, then restart worker.");
  }
  return checks;
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
  instagramLiveState,
  realtimeEnabled,
}: {
  liveState: SetupState | null | undefined;
  instagramLiveState: SetupState | null | undefined;
  realtimeEnabled: boolean;
}) {
  const [localState, setLocalState] = useState<SetupState | null>(null);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [activeScreen, setActiveScreen] = useState<SetupWizardScreen>("options");

  const { runAction, isPending, anyPending, notices, dismissNotice } = useActionStateRegistry();

  const liveStateLoading = realtimeEnabled && liveState === undefined && !localState;
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
  const showPairingCode = state?.mode === "pairing_code" && status === "code_ready" && Boolean(state?.pairingCode);
  const showQrCode = state?.mode === "qr" && status === "qr_ready" && Boolean(state?.qrDataUrl);
  const retryGuidance = getRetryGuidance(state);
  const revokedGuidance = getRevokedGuidance(state);
  const failureChecklist = getFailureChecklist(state);
  const uiStatusMessage = simplifySetupMessage(state?.message);

  const pendingStartQr = isPending("setup:start_qr");
  const pendingStartCode = isPending("setup:start_code");
  const pendingRefresh = isPending("setup:refresh");
  const pendingStop = isPending("setup:stop");
  const pendingRestart = isPending("setup:restart_worker");
  const pendingReset = isPending("setup:reset");

  const normalizedPhone = phoneNumber.replace(/[^\d]/g, "");
  const hasPhoneForPairing = normalizedPhone.length >= 8;
  const instagramStatus = instagramLiveState?.status ?? "idle";
  const instagramStatusText = instagramLiveState?.listenerActive ? "Connected" : statusLabel(instagramStatus);
  const whatsappStatusText = state?.listenerActive ? "Connected" : statusLabel(status);
  const activeScreenMeta = setupWizardScreens[activeScreen];
  const showBackToOptions = activeScreen !== "options";

  const controls = useMemo(() => {
    const isIdleOrError = status === "idle" || status === "error";
    const isStarting = status === "starting";
    const isSyncing = status === "syncing";
    const isReady = status === "qr_ready" || status === "code_ready";
    const isSetupSessionActive = isStarting || isSyncing || isReady;
    const hasActiveQrSession = state?.mode === "qr" && status === "qr_ready";
    const hasActiveSetupState =
      isStarting ||
      isSyncing ||
      isReady ||
      isConnected ||
      Boolean(state?.listenerActive) ||
      pendingStartQr ||
      pendingStartCode;

    const allowStart = !liveStateLoading && !anyPending && (isIdleOrError || isReady);

    return {
      canStartQr: allowStart && !isConnected && !hasActiveQrSession,
      canStartCode: allowStart && !isConnected,
      canRefresh: !anyPending,
      canStop: !pendingStop && !pendingReset && hasActiveSetupState,
      canRestartWorker: !anyPending && !liveStateLoading && Boolean(state?.hasAuth) && !isSetupSessionActive,
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
    liveStateLoading,
    state?.hasAuth,
    state?.listenerActive,
    state?.mode,
    status,
  ]);

  const pendingLabel = useMemo(() => {
    if (pendingStartQr) return "Starting QR session...";
    if (pendingStartCode) return "Starting pairing-code session...";
    if (pendingRefresh) return "Refreshing status...";
    if (pendingStop) return "Stopping setup session...";
    if (pendingRestart) return "Restarting worker...";
    if (pendingReset) return "Resetting credentials...";
    return "";
  }, [pendingRefresh, pendingReset, pendingRestart, pendingStartCode, pendingStartQr, pendingStop]);

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

  const startSetup = (mode: WhatsAppSetupMode) => {
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
        setActiveScreen("pairing");
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

  const restartWorker = () => {
    void runAction(
      "setup:restart_worker",
      async () => {
        const response = await fetch("/api/setup/whatsapp/restart-worker", {
          method: "POST",
        });

        const next = await readSetupResponse(response);
        setLocalState(next);
      },
      {
        pendingLabel: "Restarting worker...",
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
    <section className="setup-wizard setup-wizard-fullscreen" aria-busy={anyPending}>
      <div className="setup-wizard-stage">
        <header className="setup-flow-header">
          <div className="setup-flow-topline">
            <p className="queue-meta">Setup Wizard</p>
            {showBackToOptions ? (
              <button className="btn btn-ghost" type="button" onClick={() => setActiveScreen("options")}>
                Back to Options
              </button>
            ) : null}
          </div>
          <h3 className="setup-flow-title">{activeScreenMeta.title}</h3>
          <p className="queue-body setup-flow-description">{activeScreenMeta.description}</p>
        </header>

        <div className="setup-flow-panels">
          <section id="setup-panel-options" className="setup-flow-panel" hidden={activeScreen !== "options"}>
            <div className="setup-option-grid">
              <button className="setup-option-card" type="button" onClick={() => setActiveScreen("whatsapp")}>
                <p className="setup-option-kicker">WhatsApp</p>
                <h4>Connection Setup</h4>
                <p className="queue-meta">Recommended first step. Start session and complete pairing in one guided flow.</p>
                <span className={`status-pill ${statusToneClass(status, state?.listenerActive)}`}>{whatsappStatusText}</span>
              </button>
              <button className="setup-option-card" type="button" onClick={() => setActiveScreen("instagram")}>
                <p className="setup-option-kicker">Instagram</p>
                <h4>Connection Setup</h4>
                <p className="queue-meta">Sign in, submit challenge code, and verify listener health.</p>
                <span className={`status-pill ${statusToneClass(instagramStatus, instagramLiveState?.listenerActive)}`}>
                  {instagramStatusText}
                </span>
              </button>
            </div>
          </section>

          <section id="setup-panel-whatsapp" className="setup-flow-panel" hidden={activeScreen !== "whatsapp"}>
            <div className="setup-wizard-card">
              <ActionNotices notices={notices} onDismiss={dismissNotice} />
              <h3>WhatsApp Connection Setup</h3>
              <p className="queue-body">
                Pair WhatsApp and persist worker credentials. If QR drops repeatedly, switch to pairing code mode.
              </p>

              <div className="setup-status-row">
                <span className={`status-pill ${statusToneClass(status, state?.listenerActive)}`}>{whatsappStatusText}</span>
                <span className="queue-meta">{uiStatusMessage}</span>
              </div>
              {liveStateLoading ? <LoadingIndicator label="Connecting to live setup state…" /> : null}

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

              {failureChecklist.length > 0 ? (
                <div className="queue-item">
                  <p className="queue-title">Failure Diagnosis</p>
                  {failureChecklist.map((item) => (
                    <p key={item} className="queue-meta">
                      - {item}
                    </p>
                  ))}
                </div>
              ) : null}

              {pendingLabel ? (
                <p className="queue-meta action-pending-label" aria-live="polite">
                  {pendingLabel}
                </p>
              ) : null}

              <div className="setup-guidance">
                <p className="queue-title">Recommended Path</p>
                <p className="queue-meta">1. Start QR session. 2. Open pairing screen and scan. 3. Wait for connected.</p>
              </div>

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
                <button className="btn btn-ghost" type="button" onClick={() => setActiveScreen("pairing")}>
                  Open Pairing Screen
                </button>
              </div>

              <details className="setup-advanced">
                <summary>Advanced actions</summary>
                <div className="wizard-actions">
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
                    onClick={restartWorker}
                    disabled={!controls.canRestartWorker}
                    aria-disabled={!controls.canRestartWorker}
                  >
                    {pendingRestart ? "Restarting..." : "Restart Worker"}
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
              </details>

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
            </div>
          </section>

          <section id="setup-panel-pairing" className="setup-flow-panel" hidden={activeScreen !== "pairing"}>
            <div className="setup-wizard-card">
              <p className="queue-meta">Pairing</p>
              <h3>{state?.mode === "pairing_code" ? "Pairing Code" : "QR Code"}</h3>
              <p className="queue-meta">Scan this QR from WhatsApp linked devices, or enter pairing code in WhatsApp.</p>

              <div className="wizard-actions">
                <button className="btn btn-ghost" type="button" onClick={() => setActiveScreen("whatsapp")}>
                  Back to WhatsApp Controls
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
              </div>

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
            </div>
          </section>

          <section id="setup-panel-instagram" className="setup-flow-panel" hidden={activeScreen !== "instagram"}>
            <InstagramSetupPanel liveState={instagramLiveState} realtimeEnabled={realtimeEnabled} />
          </section>
        </div>
      </div>
    </section>
  );
}

function InstagramSetupPanel({
  liveState,
  realtimeEnabled,
}: {
  liveState: SetupState | null | undefined;
  realtimeEnabled: boolean;
}) {
  const [localState, setLocalState] = useState<SetupState | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [challengeCode, setChallengeCode] = useState("");

  const { runAction, isPending, anyPending, notices, dismissNotice } = useActionStateRegistry();

  const liveStateLoading = realtimeEnabled && liveState === undefined && !localState;
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
  const requiresChallenge = status === "challenge_required";
  const pendingStart = isPending("setup:instagram:start");
  const pendingChallenge = isPending("setup:instagram:challenge");
  const pendingRefresh = isPending("setup:instagram:refresh");
  const pendingStop = isPending("setup:instagram:stop");
  const pendingRestart = isPending("setup:instagram:restart_worker");
  const pendingReset = isPending("setup:instagram:reset");

  const canStart = !anyPending;
  const canChallenge = !anyPending && requiresChallenge && Boolean(challengeCode.trim());
  const canRefresh = !anyPending;
  const canStop = !pendingStop && !pendingReset && (status !== "idle" || Boolean(state?.listenerActive));
  const canRestart = !anyPending && !liveStateLoading && Boolean(state?.hasAuth) && status !== "starting" && status !== "authenticating";
  const canReset = !anyPending && (status === "idle" || status === "error" || status === "connected");
  const uiStatusMessage = simplifySetupMessage(state?.message);

  const refresh = () => {
    void runAction(
      "setup:instagram:refresh",
      async () => {
        const response = await fetch("/api/setup/instagram/status", { cache: "no-store" });
        const next = await readSetupResponse(response);
        setLocalState(next);
      },
      {
        pendingLabel: "Refreshing...",
        suppressSuccessNotice: true,
      },
    );
  };

  const startSetup = () => {
    void runAction(
      "setup:instagram:start",
      async () => {
        if (!username.trim() || !password) {
          throw new Error("Enter your Instagram username and password before starting setup.");
        }

        const response = await fetch("/api/setup/instagram/start", {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            username: username.trim(),
            password,
          }),
        });
        const next = await readSetupResponse(response);
        setLocalState(next);
      },
      {
        pendingLabel: "Signing in...",
      },
    );
  };

  const submitChallenge = () => {
    void runAction(
      "setup:instagram:challenge",
      async () => {
        const response = await fetch("/api/setup/instagram/challenge", {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            code: challengeCode.trim(),
          }),
        });
        const next = await readSetupResponse(response);
        setLocalState(next);
      },
      {
        pendingLabel: "Submitting code...",
      },
    );
  };

  const stopSetup = () => {
    void runAction(
      "setup:instagram:stop",
      async () => {
        const response = await fetch("/api/setup/instagram/stop", {
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

  const restartWorker = () => {
    void runAction(
      "setup:instagram:restart_worker",
      async () => {
        const response = await fetch("/api/setup/instagram/restart-worker", {
          method: "POST",
        });
        const next = await readSetupResponse(response);
        setLocalState(next);
      },
      {
        pendingLabel: "Restarting worker...",
      },
    );
  };

  const resetSetup = () => {
    void runAction(
      "setup:instagram:reset",
      async () => {
        const response = await fetch("/api/setup/instagram/reset", {
          method: "POST",
        });
        const next = await readSetupResponse(response);
        setLocalState(next);
      },
      {
        pendingLabel: "Resetting session...",
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
    const shouldPoll =
      status === "starting" ||
      status === "authenticating" ||
      status === "challenge_required" ||
      shouldPollForAutoStart;

    if (!shouldPoll) {
      return;
    }

    let cancelled = false;
    const interval = setInterval(async () => {
      try {
        const response = await fetch("/api/setup/instagram/status", { cache: "no-store" });
        const next = await readSetupResponse(response);
        if (!cancelled) {
          setLocalState(next);
        }
      } catch {
        // best effort polling only
      }
    }, status === "connected" ? 1_500 : 2_200);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [state?.listenerActive, status]);

  return (
    <div className="setup-wizard-card" aria-busy={anyPending}>
      <ActionNotices notices={notices} onDismiss={dismissNotice} />
      <h3>Instagram Connection Setup</h3>
      <p className="queue-body">
        Sign in with your personal account session. If Instagram asks for verification, enter the challenge code.
      </p>

      <div className="setup-status-row">
        <span
          className={`status-pill ${
            state?.listenerActive || status === "connected"
              ? "status-active"
              : status === "starting" || status === "authenticating"
                ? "status-syncing"
                : "status-paused"
          }`}
        >
          {state?.listenerActive ? "Connected" : statusLabel(status)}
        </span>
        <span className="queue-meta">{uiStatusMessage}</span>
      </div>
      {liveStateLoading ? <LoadingIndicator label="Connecting to live setup state…" /> : null}

      {state?.challengeContactPoint ? (
        <p className="queue-meta">Challenge destination: {state.challengeContactPoint}</p>
      ) : null}

      <div className="setup-guidance">
        <p className="queue-title">Recommended Path</p>
        <p className="queue-meta">Enter username and password, start setup, then submit challenge code only if requested.</p>
      </div>

      <label className="setup-input-group">
        <span className="queue-meta">Instagram Username</span>
        <input
          type="text"
          placeholder="username"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          disabled={anyPending}
          aria-disabled={anyPending}
          autoComplete="username"
        />
      </label>

      <label className="setup-input-group">
        <span className="queue-meta">Instagram Password</span>
        <input
          type="password"
          placeholder="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          disabled={anyPending}
          aria-disabled={anyPending}
          autoComplete="current-password"
        />
      </label>

      <div className="wizard-actions">
        <button
          className="btn btn-primary"
          type="button"
          onClick={startSetup}
          disabled={!canStart}
          aria-disabled={!canStart}
        >
          {pendingStart ? "Signing in..." : "Start Instagram Setup"}
        </button>
        {requiresChallenge ? (
          <button
            className="btn btn-ghost"
            type="button"
            onClick={submitChallenge}
            disabled={!canChallenge}
            aria-disabled={!canChallenge}
          >
            {pendingChallenge ? "Submitting..." : "Submit Challenge Code"}
          </button>
        ) : null}
      </div>

      {requiresChallenge ? (
        <label className="setup-input-group">
          <span className="queue-meta">Challenge Code</span>
          <input
            type="text"
            placeholder="Enter challenge code"
            value={challengeCode}
            onChange={(event) => setChallengeCode(event.target.value)}
            disabled={anyPending}
            aria-disabled={anyPending}
          />
        </label>
      ) : null}

      <details className="setup-advanced">
        <summary>Advanced actions</summary>
        <div className="wizard-actions">
          <button
            className="btn btn-ghost"
            type="button"
            onClick={refresh}
            disabled={!canRefresh}
            aria-disabled={!canRefresh}
          >
            {pendingRefresh ? "Refreshing..." : "Refresh"}
          </button>
          <button
            className="btn btn-ghost"
            type="button"
            onClick={stopSetup}
            disabled={!canStop}
            aria-disabled={!canStop}
          >
            {pendingStop ? "Stopping..." : "Stop Session"}
          </button>
          <button
            className="btn btn-ghost"
            type="button"
            onClick={restartWorker}
            disabled={!canRestart}
            aria-disabled={!canRestart}
          >
            {pendingRestart ? "Restarting..." : "Restart Worker"}
          </button>
          <button
            className="btn btn-ghost"
            type="button"
            onClick={resetSetup}
            disabled={!canReset}
            aria-disabled={!canReset}
          >
            {pendingReset ? "Resetting..." : "Reset Session"}
          </button>
        </div>
      </details>

      {isConnected ? (
        <p className="queue-meta">Instagram worker listener is active and session is connected.</p>
      ) : null}
    </div>
  );
}

function SetupWizardRealtime() {
  const liveState = useQuery(api.system.setupStatus, { provider: "whatsapp" }) as SetupState | null | undefined;
  const instagramLiveState = useQuery(api.system.setupStatus, { provider: "instagram" }) as SetupState | null | undefined;
  return <SetupWizardContent liveState={liveState} instagramLiveState={instagramLiveState} realtimeEnabled />;
}

export function SetupWizard({ realtimeEnabled }: SetupWizardProps) {
  if (!realtimeEnabled) {
    return <SetupWizardContent liveState={null} instagramLiveState={null} realtimeEnabled={false} />;
  }

  return <SetupWizardRealtime />;
}
