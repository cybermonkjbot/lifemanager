"use client";

import { ActionNotices } from "@/components/action-notices";
import { LoadingIndicator } from "@/components/loading-state";
import { getSetupBootstrapHeaderName } from "@/lib/setup-bootstrap-auth";
import { useActionStateRegistry } from "@/lib/ui/action-state";
import { api } from "../../convex/_generated/api";
import { useQuery } from "convex/react";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
type VoiceSetupStatus = "not_installed" | "installing" | "ready" | "error";

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
  hasConnectedBefore?: boolean;
};

type SetupWizardProps = {
  realtimeEnabled: boolean;
  embedded?: boolean;
  initialScreen?: SetupWizardScreen;
  setupSecret?: string;
  showNotices?: boolean;
  onWhatsAppConnectedChange?: (connected: boolean) => void;
};

type SetupWizardScreen = "options" | "whatsapp" | "pairing" | "instagram" | "voice";

export type VoiceSetupState = {
  status: VoiceSetupStatus;
  message: string;
  modelId: string;
  hasSample: boolean;
  hasPendingSample?: boolean;
  samplePromptText?: string;
  installLog?: string;
  updatedAt: number;
};

const DEFAULT_VOICE_SAMPLE_PROMPT =
  "Hey, this is my voice sample for OdogwuHQ. I want this to sound natural, warm, and clear. Today I am speaking at my normal pace, with the kind of tone I would use when sending a thoughtful voice note to someone I care about. Sometimes I pause a little before important words, and sometimes I smile while I talk. If you are listening back to this, try to keep my rhythm, my energy, and the way I explain things simple and human.";
const VOICE_WAVEFORM_BARS = 48;
const MAX_VOICE_RECORDING_MS = 5 * 60 * 1000;
const IDLE_WAVEFORM = Array.from({ length: VOICE_WAVEFORM_BARS }, (_, index) => 0.14 + ((index * 7) % 9) / 100);

function formatVoiceDuration(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function buildWaveformFromSamples(samples: Float32Array) {
  if (samples.length === 0) {
    return IDLE_WAVEFORM;
  }
  const blockSize = Math.max(1, Math.floor(samples.length / VOICE_WAVEFORM_BARS));
  return Array.from({ length: VOICE_WAVEFORM_BARS }, (_, index) => {
    const start = index * blockSize;
    const end = Math.min(samples.length, start + blockSize);
    let peak = 0;
    for (let cursor = start; cursor < end; cursor += 1) {
      peak = Math.max(peak, Math.abs(samples[cursor] || 0));
    }
    return Math.max(0.12, Math.min(1, peak * 1.8));
  });
}

function WaveformBars({
  values,
  progress = 0,
  label,
  onSeek,
}: {
  values: number[];
  progress?: number;
  label: string;
  onSeek?: (ratio: number) => void;
}) {
  return (
    <div
      className={`voice-waveform ${onSeek ? "voice-waveform-seekable" : ""}`}
      aria-label={label}
      role={onSeek ? "slider" : "img"}
      aria-valuemin={onSeek ? 0 : undefined}
      aria-valuemax={onSeek ? 100 : undefined}
      aria-valuenow={onSeek ? Math.round(progress * 100) : undefined}
      tabIndex={onSeek ? 0 : undefined}
      onClick={
        onSeek
          ? (event) => {
              const bounds = event.currentTarget.getBoundingClientRect();
              onSeek(Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)));
            }
          : undefined
      }
      onKeyDown={
        onSeek
          ? (event) => {
              if (event.key === "ArrowLeft") {
                event.preventDefault();
                onSeek(Math.max(0, progress - 0.05));
              }
              if (event.key === "ArrowRight") {
                event.preventDefault();
                onSeek(Math.min(1, progress + 0.05));
              }
            }
          : undefined
      }
    >
      {values.map((value, index) => {
        const active = index / Math.max(1, values.length - 1) <= progress;
        return (
          <span
            key={index}
            className={active ? "voice-waveform-bar-active" : ""}
            style={{ height: `${Math.round(Math.max(0.12, Math.min(1, value)) * 100)}%` }}
          />
        );
      })}
    </div>
  );
}

const setupWizardScreens: Record<
  SetupWizardScreen,
  {
    title: string;
  }
> = {
  options: {
    title: "Connect accounts",
  },
  whatsapp: {
    title: "Connect WhatsApp",
  },
  pairing: {
    title: "Scan or enter code",
  },
  instagram: {
    title: "Connect Instagram",
  },
  voice: {
    title: "Voice sample",
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

function voiceStatusToneClass(status?: VoiceSetupStatus) {
  if (status === "ready") {
    return "status-active";
  }
  if (status === "installing") {
    return "status-syncing";
  }
  return "status-paused";
}

function voiceStatusLabel(status?: VoiceSetupStatus) {
  if (status === "ready") return "Ready";
  if (status === "installing") return "Installing";
  if (status === "error") return "Error";
  return "Not Installed";
}

function voiceSetupDetailLabel(status?: VoiceSetupStatus) {
  if (status === "ready") return "Voice tools are available";
  if (status === "installing") return "Voice tools are being prepared";
  if (status === "error") return "Voice tools need attention";
  return "Voice tools can be installed later";
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
    return "Pairing code expired. Retrying now. Keep this page open and enter the new code when it appears.";
  }

  return "QR session expired. Retrying now. Keep this page open and scan the next QR code when it appears.";
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

  return "WhatsApp signed this device out. Run setup again to pair a new session.";
}

function getFailureChecklist(state: SetupState | null) {
  if (!state) {
    return [];
  }

  const text = `${state.message} ${state.listenerMessage || ""}`.toLowerCase();
  const checks: string[] = [];
  if (text.includes("timed out") || text.includes("expired")) {
    checks.push("Session expired. Start a new QR or pairing-code session and complete it right away.");
  }
  if (text.includes("network") || text.includes("socket") || text.includes("connection")) {
    checks.push("Connection issue detected. Keep this page open and retry when your network is stable.");
  }
  if (text.includes("credentials") || text.includes("logged out") || text.includes("signed this device out")) {
    checks.push("Credentials are no longer valid. Use Reset Credentials, then pair again.");
  }
  if (text.includes("worker") && text.includes("offline")) {
    checks.push("Worker is offline. Restart it after pairing succeeds.");
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

async function readVoiceSetupResponse(response: Response) {
  let body: VoiceSetupState | null = null;

  try {
    body = (await response.json()) as VoiceSetupState;
  } catch {
    // fallback handled below
  }

  if (!response.ok) {
    const reason = body?.message || `Voice setup request failed (${response.status})`;
    throw new Error(reason);
  }

  if (!body) {
    throw new Error("Voice setup request returned an empty response.");
  }

  return body;
}

function SetupWizardContent({
  liveState,
  instagramLiveState,
  realtimeEnabled,
  initialScreen = "options",
  embedded = false,
  setupSecret,
  showNotices = true,
  onWhatsAppConnectedChange,
}: {
  liveState: SetupState | null | undefined;
  instagramLiveState: SetupState | null | undefined;
  realtimeEnabled: boolean;
  initialScreen?: SetupWizardScreen;
  embedded?: boolean;
  setupSecret?: string;
  showNotices?: boolean;
  onWhatsAppConnectedChange?: (connected: boolean) => void;
}) {
  const [localState, setLocalState] = useState<SetupState | null>(null);
  const [voiceState, setVoiceState] = useState<VoiceSetupState | null>(null);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [activeScreen, setActiveScreen] = useState<SetupWizardScreen>(initialScreen);
  const autoQrLastStartedAtRef = useRef(0);

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
  const voiceStatusText = voiceStatusLabel(voiceState?.status);
  const activeScreenMeta = setupWizardScreens[activeScreen];
  const setupHeaders = useMemo(
    () =>
      setupSecret
        ? {
            [getSetupBootstrapHeaderName()]: setupSecret,
          }
        : undefined,
    [setupSecret],
  );
  const showBackToOptions = !embedded && activeScreen !== "options";

  useEffect(() => {
    onWhatsAppConnectedChange?.(isConnected);
  }, [isConnected, onWhatsAppConnectedChange]);

  const refreshVoiceState = useCallback(async () => {
    try {
      const response = await fetch("/api/setup/voice/status", {
        cache: "no-store",
        headers: setupHeaders,
      });
      const next = await readVoiceSetupResponse(response);
      setVoiceState((current) => {
        if (!current) {
          return next;
        }
        return current.updatedAt > next.updatedAt ? current : next;
      });
    } catch {
      // best effort summary status only
    }
  }, [setupHeaders]);

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
    if (pendingStartCode) return "Starting pairing code session...";
    if (pendingRefresh) return "Refreshing status...";
    if (pendingStop) return "Stopping session...";
    if (pendingRestart) return "Restarting worker...";
    if (pendingReset) return "Resetting connection...";
    return "";
  }, [pendingRefresh, pendingReset, pendingRestart, pendingStartCode, pendingStartQr, pendingStop]);

  const refresh = () => {
    void runAction(
      "setup:refresh",
      async () => {
        const response = await fetch("/api/setup/whatsapp/status", { cache: "no-store", headers: setupHeaders });
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
            ...(setupHeaders || {}),
          },
          body: JSON.stringify({
            mode,
            phoneNumber: normalizedPhone,
          }),
        });

        const next = await readSetupResponse(response);
        setLocalState(next);
        if (!embedded) {
          setActiveScreen("pairing");
        }
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
          headers: setupHeaders,
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
          headers: setupHeaders,
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
          headers: setupHeaders,
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
    if (
      !embedded ||
      activeScreen !== "whatsapp" ||
      liveStateLoading ||
      anyPending ||
      pendingStartQr ||
      isConnected ||
      showQrCode ||
      (status !== "idle" && status !== "error")
    ) {
      return;
    }

    const now = Date.now();
    if (now - autoQrLastStartedAtRef.current < 5000) {
      return;
    }

    autoQrLastStartedAtRef.current = now;
    startSetup("qr");
    // startSetup intentionally omitted so the auto-start is driven by setup state, not function identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeScreen, anyPending, embedded, isConnected, liveStateLoading, pendingStartQr, showQrCode, status]);

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
      ? status === "qr_ready" ||
        ((status === "starting" || status === "syncing") && !state?.qrDataUrl && !state?.pairingCode) ||
        shouldPollForAutoStart
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
        const response = await fetch("/api/setup/whatsapp/status", { cache: "no-store", headers: setupHeaders });
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
  }, [realtimeEnabled, setupHeaders, state?.listenerActive, state?.pairingCode, state?.qrDataUrl, status]);

  useEffect(() => {
    void refreshVoiceState();
  }, [refreshVoiceState]);

  return (
    <section className={`setup-wizard ${embedded ? "" : "setup-wizard-fullscreen"}`.trim()} aria-busy={anyPending}>
      <div className="setup-wizard-stage">
        {!embedded ? (
          <header className="setup-flow-header">
            <div className="setup-flow-topline">
              <p className="queue-meta">Setup</p>
              {showBackToOptions ? (
                <button className="btn btn-ghost" type="button" onClick={() => setActiveScreen("options")}>
                  Back
                </button>
              ) : null}
            </div>
            <h3 className="setup-flow-title">{activeScreenMeta.title}</h3>
          </header>
        ) : null}

        <div className="setup-flow-panels">
          <section id="setup-panel-options" className="setup-flow-panel" hidden={activeScreen !== "options"}>
            <div className="setup-option-grid">
              <button className="setup-option-card" type="button" onClick={() => setActiveScreen("whatsapp")}>
                <p className="setup-option-kicker">WhatsApp</p>
                <h4>Pair device</h4>
                <span className={`status-pill ${statusToneClass(status, state?.listenerActive)}`}>{whatsappStatusText}</span>
              </button>
              <button className="setup-option-card" type="button" onClick={() => setActiveScreen("instagram")}>
                <p className="setup-option-kicker">Instagram <em className="setup-unstable-tag">Currently unstable</em></p>
                <h4>Sign in</h4>
                <span className={`status-pill ${statusToneClass(instagramStatus, instagramLiveState?.listenerActive)}`}>
                  {instagramStatusText}
                </span>
              </button>
              <button className="setup-option-card" type="button" onClick={() => setActiveScreen("voice")}>
                <p className="setup-option-kicker">Voice Notes</p>
                <h4>Add sample</h4>
                <span className={`status-pill ${voiceStatusToneClass(voiceState?.status)}`}>{voiceStatusText}</span>
              </button>
            </div>
          </section>

          <section id="setup-panel-whatsapp" className="setup-flow-panel" hidden={activeScreen !== "whatsapp"}>
            <div className="setup-wizard-card">
              {showNotices ? <ActionNotices notices={notices} onDismiss={dismissNotice} /> : null}
              {!embedded ? <h3>Connect WhatsApp</h3> : null}

              {!embedded ? (
                <div className="setup-status-row">
                  <span className={`status-pill ${statusToneClass(status, state?.listenerActive)}`}>{whatsappStatusText}</span>
                  {status === "error" ? <span className="queue-meta">{uiStatusMessage}</span> : null}
                </div>
              ) : status === "error" ? (
                <p className="queue-meta">{uiStatusMessage}</p>
              ) : null}
              {liveStateLoading ? <LoadingIndicator label="Loading live setup status…" /> : null}

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
                  <p className="queue-title">Troubleshooting</p>
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

              {!embedded ? (
                <div className="wizard-actions">
                  <button
                    className="btn btn-primary"
                    type="button"
                    onClick={() => startSetup("qr")}
                    disabled={!controls.canStartQr}
                    aria-disabled={!controls.canStartQr}
                  >
                    {pendingStartQr ? "Starting..." : "Show QR code"}
                  </button>
                  {showQrCode || showPairingCode || isConnected ? (
                    <button className="btn btn-ghost" type="button" onClick={() => setActiveScreen("pairing")}>
                      View code
                    </button>
                  ) : null}
                </div>
              ) : null}

              {embedded && isConnected ? (
                <div className="qr-frame qr-frame-connected">
                  <div className="qr-fake" aria-hidden="true" />
                  <div className="qr-frame-overlay" aria-hidden="true">
                    <span>Already connected</span>
                  </div>
                </div>
              ) : null}

              {embedded && !isConnected && showQrCode ? (
                <div className={`qr-frame ${isConnected ? "qr-frame-connected" : ""}`}>
                  <Image src={state!.qrDataUrl!} width={320} height={320} alt="WhatsApp setup QR code" unoptimized />
                </div>
              ) : null}

              {embedded && !isConnected && !showQrCode && !liveStateLoading ? (
                <LoadingIndicator label="Preparing QR code…" />
              ) : null}

              {!embedded ? (
                <details className="setup-advanced">
                  <summary>Use phone pairing code</summary>
                  <label className="setup-input-group">
                    <span className="queue-meta">Phone number</span>
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
                  <div className="wizard-actions">
                    <button
                      className="btn btn-ghost"
                      type="button"
                      onClick={() => startSetup("pairing_code")}
                      disabled={!controls.canStartCode || !hasPhoneForPairing}
                      aria-disabled={!controls.canStartCode || !hasPhoneForPairing}
                    >
                      {pendingStartCode ? "Starting..." : "Get pairing code"}
                    </button>
                  </div>
                </details>
              ) : null}

              {!embedded ? (
                <details className="setup-advanced">
                  <summary>More actions</summary>
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
                      {pendingStop ? "Stopping..." : "Stop session"}
                    </button>
                    <button
                      className="btn btn-ghost"
                      type="button"
                      onClick={restartWorker}
                      disabled={!controls.canRestartWorker}
                      aria-disabled={!controls.canRestartWorker}
                    >
                      {pendingRestart ? "Restarting..." : "Restart worker"}
                    </button>
                    <button
                      className="btn btn-ghost"
                      type="button"
                      onClick={resetSetup}
                      disabled={!controls.canReset}
                      aria-disabled={!controls.canReset}
                    >
                      {pendingReset ? "Resetting..." : "Reset credentials"}
                    </button>
                  </div>
                </details>
              ) : null}
            </div>
          </section>

          <section id="setup-panel-pairing" className="setup-flow-panel" hidden={activeScreen !== "pairing"}>
            <div className="setup-wizard-card">
              <p className="queue-meta">WhatsApp</p>
              <h3>{state?.mode === "pairing_code" ? "Enter this code" : "Scan this QR code"}</h3>

              <div className="wizard-actions">
                <button className="btn btn-ghost" type="button" onClick={() => setActiveScreen("whatsapp")}>
                  Back
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
                    ? "Get a pairing code first."
                    : "Show a QR code first."}
                </p>
              )}
            </div>
          </section>

          <section id="setup-panel-instagram" className="setup-flow-panel" hidden={activeScreen !== "instagram"}>
            <InstagramSetupPanel
              liveState={instagramLiveState}
              realtimeEnabled={realtimeEnabled}
              setupSecret={setupSecret}
              showNotices={showNotices}
            />
          </section>

          <section id="setup-panel-voice" className="setup-flow-panel" hidden={activeScreen !== "voice"}>
            <VoiceSetupPanel
              setupSecret={setupSecret}
              initialState={voiceState}
              showNotices={showNotices}
              onStateChange={(next) => setVoiceState(next)}
            />
          </section>
        </div>
      </div>
    </section>
  );
}

export function VoiceSetupPanel({
  setupSecret,
  initialState,
  showNotices = true,
  title = "Voice sample",
  description = "Record a short sample OdogwuHQ can use later for local Vox voice notes.",
  privacyCopy = "Your recording stays on this computer and is only used for local voice generation.",
  showToolControls = true,
  showAdvancedControls = true,
  surface = "card",
  className = "",
  onSampleSaved,
  onStateChange,
}: {
  setupSecret?: string;
  initialState?: VoiceSetupState | null;
  showNotices?: boolean;
  title?: string;
  description?: string;
  privacyCopy?: string;
  showToolControls?: boolean;
  showAdvancedControls?: boolean;
  surface?: "card" | "plain";
  className?: string;
  onSampleSaved?: (next: VoiceSetupState) => void;
  onStateChange?: (next: VoiceSetupState) => void;
}) {
  const [state, setState] = useState<VoiceSetupState | null>(initialState || null);
  const [modelId, setModelId] = useState(initialState?.modelId || "openbmb/VoxCPM-0.5B");
  const [promptText, setPromptText] = useState(initialState?.samplePromptText || DEFAULT_VOICE_SAMPLE_PROMPT);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const [recordingMs, setRecordingMs] = useState(0);
  const [liveWaveform, setLiveWaveform] = useState(IDLE_WAVEFORM);
  const [previewWaveform, setPreviewWaveform] = useState(IDLE_WAVEFORM);
  const [previewDurationMs, setPreviewDurationMs] = useState(0);
  const [previewProgress, setPreviewProgress] = useState(0);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const maxRecordingTimerRef = useRef<number | null>(null);
  const recordingStartedAtRef = useRef(0);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

  const { runAction, isPending, anyPending, notices, dismissNotice } = useActionStateRegistry();

  const setupHeaders = useMemo(
    () =>
      setupSecret
        ? {
            [getSetupBootstrapHeaderName()]: setupSecret,
          }
        : undefined,
    [setupSecret],
  );

  const previewUrl = useMemo(() => {
    if (!recordedBlob) {
      return "";
    }
    return URL.createObjectURL(recordedBlob);
  }, [recordedBlob]);

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  const stopMediaStream = useCallback(() => {
    const stream = streamRef.current;
    streamRef.current = null;
    if (!stream) {
      return;
    }
    stream.getTracks().forEach((track) => track.stop());
  }, []);

  const stopAudioAnalyzer = useCallback(() => {
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (maxRecordingTimerRef.current !== null) {
      window.clearTimeout(maxRecordingTimerRef.current);
      maxRecordingTimerRef.current = null;
    }
    const audioContext = audioContextRef.current;
    audioContextRef.current = null;
    if (audioContext && audioContext.state !== "closed") {
      void audioContext.close().catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    return () => {
      try {
        recorderRef.current?.stop();
      } catch {
        // no-op
      }
      recorderRef.current = null;
      stopAudioAnalyzer();
      stopMediaStream();
    };
  }, [stopAudioAnalyzer, stopMediaStream]);

  useEffect(() => {
    if (!recordedBlob) {
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const AudioContextCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AudioContextCtor) {
          return;
        }
        const arrayBuffer = await recordedBlob.arrayBuffer();
        const audioContext = new AudioContextCtor();
        const decoded = await audioContext.decodeAudioData(arrayBuffer.slice(0));
        if (cancelled) {
          await audioContext.close().catch(() => undefined);
          return;
        }
        setPreviewDurationMs(decoded.duration * 1000);
        setPreviewWaveform(buildWaveformFromSamples(decoded.getChannelData(0)));
        await audioContext.close().catch(() => undefined);
      } catch {
        if (!cancelled) {
          setPreviewWaveform(IDLE_WAVEFORM);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [recordedBlob]);

  const applyState = useCallback(
    (next: VoiceSetupState) => {
      setState((current) => {
        if (!current) {
          return next;
        }
        return current.updatedAt > next.updatedAt ? current : next;
      });
      if (!promptText && next.samplePromptText) {
        setPromptText(next.samplePromptText);
      }
      if (!modelId && next.modelId) {
        setModelId(next.modelId);
      }
      onStateChange?.(next);
    },
    [modelId, onStateChange, promptText],
  );

  const fetchVoiceState = useCallback(
    async (includeLog = false) => {
      const query = includeLog ? "?log=1" : "";
      const response = await fetch(`/api/setup/voice/status${query}`, {
        cache: "no-store",
        headers: setupHeaders,
      });
      const next = await readVoiceSetupResponse(response);
      applyState(next);
      return next;
    },
    [applyState, setupHeaders],
  );

  const refresh = useCallback(
    (suppressSuccessNotice = true) => {
      void runAction(
        "setup:voice:refresh",
        async () => {
          await fetchVoiceState(true);
        },
        {
          pendingLabel: "Refreshing voice setup...",
          suppressSuccessNotice,
        },
      );
    },
    [fetchVoiceState, runAction],
  );

  useEffect(() => {
    refresh(true);
  }, [refresh]);

  useEffect(() => {
    if (state?.status !== "installing") {
      return;
    }
    const interval = setInterval(() => {
      void fetchVoiceState(false).catch(() => undefined);
    }, 2200);
    return () => {
      clearInterval(interval);
    };
  }, [fetchVoiceState, state?.status]);

  const startRecording = async () => {
    setRecordingError(null);
    setPreviewProgress(0);
    setIsPreviewPlaying(false);
    previewAudioRef.current?.pause();

    if (!navigator.mediaDevices?.getUserMedia) {
      setRecordingError("Browser does not support microphone capture in this context.");
      return;
    }

    if (typeof MediaRecorder === "undefined") {
      setRecordingError("Browser does not support MediaRecorder.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const AudioContextCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioContextCtor) {
        const audioContext = new AudioContextCtor();
        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        audioContextRef.current = audioContext;
        const data = new Uint8Array(analyser.frequencyBinCount);
        recordingStartedAtRef.current = Date.now();
        const updateLiveWaveform = () => {
          analyser.getByteTimeDomainData(data);
          const blockSize = Math.max(1, Math.floor(data.length / VOICE_WAVEFORM_BARS));
          const values = Array.from({ length: VOICE_WAVEFORM_BARS }, (_, index) => {
            const start = index * blockSize;
            const end = Math.min(data.length, start + blockSize);
            let sum = 0;
            for (let cursor = start; cursor < end; cursor += 1) {
              sum += Math.abs((data[cursor] || 128) - 128) / 128;
            }
            return Math.max(0.12, Math.min(1, (sum / Math.max(1, end - start)) * 3.2));
          });
          setLiveWaveform(values);
          setRecordingMs(Math.min(MAX_VOICE_RECORDING_MS, Date.now() - recordingStartedAtRef.current));
          animationFrameRef.current = window.requestAnimationFrame(updateLiveWaveform);
        };
        updateLiveWaveform();
      } else {
        recordingStartedAtRef.current = Date.now();
        const updateTimer = () => {
          setRecordingMs(Math.min(MAX_VOICE_RECORDING_MS, Date.now() - recordingStartedAtRef.current));
          setLiveWaveform((current) => current.map((value, index) => 0.14 + Math.abs(Math.sin(Date.now() / 240 + index)) * value));
          animationFrameRef.current = window.requestAnimationFrame(updateTimer);
        };
        updateTimer();
      }
      const preferredMimeTypes = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
      const selectedMimeType = preferredMimeTypes.find((value) => MediaRecorder.isTypeSupported(value));
      const recorder = selectedMimeType ? new MediaRecorder(stream, { mimeType: selectedMimeType }) : new MediaRecorder(stream);
      recorderRef.current = recorder;

      recorder.ondataavailable = (event: BlobEvent) => {
        if (event.data && event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };
      recorder.onerror = () => {
        setRecordingError("Recording failed. Check microphone permissions and retry.");
      };
      recorder.onstop = () => {
        const nextBlob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        if (nextBlob.size > 0) {
          setRecordedBlob(nextBlob);
        }
        setIsRecording(false);
        setRecordingMs(Math.min(MAX_VOICE_RECORDING_MS, Date.now() - recordingStartedAtRef.current));
        stopAudioAnalyzer();
        recorderRef.current = null;
        stopMediaStream();
      };

      recorder.start(250);
      maxRecordingTimerRef.current = window.setTimeout(() => {
        const activeRecorder = recorderRef.current;
        if (activeRecorder && activeRecorder.state !== "inactive") {
          activeRecorder.stop();
          setRecordingError("Recording stopped at the 5 minute limit.");
        }
      }, MAX_VOICE_RECORDING_MS);
      setRecordedBlob(null);
      setPreviewWaveform(IDLE_WAVEFORM);
      setIsRecording(true);
    } catch {
      setRecordingError("Could not access microphone. Allow permissions and retry.");
      setIsRecording(false);
      stopAudioAnalyzer();
      stopMediaStream();
    }
  };

  const stopRecording = () => {
    const recorder = recorderRef.current;
    if (!recorder) {
      return;
    }
    if (recorder.state !== "inactive") {
      recorder.stop();
    }
  };

  const togglePreviewPlayback = () => {
    const audio = previewAudioRef.current;
    if (!audio) {
      return;
    }
    if (audio.paused) {
      void audio.play().catch(() => undefined);
      return;
    }
    audio.pause();
  };

  const seekPreview = (ratio: number) => {
    const audio = previewAudioRef.current;
    if (!audio || !Number.isFinite(audio.duration) || audio.duration <= 0) {
      setPreviewProgress(ratio);
      return;
    }
    audio.currentTime = ratio * audio.duration;
    setPreviewProgress(ratio);
  };

  const uploadSample = () => {
    void runAction(
      "setup:voice:upload_sample",
      async () => {
        if (!recordedBlob || recordedBlob.size === 0) {
          throw new Error("Record a voice sample before saving.");
        }
        if (!promptText.trim()) {
          throw new Error("Enter the transcript of the recorded voice sample.");
        }

        const payload = new FormData();
        payload.append(
          "sample",
          new File([recordedBlob], "voice-sample.webm", {
            type: recordedBlob.type || "audio/webm",
          }),
        );
        payload.append("promptText", promptText.trim());

        const response = await fetch("/api/setup/voice/sample", {
          method: "POST",
          headers: setupHeaders,
          body: payload,
        });
        const next = await readVoiceSetupResponse(response);
        applyState(next);
        onSampleSaved?.(next);
      },
      {
        pendingLabel: "Saving sample...",
      },
    );
  };

  const installVoiceModule = () => {
    void runAction(
      "setup:voice:install",
      async () => {
        const response = await fetch("/api/setup/voice/install", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(setupHeaders || {}),
          },
          body: JSON.stringify({
            modelId: modelId.trim(),
          }),
        });
        const next = await readVoiceSetupResponse(response);
        applyState(next);
      },
      {
        pendingLabel: "Installing voice tools...",
      },
    );
  };

  const resetVoiceModule = () => {
    void runAction(
      "setup:voice:reset",
      async () => {
        const response = await fetch("/api/setup/voice/reset", {
          method: "POST",
          headers: setupHeaders,
        });
        const next = await readVoiceSetupResponse(response);
        applyState(next);
      },
      {
        pendingLabel: "Resetting voice module...",
      },
    );
  };

  const pendingInstall = isPending("setup:voice:install");
  const pendingUploadSample = isPending("setup:voice:upload_sample");
  const pendingReset = isPending("setup:voice:reset");
  const pendingRefresh = isPending("setup:voice:refresh");
  const statusText = voiceStatusLabel(state?.status);
  const canUseRecordButton = !anyPending;
  const canStopRecording = isRecording;
  const canSaveSample = !anyPending && !isRecording && Boolean(recordedBlob) && Boolean(promptText.trim());
  const canInstall = !anyPending && !isRecording && Boolean(modelId.trim());
  const displayedDurationMs = isRecording ? recordingMs : previewDurationMs || recordingMs;
  const hasUnsavedRecording = Boolean(recordedBlob);
  const sampleStateLabel = state?.hasSample
    ? "Saved locally"
    : state?.hasPendingSample
      ? "Waiting for tools"
      : hasUnsavedRecording
        ? "Ready to save"
        : "Not recorded";
  const sampleStateCopy = state?.hasSample
    ? "You can replace this sample from Settings."
    : state?.hasPendingSample
      ? "Preparation will finish processing when voice tools are ready."
      : hasUnsavedRecording
        ? "Review it, then save the sample before continuing."
        : "You can skip this step and add a sample later.";
  const recorderStateLabel = isRecording ? "Recording now" : hasUnsavedRecording ? "Recording captured" : "Ready";
  const recorderActionLabel = isRecording ? "Stop" : hasUnsavedRecording ? "Record again" : "Record";
  const rootClassName = [
    surface === "card" ? "setup-wizard-card" : "voice-setup-panel",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={rootClassName} aria-busy={anyPending}>
      {showNotices ? <ActionNotices notices={notices} onDismiss={dismissNotice} /> : null}
      <div className="voice-setup-heading">
        <p className="setup-onboarding-kicker">Local voice</p>
        <h3>{title}</h3>
        <p>{description}</p>
      </div>

      <div className="voice-state-strip" aria-label="Voice setup state">
        <div>
          <span>Tools</span>
          <strong>{statusText}</strong>
          <small>{voiceSetupDetailLabel(state?.status)}</small>
        </div>
        <div>
          <span>Recorder</span>
          <strong>{recorderStateLabel}</strong>
          <small>{isRecording ? `${formatVoiceDuration(displayedDurationMs)} of 5:00` : "Up to 5 minutes"}</small>
        </div>
        <div>
          <span>Sample</span>
          <strong>{sampleStateLabel}</strong>
          <small>{sampleStateCopy}</small>
        </div>
      </div>

      <label className="voice-script-panel">
        <span className="voice-script-head">
          <span>
            <span>Sample script</span>
            <strong>Read this aloud, or edit it first</strong>
          </span>
          <small>{promptText.trim().split(/\s+/).filter(Boolean).length} words</small>
        </span>
        <textarea
          value={promptText}
          onChange={(event) => setPromptText(event.target.value)}
          rows={5}
          placeholder={DEFAULT_VOICE_SAMPLE_PROMPT}
          disabled={anyPending}
          aria-disabled={anyPending}
        />
      </label>

      <div className={`voice-recorder-console ${isRecording ? "voice-recorder-console-active" : ""}`}>
        <div className="voice-recorder-main">
          <button
            className="voice-record-button"
            type="button"
            onClick={isRecording ? stopRecording : startRecording}
            disabled={!canUseRecordButton}
            aria-disabled={!canUseRecordButton}
            aria-label={isRecording ? "Stop recording" : recordedBlob ? "Record again" : "Record voice sample"}
          >
            <span aria-hidden="true" />
          </button>
          <div className="voice-recorder-surface">
            <div className="voice-recorder-meta">
              <strong>{isRecording ? "Recording" : recordedBlob ? "Sample captured" : "Ready to record"}</strong>
              <span>{isRecording ? `${formatVoiceDuration(displayedDurationMs)} / 5:00` : formatVoiceDuration(displayedDurationMs)}</span>
            </div>
            <WaveformBars values={isRecording ? liveWaveform : recordedBlob ? previewWaveform : IDLE_WAVEFORM} progress={isRecording ? 1 : 0} label="Live voice waveform" />
          </div>
        </div>

        {previewUrl ? (
          <div className="voice-preview-player">
            <audio
              ref={previewAudioRef}
              src={previewUrl}
              preload="metadata"
              onPlay={() => setIsPreviewPlaying(true)}
              onPause={() => setIsPreviewPlaying(false)}
              onEnded={() => {
                setIsPreviewPlaying(false);
                setPreviewProgress(0);
              }}
              onTimeUpdate={(event) => {
                const audio = event.currentTarget;
                if (Number.isFinite(audio.duration) && audio.duration > 0) {
                  setPreviewProgress(audio.currentTime / audio.duration);
                }
              }}
              onLoadedMetadata={(event) => {
                if (Number.isFinite(event.currentTarget.duration)) {
                  setPreviewDurationMs(event.currentTarget.duration * 1000);
                }
              }}
            />
            <button className="voice-play-button" type="button" onClick={togglePreviewPlayback} aria-label={isPreviewPlaying ? "Pause preview" : "Play preview"}>
              <span aria-hidden="true">{isPreviewPlaying ? "Pause" : "Play"}</span>
            </button>
            <div className="voice-preview-main">
              <div className="voice-recorder-meta">
                <strong>Preview</strong>
                <span>{formatVoiceDuration(previewProgress * (previewDurationMs || 0))} / {formatVoiceDuration(previewDurationMs)}</span>
              </div>
              <WaveformBars values={previewWaveform} progress={previewProgress} label="Voice preview waveform" onSeek={seekPreview} />
            </div>
          </div>
        ) : null}
      </div>

      {recordingError ? <p className="setup-revoked-notice">{recordingError}</p> : null}

      <div className="wizard-actions voice-recorder-actions">
        {showToolControls ? (
          <button
            className="btn btn-ghost"
            type="button"
            onClick={installVoiceModule}
            disabled={!canInstall}
            aria-disabled={!canInstall}
          >
            {pendingInstall ? "Installing..." : "Install tools"}
          </button>
        ) : null}
        {isRecording ? (
          <button className="btn btn-ghost" type="button" onClick={stopRecording} disabled={!canStopRecording} aria-disabled={!canStopRecording}>
            Stop recording
          </button>
        ) : null}
        {!isRecording ? (
          <button className="btn btn-ghost" type="button" onClick={startRecording} disabled={!canUseRecordButton} aria-disabled={!canUseRecordButton}>
            {recorderActionLabel}
          </button>
        ) : null}
        <button
          className="btn btn-primary"
          type="button"
          onClick={uploadSample}
          disabled={!canSaveSample}
          aria-disabled={!canSaveSample}
        >
          {pendingUploadSample ? "Saving..." : "Save voice sample"}
        </button>
      </div>

      {showAdvancedControls ? (
        <details className="setup-advanced">
          <summary>More actions</summary>
          <label className="setup-input-group">
            <span className="queue-meta">Voice model</span>
            <input
              type="text"
              value={modelId}
              onChange={(event) => setModelId(event.target.value)}
              placeholder="openbmb/VoxCPM-0.5B"
              disabled={anyPending || isRecording}
              aria-disabled={anyPending || isRecording}
            />
          </label>
          <div className="wizard-actions">
            <button
              className="btn btn-ghost"
              type="button"
              onClick={() => refresh(false)}
              disabled={pendingRefresh || anyPending}
              aria-disabled={pendingRefresh || anyPending}
            >
              {pendingRefresh ? "Refreshing..." : "Refresh"}
            </button>
            <button
              className="btn btn-ghost"
              type="button"
              onClick={resetVoiceModule}
              disabled={pendingReset || anyPending}
              aria-disabled={pendingReset || anyPending}
            >
              {pendingReset ? "Resetting..." : "Reset"}
            </button>
          </div>
        </details>
      ) : null}

      {showAdvancedControls && state?.installLog ? (
        <details className="setup-advanced">
          <summary>Installation log</summary>
          <pre className="queue-meta">{state.installLog}</pre>
        </details>
      ) : null}
    </div>
  );
}

function InstagramSetupPanel({
  liveState,
  realtimeEnabled,
  setupSecret,
  showNotices = true,
}: {
  liveState: SetupState | null | undefined;
  realtimeEnabled: boolean;
  setupSecret?: string;
  showNotices?: boolean;
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
  const setupHeaders = useMemo(
    () =>
      setupSecret
        ? {
            [getSetupBootstrapHeaderName()]: setupSecret,
          }
        : undefined,
    [setupSecret],
  );

  const refresh = () => {
    void runAction(
      "setup:instagram:refresh",
      async () => {
        const response = await fetch("/api/setup/instagram/status", { cache: "no-store", headers: setupHeaders });
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
            ...(setupHeaders || {}),
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
            ...(setupHeaders || {}),
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
          headers: setupHeaders,
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
          headers: setupHeaders,
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
          headers: setupHeaders,
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
        const response = await fetch("/api/setup/instagram/status", { cache: "no-store", headers: setupHeaders });
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
  }, [setupHeaders, state?.listenerActive, status]);

  return (
    <div className="setup-wizard-card" aria-busy={anyPending}>
      {showNotices ? <ActionNotices notices={notices} onDismiss={dismissNotice} /> : null}
      <h3>Connect Instagram <em className="setup-unstable-tag">Currently unstable</em></h3>
      <p className="queue-meta">Instagram support is experimental and may require retries.</p>

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
        {status === "error" ? <span className="queue-meta">{uiStatusMessage}</span> : null}
      </div>
      {liveStateLoading ? <LoadingIndicator label="Loading live setup status…" /> : null}

      {state?.challengeContactPoint ? (
        <p className="queue-meta">Verification sent to: {state.challengeContactPoint}</p>
      ) : null}

      <label className="setup-input-group">
        <span className="queue-meta">Instagram username</span>
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
        <span className="queue-meta">Instagram password</span>
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
          {pendingStart ? "Signing in..." : "Sign in"}
        </button>
        {requiresChallenge ? (
          <button
            className="btn btn-ghost"
            type="button"
            onClick={submitChallenge}
            disabled={!canChallenge}
            aria-disabled={!canChallenge}
          >
            {pendingChallenge ? "Submitting..." : "Submit challenge code"}
          </button>
        ) : null}
      </div>

      {requiresChallenge ? (
        <label className="setup-input-group">
          <span className="queue-meta">Challenge code</span>
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
        <summary>More actions</summary>
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
            {pendingStop ? "Stopping..." : "Stop session"}
          </button>
          <button
            className="btn btn-ghost"
            type="button"
            onClick={restartWorker}
            disabled={!canRestart}
            aria-disabled={!canRestart}
          >
            {pendingRestart ? "Restarting..." : "Restart worker"}
          </button>
          <button
            className="btn btn-ghost"
            type="button"
            onClick={resetSetup}
            disabled={!canReset}
            aria-disabled={!canReset}
          >
            {pendingReset ? "Resetting..." : "Reset session"}
          </button>
        </div>
      </details>

      {isConnected ? (
        <p className="queue-meta">Instagram is connected and active.</p>
      ) : null}
    </div>
  );
}

function SetupWizardRealtimeWrapper({
  embedded,
  initialScreen,
  setupSecret,
  showNotices,
  onWhatsAppConnectedChange,
}: {
  embedded?: boolean;
  initialScreen?: SetupWizardScreen;
  setupSecret?: string;
  showNotices?: boolean;
  onWhatsAppConnectedChange?: (connected: boolean) => void;
}) {
  const liveState = useQuery(api.system.setupStatus, { provider: "whatsapp" }) as SetupState | null | undefined;
  const instagramLiveState = useQuery(api.system.setupStatus, { provider: "instagram" }) as SetupState | null | undefined;
  return (
    <SetupWizardContent
      liveState={liveState}
      instagramLiveState={instagramLiveState}
      realtimeEnabled={true}
      embedded={embedded}
      initialScreen={initialScreen}
      setupSecret={setupSecret}
      showNotices={showNotices}
      onWhatsAppConnectedChange={onWhatsAppConnectedChange}
    />
  );
}

export function SetupWizard({
  realtimeEnabled,
  embedded = false,
  initialScreen = "options",
  setupSecret,
  showNotices = true,
  onWhatsAppConnectedChange,
}: SetupWizardProps) {
  if (!realtimeEnabled) {
    return (
      <SetupWizardContent
        liveState={null}
        instagramLiveState={null}
        realtimeEnabled={false}
        embedded={embedded}
        initialScreen={initialScreen}
        setupSecret={setupSecret}
        showNotices={showNotices}
        onWhatsAppConnectedChange={onWhatsAppConnectedChange}
      />
    );
  }

  return (
    <SetupWizardRealtimeWrapper
      embedded={embedded}
      initialScreen={initialScreen}
      setupSecret={setupSecret}
      showNotices={showNotices}
      onWhatsAppConnectedChange={onWhatsAppConnectedChange}
    />
  );
}
