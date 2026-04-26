"use client";

import { ActionNotices } from "@/components/action-notices";
import { SetupWizard } from "@/components/setup-wizard";
import { getSetupBootstrapHeaderName } from "@/lib/setup-bootstrap-auth";
import { useActionStateRegistry } from "@/lib/ui/action-state";
import {
  DEFAULT_INSTANCE_SETUP_PREFERENCES,
  type InstanceAutonomyMode,
  type InstanceMimicryPreset,
  type InstanceReplyPacePreset,
  type InstanceSetupPreferences,
  type InstanceSetupState,
  type InstanceSoulPrivacyLevel,
  type InstanceSoulProfile,
} from "@/lib/instance-setup-types";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

type SetupOnboardingProps = {
  realtimeEnabled: boolean;
  initialInstanceState: InstanceSetupState;
};

type SetupStage = "security" | "preferences" | "connect" | "finish";

const setupStages: Array<{
  id: SetupStage;
  title: string;
}> = [
  {
    id: "security",
    title: "Secure",
  },
  {
    id: "preferences",
    title: "Defaults",
  },
  {
    id: "connect",
    title: "Connect",
  },
  {
    id: "finish",
    title: "Launch",
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

function readSetupAiSettingsResponse(response: Response) {
  return response.json() as Promise<{
    state?: InstanceSetupState;
    preferences?: InstanceSetupPreferences;
    preferencesSynced?: boolean;
    rationale?: string;
    provider?: string;
    model?: string;
    latencyMs?: number;
    toolDisabled?: boolean;
    error?: string;
  }>;
}

function setupStageIndex(stage: SetupStage) {
  return setupStages.findIndex((item) => item.id === stage);
}

function formatSetupStep(stage: SetupStage) {
  const index = setupStageIndex(stage);
  return `Step ${index + 1} of ${setupStages.length}`;
}

function resolveMimicryPreview(preset: InstanceMimicryPreset) {
  if (preset === "light") {
    return "Small voice matching with a neutral tone.";
  }
  if (preset === "close") {
    return "Strong voice matching for closer tone and rhythm.";
  }
  return "Balanced voice matching for most conversations.";
}

function resolveReplyPacePreview(preset: InstanceReplyPacePreset) {
  if (preset === "measured") {
    return "Quicker replies with a natural delay.";
  }
  if (preset === "unhurried") {
    return "Slower replies with a calm pace.";
  }
  return "Balanced pace between speed and quality.";
}

function resolveAutonomyPreview(mode: InstanceAutonomyMode) {
  return mode === "autopilot"
    ? "Allowed drafts may send without another review."
    : "Every generated draft waits for your approval.";
}

function cloneDefaultPreferences(): InstanceSetupPreferences {
  return {
    ...DEFAULT_INSTANCE_SETUP_PREFERENCES,
    soulProfile: {
      ...DEFAULT_INSTANCE_SETUP_PREFERENCES.soulProfile,
    },
    soulPrivacy: {
      ...DEFAULT_INSTANCE_SETUP_PREFERENCES.soulPrivacy,
    },
  };
}

function normalizeSoulText(profile: InstanceSoulProfile) {
  return Object.values(profile).join(" ").toLowerCase();
}

function hasSoulProfileContent(profile: InstanceSoulProfile) {
  return Object.values(profile).some((value) => value.trim().length > 0);
}

function derivePreferencesFromSoulProfile(
  profile: InstanceSoulProfile,
  current: InstanceSetupPreferences,
): InstanceSetupPreferences {
  const text = normalizeSoulText(profile);
  if (!text.trim()) {
    return current;
  }

  const wantsFastPace = /\b(fast|quick|busy|urgent|responsive|immediate|on top|efficient)\b/.test(text);
  const wantsSlowPace = /\b(slow|calm|careful|thoughtful|reflect|deep|peace|quiet|patient)\b/.test(text);
  const wantsAutopilot = /\b(automatic|autopilot|delegate|handle for me|save time|take over)\b/.test(text);
  const wantsReview = /\b(boundar|privacy|careful|review|approve|consent|manual|sensitive|cautious)\b/.test(text);
  const wantsCloseVoice = /\b(my voice|sound like me|pidgin|emoji|banter|expressive|warm|playful|intimate)\b/.test(text);
  const wantsLightVoice = /\b(professional|minimal|formal|reserved|plain|concise|direct)\b/.test(text);
  const wantsMemes = /\b(meme|funny|joke|banter|playful|humor|humour)\b/.test(text);
  const wantsInstagram = /\b(instagram|ig|creator|content|social|status|stories)\b/.test(text);
  const nightOwl = /\b(night owl|late night|overnight|after midnight)\b/.test(text);
  const earlyStart = /\b(early|morning|sunrise|5am|6am)\b/.test(text);

  return {
    ...current,
    soulProfile: profile,
    autonomyMode: wantsAutopilot && !wantsReview ? "autopilot" : "review_first",
    replyPace: wantsFastPace && !wantsSlowPace ? "measured" : wantsSlowPace ? "unhurried" : "deliberate",
    mimicryPreset: wantsCloseVoice && !wantsLightVoice ? "close" : wantsLightVoice ? "light" : "balanced",
    memesEnabled: wantsMemes || current.memesEnabled,
    instagramEnabled: wantsInstagram || current.instagramEnabled,
    quietHoursEnabled: !nightOwl || current.quietHoursEnabled,
    quietHoursStartHour: nightOwl ? 1 : current.quietHoursStartHour,
    quietHoursEndHour: earlyStart ? 6 : current.quietHoursEndHour,
  };
}

function summarizeSoulDefaults(preferences: InstanceSetupPreferences) {
  return [
    resolveAutonomyPreview(preferences.autonomyMode),
    resolveReplyPacePreview(preferences.replyPace),
    resolveMimicryPreview(preferences.mimicryPreset),
    preferences.memesEnabled ? "Meme tools are available from launch." : "Meme tools stay hidden at launch.",
  ];
}

const soulUseCaseOptions = [
  { value: "", label: "Not set" },
  { value: "personal", label: "Personal" },
  { value: "professional", label: "Professional" },
  { value: "mixed", label: "Mixed" },
] as const;

const romanticPreferenceOptions = [
  { value: "", label: "Not set" },
  { value: "men", label: "Men" },
  { value: "women", label: "Women" },
  { value: "men_and_women", label: "Men and women" },
  { value: "any_gender", label: "Any gender" },
  { value: "not_dating", label: "Not dating" },
  { value: "prefer_not_to_say", label: "Prefer not to say" },
] as const;

type SoulFieldKey = keyof InstanceSoulProfile;

const soulPrivacyOptions: Array<{ value: InstanceSoulPrivacyLevel; label: string }> = [
  { value: "setup_only", label: "Setup only" },
  { value: "ai_usable", label: "May guide AI" },
  { value: "never_mention", label: "Do not mention" },
];

const soulReviewFields: Array<{ key: SoulFieldKey; label: string }> = [
  { key: "useCase", label: "Use case" },
  { key: "genderIdentity", label: "Gender" },
  { key: "pronouns", label: "Pronouns" },
  { key: "romanticPreference", label: "Romantic preference" },
  { key: "relationshipStatus", label: "Relationship status" },
  { key: "romanticInterests", label: "Romantic interests" },
  { key: "cultureLocation", label: "Culture / location" },
  { key: "selfDescription", label: "Identity" },
  { key: "values", label: "Values" },
  { key: "communicationStyle", label: "Voice" },
  { key: "boundaries", label: "Boundaries" },
  { key: "relationships", label: "People" },
  { key: "goals", label: "Direction" },
  { key: "dailyRhythm", label: "Rhythm" },
];

function formatPrivacyLabel(value: InstanceSoulPrivacyLevel) {
  if (value === "ai_usable") {
    return "May guide AI";
  }
  if (value === "never_mention") {
    return "Do not mention";
  }
  return "Setup only";
}

export function SetupOnboarding({ realtimeEnabled, initialInstanceState }: SetupOnboardingProps) {
  const router = useRouter();
  const [stage, setStage] = useState<SetupStage>(initialInstanceState.setupCompleted ? "finish" : "security");
  const [instanceState, setInstanceState] = useState<InstanceSetupState>(initialInstanceState);
  const [preferences, setPreferences] = useState<InstanceSetupPreferences>(
    initialInstanceState.preferences || cloneDefaultPreferences(),
  );
  const [setupSecret, setSetupSecret] = useState("");
  const [pin, setPin] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  const { runAction, getRecord, notices, dismissNotice, pushNotice } = useActionStateRegistry();

  const activeStage = setupStages[setupStageIndex(stage)] || setupStages[0];
  const securityRecord = getRecord("setup:onboarding:security");
  const preferencesRecord = getRecord("setup:onboarding:preferences");
  const setupAiRecord = getRecord("setup:onboarding:ai-settings");
  const finishRecord = getRecord("setup:onboarding:finish");
  const pinSource = instanceState.pinSource;
  const envManagedPin = pinSource === "env";
  const filePinExists = pinSource === "file";
  const pinRequiredCopy = envManagedPin
    ? "Your PIN is already managed by environment variables."
    : filePinExists
      ? "A local PIN already exists. Leave both fields empty to keep it, or enter a new PIN."
      : "Create a local PIN before opening the control surface.";
  const pinValidationMessage = useMemo(() => {
    if (envManagedPin) {
      return "";
    }
    if (!filePinExists && pin.trim().length === 0) {
      return "Enter a PIN to continue.";
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
  const canFinish = canSaveSecurity;
  const soulProfileHasContent = hasSoulProfileContent(preferences.soulProfile);
  const soulDefaults = summarizeSoulDefaults(preferences);
  const setupAiToolAvailable = instanceState.setupAiSettingsToolAvailable;
  const showRomanticSetup =
    preferences.soulProfile.useCase === "personal" ||
    preferences.soulProfile.useCase === "mixed" ||
    preferences.soulProfile.romanticPreference.trim().length > 0 ||
    preferences.soulProfile.romanticInterests.trim().length > 0;
  const visibleSoulReviewFields = soulReviewFields.filter(({ key }) => preferences.soulProfile[key].trim().length > 0);

  const updateSoulField = (field: SoulFieldKey, value: string) => {
    setPreferences((current) => ({
      ...current,
      soulProfile: {
        ...current.soulProfile,
        [field]: value,
      },
    }));
  };

  const updateSoulPrivacy = (field: SoulFieldKey, value: InstanceSoulPrivacyLevel) => {
    setPreferences((current) => ({
      ...current,
      soulPrivacy: {
        ...current.soulPrivacy,
        [field]: value,
      },
    }));
  };

  const renderPrivacyControl = (field: SoulFieldKey) => (
    <select
      className="setup-privacy-select"
      value={preferences.soulPrivacy[field]}
      aria-label={`${field} privacy`}
      onChange={(event) => updateSoulPrivacy(field, event.target.value as InstanceSoulPrivacyLevel)}
    >
      {soulPrivacyOptions.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );

  const saveInstanceSetup = async (
    key: string,
    payload: {
      pin?: string;
      preferences?: InstanceSetupPreferences;
      setupCompleted?: boolean;
      beginFullSetup?: boolean;
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
        if (payload.preferences && body.preferencesSynced === false) {
          pushNotice("info", "Preferences were saved locally, but sync failed. Some runtime settings may still use older values.");
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
        pendingLabel: "Saving setup...",
        successMessage: options?.successMessage,
      },
    );
  };

  const runSetupAiSettingsTool = async () => {
    return await runAction(
      "setup:onboarding:ai-settings",
      async () => {
        const response = await fetch("/api/setup/ai-settings", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(setupSecret.trim()
              ? {
                  [getSetupBootstrapHeaderName()]: setupSecret.trim(),
                }
              : {}),
          },
          body: JSON.stringify({ preferences }),
        });

        const body = await readSetupAiSettingsResponse(response);
        if (!response.ok || !body.state || !body.preferences) {
          throw new Error(body.error || `Setup AI settings failed (${response.status})`);
        }

        setInstanceState(body.state);
        setPreferences(body.preferences);
        if (body.preferencesSynced === false) {
          pushNotice("info", "AI-fit settings were saved locally, but sync failed. Some runtime settings may still use older values.");
        }
        return body;
      },
      {
        pendingLabel: "Fitting defaults from profile...",
        successMessage: "AI-fit defaults applied. Tool disabled for this setup run.",
      },
    );
  };

  return (
    <main className="setup-onboarding-shell">
      <div className="setup-onboarding-noise" aria-hidden="true" />
      <section className="setup-onboarding-stage">
        <aside className="setup-onboarding-aside">
          <h1 className="setup-onboarding-title">Setup</h1>

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
                  </span>
                </button>
              );
            })}
          </div>
        </aside>

        <section className="setup-onboarding-main">
          <header className="setup-onboarding-head">
            <p className="queue-meta">{formatSetupStep(stage)}</p>
            <h2 className="setup-onboarding-panel-title">{activeStage.title}</h2>
          </header>

          <ActionNotices notices={notices} onDismiss={dismissNotice} />

          {stage === "security" ? (
            <div className="setup-onboarding-panel">
              <p className="queue-meta">{pinRequiredCopy}</p>

              <details className="setup-advanced">
                <summary>Remote setup access</summary>
                <label className="setup-input-group">
                  <span className="queue-meta">Setup secret</span>
                  <input
                    type="password"
                    value={setupSecret}
                    placeholder="Required only when SLM_SETUP_SECRET is set"
                    onChange={(event) => setSetupSecret(event.target.value)}
                    autoComplete="off"
                  />
                </label>
              </details>

              {!envManagedPin ? (
                <div className="setup-form-grid">
                  <label className="setup-input-group">
                    <span className="queue-meta">Instance PIN</span>
                    <input
                      type="password"
                      value={pin}
                      placeholder={filePinExists ? "Leave blank to keep your current PIN" : "Create PIN"}
                      onChange={(event) => setPin(event.target.value)}
                      autoComplete="new-password"
                    />
                  </label>
                  <label className="setup-input-group">
                    <span className="queue-meta">Confirm PIN</span>
                    <input
                      type="password"
                      value={pinConfirm}
                      placeholder={filePinExists && pin.trim().length === 0 ? "Only needed when changing PIN" : "Confirm PIN"}
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
                        successMessage: "Local PIN settings saved.",
                        nextStage: "preferences",
                      },
                    );
                  }}
                >
                  {securityRecord.pending ? "Saving..." : "Save and continue"}
                </button>
              </div>
            </div>
          ) : null}

          {stage === "preferences" ? (
            <div className="setup-onboarding-panel">
              <div className="setup-poster-block setup-preference-hero">
                <h3>Recommended defaults</h3>
                <p className="queue-meta">
                  Add only the personal context you want this system to use when shaping replies and defaults.
                </p>
                <div className="wizard-actions">
                  <button
                    className="btn btn-ghost"
                    type="button"
                    onClick={() => setPreferences(cloneDefaultPreferences())}
                  >
                    Use recommended defaults
                  </button>
                </div>
              </div>

              <div className="setup-soul-panel">
                <div className="setup-soul-head">
                  <div>
                    <p className="queue-meta">Guidance profile</p>
                    <h3>What context should guide the system?</h3>
                  </div>
                  <button
                    className="btn btn-primary"
                    type="button"
                    disabled={!soulProfileHasContent || !setupAiToolAvailable || setupAiRecord.pending}
                    aria-disabled={!soulProfileHasContent || !setupAiToolAvailable || setupAiRecord.pending}
                    onClick={() => {
                      void runSetupAiSettingsTool();
                    }}
                  >
                    {setupAiRecord.pending ? "Applying..." : setupAiToolAvailable ? "Fit defaults with AI" : "AI fit already used"}
                  </button>
                  <button
                    className="btn btn-ghost"
                    type="button"
                    disabled={!soulProfileHasContent || setupAiRecord.pending}
                    aria-disabled={!soulProfileHasContent || setupAiRecord.pending}
                    onClick={() => setPreferences((current) => derivePreferencesFromSoulProfile(current.soulProfile, current))}
                  >
                    Fit defaults locally
                  </button>
                </div>

                <div className="setup-soul-grid">
                  <label className="setup-input-group">
                    <span className="setup-field-head">
                      <span className="queue-meta">Use case</span>
                      {renderPrivacyControl("useCase")}
                    </span>
                    <select
                      value={preferences.soulProfile.useCase}
                      onChange={(event) => updateSoulField("useCase", event.target.value)}
                    >
                      {soulUseCaseOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="setup-input-group">
                    <span className="setup-field-head">
                      <span className="queue-meta">Gender</span>
                      {renderPrivacyControl("genderIdentity")}
                    </span>
                    <input
                      type="text"
                      value={preferences.soulProfile.genderIdentity}
                      placeholder="Optional"
                      onChange={(event) => updateSoulField("genderIdentity", event.target.value)}
                    />
                  </label>
                  <label className="setup-input-group">
                    <span className="setup-field-head">
                      <span className="queue-meta">Pronouns</span>
                      {renderPrivacyControl("pronouns")}
                    </span>
                    <input
                      type="text"
                      value={preferences.soulProfile.pronouns}
                      placeholder="Optional"
                      onChange={(event) => updateSoulField("pronouns", event.target.value)}
                    />
                  </label>
                  <label className="setup-input-group">
                    <span className="setup-field-head">
                      <span className="queue-meta">Culture / location</span>
                      {renderPrivacyControl("cultureLocation")}
                    </span>
                    <input
                      type="text"
                      value={preferences.soulProfile.cultureLocation}
                      placeholder="City, language, cultural context"
                      onChange={(event) => updateSoulField("cultureLocation", event.target.value)}
                    />
                  </label>
                  {showRomanticSetup ? (
                    <>
                      <label className="setup-input-group">
                        <span className="setup-field-head">
                          <span className="queue-meta">Romantic preference</span>
                          {renderPrivacyControl("romanticPreference")}
                        </span>
                        <select
                          value={preferences.soulProfile.romanticPreference}
                          onChange={(event) => updateSoulField("romanticPreference", event.target.value)}
                        >
                          {romanticPreferenceOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="setup-input-group">
                        <span className="setup-field-head">
                          <span className="queue-meta">Relationship status</span>
                          {renderPrivacyControl("relationshipStatus")}
                        </span>
                        <input
                          type="text"
                          value={preferences.soulProfile.relationshipStatus}
                          placeholder="Single, talking stage, partnered, complicated"
                          onChange={(event) => updateSoulField("relationshipStatus", event.target.value)}
                        />
                      </label>
                      <label className="setup-input-group setup-soul-wide">
                        <span className="setup-field-head">
                          <span className="queue-meta">Romantic interests</span>
                          {renderPrivacyControl("romanticInterests")}
                        </span>
                        <textarea
                          value={preferences.soulProfile.romanticInterests}
                          rows={3}
                          placeholder="Names, situations, boundaries, or what the system should know."
                          onChange={(event) => updateSoulField("romanticInterests", event.target.value)}
                        />
                      </label>
                    </>
                  ) : null}
                  <label className="setup-input-group setup-soul-wide">
                    <span className="setup-field-head">
                      <span className="queue-meta">Identity</span>
                      {renderPrivacyControl("selfDescription")}
                    </span>
                    <textarea
                      value={preferences.soulProfile.selfDescription}
                      rows={4}
                      placeholder="The version of you this system should stay loyal to."
                      onChange={(event) => updateSoulField("selfDescription", event.target.value)}
                    />
                  </label>
                  <label className="setup-input-group">
                    <span className="setup-field-head">
                      <span className="queue-meta">Values</span>
                      {renderPrivacyControl("values")}
                    </span>
                    <textarea
                      value={preferences.soulProfile.values}
                      rows={3}
                      placeholder="What matters most."
                      onChange={(event) => updateSoulField("values", event.target.value)}
                    />
                  </label>
                  <label className="setup-input-group">
                    <span className="setup-field-head">
                      <span className="queue-meta">Voice</span>
                      {renderPrivacyControl("communicationStyle")}
                    </span>
                    <textarea
                      value={preferences.soulProfile.communicationStyle}
                      rows={3}
                      placeholder="How you sound when you mean it."
                      onChange={(event) => updateSoulField("communicationStyle", event.target.value)}
                    />
                  </label>
                  <label className="setup-input-group">
                    <span className="setup-field-head">
                      <span className="queue-meta">Boundaries</span>
                      {renderPrivacyControl("boundaries")}
                    </span>
                    <textarea
                      value={preferences.soulProfile.boundaries}
                      rows={3}
                      placeholder="What should be protected."
                      onChange={(event) => updateSoulField("boundaries", event.target.value)}
                    />
                  </label>
                  <label className="setup-input-group">
                    <span className="setup-field-head">
                      <span className="queue-meta">People</span>
                      {renderPrivacyControl("relationships")}
                    </span>
                    <textarea
                      value={preferences.soulProfile.relationships}
                      rows={3}
                      placeholder="Roles, closeness, family, work, community."
                      onChange={(event) => updateSoulField("relationships", event.target.value)}
                    />
                  </label>
                  <label className="setup-input-group">
                    <span className="setup-field-head">
                      <span className="queue-meta">Direction</span>
                      {renderPrivacyControl("goals")}
                    </span>
                    <textarea
                      value={preferences.soulProfile.goals}
                      rows={3}
                      placeholder="What you are becoming or building."
                      onChange={(event) => updateSoulField("goals", event.target.value)}
                    />
                  </label>
                  <label className="setup-input-group">
                    <span className="setup-field-head">
                      <span className="queue-meta">Rhythm</span>
                      {renderPrivacyControl("dailyRhythm")}
                    </span>
                    <textarea
                      value={preferences.soulProfile.dailyRhythm}
                      rows={3}
                      placeholder="Busy hours, quiet hours, energy patterns."
                      onChange={(event) => updateSoulField("dailyRhythm", event.target.value)}
                    />
                  </label>
                </div>

                <div className="setup-soul-summary">
                  {soulDefaults.map((item) => (
                    <span key={item}>{item}</span>
                  ))}
                  {!setupAiToolAvailable && instanceState.setupAiSettingsToolConsumedAt ? (
                    <span>Setup AI tool disabled.</span>
                  ) : null}
                </div>
              </div>

              <details className="setup-advanced setup-preference-details">
                <summary>Customize defaults</summary>

                <div className="setup-choice-group">
                  <p className="queue-title">Automation mode</p>
                  <div className="setup-choice-grid">
                    {(["review_first", "autopilot"] as const).map((value) => (
                      <button
                        key={value}
                        type="button"
                        className={`setup-choice-card ${preferences.autonomyMode === value ? "setup-choice-card-active" : ""}`}
                        onClick={() => setPreferences((current) => ({ ...current, autonomyMode: value }))}
                      >
                        <strong>{value === "review_first" ? "Review first" : "Autopilot"}</strong>
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
                  <p className="queue-title">Voice matching</p>
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
                      <strong>Enable meme tools</strong>
                      <span>Show meme creation and review features from the start.</span>
                    </span>
                  </label>
                  <label className="setup-toggle-card">
                    <input
                      type="checkbox"
                      checked={preferences.instagramEnabled}
                      onChange={(event) => setPreferences((current) => ({ ...current, instagramEnabled: event.target.checked }))}
                    />
                    <span>
                      <strong>Enable Instagram setup</strong>
                      <span>Show Instagram connection steps and runtime controls.</span>
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
                    <span>Defer automatic sends during overnight hours.</span>
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
              </details>

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
                        successMessage: "Launch defaults saved.",
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
              <SetupWizard realtimeEnabled={realtimeEnabled} embedded initialScreen="whatsapp" setupSecret={setupSecret.trim()} />
              <div className="wizard-actions">
                <button className="btn btn-primary" type="button" onClick={() => setStage("finish")}>
                  Continue without connecting
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
                <p className="setup-poster-kicker">Review</p>
                <h3>Check the profile and defaults before launch.</h3>
                <p>
                  Privacy choices decide what stays in setup, what can guide replies, and what must never be mentioned.
                </p>
              </div>

              <div className="setup-summary-grid">
                <div className="setup-summary-card">
                  <p className="queue-meta">Autonomy</p>
                  <p className="setup-summary-value">{preferences.autonomyMode === "autopilot" ? "autopilot" : "review first"}</p>
                </div>
                <div className="setup-summary-card">
                  <p className="queue-meta">Reply pace</p>
                  <p className="setup-summary-value">{preferences.replyPace}</p>
                </div>
                <div className="setup-summary-card">
                  <p className="queue-meta">Voice matching</p>
                  <p className="setup-summary-value">{preferences.mimicryPreset}</p>
                </div>
                <div className="setup-summary-card">
                  <p className="queue-meta">Profile fields</p>
                  <p className="setup-summary-value">{visibleSoulReviewFields.length || 0} saved</p>
                </div>
              </div>

              <div className="setup-review-panel">
                <div className="setup-review-head">
                  <div>
                    <p className="queue-meta">Guidance profile</p>
                    <p className="queue-title">Saved fields and privacy</p>
                  </div>
                  <button className="btn btn-ghost" type="button" onClick={() => setStage("preferences")}>
                    Edit profile
                  </button>
                </div>
                {visibleSoulReviewFields.length > 0 ? (
                  <div className="setup-review-list">
                    {visibleSoulReviewFields.map(({ key, label }) => (
                      <div key={key} className="setup-review-row">
                        <div>
                          <strong>{label}</strong>
                          <span>{preferences.soulProfile[key]}</span>
                        </div>
                        <em>{formatPrivacyLabel(preferences.soulPrivacy[key])}</em>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="empty-line">No guidance profile fields filled yet.</p>
                )}
              </div>

              {!canFinish ? (
                <p className="instance-lock-error">
                  Save a valid PIN before finishing setup.
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
                        successMessage: "Setup complete.",
                        redirectOnSuccess: true,
                      },
                    );
                  }}
                >
                  {finishRecord.pending ? "Finishing..." : instanceState.setupCompleted ? "Open dashboard" : "Finish setup"}
                </button>
                <button className="btn btn-ghost" type="button" onClick={() => setStage("connect")}>
                  Back
                </button>
                {instanceState.setupCompleted ? (
                  <button
                    className="btn btn-ghost"
                    type="button"
                    disabled={finishRecord.pending}
                    aria-disabled={finishRecord.pending}
                    onClick={() => {
                      void saveInstanceSetup(
                        "setup:onboarding:finish",
                        {
                          preferences,
                          beginFullSetup: true,
                        },
                        {
                          successMessage: "Full setup restarted.",
                          nextStage: "security",
                        },
                      );
                    }}
                  >
                    Run setup again
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
        </section>
      </section>
    </main>
  );
}
