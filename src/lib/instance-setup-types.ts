export type InstancePinSource = "none" | "file" | "env";
export type InstanceAutonomyMode = "review_first" | "autopilot";
export type InstanceReplyPacePreset = "measured" | "deliberate" | "unhurried";
export type InstanceMimicryPreset = "light" | "balanced" | "close";
export type InstanceSoulPrivacyLevel = "setup_only" | "ai_usable" | "never_mention";
export type InstanceServiceMode = "hosted" | "self_hosted";

export type InstanceLegalAcceptance = {
  accepted: boolean;
  acceptedAt: number | null;
  privacyPolicyVersion: string;
  termsVersion: string;
};

export type InstanceSelfHostedConfig = {
  convexUrl: string;
  convexDeployKey: string;
  convexBackendProvisionedAt: number | null;
  appBaseUrl: string;
  aiBaseUrl: string;
  aiApiKey: string;
  aiModel: string;
};

export type InstanceAccountProfile = {
  email: string;
  displayName: string;
  tenantId: string;
  deviceId: string;
  connectorToken: string;
  connectorTokenEncrypted: string;
  connectorTokenIv: string;
  connectorTokenTag: string;
  connectorTokenExpiresAt: number | null;
  trialStartedAt: number | null;
  trialEndsAt: number | null;
  billingStatus: "trialing" | "active" | "past_due" | "paused" | "canceled" | "self_hosted" | "unknown";
};

export type InstanceSoulProfile = {
  useCase: string;
  genderIdentity: string;
  pronouns: string;
  romanticPreference: string;
  relationshipStatus: string;
  romanticInterests: string;
  cultureLocation: string;
  selfDescription: string;
  values: string;
  communicationStyle: string;
  boundaries: string;
  relationships: string;
  goals: string;
  dailyRhythm: string;
};

export type InstanceSoulPrivacy = Record<keyof InstanceSoulProfile, InstanceSoulPrivacyLevel>;

export type InstanceSetupPreferences = {
  serviceMode: InstanceServiceMode;
  selfHosted: InstanceSelfHostedConfig;
  autonomyMode: InstanceAutonomyMode;
  replyPace: InstanceReplyPacePreset;
  mimicryPreset: InstanceMimicryPreset;
  memesEnabled: boolean;
  quietHoursEnabled: boolean;
  quietHoursStartHour: number;
  quietHoursEndHour: number;
  instagramEnabled: boolean;
  soulProfile: InstanceSoulProfile;
  soulPrivacy: InstanceSoulPrivacy;
};

export type InstanceSetupState = {
  setupCompleted: boolean;
  pinEnabled: boolean;
  pinSource: InstancePinSource;
  legalAcceptance: InstanceLegalAcceptance;
  preferences: InstanceSetupPreferences;
  account: InstanceAccountProfile;
  setupAiSettingsToolAvailable: boolean;
  setupAiSettingsToolConsumedAt: number | null;
  updatedAt: number | null;
};

export const DEFAULT_INSTANCE_LEGAL_ACCEPTANCE: InstanceLegalAcceptance = {
  accepted: false,
  acceptedAt: null,
  privacyPolicyVersion: "",
  termsVersion: "",
};

export const DEFAULT_INSTANCE_ACCOUNT_PROFILE: InstanceAccountProfile = {
  email: "",
  displayName: "",
  tenantId: "",
  deviceId: "",
  connectorToken: "",
  connectorTokenEncrypted: "",
  connectorTokenIv: "",
  connectorTokenTag: "",
  connectorTokenExpiresAt: null,
  trialStartedAt: null,
  trialEndsAt: null,
  billingStatus: "unknown",
};

export const DEFAULT_INSTANCE_SETUP_PREFERENCES: InstanceSetupPreferences = {
  serviceMode: "hosted",
  selfHosted: {
    convexUrl: "",
    convexDeployKey: "",
    convexBackendProvisionedAt: null,
    appBaseUrl: "",
    aiBaseUrl: "",
    aiApiKey: "",
    aiModel: "",
  },
  autonomyMode: "review_first",
  replyPace: "deliberate",
  mimicryPreset: "balanced",
  memesEnabled: false,
  quietHoursEnabled: true,
  quietHoursStartHour: 23,
  quietHoursEndHour: 7,
  instagramEnabled: false,
  soulProfile: {
    useCase: "",
    genderIdentity: "",
    pronouns: "",
    romanticPreference: "",
    relationshipStatus: "",
    romanticInterests: "",
    cultureLocation: "",
    selfDescription: "",
    values: "",
    communicationStyle: "",
    boundaries: "",
    relationships: "",
    goals: "",
    dailyRhythm: "",
  },
  soulPrivacy: {
    useCase: "setup_only",
    genderIdentity: "setup_only",
    pronouns: "setup_only",
    romanticPreference: "setup_only",
    relationshipStatus: "setup_only",
    romanticInterests: "setup_only",
    cultureLocation: "setup_only",
    selfDescription: "ai_usable",
    values: "ai_usable",
    communicationStyle: "ai_usable",
    boundaries: "ai_usable",
    relationships: "ai_usable",
    goals: "ai_usable",
    dailyRhythm: "setup_only",
  },
};
