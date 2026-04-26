export type InstancePinSource = "none" | "file" | "env";
export type InstanceAutonomyMode = "review_first" | "autopilot";
export type InstanceReplyPacePreset = "measured" | "deliberate" | "unhurried";
export type InstanceMimicryPreset = "light" | "balanced" | "close";
export type InstanceSoulPrivacyLevel = "setup_only" | "ai_usable" | "never_mention";

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
  preferences: InstanceSetupPreferences;
  setupAiSettingsToolAvailable: boolean;
  setupAiSettingsToolConsumedAt: number | null;
  updatedAt: number | null;
};

export const DEFAULT_INSTANCE_SETUP_PREFERENCES: InstanceSetupPreferences = {
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
