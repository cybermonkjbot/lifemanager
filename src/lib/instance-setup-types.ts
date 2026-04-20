export type InstancePinSource = "none" | "file" | "env";
export type InstanceAutonomyMode = "review_first" | "autopilot";
export type InstanceReplyPacePreset = "measured" | "deliberate" | "unhurried";
export type InstanceMimicryPreset = "light" | "balanced" | "close";

export type InstanceSetupPreferences = {
  autonomyMode: InstanceAutonomyMode;
  replyPace: InstanceReplyPacePreset;
  mimicryPreset: InstanceMimicryPreset;
  memesEnabled: boolean;
  quietHoursEnabled: boolean;
  quietHoursStartHour: number;
  quietHoursEndHour: number;
  instagramEnabled: boolean;
};

export type InstanceSetupState = {
  setupCompleted: boolean;
  pinEnabled: boolean;
  pinSource: InstancePinSource;
  preferences: InstanceSetupPreferences;
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
};
