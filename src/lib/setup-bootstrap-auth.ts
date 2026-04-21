import { createHmac, timingSafeEqual } from "node:crypto";

const SETUP_BOOTSTRAP_COOKIE_NAME = "slm_setup_bootstrap";
const SETUP_BOOTSTRAP_TOKEN_VERSION = "v1";
const SETUP_BOOTSTRAP_HEADER = "x-setup-secret";
const SETUP_BOOTSTRAP_TTL_MS = 2 * 60 * 60 * 1000;

function normalizeToken(value: string | null | undefined) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeHostname(value: string | null | undefined) {
  return normalizeToken(value).toLowerCase();
}

function getSetupBootstrapSecret() {
  return normalizeToken(process.env.SLM_SETUP_SECRET);
}

function signSetupBootstrapPayload(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function constantTimeEqual(left: string, right: string) {
  const a = Buffer.from(left.normalize("NFKC"));
  const b = Buffer.from(right.normalize("NFKC"));
  return a.length === b.length && timingSafeEqual(a, b);
}

export function getSetupBootstrapHeaderName() {
  return SETUP_BOOTSTRAP_HEADER;
}

export function getSetupBootstrapCookieName() {
  return SETUP_BOOTSTRAP_COOKIE_NAME;
}

export function setupBootstrapConfigured() {
  return getSetupBootstrapSecret().length > 0;
}

export function isLoopbackHostname(hostname: string | null | undefined) {
  const normalized = normalizeHostname(hostname);
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1" || normalized === "[::1]";
}

export function requestHasValidSetupBootstrapSecret(headers: Pick<Headers, "get">) {
  const configuredSecret = getSetupBootstrapSecret();
  if (!configuredSecret) {
    return false;
  }
  return constantTimeEqual(normalizeToken(headers.get(SETUP_BOOTSTRAP_HEADER)), configuredSecret);
}

export function buildSetupBootstrapCookie(now = Date.now()) {
  const secret = getSetupBootstrapSecret();
  if (!secret) {
    throw new Error("Missing SLM_SETUP_SECRET");
  }
  const expiresAt = now + SETUP_BOOTSTRAP_TTL_MS;
  const payload = `${SETUP_BOOTSTRAP_TOKEN_VERSION}.${expiresAt}`;
  const signature = signSetupBootstrapPayload(payload, secret);
  return `${payload}.${signature}`;
}

export function getSetupBootstrapCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.floor(SETUP_BOOTSTRAP_TTL_MS / 1000),
  };
}

export function clearSetupBootstrapCookieOptions() {
  return {
    ...getSetupBootstrapCookieOptions(),
    maxAge: 0,
  };
}

export function verifySetupBootstrapCookie(token: string | undefined | null, now = Date.now()) {
  const secret = getSetupBootstrapSecret();
  if (!secret || !token) {
    return false;
  }

  const [version, expiresAtRaw, signature] = token.split(".");
  if (version !== SETUP_BOOTSTRAP_TOKEN_VERSION || !expiresAtRaw || !signature) {
    return false;
  }

  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt) || expiresAt <= now) {
    return false;
  }

  const expectedSignature = signSetupBootstrapPayload(`${version}.${expiresAtRaw}`, secret);
  return constantTimeEqual(signature, expectedSignature);
}
