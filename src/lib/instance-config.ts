import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  DEFAULT_INSTANCE_SETUP_PREFERENCES,
  type InstancePinSource,
  type InstanceSetupPreferences,
  type InstanceSetupState,
} from "./instance-setup-types";

const INSTANCE_CONFIG_PATH = join(process.cwd(), ".slm", "instance-config.json");

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
  };
}

export async function readLocalInstanceConfig(): Promise<LocalInstanceConfig | null> {
  try {
    const raw = await readFile(INSTANCE_CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<LocalInstanceConfig>;
    const createdAt = Number(parsed.createdAt);
    const updatedAt = Number(parsed.updatedAt);

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
    };
  } catch {
    return null;
  }
}

export async function writeLocalInstanceConfig(config: LocalInstanceConfig) {
  await mkdir(dirname(INSTANCE_CONFIG_PATH), { recursive: true });
  await writeFile(INSTANCE_CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, "utf8");
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

  return {
    setupCompleted: config?.setupCompleted === true,
    pinEnabled: pinSource !== "none",
    pinSource,
    preferences: config?.preferences || DEFAULT_INSTANCE_SETUP_PREFERENCES,
    updatedAt: config?.updatedAt ?? null,
  };
}
