"use client";

import { ActionNotices } from "@/components/action-notices";
import { SetupWizard } from "@/components/setup-wizard";
import { useActionStateRegistry } from "@/lib/ui/action-state";
import {
  DEFAULT_INSTANCE_SETUP_PREFERENCES,
  type InstanceAutonomyMode,
  type InstanceMimicryPreset,
  type InstanceReplyPacePreset,
  type InstanceSelfHostedConfig,
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

type SetupStage = "service" | "security" | "profile" | "defaults" | "connect" | "finish";

const setupStages: Array<{
  id: SetupStage;
  sentence: string;
}> = [
  {
    id: "service",
    sentence: "Add the account details for this app.",
  },
  {
    id: "security",
    sentence: "Create the PIN that protects your control surface.",
  },
  {
    id: "profile",
    sentence: "Add only the profile context you want replies to use.",
  },
  {
    id: "defaults",
    sentence: "Choose how replies should behave by default.",
  },
  {
    id: "connect",
    sentence: "Scan the WhatsApp QR code on this computer.",
  },
  {
    id: "finish",
    sentence: "Review the setup and open the dashboard.",
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
  return setupStages[index]?.sentence || setupStages[0].sentence;
}

function resolveMimicryPreview(preset: InstanceMimicryPreset) {
  if (preset === "light") {
    return "Light voice matching.";
  }
  if (preset === "close") {
    return "Closer tone and rhythm.";
  }
  return "Balanced voice matching.";
}

function resolveReplyPacePreview(preset: InstanceReplyPacePreset) {
  if (preset === "measured") {
    return "Quicker replies.";
  }
  if (preset === "unhurried") {
    return "Slower replies.";
  }
  return "Balanced pace.";
}

function resolveAutonomyPreview(mode: InstanceAutonomyMode) {
  return mode === "autopilot"
    ? "Allowed drafts can send automatically."
    : "Drafts wait for your approval.";
}

function cloneDefaultPreferences(): InstanceSetupPreferences {
  return {
    ...DEFAULT_INSTANCE_SETUP_PREFERENCES,
    selfHosted: {
      ...DEFAULT_INSTANCE_SETUP_PREFERENCES.selfHosted,
    },
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

function countDescriptionWords(value: string) {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function isProfileDescriptionEnough(value: string) {
  return value.trim().length >= 160 && countDescriptionWords(value) >= 30;
}

function inferSoulProfileFromDescription(profile: InstanceSoulProfile): InstanceSoulProfile {
  const description = profile.selfDescription.trim();
  const text = description.toLowerCase();
  if (!description) {
    return profile;
  }

  const wantsProfessional = /\b(work|business|client|professional|team|company|founder|startup|sales|career)\b/.test(text);
  const wantsPersonal = /\b(friend|family|dating|relationship|personal|romantic|partner|crush|social)\b/.test(text);
  const useCase = profile.useCase || (wantsProfessional && wantsPersonal ? "mixed" : wantsProfessional ? "professional" : "personal");
  const communicationStyle =
    profile.communicationStyle ||
    (/\b(pidgin|yoruba|igbo|hausa|slang|emoji|banter|playful|warm|direct|formal|short|concise)\b/.test(text)
      ? description
      : "Use the tone, pace, and boundaries described in the setup description.");
  const dailyRhythm =
    profile.dailyRhythm ||
    (/\b(morning|night|late|busy|weekend|weekday|after work|school|routine|quiet hours)\b/.test(text) ? description : "");
  const goals =
    profile.goals ||
    (/\b(build|grow|focus|goal|priority|project|business|career|study|learn|launch)\b/.test(text) ? description : "");
  const boundaries =
    profile.boundaries ||
    (/\b(boundary|private|privacy|careful|review|approve|avoid|never|sensitive|do not|don't)\b/.test(text) ? description : "");

  return {
    ...profile,
    useCase,
    selfDescription: description,
    communicationStyle,
    dailyRhythm,
    goals,
    boundaries,
  };
}

function parseHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

function isPlaceholderValue(value: string) {
  const normalized = value.trim().toLowerCase();
  return (
    !normalized ||
    normalized === "test-key" ||
    normalized === "your-api-key" ||
    normalized.includes("example.") ||
    normalized.includes("your-")
  );
}

function validateSelfHostedSetup(preferences: InstanceSetupPreferences) {
  if (preferences.serviceMode !== "self_hosted") {
    return "";
  }

  const { selfHosted } = preferences;
  const convexUrl = parseHttpUrl(selfHosted.convexUrl);
  if (!convexUrl || !selfHosted.convexUrl.includes(".convex.cloud")) {
    return "Enter your real Convex deployment URL, for example https://your-deployment.convex.cloud.";
  }
  if (isPlaceholderValue(selfHosted.convexUrl)) {
    return "Replace the placeholder Convex URL with your real self-hosted Convex deployment.";
  }

  const aiBaseUrl = parseHttpUrl(selfHosted.aiBaseUrl);
  if (!aiBaseUrl || isPlaceholderValue(selfHosted.aiBaseUrl)) {
    return "Enter the real AI base URL you want this self-hosted instance to use.";
  }
  if (isPlaceholderValue(selfHosted.aiModel)) {
    return "Enter the real AI model for this self-hosted instance.";
  }
  if (isPlaceholderValue(selfHosted.aiApiKey)) {
    return "Enter a real AI API key. Placeholder keys like test-key cannot finish setup.";
  }
  return "";
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
    preferences.memesEnabled ? "Meme tools on." : "Meme tools off.",
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
  const [stage, setStage] = useState<SetupStage>(initialInstanceState.setupCompleted ? "finish" : "service");
  const [instanceState, setInstanceState] = useState<InstanceSetupState>(initialInstanceState);
  const [preferences, setPreferences] = useState<InstanceSetupPreferences>(
    initialInstanceState.preferences || cloneDefaultPreferences(),
  );
  const [account, setAccount] = useState(initialInstanceState.account);
  const [pin, setPin] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  const [whatsappConnected, setWhatsappConnected] = useState(false);
  const { runAction, getRecord, notices, dismissNotice, pushNotice } = useActionStateRegistry();

  const securityRecord = getRecord("setup:onboarding:security");
  const preferencesRecord = getRecord("setup:onboarding:preferences");
  const setupAiRecord = getRecord("setup:onboarding:ai-settings");
  const finishRecord = getRecord("setup:onboarding:finish");
  const pinSource = instanceState.pinSource;
  const envManagedPin = pinSource === "env";
  const filePinExists = pinSource === "file";
  const pinAlreadyConfigured = envManagedPin || filePinExists || instanceState.pinEnabled;
  const pinRequiredCopy = envManagedPin
    ? "This PIN is managed by environment variables."
    : filePinExists
      ? "A PIN is already set for this app."
      : "Create a local PIN before opening the control surface.";
  const pinValidationMessage = useMemo(() => {
    if (pinAlreadyConfigured) {
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
  }, [filePinExists, pin, pinAlreadyConfigured, pinConfirm]);
  const serviceValidationMessage = useMemo(() => validateSelfHostedSetup(preferences), [preferences]);

  const canSaveSecurity = pinAlreadyConfigured || pinValidationMessage === "";
  const canSaveService = serviceValidationMessage === "";
  const canFinish = canSaveSecurity && canSaveService;
  const profileDescription = preferences.soulProfile.selfDescription;
  const profileDescriptionWordCount = countDescriptionWords(profileDescription);
  const profileDescriptionEnough = isProfileDescriptionEnough(profileDescription);
  const profileValidationMessage = profileDescriptionEnough
    ? ""
    : `Write at least 30 words so setup can infer tone, boundaries, pace, and defaults. ${profileDescriptionWordCount}/30 words.`;
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

  const updateSelfHostedConfig = (field: keyof InstanceSelfHostedConfig, value: string) => {
    setPreferences((current) => ({
      ...current,
      selfHosted: {
        ...current.selfHosted,
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
      account?: typeof account;
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
          },
          body: JSON.stringify(payload),
        });

        const body = await readSetupStateResponse(response);
        if (!response.ok || !body.state) {
          throw new Error(body.error || `Setup save failed (${response.status})`);
        }

        setInstanceState(body.state);
        setPreferences(body.state.preferences);
        setAccount(body.state.account);
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

  const runSetupAiSettingsTool = async (options?: { nextStage?: SetupStage }) => {
    return await runAction(
      "setup:onboarding:ai-settings",
      async () => {
        const response = await fetch("/api/setup/ai-settings", {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            preferences: {
              ...preferences,
              soulProfile: inferSoulProfileFromDescription(preferences.soulProfile),
            },
          }),
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
        if (options?.nextStage) {
          setStage(options.nextStage);
        }
        return body;
      },
      {
        pendingLabel: "Fitting defaults from profile...",
        successMessage: "AI-fit defaults applied. Tool disabled for this setup run.",
      },
    );
  };

  const applyProfileLocally = () => {
    setPreferences((current) => derivePreferencesFromSoulProfile(inferSoulProfileFromDescription(current.soulProfile), current));
    setStage("defaults");
  };

  const continueFromProfile = () => {
    if (!profileDescriptionEnough) {
      pushNotice("error", profileValidationMessage);
      return;
    }
    if (setupAiToolAvailable) {
      void runSetupAiSettingsTool({ nextStage: "defaults" });
      return;
    }
    applyProfileLocally();
  };

  return (
    <main className="setup-onboarding-shell">
      <div className="setup-onboarding-noise" aria-hidden="true" />
      <section className="setup-onboarding-stage">
        <section className="setup-onboarding-main">
          <header className="setup-onboarding-head">
            <p className="queue-meta">OdogwuHQ setup</p>
            <h1 className="setup-step-sentence">{formatSetupStep(stage)}</h1>
          </header>

          <ActionNotices notices={notices} onDismiss={dismissNotice} />

          {stage === "service" ? (
            <div className="setup-onboarding-panel">
              {preferences.serviceMode === "hosted" ? (
                <div className="setup-form-grid">
                  <label className="setup-input-group setup-soul-wide">
                    <span className="queue-meta">Email</span>
                    <input
                      type="email"
                      value={account.email}
                      placeholder="you@example.com"
                      onChange={(event) => setAccount((current) => ({ ...current, email: event.target.value }))}
                      autoComplete="email"
                    />
                  </label>
                </div>
              ) : null}

              <div className="setup-soul-summary">
                <span>7 day trial.</span>
                <span>₦5,000/month.</span>
                <span>WhatsApp session remains local.</span>
              </div>

              <details className="setup-advanced">
                <summary>Use your own backend</summary>
                <label className="setup-toggle-card">
                  <input
                    type="checkbox"
                    checked={preferences.serviceMode === "self_hosted"}
                    onChange={(event) =>
                      setPreferences((current) => ({
                        ...current,
                        serviceMode: event.target.checked ? "self_hosted" : "hosted",
                      }))
                    }
                  />
                  <span>
                    <strong>Self-hosted mode</strong>
                    <span>Use your own Convex deployment, AI endpoint, keys, and app URLs.</span>
                  </span>
                </label>

                {preferences.serviceMode === "self_hosted" ? (
                  <div className="setup-form-grid">
                    <label className="setup-input-group setup-soul-wide">
                      <span className="queue-meta">Convex deployment URL</span>
                      <input
                        type="url"
                        value={preferences.selfHosted.convexUrl}
                        placeholder="https://your-deployment.convex.cloud"
                        onChange={(event) => updateSelfHostedConfig("convexUrl", event.target.value)}
                      />
                    </label>
                    <label className="setup-input-group">
                      <span className="queue-meta">App / API base URL</span>
                      <input
                        type="url"
                        value={preferences.selfHosted.appBaseUrl}
                        placeholder="https://your-domain.example"
                        onChange={(event) => updateSelfHostedConfig("appBaseUrl", event.target.value)}
                      />
                    </label>
                    <label className="setup-input-group">
                      <span className="queue-meta">AI base URL</span>
                      <input
                        type="url"
                        value={preferences.selfHosted.aiBaseUrl}
                        placeholder="https://api.openai.com/v1 or Azure endpoint"
                        onChange={(event) => updateSelfHostedConfig("aiBaseUrl", event.target.value)}
                      />
                    </label>
                    <label className="setup-input-group">
                      <span className="queue-meta">AI model</span>
                      <input
                        type="text"
                        value={preferences.selfHosted.aiModel}
                        placeholder="gpt-5.4, gpt-4.1, or your hosted model"
                        onChange={(event) => updateSelfHostedConfig("aiModel", event.target.value)}
                      />
                    </label>
                    <label className="setup-input-group">
                      <span className="queue-meta">AI API key</span>
                      <input
                        type="password"
                        value={preferences.selfHosted.aiApiKey}
                        placeholder="Stored locally on this machine"
                        onChange={(event) => updateSelfHostedConfig("aiApiKey", event.target.value)}
                        autoComplete="off"
                      />
                    </label>
                  </div>
                ) : null}
              </details>

              {serviceValidationMessage ? <p className="instance-lock-error">{serviceValidationMessage}</p> : null}

              <div className="wizard-actions">
                <button
                  className="btn btn-primary"
                  type="button"
                  disabled={!canSaveService || preferencesRecord.pending}
                  aria-disabled={!canSaveService || preferencesRecord.pending}
                  onClick={() => {
                    void saveInstanceSetup(
                      "setup:onboarding:preferences",
                      {
                        preferences,
                        account,
                      },
                      {
                        successMessage: "Service choice saved.",
                        nextStage: "security",
                      },
                    );
                  }}
                >
                  {preferencesRecord.pending ? "Saving..." : "Save and continue"}
                </button>
              </div>
            </div>
          ) : null}

          {stage === "security" ? (
            <div className="setup-onboarding-panel">
              <p className="queue-meta">{pinRequiredCopy}</p>

              <div className="setup-form-grid">
                <label className="setup-input-group">
                  <span className="queue-meta">Instance PIN</span>
                  <input
                    type="password"
                    value={pin}
                    placeholder={pinAlreadyConfigured ? "PIN already set" : "Create PIN"}
                    onChange={(event) => setPin(event.target.value)}
                    autoComplete="new-password"
                    disabled={pinAlreadyConfigured}
                    aria-disabled={pinAlreadyConfigured}
                  />
                </label>
                <label className="setup-input-group">
                  <span className="queue-meta">Confirm PIN</span>
                  <input
                    type="password"
                    value={pinConfirm}
                    placeholder={pinAlreadyConfigured ? "PIN already set" : "Confirm PIN"}
                    onChange={(event) => setPinConfirm(event.target.value)}
                    autoComplete="new-password"
                    disabled={pinAlreadyConfigured}
                    aria-disabled={pinAlreadyConfigured}
                  />
                </label>
              </div>

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
                        ...(pinAlreadyConfigured ? {} : { pin: pin.trim() }),
                        issueSession: !envManagedPin && !pinAlreadyConfigured,
                      },
                      {
                        successMessage: pinAlreadyConfigured ? "PIN kept." : "PIN saved.",
                        nextStage: "profile",
                      },
                    );
                  }}
                >
                  {securityRecord.pending ? "Saving..." : pinAlreadyConfigured ? "Continue" : "Save and continue"}
                </button>
                <button className="btn btn-ghost" type="button" onClick={() => setStage("service")}>
                  Back
                </button>
              </div>
            </div>
          ) : null}

          {stage === "profile" ? (
            <div className="setup-onboarding-panel">
              <div className="setup-soul-panel">
                <div className="setup-soul-head">
                  <div>
                    <p className="queue-title">Describe yourself, your voice, your boundaries, and how this app should act for you.</p>
                  </div>
                </div>

                <label className="setup-input-group setup-soul-wide">
                  <span className="queue-meta">Profile description</span>
                  <textarea
                    value={profileDescription}
                    rows={8}
                    placeholder="Example: I run a busy business, reply warmly but directly, use light Nigerian English and occasional pidgin, avoid sensitive family topics, slow down at night, and keep anything romantic private unless I mention it."
                    onChange={(event) => updateSoulField("selfDescription", event.target.value)}
                  />
                </label>
                <p className={profileDescriptionEnough ? "queue-meta" : "instance-lock-error"}>
                  {profileDescriptionEnough
                    ? "Enough context to infer setup defaults."
                    : `Add more context so setup can infer the important settings. ${profileDescriptionWordCount}/30 words.`}
                </p>

                <details className="setup-advanced">
                  <summary>Advanced profile fields</summary>
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
                      placeholder="Short description of you."
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
                      placeholder="Tone, phrases, languages, emoji style."
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
                      placeholder="Topics or actions to avoid."
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
                      placeholder="Important people and context."
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
                      placeholder="Goals or priorities."
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
                      placeholder="Busy hours, quiet hours, routines."
                      onChange={(event) => updateSoulField("dailyRhythm", event.target.value)}
                    />
                  </label>
                  </div>
                </details>

                <div className="setup-soul-summary">
                  {soulDefaults.map((item) => (
                    <span key={item}>{item}</span>
                  ))}
                  {!setupAiToolAvailable && instanceState.setupAiSettingsToolConsumedAt ? (
                    <span>AI fit already used.</span>
                  ) : null}
                </div>
              </div>

              <div className="wizard-actions">
                <button
                  className="btn btn-primary"
                  type="button"
                  disabled={!profileDescriptionEnough || setupAiRecord.pending}
                  aria-disabled={!profileDescriptionEnough || setupAiRecord.pending}
                  onClick={continueFromProfile}
                >
                  {setupAiRecord.pending ? "Fitting..." : setupAiToolAvailable ? "Fit and continue" : "Continue"}
                </button>
                <button className="btn btn-ghost" type="button" onClick={() => setStage("security")}>
                  Back
                </button>
              </div>
            </div>
          ) : null}

          {stage === "defaults" ? (
            <div className="setup-onboarding-panel">
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
                      <span>Show meme creation and review.</span>
                    </span>
                  </label>
                  <label className="setup-toggle-card">
                    <input
                      type="checkbox"
                      checked={preferences.instagramEnabled}
                      onChange={(event) => setPreferences((current) => ({ ...current, instagramEnabled: event.target.checked }))}
                    />
                    <span>
                      <strong>Enable Instagram setup <em className="setup-unstable-tag">Currently unstable</em></strong>
                      <span>Show experimental Instagram connection controls.</span>
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
                    <span>Pause automatic sends during these hours.</span>
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
                        account,
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
                <button className="btn btn-ghost" type="button" onClick={() => setStage("profile")}>
                  Back
                </button>
              </div>
            </div>
          ) : null}

          {stage === "connect" ? (
            <div className="setup-onboarding-panel">
              <SetupWizard
                realtimeEnabled={realtimeEnabled}
                embedded
                initialScreen="whatsapp"
                onWhatsAppConnectedChange={setWhatsappConnected}
              />
              <div className="wizard-actions">
                {whatsappConnected ? (
                  <button className="btn btn-primary" type="button" onClick={() => setStage("finish")}>
                    Continue
                  </button>
                ) : null}
                <button className="btn btn-ghost" type="button" onClick={() => setStage("defaults")}>
                  Back
                </button>
              </div>
            </div>
          ) : null}

          {stage === "finish" ? (
            <div className="setup-onboarding-panel">
              <div className="setup-summary-grid">
                <div className="setup-summary-card">
                  <p className="queue-meta">Service</p>
                  <p className="setup-summary-value">{preferences.serviceMode === "hosted" ? "managed" : "self-hosted"}</p>
                </div>
                {account.email ? (
                  <div className="setup-summary-card">
                    <p className="queue-meta">Email</p>
                    <p className="setup-summary-value">{account.email}</p>
                  </div>
                ) : null}
                {preferences.serviceMode === "self_hosted" && preferences.selfHosted.convexUrl ? (
                  <div className="setup-summary-card">
                    <p className="queue-meta">Convex URL</p>
                    <p className="setup-summary-value">{preferences.selfHosted.convexUrl}</p>
                  </div>
                ) : null}
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
                  <p className="queue-meta">Meme tools</p>
                  <p className="setup-summary-value">{preferences.memesEnabled ? "enabled" : "off"}</p>
                </div>
                <div className="setup-summary-card">
                  <p className="queue-meta">Instagram <em className="setup-unstable-tag">Currently unstable</em></p>
                  <p className="setup-summary-value">{preferences.instagramEnabled ? "enabled" : "off"}</p>
                </div>
                {preferences.quietHoursEnabled ? (
                  <div className="setup-summary-card">
                    <p className="queue-meta">Quiet hours</p>
                    <p className="setup-summary-value">
                      {String(preferences.quietHoursStartHour).padStart(2, "0")}:00 to{" "}
                      {String(preferences.quietHoursEndHour).padStart(2, "0")}:00
                    </p>
                  </div>
                ) : null}
              </div>

              <div className="setup-review-panel">
                <div className="setup-review-head">
                  <div>
                    <p className="queue-title">Profile context</p>
                  </div>
                  <button className="btn btn-ghost" type="button" onClick={() => setStage("profile")}>
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
                  {pinValidationMessage || serviceValidationMessage || "Complete setup before opening the dashboard."}
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
                        account,
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
              </div>
            </div>
          ) : null}
        </section>
      </section>
    </main>
  );
}
