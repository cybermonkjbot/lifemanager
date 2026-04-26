import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  DEFAULT_INSTANCE_SETUP_PREFERENCES,
  type InstancePinSource,
  type InstanceSetupPreferences,
  type InstanceSetupState,
  type InstanceSoulPrivacy,
  type InstanceSoulPrivacyLevel,
  type InstanceSoulProfile,
} from "./instance-setup-types";

const INSTANCE_CONFIG_PATH = join(process.cwd(), ".slm", "instance-config.json");
const SOUL_PROFILE_PATH = join(process.cwd(), ".slm", "soul.md");

type LocalPinRecord = {
  salt: string;
  hash: string;
  cookieSecret: string;
  createdAt: number;
  updatedAt: number;
};

export type LocalInstanceConfig = {
  version: 1;
  setupCompleted: boolean;
  createdAt: number;
  updatedAt: number;
  pin: LocalPinRecord | null;
  preferences: InstanceSetupPreferences;
  setupAiSettingsToolConsumedAt?: number | null;
};

function clampHour(value: number | undefined, fallback: number) {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  const normalized = Math.round(value as number);
  return ((normalized % 24) + 24) % 24;
}

function normalizeBoolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeStringUnion<T extends string>(value: unknown, allowed: readonly T[], fallback: T) {
  return typeof value === "string" && allowed.includes(value as T) ? (value as T) : fallback;
}

function normalizeSoulText(value: unknown, maxChars = 1200) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, maxChars) : "";
}

function normalizeSoulPrivacyLevel(value: unknown, fallback: InstanceSoulPrivacyLevel): InstanceSoulPrivacyLevel {
  return value === "setup_only" || value === "ai_usable" || value === "never_mention" ? value : fallback;
}

export function sanitizeInstanceSoulProfile(value: Partial<InstanceSoulProfile> | null | undefined): InstanceSoulProfile {
  return {
    useCase: normalizeSoulText(value?.useCase, 80),
    genderIdentity: normalizeSoulText(value?.genderIdentity, 120),
    pronouns: normalizeSoulText(value?.pronouns, 80),
    romanticPreference: normalizeSoulText(value?.romanticPreference, 160),
    relationshipStatus: normalizeSoulText(value?.relationshipStatus, 180),
    romanticInterests: normalizeSoulText(value?.romanticInterests, 1800),
    cultureLocation: normalizeSoulText(value?.cultureLocation, 800),
    selfDescription: normalizeSoulText(value?.selfDescription, 1800),
    values: normalizeSoulText(value?.values),
    communicationStyle: normalizeSoulText(value?.communicationStyle),
    boundaries: normalizeSoulText(value?.boundaries),
    relationships: normalizeSoulText(value?.relationships),
    goals: normalizeSoulText(value?.goals),
    dailyRhythm: normalizeSoulText(value?.dailyRhythm),
  };
}

export function sanitizeInstanceSoulPrivacy(value: Partial<InstanceSoulPrivacy> | null | undefined): InstanceSoulPrivacy {
  const defaults = DEFAULT_INSTANCE_SETUP_PREFERENCES.soulPrivacy;
  return {
    useCase: normalizeSoulPrivacyLevel(value?.useCase, defaults.useCase),
    genderIdentity: normalizeSoulPrivacyLevel(value?.genderIdentity, defaults.genderIdentity),
    pronouns: normalizeSoulPrivacyLevel(value?.pronouns, defaults.pronouns),
    romanticPreference: normalizeSoulPrivacyLevel(value?.romanticPreference, defaults.romanticPreference),
    relationshipStatus: normalizeSoulPrivacyLevel(value?.relationshipStatus, defaults.relationshipStatus),
    romanticInterests: normalizeSoulPrivacyLevel(value?.romanticInterests, defaults.romanticInterests),
    cultureLocation: normalizeSoulPrivacyLevel(value?.cultureLocation, defaults.cultureLocation),
    selfDescription: normalizeSoulPrivacyLevel(value?.selfDescription, defaults.selfDescription),
    values: normalizeSoulPrivacyLevel(value?.values, defaults.values),
    communicationStyle: normalizeSoulPrivacyLevel(value?.communicationStyle, defaults.communicationStyle),
    boundaries: normalizeSoulPrivacyLevel(value?.boundaries, defaults.boundaries),
    relationships: normalizeSoulPrivacyLevel(value?.relationships, defaults.relationships),
    goals: normalizeSoulPrivacyLevel(value?.goals, defaults.goals),
    dailyRhythm: normalizeSoulPrivacyLevel(value?.dailyRhythm, defaults.dailyRhythm),
  };
}

export function sanitizeInstanceSetupPreferences(
  value: Partial<InstanceSetupPreferences> | null | undefined,
): InstanceSetupPreferences {
  return {
    autonomyMode: normalizeStringUnion(value?.autonomyMode, ["review_first", "autopilot"], DEFAULT_INSTANCE_SETUP_PREFERENCES.autonomyMode),
    replyPace: normalizeStringUnion(value?.replyPace, ["measured", "deliberate", "unhurried"], DEFAULT_INSTANCE_SETUP_PREFERENCES.replyPace),
    mimicryPreset: normalizeStringUnion(value?.mimicryPreset, ["light", "balanced", "close"], DEFAULT_INSTANCE_SETUP_PREFERENCES.mimicryPreset),
    memesEnabled: normalizeBoolean(value?.memesEnabled, DEFAULT_INSTANCE_SETUP_PREFERENCES.memesEnabled),
    quietHoursEnabled: normalizeBoolean(value?.quietHoursEnabled, DEFAULT_INSTANCE_SETUP_PREFERENCES.quietHoursEnabled),
    quietHoursStartHour: clampHour(value?.quietHoursStartHour, DEFAULT_INSTANCE_SETUP_PREFERENCES.quietHoursStartHour),
    quietHoursEndHour: clampHour(value?.quietHoursEndHour, DEFAULT_INSTANCE_SETUP_PREFERENCES.quietHoursEndHour),
    instagramEnabled: normalizeBoolean(value?.instagramEnabled, DEFAULT_INSTANCE_SETUP_PREFERENCES.instagramEnabled),
    soulProfile: sanitizeInstanceSoulProfile(value?.soulProfile || DEFAULT_INSTANCE_SETUP_PREFERENCES.soulProfile),
    soulPrivacy: sanitizeInstanceSoulPrivacy(value?.soulPrivacy || DEFAULT_INSTANCE_SETUP_PREFERENCES.soulPrivacy),
  };
}

export async function readLocalInstanceConfig(): Promise<LocalInstanceConfig | null> {
  try {
    const raw = await readFile(INSTANCE_CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<LocalInstanceConfig>;
    const createdAt = Number(parsed.createdAt);
    const updatedAt = Number(parsed.updatedAt);
    const setupAiSettingsToolConsumedAt = Number(parsed.setupAiSettingsToolConsumedAt);

    return {
      version: 1,
      setupCompleted: parsed.setupCompleted === true,
      createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
      updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now(),
      pin:
        parsed.pin &&
        typeof parsed.pin.salt === "string" &&
        typeof parsed.pin.hash === "string" &&
        typeof parsed.pin.cookieSecret === "string"
          ? {
              salt: parsed.pin.salt,
              hash: parsed.pin.hash,
              cookieSecret: parsed.pin.cookieSecret,
              createdAt: Number.isFinite(Number(parsed.pin.createdAt)) ? Number(parsed.pin.createdAt) : Date.now(),
              updatedAt: Number.isFinite(Number(parsed.pin.updatedAt)) ? Number(parsed.pin.updatedAt) : Date.now(),
            }
          : null,
      preferences: sanitizeInstanceSetupPreferences(parsed.preferences),
      setupAiSettingsToolConsumedAt: Number.isFinite(setupAiSettingsToolConsumedAt) ? setupAiSettingsToolConsumedAt : null,
    };
  } catch {
    return null;
  }
}

export async function writeLocalInstanceConfig(config: LocalInstanceConfig) {
  await mkdir(dirname(INSTANCE_CONFIG_PATH), { recursive: true });
  await writeFile(INSTANCE_CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

export function hasInstanceSoulProfileContent(profile: InstanceSoulProfile) {
  return Object.values(profile).some((value) => value.trim().length > 0);
}

export function buildSoulMarkdown(
  profile: InstanceSoulProfile,
  privacy: InstanceSoulPrivacy = DEFAULT_INSTANCE_SETUP_PREFERENCES.soulPrivacy,
) {
  const rows: Array<[string, string]> = [
    ["Use case", profile.useCase],
    ["Gender identity", profile.genderIdentity],
    ["Pronouns", profile.pronouns],
    ["Romantic preference", profile.romanticPreference],
    ["Relationship status", profile.relationshipStatus],
    ["Romantic interests", profile.romanticInterests],
    ["Culture and location", profile.cultureLocation],
    ["Who I am", profile.selfDescription],
    ["Values", profile.values],
    ["How I communicate", profile.communicationStyle],
    ["Boundaries", profile.boundaries],
    ["My people", profile.relationships],
    ["Goals", profile.goals],
    ["Rhythm", profile.dailyRhythm],
  ];

  const body = rows
    .filter(([, value]) => value.trim().length > 0)
    .map(([label, value]) => `## ${label}\n${value.trim()}`)
    .join("\n\n");

  const privacyBody = Object.entries(privacy)
    .map(([key, value]) => `- ${key}: ${value}`)
    .join("\n");

  return `# Soul\n\n${body || "No soul profile has been written yet."}\n\n## Privacy choices\n${privacyBody}\n`;
}

export async function writeLocalSoulMarkdown(
  profile: InstanceSoulProfile,
  privacy: InstanceSoulPrivacy = DEFAULT_INSTANCE_SETUP_PREFERENCES.soulPrivacy,
) {
  if (!hasInstanceSoulProfileContent(profile)) {
    return false;
  }
  await mkdir(dirname(SOUL_PROFILE_PATH), { recursive: true });
  await writeFile(SOUL_PROFILE_PATH, buildSoulMarkdown(profile, privacy), "utf8");
  return true;
}

function normalizePin(value: string | undefined | null) {
  return (value || "").trim();
}

function hashPin(pin: string, salt: string) {
  return scryptSync(pin, salt, 64).toString("hex");
}

export function createLocalPinRecord(pin: string, previousSecret?: string, now = Date.now()): LocalPinRecord {
  const normalizedPin = normalizePin(pin);
  const salt = randomBytes(16).toString("hex");
  return {
    salt,
    hash: hashPin(normalizedPin, salt),
    cookieSecret: previousSecret || randomBytes(32).toString("hex"),
    createdAt: now,
    updatedAt: now,
  };
}

export function verifyLocalPin(pin: string, record: Pick<LocalPinRecord, "salt" | "hash"> | null | undefined) {
  if (!record) {
    return false;
  }

  try {
    const expected = Buffer.from(record.hash, "hex");
    const actual = Buffer.from(hashPin(normalizePin(pin), record.salt), "hex");
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function resolveEnvPinSource(): InstancePinSource {
  return normalizePin(process.env.SLM_INSTANCE_PIN) ? "env" : "none";
}

export async function resolveInstanceSetupState(): Promise<InstanceSetupState> {
  const config = await readLocalInstanceConfig();
  const envPinSource = resolveEnvPinSource();
  const pinSource: InstancePinSource = envPinSource === "env" ? "env" : config?.pin ? "file" : "none";
  const setupCompleted = config?.setupCompleted === true;
  const setupAiSettingsToolConsumedAt = config?.setupAiSettingsToolConsumedAt ?? null;

  return {
    setupCompleted,
    pinEnabled: pinSource !== "none",
    pinSource,
    preferences: config?.preferences || DEFAULT_INSTANCE_SETUP_PREFERENCES,
    setupAiSettingsToolAvailable: !setupCompleted && !setupAiSettingsToolConsumedAt,
    setupAiSettingsToolConsumedAt,
    updatedAt: config?.updatedAt ?? null,
  };
}
