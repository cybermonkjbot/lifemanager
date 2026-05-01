import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  DEFAULT_INSTANCE_ACCOUNT_PROFILE,
  DEFAULT_INSTANCE_LEGAL_ACCEPTANCE,
  DEFAULT_INSTANCE_SETUP_PREFERENCES,
  type InstanceAccountProfile,
  type InstanceLegalAcceptance,
  type InstancePinSource,
  type InstanceSelfHostedConfig,
  type InstanceSetupPreferences,
  type InstanceSetupState,
  type InstanceSoulPrivacy,
  type InstanceSoulPrivacyLevel,
  type InstanceSoulProfile,
} from "./instance-setup-types";
import { getRuntimeDataPath } from "./runtime/paths";

const INSTANCE_CONFIG_PATH = getRuntimeDataPath("instance-config.json");
const SOUL_PROFILE_PATH = getRuntimeDataPath("soul.md");

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
  legalAcceptance?: InstanceLegalAcceptance;
  preferences: InstanceSetupPreferences;
  account?: InstanceAccountProfile;
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

function normalizeConfigText(value: unknown, maxChars = 800) {
  return typeof value === "string" ? value.trim().slice(0, maxChars) : "";
}

function normalizeEmail(value: unknown) {
  return normalizeConfigText(value, 320).toLowerCase();
}

function sanitizeLegalAcceptance(value: Partial<InstanceLegalAcceptance> | null | undefined): InstanceLegalAcceptance {
  const acceptedAt = Number(value?.acceptedAt);
  return {
    accepted: value?.accepted === true,
    acceptedAt: Number.isFinite(acceptedAt) ? acceptedAt : null,
    privacyPolicyVersion: normalizeConfigText(value?.privacyPolicyVersion, 80),
    termsVersion: normalizeConfigText(value?.termsVersion, 80),
  };
}

function deriveLocalSecretKey(secret: string) {
  return createHash("sha256").update(`odogwu-local-secret:${secret}`).digest();
}

function encryptLocalSecret(value: string, secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveLocalSecretKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    encrypted: encrypted.toString("base64url"),
    iv: iv.toString("base64url"),
    tag: tag.toString("base64url"),
  };
}

export function decryptLocalSecret(
  encrypted: string | undefined,
  iv: string | undefined,
  tag: string | undefined,
  secret: string | undefined,
) {
  if (!encrypted || !iv || !tag || !secret) {
    return "";
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", deriveLocalSecretKey(secret), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(encrypted, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return "";
  }
}

function normalizeSoulPrivacyLevel(value: unknown, fallback: InstanceSoulPrivacyLevel): InstanceSoulPrivacyLevel {
  return value === "setup_only" || value === "ai_usable" || value === "never_mention" ? value : fallback;
}

function sanitizeSelfHostedConfig(value: Partial<InstanceSelfHostedConfig> | null | undefined): InstanceSelfHostedConfig {
  const convexBackendProvisionedAt = Number(value?.convexBackendProvisionedAt);
  return {
    convexUrl: normalizeConfigText(value?.convexUrl),
    convexDeployKey: normalizeConfigText(value?.convexDeployKey, 2000),
    convexBackendProvisionedAt:
      Number.isFinite(convexBackendProvisionedAt) && convexBackendProvisionedAt > 0
        ? convexBackendProvisionedAt
        : null,
    appBaseUrl: normalizeConfigText(value?.appBaseUrl),
    aiBaseUrl: normalizeConfigText(value?.aiBaseUrl),
    aiApiKey: normalizeConfigText(value?.aiApiKey, 2000),
    aiModel: normalizeConfigText(value?.aiModel, 200),
  };
}

export function sanitizeInstanceAccountProfile(
  value: Partial<InstanceAccountProfile> | null | undefined,
): InstanceAccountProfile {
  const billingStatus =
    value?.billingStatus === "trialing" ||
    value?.billingStatus === "active" ||
    value?.billingStatus === "past_due" ||
    value?.billingStatus === "paused" ||
    value?.billingStatus === "canceled" ||
    value?.billingStatus === "self_hosted" ||
    value?.billingStatus === "unknown"
      ? value.billingStatus
      : DEFAULT_INSTANCE_ACCOUNT_PROFILE.billingStatus;
  const trialStartedAt = Number(value?.trialStartedAt);
  const trialEndsAt = Number(value?.trialEndsAt);
  return {
    email: normalizeEmail(value?.email),
    displayName: normalizeConfigText(value?.displayName, 160),
    tenantId: normalizeConfigText(value?.tenantId, 120),
    deviceId: normalizeConfigText(value?.deviceId, 120),
    connectorToken: normalizeConfigText(value?.connectorToken, 2000),
    connectorTokenEncrypted: normalizeConfigText(value?.connectorTokenEncrypted, 4000),
    connectorTokenIv: normalizeConfigText(value?.connectorTokenIv, 400),
    connectorTokenTag: normalizeConfigText(value?.connectorTokenTag, 400),
    connectorTokenExpiresAt: Number.isFinite(Number(value?.connectorTokenExpiresAt)) ? Number(value?.connectorTokenExpiresAt) : null,
    trialStartedAt: Number.isFinite(trialStartedAt) ? trialStartedAt : null,
    trialEndsAt: Number.isFinite(trialEndsAt) ? trialEndsAt : null,
    billingStatus,
  };
}

export function redactInstanceAccountProfileForClient(account: InstanceAccountProfile): InstanceAccountProfile {
  return {
    ...account,
    connectorToken: "",
    connectorTokenEncrypted: "",
    connectorTokenIv: "",
    connectorTokenTag: "",
  };
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
    serviceMode: normalizeStringUnion(value?.serviceMode, ["hosted", "self_hosted"], DEFAULT_INSTANCE_SETUP_PREFERENCES.serviceMode),
    selfHosted: sanitizeSelfHostedConfig(value?.selfHosted || DEFAULT_INSTANCE_SETUP_PREFERENCES.selfHosted),
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
  if (process.env.SLM_DISABLE_LOCAL_INSTANCE_CONFIG === "1") {
    return null;
  }

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
      legalAcceptance: sanitizeLegalAcceptance(parsed.legalAcceptance),
      preferences: sanitizeInstanceSetupPreferences(parsed.preferences),
      account: sanitizeInstanceAccountProfile(parsed.account),
      setupAiSettingsToolConsumedAt: Number.isFinite(setupAiSettingsToolConsumedAt) ? setupAiSettingsToolConsumedAt : null,
    };
  } catch {
    return null;
  }
}

function prepareConfigForDisk(config: LocalInstanceConfig): LocalInstanceConfig {
  const account = sanitizeInstanceAccountProfile(config.account);
  const rawConnectorToken = account.connectorToken.trim();
  if (rawConnectorToken && config.pin?.cookieSecret) {
    const encrypted = encryptLocalSecret(rawConnectorToken, config.pin.cookieSecret);
    account.connectorToken = "";
    account.connectorTokenEncrypted = encrypted.encrypted;
    account.connectorTokenIv = encrypted.iv;
    account.connectorTokenTag = encrypted.tag;
  }

  return {
    ...config,
    account,
  };
}

export async function writeLocalInstanceConfig(config: LocalInstanceConfig) {
  await mkdir(dirname(INSTANCE_CONFIG_PATH), { recursive: true });
  await writeFile(INSTANCE_CONFIG_PATH, `${JSON.stringify(prepareConfigForDisk(config), null, 2)}\n`, "utf8");
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

export function createLocalPinHash(pin: string, salt: string) {
  return hashPin(pin, salt);
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
    legalAcceptance: sanitizeLegalAcceptance(config?.legalAcceptance || DEFAULT_INSTANCE_LEGAL_ACCEPTANCE),
    preferences: config?.preferences || DEFAULT_INSTANCE_SETUP_PREFERENCES,
    account: redactInstanceAccountProfileForClient(sanitizeInstanceAccountProfile(config?.account)),
    setupAiSettingsToolAvailable: !setupCompleted && !setupAiSettingsToolConsumedAt,
    setupAiSettingsToolConsumedAt,
    updatedAt: config?.updatedAt ?? null,
  };
}
