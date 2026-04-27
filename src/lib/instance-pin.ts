import { createHmac, timingSafeEqual } from "node:crypto";
import { readLocalInstanceConfig, verifyLocalPin } from "./instance-config";
import { type InstancePinSource, type InstanceSetupState } from "./instance-setup-types";
import { secureSessionCookieBase } from "./secure-cookies";

const INSTANCE_PIN_COOKIE_NAME = "slm_instance_pin";
const INSTANCE_PIN_TOKEN_VERSION = "v1";
const DEFAULT_INSTANCE_PIN_TTL_DAYS = 30;
const MIN_INSTANCE_PIN_TTL_DAYS = 1;
const MAX_INSTANCE_PIN_TTL_DAYS = 180;
const DAY_MS = 24 * 60 * 60 * 1000;

type ResolvedPinState =
  | { enabled: false; source: "none" }
  | { enabled: true; source: InstancePinSource; secret: string; pinValue?: string };

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalizePin(value: string | undefined | null) {
  return (value || "").trim();
}

function constantTimeEqual(left: string, right: string) {
  const a = Buffer.from(left.normalize("NFKC"));
  const b = Buffer.from(right.normalize("NFKC"));
  return a.length === b.length && timingSafeEqual(a, b);
}

function getInstancePinTtlDays() {
  const parsedTtl = Number(process.env.SLM_INSTANCE_PIN_TTL_DAYS || DEFAULT_INSTANCE_PIN_TTL_DAYS);
  return Number.isFinite(parsedTtl)
    ? clamp(Math.round(parsedTtl), MIN_INSTANCE_PIN_TTL_DAYS, MAX_INSTANCE_PIN_TTL_DAYS)
    : DEFAULT_INSTANCE_PIN_TTL_DAYS;
}

async function resolvePinState(): Promise<ResolvedPinState> {
  const envPin = normalizePin(process.env.SLM_INSTANCE_PIN);
  if (envPin) {
    return {
      enabled: true,
      source: "env",
      secret: normalizePin(process.env.SLM_INSTANCE_COOKIE_SECRET) || envPin,
      pinValue: envPin,
    };
  }

  const config = await readLocalInstanceConfig();
  if (config?.pin) {
    return {
      enabled: true,
      source: "file",
      secret: config.pin.cookieSecret,
    };
  }

  return {
    enabled: false,
    source: "none",
  };
}

function signPayload(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export async function isInstancePinEnabled() {
  return (await resolvePinState()).enabled;
}

export async function resolveInstancePinSource() {
  return (await resolvePinState()).source;
}

export function getInstancePinCookieName() {
  return INSTANCE_PIN_COOKIE_NAME;
}

export function getInstancePinCookieOptions() {
  const ttlDays = getInstancePinTtlDays();
  return {
    ...secureSessionCookieBase(),
    maxAge: ttlDays * 24 * 60 * 60,
  };
}

export function clearInstancePinCookieOptions() {
  return {
    ...getInstancePinCookieOptions(),
    maxAge: 0,
  };
}

export function normalizeInstanceNextPath(value: string | undefined | null) {
  const candidate = (value || "").trim();
  if (!candidate.startsWith("/") || candidate.startsWith("//")) {
    return "/";
  }

  const hashless = candidate.split("#", 1)[0] || "/";
  const pathname = hashless.split("?", 1)[0] || "/";
  if (pathname === "/unlock" || pathname === "/setup" || pathname.startsWith("/api/auth/pin")) {
    return "/";
  }

  return hashless || "/";
}

export async function matchesInstancePin(candidate: string | undefined | null) {
  const state = await resolvePinState();
  if (!state.enabled) {
    return true;
  }

  const normalizedCandidate = normalizePin(candidate);
  if (state.source === "env") {
    return constantTimeEqual(normalizedCandidate, state.pinValue || "");
  }

  const config = await readLocalInstanceConfig();
  return verifyLocalPin(normalizedCandidate, config?.pin);
}

export async function buildInstancePinSessionToken(now = Date.now()) {
  const state = await resolvePinState();
  if (!state.enabled) {
    throw new Error("Instance PIN is not enabled.");
  }

  const expiresAt = now + getInstancePinTtlDays() * DAY_MS;
  const payload = `${INSTANCE_PIN_TOKEN_VERSION}.${expiresAt}`;
  const signature = signPayload(payload, state.secret);
  return `${payload}.${signature}`;
}

export async function verifyInstancePinSessionToken(token: string | undefined | null, now = Date.now()) {
  const state = await resolvePinState();
  if (!state.enabled) {
    return true;
  }
  if (!token) {
    return false;
  }

  const [version, expiresAtRaw, signature] = token.split(".");
  if (version !== INSTANCE_PIN_TOKEN_VERSION || !expiresAtRaw || !signature) {
    return false;
  }

  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt) || expiresAt <= now) {
    return false;
  }

  const expectedSignature = signPayload(`${version}.${expiresAtRaw}`, state.secret);
  return constantTimeEqual(signature, expectedSignature);
}

export async function resolveInstanceGateState(): Promise<InstanceSetupState> {
  const state = await resolvePinState();
  const setup = await import("./instance-config").then((module) => module.resolveInstanceSetupState());
  return {
    ...setup,
    pinEnabled: state.enabled,
    pinSource: state.source,
  };
}
