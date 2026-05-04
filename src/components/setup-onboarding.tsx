"use client";

import { ActionNotices } from "@/components/action-notices";
import { SearchableSelect } from "@/components/app-ui";
import { BrandLogo } from "@/components/brand-logo";
import { SetupPreparationProgress } from "@/components/setup-preparation-progress";
import { SetupWizard, VoiceSetupPanel, type VoiceSetupState } from "@/components/setup-wizard";
import { LEGAL_POLICY_VERSIONS, privacyPolicy, termsAndConditions, type LegalPolicy } from "@/lib/legal-policies";
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
import { useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, type UIEvent, useEffect, useMemo, useRef, useState } from "react";

type SetupOnboardingProps = {
  realtimeEnabled: boolean;
  initialInstanceState: InstanceSetupState;
};

type SetupStage =
  | "legal"
  | "welcome"
  | "purpose"
  | "service"
  | "account"
  | "backend"
  | "ai"
  | "verify"
  | "security"
  | "profile"
  | "defaults"
  | "connect"
  | "finish"
  | "voice"
  | "prepare";

type ConnectorSetupScreen = "whatsapp" | "instagram" | "imessage" | "telegram";

const connectorSetupScreens: ConnectorSetupScreen[] = ["whatsapp", "instagram", "imessage", "telegram"];

function isConnectorSetupScreen(value: string | null): value is ConnectorSetupScreen {
  return connectorSetupScreens.includes(value as ConnectorSetupScreen);
}

function connectorSetupLabel(provider: ConnectorSetupScreen) {
  if (provider === "whatsapp") {
    return "WhatsApp";
  }
  if (provider === "instagram") {
    return "Instagram";
  }
  if (provider === "imessage") {
    return "iMessage";
  }
  return "Telegram";
}

const setupStages: Array<{
  id: SetupStage;
  label: string;
  sentence: string;
  helper: string;
}> = [
  {
    id: "welcome",
    label: "Welcome",
    sentence: "Set up OdogwuHQ for your desktop.",
    helper: "A guided setup for your private communication console.",
  },
  {
    id: "purpose",
    label: "Use",
    sentence: "Tell us what this workspace is for.",
    helper: "OdogwuHQ keeps the same conversation focus, then tunes labels, defaults, and business surfaces around your answer.",
  },
  {
    id: "service",
    label: "Service",
    sentence: "Choose how this app should run.",
    helper: "Use the managed service or connect your own self-hosted setup. OdogwuHQ will handle the right path from there.",
  },
  {
    id: "account",
    label: "Account",
    sentence: "Add the email for your account.",
    helper: "This is only used for your managed account, trial, billing, and recovery.",
  },
  {
    id: "backend",
    label: "Backend",
    sentence: "Connect your backend.",
    helper: "Add the deployment details for the self-hosted app. This only appears for self-hosted setup.",
  },
  {
    id: "ai",
    label: "AI",
    sentence: "Connect your AI provider.",
    helper: "Choose the provider endpoint, model, and key this app should use for replies.",
  },
  {
    id: "verify",
    label: "Verify",
    sentence: "Verify the self-hosted setup.",
    helper: "OdogwuHQ will check the backend before moving on.",
  },
  {
    id: "security",
    label: "Security",
    sentence: "Create the PIN that protects this app.",
    helper: "This PIN unlocks OdogwuHQ on this computer.",
  },
  {
    id: "profile",
    label: "Profile",
    sentence: "Add only the profile context you want replies to use.",
    helper: "One good description is enough. Advanced fields are there only when you want more control.",
  },
  {
    id: "defaults",
    label: "Defaults",
    sentence: "Choose how replies should behave by default.",
    helper: "These are starting preferences. You can change them later from Settings.",
  },
  {
    id: "connect",
    label: "Connect",
    sentence: "Connect the accounts OdogwuHQ should use.",
    helper: "Connect the messaging accounts OdogwuHQ should use on this computer.",
  },
  {
    id: "finish",
    label: "Review",
    sentence: "Review the setup and open the dashboard.",
    helper: "Make sure the important choices look right, then move into the app.",
  },
  {
    id: "voice",
    label: "Voice",
    sentence: "Tell OdogwuHQ what you sound like.",
    helper: "Record a short local voice note for Vox voice generation, or skip it for now.",
  },
  {
    id: "prepare",
    label: "Ready",
    sentence: "Get OdogwuHQ ready on this computer.",
    helper: "Local transcription and voice tools can install while you continue.",
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

function readConvexDeployResponse(response: Response) {
  return response.json() as Promise<{
    status?: "ready";
    deployed?: boolean;
    skipped?: boolean;
    needsCredentials?: boolean;
    message?: string;
    output?: string;
    preferences?: InstanceSetupPreferences;
    error?: string;
  }>;
}

function formatSetupStep(stage: SetupStage) {
  return setupStages.find((item) => item.id === stage)?.sentence || setupStages[0].sentence;
}

function formatSetupHelper(stage: SetupStage) {
  return setupStages.find((item) => item.id === stage)?.helper || setupStages[0].helper;
}

function renderLegalPolicy(policy: LegalPolicy) {
  return (
    <article className="setup-legal-document">
      <header>
        <p className="queue-meta">{policy.updatedLabel}</p>
        <h2>{policy.title}</h2>
      </header>
      {policy.intro.map((paragraph) => (
        <p key={paragraph}>{paragraph}</p>
      ))}
      {policy.sections.map((section) => (
        <section key={section.heading}>
          <h3>{section.heading}</h3>
          {section.body.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </section>
      ))}
    </article>
  );
}

function legalAcceptanceIsCurrent(state: InstanceSetupState) {
  return (
    state.legalAcceptance.accepted &&
    state.legalAcceptance.privacyPolicyVersion === LEGAL_POLICY_VERSIONS.privacyPolicy &&
    state.legalAcceptance.termsVersion === LEGAL_POLICY_VERSIONS.terms
  );
}

function resolveMimicryPreview(preset: InstanceMimicryPreset) {
  if (preset === "light") {
    return "Light style match.";
  }
  if (preset === "close") {
    return "Closer tone and rhythm.";
  }
  return "Balanced style match.";
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
    ? "Allowed replies can send automatically."
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

function applyProductUseDefaults(
  productUse: InstanceSetupPreferences["productUse"],
  current: InstanceSetupPreferences,
): InstanceSetupPreferences {
  const businessDescription =
    "This is a business workspace. Help us reply to customers, protect the brand voice, follow up on leads, answer product questions, and move conversations toward clear next steps without sounding pushy.";
  const personalDescription =
    "This is a personal workspace. Help me keep conversations warm, reply in my natural voice, remember follow-ups, and respect my boundaries.";
  const description = current.soulProfile.selfDescription.trim();
  return {
    ...current,
    productUse,
    mimicryPreset: productUse === "business" && current.mimicryPreset === "close" ? "balanced" : current.mimicryPreset,
    soulProfile: {
      ...current.soulProfile,
      useCase: productUse,
      selfDescription:
        !description ||
        description === businessDescription ||
        description === personalDescription
          ? productUse === "business"
            ? businessDescription
            : personalDescription
          : current.soulProfile.selfDescription,
      goals:
        productUse === "business" && !current.soulProfile.goals.trim()
          ? "Capture demand from conversations, follow up with leads, help customers buy, and keep service promises visible."
          : current.soulProfile.goals,
      relationships:
        productUse === "business" && !current.soulProfile.relationships.trim()
          ? "Customers, leads, returning buyers, suppliers, collaborators, and VIP clients."
          : current.soulProfile.relationships,
      boundaries:
        productUse === "business" && !current.soulProfile.boundaries.trim()
          ? "Do not overpromise, invent prices, confirm payments without evidence, or send sensitive business messages without review."
          : current.soulProfile.boundaries,
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

function validateSelfHostedBackendSetup(preferences: InstanceSetupPreferences) {
  if (preferences.serviceMode !== "self_hosted") {
    return "";
  }

  const { selfHosted } = preferences;
  const convexUrl = parseHttpUrl(selfHosted.convexUrl);
  if (!convexUrl) {
    return "Enter your real backend URL.";
  }
  if (isPlaceholderValue(selfHosted.convexUrl)) {
    return "Replace the placeholder backend URL with your real deployment.";
  }
  return "";
}

function validateSelfHostedAiSetup(preferences: InstanceSetupPreferences) {
  if (preferences.serviceMode !== "self_hosted") {
    return "";
  }

  const { selfHosted } = preferences;
  const aiBaseUrl = parseHttpUrl(selfHosted.aiBaseUrl);
  if (!aiBaseUrl || isPlaceholderValue(selfHosted.aiBaseUrl)) {
    return "Enter the real AI provider URL this app should use.";
  }
  if (isPlaceholderValue(selfHosted.aiModel)) {
    return "Enter the real model this app should use.";
  }
  if (isPlaceholderValue(selfHosted.aiApiKey)) {
    return "Enter a real AI API key. Placeholder keys like test-key cannot finish setup.";
  }
  return "";
}

function validateSelfHostedSetup(preferences: InstanceSetupPreferences) {
  return validateSelfHostedBackendSetup(preferences) || validateSelfHostedAiSetup(preferences);
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
  const nightOwl = /\b(night owl|late night|overnight|after midnight)\b/.test(text);
  const earlyStart = /\b(early|morning|sunrise|5am|6am)\b/.test(text);

  return {
    ...current,
    soulProfile: profile,
    autonomyMode: wantsAutopilot && !wantsReview ? "autopilot" : "review_first",
    replyPace: wantsFastPace && !wantsSlowPace ? "measured" : wantsSlowPace ? "unhurried" : "deliberate",
    mimicryPreset: wantsCloseVoice && !wantsLightVoice ? "close" : wantsLightVoice ? "light" : "balanced",
    memesEnabled: wantsMemes || current.memesEnabled,
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
  { value: "business", label: "Business" },
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

const profileStarterChips = [
  {
    label: "Warm and direct",
    text: "I prefer warm, direct replies that sound natural and do not over-explain.",
  },
  {
    label: "Busy schedule",
    text: "I am often busy, so help me keep conversations moving without sounding rushed.",
  },
  {
    label: "Nigerian voice",
    text: "Use natural Nigerian English when it fits, with light pidgin only where it would sound like me.",
  },
  {
    label: "Privacy first",
    text: "Be careful with private topics, sensitive relationships, money, family, and anything I have not clearly approved.",
  },
  {
    label: "Playful when safe",
    text: "A little humor is good with close people, but stay clean and respectful in professional chats.",
  },
] as const;

const businessProfileStarterChips = [
  {
    label: "Customer-first",
    text: "Reply like a helpful business owner: warm, clear, and focused on what the customer needs next.",
  },
  {
    label: "Sales follow-up",
    text: "Track leads, people who ask for price, people waiting for payment details, and customers who need a polite follow-up.",
  },
  {
    label: "Brand safe",
    text: "Never invent prices, availability, discounts, delivery timelines, or payment confirmation.",
  },
  {
    label: "Nigerian market",
    text: "Use natural Nigerian English when it fits, keep replies respectful, and make buying steps simple.",
  },
  {
    label: "Human approval",
    text: "Ask for approval before sensitive replies, refunds, escalations, major promises, or anything involving money.",
  },
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

function formatReplyPaceLabel(value: InstanceReplyPacePreset) {
  if (value === "measured") {
    return "Measured";
  }
  if (value === "unhurried") {
    return "Unhurried";
  }
  return "Deliberate";
}

function formatReplyStyleLabel(value: InstanceMimicryPreset) {
  if (value === "light") {
    return "Light";
  }
  if (value === "close") {
    return "Close";
  }
  return "Balanced";
}

export function SetupOnboarding({ realtimeEnabled, initialInstanceState }: SetupOnboardingProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const connectParam = searchParams.get("connect");
  const requestedConnector: ConnectorSetupScreen | null = isConnectorSetupScreen(connectParam) ? connectParam : null;
  const wantsVoiceConnect = searchParams.get("connect") === "voice";
  const connectorReturnTo = searchParams.get("returnTo");
  const defaultConnectorReturnTo = requestedConnector === "whatsapp" ? "/" : "/settings";
  const safeConnectorReturnTo =
    connectorReturnTo && connectorReturnTo.startsWith("/") && !connectorReturnTo.startsWith("//")
      ? connectorReturnTo
      : defaultConnectorReturnTo;
  const voiceReturnTo = searchParams.get("returnTo");
  const safeVoiceReturnTo =
    voiceReturnTo && voiceReturnTo.startsWith("/") && !voiceReturnTo.startsWith("//") ? voiceReturnTo : "/settings?section=voice";
  const shouldExitAfterConnectorConnect = initialInstanceState.setupCompleted && requestedConnector !== null;
  const shouldExitAfterVoiceSave = initialInstanceState.setupCompleted && wantsVoiceConnect;
  const needsLegalAcceptance = !legalAcceptanceIsCurrent(initialInstanceState);
  const resolvePostLegalStage = (): SetupStage => {
    if (!initialInstanceState.setupCompleted) {
      return "welcome";
    }
    if (requestedConnector) {
      return "connect";
    }
    if (wantsVoiceConnect) {
      return "voice";
    }
    return "finish";
  };
  const [stage, setStage] = useState<SetupStage>(
    needsLegalAcceptance
      ? "legal"
      : requestedConnector
        ? "connect"
        : wantsVoiceConnect
          ? "voice"
          : initialInstanceState.setupCompleted
            ? "finish"
            : "welcome",
  );
  const [legalScrolledToEnd, setLegalScrolledToEnd] = useState(false);
  const [legalDeclined, setLegalDeclined] = useState(false);
  const [instanceState, setInstanceState] = useState<InstanceSetupState>(initialInstanceState);
  const [preferences, setPreferences] = useState<InstanceSetupPreferences>(
    initialInstanceState.preferences || cloneDefaultPreferences(),
  );
  const [account, setAccount] = useState(initialInstanceState.account);
  const [pin, setPin] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  const [whatsappConnected, setWhatsappConnected] = useState(false);
  const [instagramConnected, setInstagramConnected] = useState(false);
  const [imessageConnected, setIMessageConnected] = useState(false);
  const [telegramConnected, setTelegramConnected] = useState(false);
  const [voiceOnboardingState, setVoiceOnboardingState] = useState<VoiceSetupState | null>(null);
  const stageTitleRef = useRef<HTMLHeadingElement>(null);
  const legalScrollRef = useRef<HTMLDivElement>(null);
  const connectorAutoExitHandledRef = useRef(false);
  const { runAction, getRecord, notices, dismissNotice, pushNotice } = useActionStateRegistry();

  const securityRecord = getRecord("setup:onboarding:security");
  const accountRecord = getRecord("setup:onboarding:account");
  const preferencesRecord = getRecord("setup:onboarding:preferences");
  const setupAiRecord = getRecord("setup:onboarding:ai-settings");
  const convexBackendRecord = getRecord("setup:onboarding:convex-backend");
  const finishRecord = getRecord("setup:onboarding:finish");
  const legalRecord = getRecord("setup:onboarding:legal");
  const isWelcomeStage = stage === "welcome";
  const isLegalStage = stage === "legal";
  const isPreparationStage = stage === "prepare";
  const previousStage =
    stage === "purpose"
      ? "welcome"
      : stage === "service"
        ? "purpose"
      : stage === "account" || stage === "backend"
        ? "service"
        : stage === "ai"
          ? "backend"
          : stage === "verify"
            ? "ai"
            : stage === "security"
              ? preferences.serviceMode === "hosted"
                ? "account"
                : "verify"
              : stage === "profile"
                ? "security"
                : stage === "defaults"
                  ? "profile"
                    : stage === "connect"
                    ? shouldExitAfterConnectorConnect
                      ? null
                      : "defaults"
                    : stage === "finish"
                      ? "connect"
                      : stage === "voice"
                        ? shouldExitAfterVoiceSave
                          ? null
                          : "finish"
                        : stage === "prepare"
                          ? "voice"
                        : null;
  const showSetupNotices = notices.length > 0;
  const pinSource = instanceState.pinSource;
  const envManagedPin = pinSource === "env";
  const filePinExists = pinSource === "file";
  const pinAlreadyConfigured = envManagedPin || filePinExists || instanceState.pinEnabled;
  const pinRequiredCopy = envManagedPin
    ? "This PIN is managed by environment variables."
    : filePinExists
      ? "A PIN is already set for this app."
      : "Create a PIN before opening this app.";
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
  const backendSetupValidationMessage = useMemo(() => validateSelfHostedBackendSetup(preferences), [preferences]);
  const aiSetupValidationMessage = useMemo(() => validateSelfHostedAiSetup(preferences), [preferences]);
  const selfHostedValidationMessage = useMemo(() => validateSelfHostedSetup(preferences), [preferences]);
  const selfHostedBackendReady =
    preferences.serviceMode !== "self_hosted" || Boolean(preferences.selfHosted.convexBackendProvisionedAt);
  const backendValidationMessage =
    preferences.serviceMode === "self_hosted" && !selfHostedBackendReady
      ? "Verify the backend before opening the dashboard."
      : "";

  const canSaveSecurity = pinAlreadyConfigured || pinValidationMessage === "";
  const canSaveService = true;
  const canSaveBackend = backendSetupValidationMessage === "";
  const canSaveAi = aiSetupValidationMessage === "";
  const canSaveSelfHostedSetup = selfHostedValidationMessage === "";
  const accountEmailValid =
    preferences.serviceMode !== "hosted" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account.email.trim().toLowerCase());
  const accountValidationMessage = accountEmailValid ? "" : "Enter the email for your managed account.";
  const canSaveAccount = accountEmailValid;
  const legalAccepted = legalAcceptanceIsCurrent(instanceState);
  const canFinish = canSaveSecurity && canSaveService && canSaveAccount && canSaveSelfHostedSetup && selfHostedBackendReady && legalAccepted;
  const profileDescription = preferences.soulProfile.selfDescription;
  const profileDescriptionWordCount = countDescriptionWords(profileDescription);
  const profileDescriptionEnough = isProfileDescriptionEnough(profileDescription);
  const soulDefaults = summarizeSoulDefaults(preferences);
  const setupAiToolAvailable = instanceState.setupAiSettingsToolAvailable;
  const connectorConnectedByProvider: Record<ConnectorSetupScreen, boolean> = {
    whatsapp: whatsappConnected,
    instagram: instagramConnected,
    imessage: imessageConnected,
    telegram: telegramConnected,
  };
  const anyConnectorConnected = whatsappConnected || instagramConnected || imessageConnected || telegramConnected;
  const requestedConnectorConnected = requestedConnector ? connectorConnectedByProvider[requestedConnector] : false;
  const connectInitialScreen = requestedConnector || (preferences.instagramEnabled ? "options" : "whatsapp");
  const connectReady = requestedConnector ? requestedConnectorConnected : anyConnectorConnected;
  const showRomanticSetup =
    preferences.productUse !== "business" &&
    (preferences.soulProfile.useCase === "personal" ||
      preferences.soulProfile.useCase === "mixed" ||
      preferences.soulProfile.romanticPreference.trim().length > 0 ||
      preferences.soulProfile.romanticInterests.trim().length > 0);
  const visibleSoulReviewFields = soulReviewFields.filter(({ key }) => preferences.soulProfile[key].trim().length > 0);

  useEffect(() => {
    if (!isWelcomeStage && !isLegalStage) {
      stageTitleRef.current?.focus();
    }
  }, [isLegalStage, isWelcomeStage, stage]);

  const updateSoulField = (field: SoulFieldKey, value: string) => {
    setPreferences((current) => ({
      ...current,
      soulProfile: {
        ...current.soulProfile,
        [field]: value,
      },
    }));
  };

  const addProfileStarter = (text: string) => {
    setPreferences((current) => {
      const currentDescription = current.soulProfile.selfDescription.trim();
      const nextDescription = currentDescription
        ? `${currentDescription}${currentDescription.endsWith(".") ? "" : "."} ${text}`
        : text;
      return {
        ...current,
        soulProfile: {
          ...current.soulProfile,
          selfDescription: nextDescription,
        },
      };
    });
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
        ...(field === "convexUrl" && value !== current.selfHosted.convexUrl
          ? { convexBackendProvisionedAt: null }
          : {}),
      },
    }));
  };

  const chooseProductUse = (productUse: InstanceSetupPreferences["productUse"]) => {
    setPreferences((current) => applyProductUseDefaults(productUse, current));
  };

  const renderPrivacyControl = (field: SoulFieldKey) => (
    <SearchableSelect
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
    </SearchableSelect>
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
      legalAccepted?: boolean;
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

  const setupSelfHostedBackend = async (nextPreferences: InstanceSetupPreferences) => {
    if (nextPreferences.serviceMode !== "self_hosted") {
      return nextPreferences;
    }

    const result = await runAction(
      "setup:onboarding:convex-backend",
      async () => {
        const response = await fetch("/api/setup/convex/deploy", {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({ preferences: nextPreferences }),
        });

        const body = await readConvexDeployResponse(response);
        if (!response.ok || !body.preferences) {
          throw new Error(body.error || `Backend setup failed (${response.status})`);
        }

        setPreferences(body.preferences);
        setInstanceState((current) => ({
          ...current,
          preferences: body.preferences || current.preferences,
        }));
        return body.preferences;
      },
      {
        pendingLabel: "Verifying backend...",
        successMessage: "Backend ready.",
      },
    );
    return result.value || null;
  };

  const saveServiceAndContinue = async () => {
    if (preferences.serviceMode === "self_hosted") {
      const result = await saveInstanceSetup(
        "setup:onboarding:preferences",
        {
          preferences,
          account,
        },
        {
          successMessage: "Self-hosted setup selected.",
        },
      );
      if (!result.value?.state) {
        return;
      }
      setPreferences(result.value.state.preferences);
      setStage("backend");
      return;
    }

    const result = await saveInstanceSetup(
      "setup:onboarding:preferences",
      {
        preferences,
        account,
      },
      {
        successMessage: "Account setup saved.",
      },
    );
    if (!result.value?.state) {
      return;
    }
    const body = result.value;
    const nextPreferences = body.state?.preferences || preferences;
    if (nextPreferences.serviceMode === "hosted") {
      setStage("account");
      return;
    }
    setStage("security");
  };

  const savePurposeAndContinue = async () => {
    const result = await saveInstanceSetup(
      "setup:onboarding:preferences",
      {
        preferences,
        account,
      },
      {
        successMessage: preferences.productUse === "business" ? "Business workspace selected." : "Personal workspace selected.",
      },
    );
    if (!result.value?.state) {
      return;
    }
    setPreferences(result.value.state.preferences);
    setStage("service");
  };

  const saveBackendAndContinue = async () => {
    const result = await saveInstanceSetup(
      "setup:onboarding:preferences",
      {
        preferences,
        account,
      },
      {
        successMessage: "Backend details saved.",
      },
    );
    if (!result.value?.state) {
      return;
    }
    setPreferences(result.value.state.preferences);
    setStage("ai");
  };

  const saveAiAndContinue = async () => {
    const result = await saveInstanceSetup(
      "setup:onboarding:preferences",
      {
        preferences,
        account,
      },
      {
        successMessage: "AI provider saved.",
      },
    );
    if (!result.value?.state) {
      return;
    }
    setPreferences(result.value.state.preferences);
    setStage("verify");
  };

  const verifySelfHostedAndContinue = async () => {
    const provisionedPreferences = await setupSelfHostedBackend(preferences);
    if (!provisionedPreferences) {
      return;
    }
    const result = await saveInstanceSetup(
      "setup:onboarding:preferences",
      {
        preferences: provisionedPreferences,
        account,
      },
      {
        successMessage: "Self-hosted setup verified.",
      },
    );
    if (!result.value?.state) {
      return;
    }
    setPreferences(result.value.state.preferences);
    setStage("security");
  };

  const finishSetup = async () => {
    const nextPreferences =
      preferences.serviceMode === "self_hosted" && !preferences.selfHosted.convexBackendProvisionedAt
        ? await setupSelfHostedBackend(preferences)
        : preferences;
    if (!nextPreferences) {
      return;
    }
    await saveInstanceSetup(
      "setup:onboarding:finish",
      {
        ...(envManagedPin || pin.trim().length === 0 ? {} : { pin: pin.trim() }),
        preferences: nextPreferences,
        account,
        setupCompleted: true,
        issueSession: !envManagedPin,
      },
      {
        successMessage: "Setup complete.",
        redirectOnSuccess: true,
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

  const exitVoiceSetup = () => {
    if (shouldExitAfterVoiceSave) {
      router.push(safeVoiceReturnTo);
      return;
    }
    setStage("prepare");
  };

  const exitConnectorSetup = () => {
    if (shouldExitAfterConnectorConnect) {
      router.push(safeConnectorReturnTo);
      return;
    }
    setStage("finish");
  };

  const continueFromConnections = () => {
    exitConnectorSetup();
  };

  const skipInstagramAndContinue = async () => {
    const result = await saveInstanceSetup(
      "setup:onboarding:preferences",
      {
        preferences: {
          ...preferences,
          instagramEnabled: false,
        },
        account,
      },
      {
        successMessage: "Instagram skipped for now.",
      },
    );
    if (!result.value?.state) {
      return;
    }
    setPreferences(result.value.state.preferences);
    setStage("finish");
  };

  useEffect(() => {
    if (
      stage !== "connect" ||
      !requestedConnector ||
      !shouldExitAfterConnectorConnect ||
      !requestedConnectorConnected ||
      connectorAutoExitHandledRef.current
    ) {
      return;
    }

    connectorAutoExitHandledRef.current = true;
    const timer = window.setTimeout(() => {
      exitConnectorSetup();
    }, 900);

    return () => window.clearTimeout(timer);
    // exitConnectorSetup reads stable setup-entry values for this onboarding mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    requestedConnector,
    requestedConnectorConnected,
    shouldExitAfterConnectorConnect,
    stage,
  ]);

  const applyProfileLocally = () => {
    setPreferences((current) => derivePreferencesFromSoulProfile(inferSoulProfileFromDescription(current.soulProfile), current));
    setStage("defaults");
  };

  const continueWithoutProfileDefaults = () => {
    setStage("defaults");
  };

  const continueFromProfile = () => {
    if (!profileDescriptionEnough) {
      continueWithoutProfileDefaults();
      return;
    }
    if (setupAiToolAvailable) {
      void runSetupAiSettingsTool({ nextStage: "defaults" });
      return;
    }
    applyProfileLocally();
  };

  const handleLegalScroll = (event: UIEvent<HTMLDivElement>) => {
    const target = event.currentTarget;
    const atEnd = target.scrollTop + target.clientHeight >= target.scrollHeight - 8;
    if (atEnd) {
      setLegalScrolledToEnd(true);
    }
  };

  const acceptLegalPolicies = () => {
    if (!legalScrolledToEnd) {
      pushNotice("error", "Scroll to the end before choosing.");
      return;
    }
    void saveInstanceSetup(
      "setup:onboarding:legal",
      { legalAccepted: true },
      {
        successMessage: "Policies accepted.",
        nextStage: resolvePostLegalStage(),
      },
    );
  };

  const jumpToLegalEnd = () => {
    const legalScroll = legalScrollRef.current;
    if (!legalScroll) {
      setLegalScrolledToEnd(true);
      return;
    }
    legalScroll.scrollTo({ top: legalScroll.scrollHeight, behavior: "smooth" });
    setLegalScrolledToEnd(true);
  };

  return (
    <main className={["setup-onboarding-shell", isLegalStage ? "setup-onboarding-shell-legal" : ""].filter(Boolean).join(" ")}>
      <div className="setup-onboarding-noise" aria-hidden="true" />
      <section
        className={[
          "setup-onboarding-stage",
          isLegalStage ? "setup-onboarding-stage-legal" : "",
          isPreparationStage ? "setup-onboarding-stage-prepare" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <section
          className={[
            "setup-onboarding-main",
            isWelcomeStage ? "setup-onboarding-main-welcome" : "",
            isLegalStage ? "setup-onboarding-main-legal" : "",
            isPreparationStage ? "setup-onboarding-main-prepare" : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          {!isWelcomeStage && !isLegalStage && !isPreparationStage ? (
            <header className="setup-onboarding-head">
              {previousStage ? (
                <button className="setup-stage-back" type="button" onClick={() => setStage(previousStage)} aria-label="Back">
                  <svg aria-hidden="true" viewBox="0 0 20 20" focusable="false">
                    <path d="M12.7 4.3 7 10l5.7 5.7" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
                  </svg>
                </button>
              ) : null}
              <div className="setup-onboarding-brand-row">
                <BrandLogo priority />
                <div>
                  <p className="queue-meta">OdogwuHQ setup</p>
                  <span>Setup Assistant</span>
                </div>
              </div>
              <div className="setup-step-copy">
                <h1 className="setup-step-sentence" ref={stageTitleRef} tabIndex={-1}>{formatSetupStep(stage)}</h1>
                <p className="setup-step-helper">{formatSetupHelper(stage)}</p>
              </div>
            </header>
          ) : null}

          {showSetupNotices ? <ActionNotices notices={notices} onDismiss={dismissNotice} /> : null}

          {isLegalStage ? (
            <div className="setup-legal-screen">
              {legalDeclined ? (
                <div className="setup-legal-declined">
                  <p className="setup-onboarding-kicker">Setup paused</p>
                  <h1>OdogwuHQ needs these terms to continue.</h1>
                  <p>You can review them again whenever you are ready.</p>
                  <button className="btn btn-primary" type="button" onClick={() => setLegalDeclined(false)}>
                    Review again
                  </button>
                </div>
              ) : (
                <>
                  <header className="setup-legal-head">
                    <div>
                      <p className="setup-onboarding-kicker">Before you continue</p>
                      <h1>Privacy Policy and Terms</h1>
                      <p className="setup-legal-intro">
                        OdogwuHQ needs your permission to store local setup data, connect accounts you choose, and operate the automation settings you control.
                      </p>
                    </div>
                    <BrandLogo priority />
                  </header>

                  <div className="setup-legal-summary" aria-label="Policy summary">
                    <p>Connected app sessions stay tied to this desktop setup.</p>
                    <p>Profile context is optional and can be marked private.</p>
                    <p>Automation only uses the defaults and permissions you choose.</p>
                  </div>

                  <div className="setup-legal-scroll" ref={legalScrollRef} onScroll={handleLegalScroll} tabIndex={0}>
                    {renderLegalPolicy(privacyPolicy)}
                    {renderLegalPolicy(termsAndConditions)}
                    <div className="setup-legal-end-marker" aria-hidden="true">
                      End of policies
                    </div>
                  </div>

                  <footer className="setup-legal-actions">
                    <p>{legalScrolledToEnd ? "You have reached the end." : "Scroll to the end to choose."}</p>
                    <div className="wizard-actions">
                      <button className="btn btn-ghost" type="button" onClick={jumpToLegalEnd}>
                        Jump to end
                      </button>
                      <button
                        className="btn btn-ghost"
                        type="button"
                        disabled={!legalScrolledToEnd || legalRecord.pending}
                        aria-disabled={!legalScrolledToEnd || legalRecord.pending}
                        onClick={() => setLegalDeclined(true)}
                      >
                        Decline
                      </button>
                      <button
                        className="btn btn-primary"
                        type="button"
                        disabled={!legalScrolledToEnd || legalRecord.pending}
                        aria-disabled={!legalScrolledToEnd || legalRecord.pending}
                        onClick={acceptLegalPolicies}
                      >
                        {legalRecord.pending ? "Saving..." : "Accept and continue"}
                      </button>
                    </div>
                  </footer>
                </>
              )}
            </div>
          ) : null}

          {isWelcomeStage ? (
            <div className="setup-onboarding-panel setup-welcome-panel">
              <div className="setup-welcome-center">
                <p className="setup-onboarding-kicker">Welcome to</p>
                <h2>OdogwuHQ</h2>
                <p>
                  Your private desktop console for replies, follow-ups, and chat automation you control.
                </p>

                <div className="wizard-actions">
                  <button className="btn btn-primary setup-primary-action" type="button" onClick={() => setStage("purpose")}>
                    Start setup
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {stage === "purpose" ? (
            <form
              className="setup-onboarding-panel"
              onSubmit={(event: FormEvent<HTMLFormElement>) => {
                event.preventDefault();
                void savePurposeAndContinue();
              }}
            >
              <div className="setup-segmented-choice" role="radiogroup" aria-label="Workspace use">
                <label
                  className={preferences.productUse === "personal" ? "setup-segmented-option setup-segmented-option-active" : "setup-segmented-option"}
                >
                  <input
                    type="radio"
                    name="productUse"
                    value="personal"
                    checked={preferences.productUse === "personal"}
                    onChange={() => chooseProductUse("personal")}
                  />
                  <strong>Personal</strong>
                  <span>Chats, relationships, follow-ups, boundaries, and your own voice.</span>
                </label>
                <label
                  className={preferences.productUse === "business" ? "setup-segmented-option setup-segmented-option-active" : "setup-segmented-option"}
                >
                  <input
                    type="radio"
                    name="productUse"
                    value="business"
                    checked={preferences.productUse === "business"}
                    onChange={() => chooseProductUse("business")}
                  />
                  <strong>Business</strong>
                  <span>Customers, leads, brand voice, sales follow-ups, livechat, and storefront tools.</span>
                </label>
              </div>

              <div className="setup-soul-summary">
                {preferences.productUse === "business" ? (
                  <>
                    <span>Conversation-first CRM.</span>
                    <span>Brand voice controls.</span>
                    <span>Storefront + livechat path.</span>
                  </>
                ) : (
                  <>
                    <span>Personal conversation memory.</span>
                    <span>Review-first boundaries.</span>
                    <span>Warm follow-ups.</span>
                  </>
                )}
              </div>

              <div className="wizard-actions">
                <button
                  className="btn btn-primary setup-primary-action"
                  type="submit"
                  disabled={preferencesRecord.pending}
                  aria-disabled={preferencesRecord.pending}
                >
                  {preferencesRecord.pending ? "Continuing..." : "Continue"}
                </button>
              </div>
            </form>
          ) : null}

          {stage === "service" ? (
            <form
              className="setup-onboarding-panel"
              onSubmit={(event: FormEvent<HTMLFormElement>) => {
                event.preventDefault();
                void saveServiceAndContinue();
              }}
            >
              <div className="setup-segmented-choice" role="radiogroup" aria-label="Service mode">
                <label
                  className={preferences.serviceMode === "hosted" ? "setup-segmented-option setup-segmented-option-active" : "setup-segmented-option"}
                >
                  <input
                    type="radio"
                    name="serviceMode"
                    value="hosted"
                    checked={preferences.serviceMode === "hosted"}
                    onChange={() =>
                      setPreferences((current) => ({
                        ...current,
                        serviceMode: "hosted",
                      }))
                    }
                  />
                  <strong>Managed</strong>
                  <span>Trial, billing, and sync are handled for you.</span>
                </label>
                <label
                  className={
                    preferences.serviceMode === "self_hosted" ? "setup-segmented-option setup-segmented-option-active" : "setup-segmented-option"
                  }
                >
                  <input
                    type="radio"
                    name="serviceMode"
                    value="self_hosted"
                    checked={preferences.serviceMode === "self_hosted"}
                    onChange={() =>
                      setPreferences((current) => ({
                        ...current,
                        serviceMode: "self_hosted",
                      }))
                    }
                  />
                  <strong>Self-hosted</strong>
                  <span>Use your own deployment and AI provider.</span>
                </label>
              </div>

              <div className="wizard-actions">
                <button
                  className="btn btn-primary setup-primary-action"
                  type="submit"
                  disabled={!canSaveService || preferencesRecord.pending || convexBackendRecord.pending}
                  aria-disabled={!canSaveService || preferencesRecord.pending || convexBackendRecord.pending}
                >
                  {preferencesRecord.pending ? "Continuing..." : "Continue"}
                </button>
              </div>
            </form>
          ) : null}

          {stage === "backend" ? (
            <form
              className="setup-onboarding-panel"
              onSubmit={(event: FormEvent<HTMLFormElement>) => {
                event.preventDefault();
                if (canSaveBackend) {
                  void saveBackendAndContinue();
                }
              }}
            >
              <div className="setup-form-grid setup-native-group">
                <label className="setup-input-group setup-soul-wide">
                  <span className="queue-meta">Backend URL</span>
                  <input
                    type="url"
                    value={preferences.selfHosted.convexUrl}
                    placeholder="https://your-deployment.convex.cloud"
                    onChange={(event) => updateSelfHostedConfig("convexUrl", event.target.value)}
                  />
                </label>
                <label className="setup-input-group">
                  <span className="queue-meta">Deploy key</span>
                  <input
                    type="password"
                    value={preferences.selfHosted.convexDeployKey}
                    placeholder="Used once, then cleared"
                    onChange={(event) => updateSelfHostedConfig("convexDeployKey", event.target.value)}
                    autoComplete="off"
                  />
                </label>
                <label className="setup-input-group">
                  <span className="queue-meta">App URL</span>
                  <input
                    type="url"
                    value={preferences.selfHosted.appBaseUrl}
                    placeholder="https://your-domain.example"
                    onChange={(event) => updateSelfHostedConfig("appBaseUrl", event.target.value)}
                  />
                </label>
              </div>

              {backendSetupValidationMessage ? <p className="instance-lock-error">{backendSetupValidationMessage}</p> : null}

              <div className="wizard-actions">
                <button
                  className="btn btn-primary setup-primary-action"
                  type="submit"
                  disabled={!canSaveBackend || preferencesRecord.pending}
                  aria-disabled={!canSaveBackend || preferencesRecord.pending}
                >
                  {preferencesRecord.pending ? "Continuing..." : "Continue"}
                </button>
              </div>
            </form>
          ) : null}

          {stage === "ai" ? (
            <form
              className="setup-onboarding-panel"
              onSubmit={(event: FormEvent<HTMLFormElement>) => {
                event.preventDefault();
                if (canSaveAi) {
                  void saveAiAndContinue();
                }
              }}
            >
              <div className="setup-form-grid setup-native-group">
                <label className="setup-input-group setup-soul-wide">
                  <span className="queue-meta">Provider URL</span>
                  <input
                    type="url"
                    value={preferences.selfHosted.aiBaseUrl}
                    placeholder="https://api.openai.com/v1 or your provider endpoint"
                    onChange={(event) => updateSelfHostedConfig("aiBaseUrl", event.target.value)}
                  />
                </label>
                <label className="setup-input-group">
                  <span className="queue-meta">Model</span>
                  <input
                    type="text"
                    value={preferences.selfHosted.aiModel}
                    placeholder="gpt-5.4, gpt-4.1, or your hosted model"
                    onChange={(event) => updateSelfHostedConfig("aiModel", event.target.value)}
                  />
                </label>
                <label className="setup-input-group">
                  <span className="queue-meta">API key</span>
                  <input
                    type="password"
                    value={preferences.selfHosted.aiApiKey}
                    placeholder="Stored locally on this machine"
                    onChange={(event) => updateSelfHostedConfig("aiApiKey", event.target.value)}
                    autoComplete="off"
                  />
                </label>
              </div>

              {aiSetupValidationMessage ? <p className="instance-lock-error">{aiSetupValidationMessage}</p> : null}

              <div className="wizard-actions">
                <button
                  className="btn btn-primary setup-primary-action"
                  type="submit"
                  disabled={!canSaveAi || preferencesRecord.pending}
                  aria-disabled={!canSaveAi || preferencesRecord.pending}
                >
                  {preferencesRecord.pending ? "Continuing..." : "Continue"}
                </button>
              </div>
            </form>
          ) : null}

          {stage === "verify" ? (
            <form
              className="setup-onboarding-panel"
              onSubmit={(event: FormEvent<HTMLFormElement>) => {
                event.preventDefault();
                if (canSaveSelfHostedSetup) {
                  void verifySelfHostedAndContinue();
                }
              }}
            >
              <div className="setup-backend-state">
                <strong>{selfHostedBackendReady ? "Backend ready" : "Backend not verified"}</strong>
                <span>
                  {convexBackendRecord.pending
                    ? convexBackendRecord.pendingLabel || "Verifying backend..."
                    : selfHostedBackendReady
                      ? "The deployment is reachable."
                      : "OdogwuHQ will check the deployment before continuing."}
                </span>
              </div>

              {selfHostedValidationMessage ? <p className="instance-lock-error">{selfHostedValidationMessage}</p> : null}

              <div className="wizard-actions">
                <button
                  className="btn btn-primary setup-primary-action"
                  type="submit"
                  disabled={!canSaveSelfHostedSetup || convexBackendRecord.pending || preferencesRecord.pending}
                  aria-disabled={!canSaveSelfHostedSetup || convexBackendRecord.pending || preferencesRecord.pending}
                >
                  {convexBackendRecord.pending ? "Verifying..." : preferencesRecord.pending ? "Continuing..." : "Verify and continue"}
                </button>
              </div>
            </form>
          ) : null}

          {stage === "account" ? (
            <form
              className="setup-onboarding-panel"
              onSubmit={(event: FormEvent<HTMLFormElement>) => {
                event.preventDefault();
                if (canSaveAccount) {
                  void saveInstanceSetup(
                    "setup:onboarding:account",
                    {
                      account,
                    },
                    {
                      successMessage: "Account email saved.",
                      nextStage: "security",
                    },
                  );
                }
              }}
            >
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

              <div className="setup-soul-summary">
                {preferences.productUse === "business" ? (
                  <>
                    <span>Business trial.</span>
                    <span>Higher plans unlock storefront, livechat, and sales tools.</span>
                    <span>Connected-app sessions remain local.</span>
                  </>
                ) : (
                  <>
                    <span>7 day trial.</span>
                    <span>₦5,000/month.</span>
                    <span>Connected-app sessions remain local.</span>
                  </>
                )}
              </div>

              {accountValidationMessage ? <p className="instance-lock-error">{accountValidationMessage}</p> : null}

              <div className="wizard-actions">
                <button
                  className="btn btn-primary setup-primary-action"
                  type="submit"
                  disabled={!canSaveAccount || accountRecord.pending}
                  aria-disabled={!canSaveAccount || accountRecord.pending}
                >
                  {accountRecord.pending ? "Continuing..." : "Continue"}
                </button>
              </div>
            </form>
          ) : null}

          {stage === "security" ? (
            <form
              className="setup-onboarding-panel"
              onSubmit={(event: FormEvent<HTMLFormElement>) => {
                event.preventDefault();
                if (canSaveSecurity) {
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
                }
              }}
            >
              <p className="queue-meta">{pinRequiredCopy}</p>

              <div className="setup-form-grid">
                <label className="setup-input-group">
                  <span className="queue-meta">App PIN</span>
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
                  className="btn btn-primary setup-primary-action"
                  type="submit"
                  disabled={!canSaveSecurity || securityRecord.pending}
                  aria-disabled={!canSaveSecurity || securityRecord.pending}
                >
                  {securityRecord.pending ? "Continuing..." : "Continue"}
                </button>
              </div>
            </form>
          ) : null}

          {stage === "profile" ? (
            <form
              className="setup-onboarding-panel"
              onSubmit={(event: FormEvent<HTMLFormElement>) => {
                event.preventDefault();
                continueFromProfile();
              }}
            >
              <div className="setup-soul-panel">
                <div className="setup-soul-head">
                  <div>
                    <p className="queue-title">
                      {preferences.productUse === "business"
                        ? "Describe the business, brand voice, customers, offer, boundaries, and how OdogwuHQ should help sell through conversations."
                        : "Describe yourself, your voice, your boundaries, and how this app should act for you."}
                    </p>
                  </div>
                </div>

                <label className="setup-input-group setup-soul-wide">
                  <span className="queue-meta">Profile description</span>
                  <textarea
                    value={profileDescription}
                    rows={8}
                    placeholder={
                      preferences.productUse === "business"
                        ? "Example: We sell skincare products in Lagos. Reply warmly and clearly, ask useful buying questions, never invent prices or stock, collect delivery details only after approval, and follow up with leads who asked for payment info."
                        : "Example: I run a busy business, reply warmly but directly, use light Nigerian English and occasional pidgin, avoid sensitive family topics, slow down at night, and keep anything romantic private unless I mention it."
                    }
                    onChange={(event) => updateSoulField("selfDescription", event.target.value)}
                  />
                </label>
                <div className="setup-chip-row" aria-label="Profile starters">
                  {(preferences.productUse === "business" ? businessProfileStarterChips : profileStarterChips).map((chip) => (
                    <button className="setup-chip" key={chip.label} type="button" onClick={() => addProfileStarter(chip.text)}>
                      {chip.label}
                    </button>
                  ))}
                </div>
                <p className={profileDescriptionEnough ? "queue-meta" : "instance-lock-error"}>
                  {profileDescriptionEnough
                    ? "Enough context to personalize the starting settings."
                    : `Optional. Add more if you want OdogwuHQ to personalize the starting settings. ${profileDescriptionWordCount}/30 words.`}
                </p>

                <details className="setup-advanced">
                  <summary>Advanced profile fields</summary>
                  <div className="setup-soul-grid">
                  <label className="setup-input-group">
                    <span className="setup-field-head">
                      <span className="queue-meta">Use case</span>
                      {renderPrivacyControl("useCase")}
                    </span>
                    <SearchableSelect
                      value={preferences.soulProfile.useCase}
                      onChange={(event) => updateSoulField("useCase", event.target.value)}
                    >
                      {soulUseCaseOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </SearchableSelect>
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
                        <SearchableSelect
                          value={preferences.soulProfile.romanticPreference}
                          onChange={(event) => updateSoulField("romanticPreference", event.target.value)}
                        >
                          {romanticPreferenceOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </SearchableSelect>
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
                  className="btn btn-primary setup-primary-action"
                  type="submit"
                  disabled={setupAiRecord.pending}
                  aria-disabled={setupAiRecord.pending}
                >
                  {setupAiRecord.pending ? "Personalizing..." : profileDescriptionEnough && setupAiToolAvailable ? "Personalize settings" : "Continue"}
                </button>
                <button className="btn btn-ghost setup-secondary-action" type="button" onClick={continueWithoutProfileDefaults}>
                  Use defaults for now
                </button>
              </div>
            </form>
          ) : null}

          {stage === "defaults" ? (
            <form
              className="setup-onboarding-panel"
              onSubmit={(event: FormEvent<HTMLFormElement>) => {
                event.preventDefault();
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
            >
                <div className="setup-choice-group">
                  <p className="queue-title">{preferences.productUse === "business" ? "Customer reply behavior" : "Send behavior"}</p>
                  <div className="setup-choice-grid setup-choice-grid-two" role="radiogroup" aria-label="Send behavior">
                    {(["review_first", "autopilot"] as const).map((value) => (
                      <label
                        key={value}
                        className={`setup-choice-card ${preferences.autonomyMode === value ? "setup-choice-card-active" : ""}`}
                      >
                        <input
                          type="radio"
                          name="autonomyMode"
                          value={value}
                          checked={preferences.autonomyMode === value}
                          onChange={() => setPreferences((current) => ({ ...current, autonomyMode: value }))}
                        />
                        <strong>{value === "review_first" ? "Review first" : "Send automatically"}</strong>
                        <span>{resolveAutonomyPreview(value)}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="setup-choice-group">
                  <p className="queue-title">{preferences.productUse === "business" ? "Customer reply pace" : "Reply pace"}</p>
                  <div className="setup-choice-grid" role="radiogroup" aria-label="Reply pace">
                    {(["measured", "deliberate", "unhurried"] as const).map((value) => (
                      <label
                        key={value}
                        className={`setup-choice-card ${preferences.replyPace === value ? "setup-choice-card-active" : ""}`}
                      >
                        <input
                          type="radio"
                          name="replyPace"
                          value={value}
                          checked={preferences.replyPace === value}
                          onChange={() => setPreferences((current) => ({ ...current, replyPace: value }))}
                        />
                        <strong>{value === "measured" ? "Measured" : value === "deliberate" ? "Deliberate" : "Unhurried"}</strong>
                        <span>{resolveReplyPacePreview(value)}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="setup-choice-group">
                  <p className="queue-title">{preferences.productUse === "business" ? "Brand voice match" : "Reply style"}</p>
                  <div className="setup-choice-grid" role="radiogroup" aria-label="Reply style">
                    {(["light", "balanced", "close"] as const).map((value) => (
                      <label
                        key={value}
                        className={`setup-choice-card ${preferences.mimicryPreset === value ? "setup-choice-card-active" : ""}`}
                      >
                        <input
                          type="radio"
                          name="mimicryPreset"
                          value={value}
                          checked={preferences.mimicryPreset === value}
                          onChange={() => setPreferences((current) => ({ ...current, mimicryPreset: value }))}
                        />
                        <strong>{value === "light" ? "Light" : value === "balanced" ? "Balanced" : "Close"}</strong>
                        <span>{resolveMimicryPreview(value)}</span>
                      </label>
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
                      <span>{preferences.productUse === "business" ? "Show reusable media and campaign assets." : "Show meme creation and review."}</span>
                    </span>
                  </label>
                </div>

                <label className="setup-toggle-card">
                  <input
                    type="checkbox"
                    checked={preferences.instagramEnabled}
                    onChange={(event) => setPreferences((current) => ({ ...current, instagramEnabled: event.target.checked }))}
                  />
                  <span>
                    <strong>Enable Instagram</strong>
                    <span>Show Instagram sign-in during account connection.</span>
                  </span>
                </label>

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
                      <SearchableSelect
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
                      </SearchableSelect>
                    </label>
                    <label className="setup-input-group">
                      <span className="queue-meta">Quiet hours end</span>
                      <SearchableSelect
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
                      </SearchableSelect>
                    </label>
                  </div>
                ) : null}
              <div className="wizard-actions">
                <button
                  className="btn btn-primary setup-primary-action"
                  type="submit"
                  disabled={preferencesRecord.pending}
                  aria-disabled={preferencesRecord.pending}
                >
                  {preferencesRecord.pending ? "Continuing..." : "Continue"}
                </button>
              </div>
            </form>
          ) : null}

          {stage === "connect" ? (
            <div className="setup-onboarding-panel">
              <SetupWizard
                realtimeEnabled={realtimeEnabled}
                embedded
                initialScreen={connectInitialScreen}
                showNotices={false}
                onWhatsAppConnectedChange={setWhatsappConnected}
                onInstagramConnectedChange={setInstagramConnected}
                onIMessageConnectedChange={setIMessageConnected}
                onTelegramConnectedChange={setTelegramConnected}
              />
              <div className="wizard-actions">
                {connectReady ? (
                  <button className="btn btn-primary setup-primary-action" type="button" onClick={continueFromConnections}>
                    {shouldExitAfterConnectorConnect ? "Done" : "Continue"}
                  </button>
                ) : null}
                {!shouldExitAfterConnectorConnect && preferences.instagramEnabled && anyConnectorConnected && !instagramConnected ? (
                  <button
                    className="btn btn-ghost setup-secondary-action"
                    type="button"
                    disabled={preferencesRecord.pending}
                    aria-disabled={preferencesRecord.pending}
                    onClick={() => void skipInstagramAndContinue()}
                  >
                    {preferencesRecord.pending ? "Saving..." : "Skip Instagram for now"}
                  </button>
                ) : null}
                {shouldExitAfterConnectorConnect ? (
                  <button className="btn btn-ghost setup-secondary-action" type="button" onClick={() => router.push(safeConnectorReturnTo)}>
                    Back to {requestedConnector ? connectorSetupLabel(requestedConnector) : "settings"}
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}

          {stage === "finish" ? (
            <div className="setup-onboarding-panel">
              <div className="setup-finish-hero">
                <p className="setup-finish-status">Ready</p>
                <p>
                  OdogwuHQ will open with {preferences.autonomyMode === "autopilot" ? "automatic sending" : "review first"}, a{" "}
                  {formatReplyPaceLabel(preferences.replyPace).toLowerCase()} reply pace, and{" "}
                  {formatReplyStyleLabel(preferences.mimicryPreset).toLowerCase()} reply style.
                </p>
              </div>

              <div className="setup-finish-list" aria-label="Setup summary">
                <div>
                  <span>Workspace</span>
                  <strong>{preferences.productUse === "business" ? "Business" : "Personal"}</strong>
                </div>
                <div>
                  <span>Account</span>
                  <strong>{preferences.serviceMode === "hosted" ? account.email || "Managed" : "Self-hosted"}</strong>
                </div>
                <div>
                  <span>Connection</span>
                  <strong>{preferences.serviceMode === "self_hosted" ? (selfHostedBackendReady ? "Backend ready" : "Backend needs verification") : "Managed service"}</strong>
                </div>
                <div>
                  <span>Tools</span>
                  <strong>
                    {[
                      preferences.memesEnabled ? "Meme tools on" : "Meme tools off",
                      preferences.instagramEnabled ? "Instagram on" : "Instagram off",
                    ].join(" / ")}
                  </strong>
                </div>
                <div>
                  <span>Quiet hours</span>
                  <strong>
                    {preferences.quietHoursEnabled
                      ? `${String(preferences.quietHoursStartHour).padStart(2, "0")}:00 to ${String(preferences.quietHoursEndHour).padStart(2, "0")}:00`
                      : "Off"}
                  </strong>
                </div>
              </div>

              <details className="setup-review-panel setup-review-details">
                <summary>
                  <span>Profile context</span>
                  <strong>{visibleSoulReviewFields.length > 0 ? `${visibleSoulReviewFields.length} fields` : "Using defaults"}</strong>
                </summary>
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
                <button className="btn btn-ghost setup-edit-inline" type="button" onClick={() => setStage("profile")}>
                  Edit profile
                </button>
              </details>

              {!canFinish ? (
                <p className="instance-lock-error">
                  {pinValidationMessage ||
                    selfHostedValidationMessage ||
                    accountValidationMessage ||
                    backendValidationMessage ||
                    (!legalAccepted ? "Accept the Privacy Policy and Terms before opening the dashboard." : "Complete setup before opening the dashboard.")}
                </p>
              ) : null}

              <div className="wizard-actions">
                <button
                  className="btn btn-primary setup-primary-action"
                  type="button"
                  disabled={!canFinish || finishRecord.pending || convexBackendRecord.pending}
                  aria-disabled={!canFinish || finishRecord.pending || convexBackendRecord.pending}
                  onClick={() => {
                    if (instanceState.setupCompleted) {
                      void finishSetup();
                      return;
                    }
                    setStage("voice");
                  }}
                >
                  {finishRecord.pending || convexBackendRecord.pending ? "Finishing..." : instanceState.setupCompleted ? "Open dashboard" : "Continue"}
                </button>
              </div>
            </div>
          ) : null}

          {stage === "voice" ? (
            <div className="setup-onboarding-panel setup-voice-step">
              <VoiceSetupPanel
                surface="plain"
                showNotices={false}
                showToolControls={false}
                showAdvancedControls={false}
                initialState={voiceOnboardingState}
                onStateChange={setVoiceOnboardingState}
              />
              <div className="wizard-actions">
                <button className="btn btn-ghost setup-secondary-action" type="button" onClick={exitVoiceSetup}>
                  {shouldExitAfterVoiceSave ? "Back to Settings" : "Skip for now"}
                </button>
                <button className="btn btn-primary setup-primary-action" type="button" onClick={exitVoiceSetup}>
                  {shouldExitAfterVoiceSave
                    ? "Done"
                    : voiceOnboardingState?.hasSample || voiceOnboardingState?.hasPendingSample
                      ? "Continue"
                      : "Continue without voice"}
                </button>
              </div>
            </div>
          ) : null}

          {stage === "prepare" ? (
            <SetupPreparationProgress
              variant="full"
              startOnMount
              onDoLater={finishSetup}
              onMinimize={finishSetup}
              onDone={finishSetup}
            />
          ) : null}
        </section>
      </section>
    </main>
  );
}
