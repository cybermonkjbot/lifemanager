"use client";

import { ActionNotices } from "@/components/action-notices";
import { SetupWizard } from "@/components/setup-wizard";
import { getSetupBootstrapHeaderName } from "@/lib/setup-bootstrap-auth";
import { useActionStateRegistry } from "@/lib/ui/action-state";
import { api } from "../../convex/_generated/api";
import {
  DEFAULT_INSTANCE_SETUP_PREFERENCES,
  type InstanceAutonomyMode,
  type InstanceMimicryPreset,
  type InstanceReplyPacePreset,
  type InstanceSetupPreferences,
  type InstanceSetupState,
} from "@/lib/instance-setup-types";
import { useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

type SetupOnboardingProps = {
  realtimeEnabled: boolean;
  initialInstanceState: InstanceSetupState;
};

type SetupStage = "welcome" | "security" | "preferences" | "connect" | "finish";

type LiveSetupState = {
  status?: "idle" | "starting" | "authenticating" | "qr_ready" | "code_ready" | "challenge_required" | "syncing" | "connected" | "error";
  listenerActive?: boolean;
  updatedAt?: number;
  hasAuth?: boolean;
  message?: string;
};

const setupStages: Array<{
  id: SetupStage;
  kicker: string;
  title: string;
  description: string;
}> = [
  {
    id: "welcome",
    kicker: "Stage 01",
    title: "Prepare the instance",
    description: "Turn this install into a private operator console before any runtime starts sending or learning.",
  },
  {
    id: "security",
    kicker: "Stage 02",
    title: "Set the instance PIN",
    description: "Lock this deployment with a local PIN so the open source app does not default into a public SaaS shell.",
  },
  {
    id: "preferences",
    kicker: "Stage 03",
    title: "Choose runtime behavior",
    description: "Save a small set of first-run defaults so the app starts with your tempo, review posture, and night boundaries.",
  },
  {
    id: "connect",
    kicker: "Stage 04",
    title: "Connect the channels",
    description: "Pair WhatsApp, optionally add Instagram, and verify the workers are actually alive.",
  },
  {
    id: "finish",
    kicker: "Stage 05",
    title: "Complete onboarding",
    description: "Seal the instance, keep the unlock session, and enter the dashboard with the setup state already anchored.",
  },
];

function readSetupStateResponse(response: Response) {
  return response.json() as Promise<{
    state?: InstanceSetupState;
    preferencesSynced?: boolean;
    issuedSession?: boolean;
    redirectPath?: string;
    error?: string;
  }>;
}

function simplifyConnectionStatus(state: LiveSetupState | null | undefined, label: string) {
  if (!state) {
    return `${label} not loaded yet.`;
  }
  if (state.listenerActive || state.status === "connected") {
    return `${label} connected.`;
  }
  if (state.status === "qr_ready") {
    return `${label} QR is ready.`;
  }
  if (state.status === "code_ready") {
    return `${label} pairing code is ready.`;
  }
  if (state.status === "challenge_required") {
    return `${label} needs a challenge code.`;
  }
  if (state.status === "starting" || state.status === "authenticating" || state.status === "syncing") {
    return `${label} is still in setup.`;
  }
  if (state.status === "error") {
    return `${label} needs attention.`;
  }
  return `${label} has not been connected yet.`;
}

function setupStageIndex(stage: SetupStage) {
  return setupStages.findIndex((item) => item.id === stage);
}

function resolveMimicryPreview(preset: InstanceMimicryPreset) {
  if (preset === "light") {
    return "Light mirror. Keep the voice neutral-first.";
  }
  if (preset === "close") {
    return "Tighter mirror. Match rhythm and phrasing more aggressively.";
  }
  return "Balanced mirror. Natural adaptation without over-copying.";
}

function resolveReplyPacePreview(preset: InstanceReplyPacePreset) {
  if (preset === "measured") {
    return "Faster but still human. Best if you want lower latency.";
  }
  if (preset === "unhurried") {
    return "Slow and deliberate. Better for a restrained, less online feel.";
  }
  return "Quality-first default. Enough delay to feel deliberate without dragging.";
}

function resolveAutonomyPreview(mode: InstanceAutonomyMode) {
  return mode === "autopilot"
    ? "Approved drafts can move automatically when the rest of the system allows it."
    : "Start in review-first mode so nothing moves without manual approval.";
}

export function SetupOnboarding({ realtimeEnabled, initialInstanceState }: SetupOnboardingProps) {
  const router = useRouter();
  const [stage, setStage] = useState<SetupStage>(initialInstanceState.setupCompleted ? "finish" : "welcome");
  const [instanceState, setInstanceState] = useState<InstanceSetupState>(initialInstanceState);
  const [preferences, setPreferences] = useState<InstanceSetupPreferences>(
    initialInstanceState.preferences || DEFAULT_INSTANCE_SETUP_PREFERENCES,
  );
  const [setupSecret, setSetupSecret] = useState("");
  const [pin, setPin] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  const { runAction, getRecord, notices, dismissNotice } = useActionStateRegistry();

  const whatsappLiveState = useQuery(
    api.system.setupStatus,
    realtimeEnabled ? { provider: "whatsapp" } : "skip",
  ) as LiveSetupState | null | undefined;
  const instagramLiveState = useQuery(
    api.system.setupStatus,
    realtimeEnabled ? { provider: "instagram" } : "skip",
  ) as LiveSetupState | null | undefined;

  const activeStage = setupStages[setupStageIndex(stage)] || setupStages[0];
  const securityRecord = getRecord("setup:onboarding:security");
  const preferencesRecord = getRecord("setup:onboarding:preferences");
  const finishRecord = getRecord("setup:onboarding:finish");
  const pinSource = instanceState.pinSource;
  const envManagedPin = pinSource === "env";
  const filePinExists = pinSource === "file";
  const pinRequiredCopy = envManagedPin
    ? "This deployment is already pin-managed by environment configuration. Setup will keep that source of truth."
    : filePinExists
      ? "A local instance PIN already exists. Leave the fields empty to keep it, or enter a new PIN to rotate it now."
      : "Create the instance PIN now. This becomes the browser gate for this deployment.";
  const pinValidationMessage = useMemo(() => {
    if (envManagedPin) {
      return "";
    }
    if (!filePinExists && pin.trim().length === 0) {
      return "PIN is required to complete setup.";
    }
    if (pin.trim().length > 0 && pin.trim().length < 4) {
      return "PIN must be at least 4 characters.";
    }
    if (pin.trim().length > 0 && pin !== pinConfirm) {
      return "PIN confirmation does not match.";
    }
    return "";
  }, [envManagedPin, filePinExists, pin, pinConfirm]);

  const canSaveSecurity = envManagedPin || pinValidationMessage === "";
  const whatsappReady = Boolean(whatsappLiveState?.listenerActive || whatsappLiveState?.status === "connected");
  const instagramReady = Boolean(instagramLiveState?.listenerActive || instagramLiveState?.status === "connected");
  const canFinish = canSaveSecurity && (whatsappReady || !realtimeEnabled);

  const saveInstanceSetup = async (
    key: string,
    payload: {
      pin?: string;
      preferences?: InstanceSetupPreferences;
      setupCompleted?: boolean;
      issueSession?: boolean;
    },
    options?: {
      successMessage?: string;
      nextStage?: SetupStage;
      redirectOnSuccess?: boolean;
    },
  ) => {
    return await runAction(
      key,
      async () => {
        const response = await fetch("/api/setup/instance", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(setupSecret.trim()
              ? {
                  [getSetupBootstrapHeaderName()]: setupSecret.trim(),
                }
              : {}),
          },
          body: JSON.stringify(payload),
        });

        const body = await readSetupStateResponse(response);
        if (!response.ok || !body.state) {
          throw new Error(body.error || `Setup save failed (${response.status})`);
        }

        setInstanceState(body.state);
        setPreferences(body.state.preferences);
        if (payload.pin) {
          setPin("");
          setPinConfirm("");
        }
        if (options?.nextStage) {
          setStage(options.nextStage);
        }
        if (options?.redirectOnSuccess && body.redirectPath) {
          router.push(body.redirectPath);
          router.refresh();
        }
        return body;
      },
      {
        pendingLabel: "Saving setup state...",
        successMessage: options?.successMessage,
      },
    );
  };

  return (
    <main className="setup-onboarding-shell">
      <div className="setup-onboarding-noise" aria-hidden="true" />
      <section className="setup-onboarding-stage">
        <aside className="setup-onboarding-aside">
          <p className="setup-onboarding-kicker">Social Life Manager</p>
          <h1 className="setup-onboarding-title">Provision a private life-ops instance.</h1>
          <p className="setup-onboarding-copy">
            This setup flow is where the app stops being a generic open source codebase and becomes your own local operator system.
          </p>

          <div className="setup-onboarding-checklist">
            {setupStages.map((item, index) => {
              const active = item.id === stage;
              const completed = setupStageIndex(stage) > index || (item.id === "finish" && instanceState.setupCompleted);
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`setup-step-chip ${active ? "setup-step-chip-active" : ""} ${completed ? "setup-step-chip-complete" : ""}`}
                  onClick={() => setStage(item.id)}
                >
                  <span className="setup-step-chip-count">{String(index + 1).padStart(2, "0")}</span>
                  <span className="setup-step-chip-copy">
                    <strong>{item.title}</strong>
                    <span>{item.description}</span>
                  </span>
                </button>
              );
            })}
          </div>

          <div className="setup-onboarding-signal">
            <p className="queue-meta">Current state</p>
            <p className="setup-onboarding-signal-line">{simplifyConnectionStatus(whatsappLiveState, "WhatsApp")}</p>
            <p className="setup-onboarding-signal-line">{simplifyConnectionStatus(instagramLiveState, "Instagram")}</p>
            <p className="setup-onboarding-signal-line">
              {instanceState.pinEnabled ? `Instance PIN source: ${instanceState.pinSource}.` : "Instance PIN not saved yet."}
            </p>
          </div>
        </aside>

        <section className="setup-onboarding-main">
          <header className="setup-onboarding-head">
            <p className="queue-meta">{activeStage.kicker}</p>
            <h2 className="setup-onboarding-panel-title">{activeStage.title}</h2>
            <p className="setup-onboarding-panel-copy">{activeStage.description}</p>
          </header>

          <ActionNotices notices={notices} onDismiss={dismissNotice} />

          {stage === "welcome" ? (
            <div className="setup-onboarding-panel">
              <div className="setup-poster-block">
                <p className="setup-poster-kicker">First-run path</p>
                <h3>Set the gate, set the behavior, then pair the channels.</h3>
                <p>
                  Keep the first-run sequence opinionated. Security and runtime defaults should exist before the dashboard becomes your daily working surface.
                </p>
              </div>
              <div className="setup-summary-list">
                <p className="setup-summary-item">The PIN is now part of instance setup, not just environment wiring.</p>
                <p className="setup-summary-item">Preferences save a real runtime baseline instead of asking you to discover settings later.</p>
                <p className="setup-summary-item">Channel setup remains live and operational, but it now sits inside a guided onboarding tunnel.</p>
              </div>
              <label className="setup-input-group">
                <span className="queue-meta">Setup bootstrap secret</span>
                <input
                  type="password"
                  value={setupSecret}
                  placeholder="Only needed for remote first-run when SLM_SETUP_SECRET is configured"
                  onChange={(event) => setSetupSecret(event.target.value)}
                  autoComplete="off"
                />
              </label>
              <div className="wizard-actions">
                <button className="btn btn-primary" type="button" onClick={() => setStage("security")}>
                  Start setup
                </button>
                {instanceState.setupCompleted ? (
                  <button className="btn btn-ghost" type="button" onClick={() => router.push("/")}>
                    Go to dashboard
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}

          {stage === "security" ? (
            <div className="setup-onboarding-panel">
              <div className="setup-guidance">
                <p className="queue-title">Security posture</p>
                <p className="queue-meta">{pinRequiredCopy}</p>
              </div>

              <label className="setup-input-group">
                <span className="queue-meta">Setup bootstrap secret</span>
                <input
                  type="password"
                  value={setupSecret}
                  placeholder="Only needed for remote first-run when SLM_SETUP_SECRET is configured"
                  onChange={(event) => setSetupSecret(event.target.value)}
                  autoComplete="off"
                />
              </label>

              {!envManagedPin ? (
                <div className="setup-form-grid">
                  <label className="setup-input-group">
                    <span className="queue-meta">Instance PIN</span>
                    <input
                      type="password"
                      value={pin}
                      placeholder={filePinExists ? "Leave blank to keep current PIN" : "Create PIN"}
                      onChange={(event) => setPin(event.target.value)}
                      autoComplete="new-password"
                    />
                  </label>
                  <label className="setup-input-group">
                    <span className="queue-meta">Confirm PIN</span>
                    <input
                      type="password"
                      value={pinConfirm}
                      placeholder={filePinExists && pin.trim().length === 0 ? "Only required when rotating PIN" : "Confirm PIN"}
                      onChange={(event) => setPinConfirm(event.target.value)}
                      autoComplete="new-password"
                    />
                  </label>
                </div>
              ) : null}

              {pinValidationMessage ? <p className="instance-lock-error">{pinValidationMessage}</p> : null}

              <div className="wizard-actions">
                <button
                  className="btn btn-primary"
                  type="button"
                  disabled={!canSaveSecurity || securityRecord.pending}
                  aria-disabled={!canSaveSecurity || securityRecord.pending}
                  onClick={() => {
                    void saveInstanceSetup(
                      "setup:onboarding:security",
                      {
                        ...(envManagedPin ? {} : { pin: pin.trim() }),
                        issueSession: !envManagedPin,
                      },
                      {
                        successMessage: "Instance security saved.",
                        nextStage: "preferences",
                      },
                    );
                  }}
                >
                  {securityRecord.pending ? "Saving..." : "Save and continue"}
                </button>
                <button className="btn btn-ghost" type="button" onClick={() => setStage("welcome")}>
                  Back
                </button>
              </div>
            </div>
          ) : null}

          {stage === "preferences" ? (
            <div className="setup-onboarding-panel">
              <div className="setup-choice-group">
                <p className="queue-title">Autonomy posture</p>
                <div className="setup-choice-grid">
                  {(["review_first", "autopilot"] as const).map((value) => (
                    <button
                      key={value}
                      type="button"
                      className={`setup-choice-card ${preferences.autonomyMode === value ? "setup-choice-card-active" : ""}`}
                      onClick={() => setPreferences((current) => ({ ...current, autonomyMode: value }))}
                    >
                      <strong>{value === "review_first" ? "Review first" : "Autopilot ready"}</strong>
                      <span>{resolveAutonomyPreview(value)}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="setup-choice-group">
                <p className="queue-title">Reply pace</p>
                <div className="setup-choice-grid">
                  {(["measured", "deliberate", "unhurried"] as const).map((value) => (
                    <button
                      key={value}
                      type="button"
                      className={`setup-choice-card ${preferences.replyPace === value ? "setup-choice-card-active" : ""}`}
                      onClick={() => setPreferences((current) => ({ ...current, replyPace: value }))}
                    >
                      <strong>{value === "measured" ? "Measured" : value === "deliberate" ? "Deliberate" : "Unhurried"}</strong>
                      <span>{resolveReplyPacePreview(value)}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="setup-choice-group">
                <p className="queue-title">Voice mimicry</p>
                <div className="setup-choice-grid">
                  {(["light", "balanced", "close"] as const).map((value) => (
                    <button
                      key={value}
                      type="button"
                      className={`setup-choice-card ${preferences.mimicryPreset === value ? "setup-choice-card-active" : ""}`}
                      onClick={() => setPreferences((current) => ({ ...current, mimicryPreset: value }))}
                    >
                      <strong>{value === "light" ? "Light" : value === "balanced" ? "Balanced" : "Close"}</strong>
                      <span>{resolveMimicryPreview(value)}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="setup-preferences-row">
                <label className="setup-toggle-card">
                  <input
                    type="checkbox"
                    checked={preferences.memesEnabled}
                    onChange={(event) => setPreferences((current) => ({ ...current, memesEnabled: event.target.checked }))}
                  />
                  <span>
                    <strong>Enable meme surfaces</strong>
                    <span>Turn on playful media features from the start.</span>
                  </span>
                </label>
                <label className="setup-toggle-card">
                  <input
                    type="checkbox"
                    checked={preferences.instagramEnabled}
                    onChange={(event) => setPreferences((current) => ({ ...current, instagramEnabled: event.target.checked }))}
                  />
                  <span>
                    <strong>Plan for Instagram</strong>
                    <span>Keep the optional Instagram connection visible in setup.</span>
                  </span>
                </label>
              </div>

              <label className="setup-toggle-card">
                <input
                  type="checkbox"
                  checked={preferences.quietHoursEnabled}
                  onChange={(event) => setPreferences((current) => ({ ...current, quietHoursEnabled: event.target.checked }))}
                />
                <span>
                  <strong>Quiet hours</strong>
                  <span>Block the app from acting like it lives online all night.</span>
                </span>
              </label>

              {preferences.quietHoursEnabled ? (
                <div className="setup-hours-grid">
                  <label className="setup-input-group">
                    <span className="queue-meta">Quiet hours start</span>
                    <select
                      value={preferences.quietHoursStartHour}
                      onChange={(event) =>
                        setPreferences((current) => ({
                          ...current,
                          quietHoursStartHour: Number(event.target.value),
                        }))
                      }
                    >
                      {Array.from({ length: 24 }, (_, hour) => (
                        <option key={hour} value={hour}>
                          {String(hour).padStart(2, "0")}:00
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="setup-input-group">
                    <span className="queue-meta">Quiet hours end</span>
                    <select
                      value={preferences.quietHoursEndHour}
                      onChange={(event) =>
                        setPreferences((current) => ({
                          ...current,
                          quietHoursEndHour: Number(event.target.value),
                        }))
                      }
                    >
                      {Array.from({ length: 24 }, (_, hour) => (
                        <option key={hour} value={hour}>
                          {String(hour).padStart(2, "0")}:00
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              ) : null}

              <div className="wizard-actions">
                <button
                  className="btn btn-primary"
                  type="button"
                  onClick={() => {
                    void saveInstanceSetup(
                      "setup:onboarding:preferences",
                      {
                        preferences,
                      },
                      {
                        successMessage: "Preferences saved.",
                        nextStage: "connect",
                      },
                    );
                  }}
                  disabled={preferencesRecord.pending}
                  aria-disabled={preferencesRecord.pending}
                >
                  {preferencesRecord.pending ? "Saving..." : "Save and continue"}
                </button>
                <button className="btn btn-ghost" type="button" onClick={() => setStage("security")}>
                  Back
                </button>
              </div>
            </div>
          ) : null}

          {stage === "connect" ? (
            <div className="setup-onboarding-panel">
              <div className="setup-guidance">
                <p className="queue-title">Connection checklist</p>
                <p className="queue-meta">
                  Finish WhatsApp first. Instagram is optional, but the core onboarding should not be considered truly complete until WhatsApp is paired.
                </p>
              </div>
              <div className="setup-connection-state-grid">
                <div className="setup-connection-state-card">
                  <p className="queue-meta">WhatsApp</p>
                  <p className="setup-connection-state-value">{whatsappReady ? "Ready" : "Pending"}</p>
                  <p className="queue-meta">{simplifyConnectionStatus(whatsappLiveState, "WhatsApp")}</p>
                </div>
                <div className="setup-connection-state-card">
                  <p className="queue-meta">Instagram</p>
                  <p className="setup-connection-state-value">{instagramReady ? "Ready" : "Optional"}</p>
                  <p className="queue-meta">{simplifyConnectionStatus(instagramLiveState, "Instagram")}</p>
                </div>
              </div>
              <SetupWizard realtimeEnabled={realtimeEnabled} embedded initialScreen="whatsapp" setupSecret={setupSecret.trim()} />
              <div className="wizard-actions">
                <button className="btn btn-primary" type="button" onClick={() => setStage("finish")}>
                  Continue to finish
                </button>
                <button className="btn btn-ghost" type="button" onClick={() => setStage("preferences")}>
                  Back
                </button>
              </div>
            </div>
          ) : null}

          {stage === "finish" ? (
            <div className="setup-onboarding-panel">
              <div className="setup-completion-banner">
                <p className="setup-poster-kicker">Completion check</p>
                <h3>Seal the instance and enter the workspace.</h3>
                <p>
                  Save the instance as complete once the gate exists and the primary connection state is where you want it. You can revisit setup later from navigation.
                </p>
              </div>

              <div className="setup-summary-grid">
                <div className="setup-summary-card">
                  <p className="queue-meta">PIN source</p>
                  <p className="setup-summary-value">{instanceState.pinEnabled ? instanceState.pinSource : "missing"}</p>
                </div>
                <div className="setup-summary-card">
                  <p className="queue-meta">Autonomy</p>
                  <p className="setup-summary-value">{preferences.autonomyMode === "autopilot" ? "autopilot" : "review first"}</p>
                </div>
                <div className="setup-summary-card">
                  <p className="queue-meta">Reply pace</p>
                  <p className="setup-summary-value">{preferences.replyPace}</p>
                </div>
                <div className="setup-summary-card">
                  <p className="queue-meta">WhatsApp</p>
                  <p className="setup-summary-value">{whatsappReady ? "connected" : realtimeEnabled ? "pending" : "not verified"}</p>
                </div>
              </div>

              {!canFinish ? (
                <p className="instance-lock-error">
                  {!canSaveSecurity
                    ? "Save a valid instance PIN before finishing setup."
                    : "Connect WhatsApp before marking setup complete."}
                </p>
              ) : null}

              <div className="wizard-actions">
                <button
                  className="btn btn-primary"
                  type="button"
                  disabled={!canFinish || finishRecord.pending}
                  aria-disabled={!canFinish || finishRecord.pending}
                  onClick={() => {
                    void saveInstanceSetup(
                      "setup:onboarding:finish",
                      {
                        ...(envManagedPin || pin.trim().length === 0 ? {} : { pin: pin.trim() }),
                        preferences,
                        setupCompleted: true,
                        issueSession: !envManagedPin,
                      },
                      {
                        successMessage: "Setup completed.",
                        redirectOnSuccess: true,
                      },
                    );
                  }}
                >
                  {finishRecord.pending ? "Completing..." : instanceState.setupCompleted ? "Return to dashboard" : "Complete setup"}
                </button>
                <button className="btn btn-ghost" type="button" onClick={() => setStage("connect")}>
                  Back
                </button>
              </div>
            </div>
          ) : null}
        </section>
      </section>
    </main>
  );
}
