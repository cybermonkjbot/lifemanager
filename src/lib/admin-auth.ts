import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { normalizeAdminEmail } from "./admin-users";
import { getRuntimeDataPath } from "./runtime/paths";
import { isElectronEnvironment } from "./runtime-env";
import { requestHasSameOrigin, secureSessionCookieBase } from "./secure-cookies";

const ADMIN_COOKIE_NAME = "odogwu_admin_session";
const ADMIN_TOKEN_VERSION = "v2";
const DEFAULT_ADMIN_TTL_HOURS = 8;
const HOUR_MS = 60 * 60 * 1000;
const ADMIN_SESSION_SECRET_PATH = getRuntimeDataPath("admin-session-secret");

export type AdminSession = {
  email: string;
  expiresAt: number;
};

function constantTimeEqual(left: string, right: string) {
  const a = Buffer.from(left.normalize("NFKC"));
  const b = Buffer.from(right.normalize("NFKC"));
  return a.length === b.length && timingSafeEqual(a, b);
}

function signAdminPayload(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function getAdminSessionSecret() {
  try {
    const existing = readFileSync(ADMIN_SESSION_SECRET_PATH, "utf8").trim();
    if (existing) {
      return existing;
    }
  } catch {
    // Fall through and create a local session secret.
  }

  const secret = randomBytes(32).toString("hex");
  mkdirSync(dirname(ADMIN_SESSION_SECRET_PATH), { recursive: true });
  writeFileSync(ADMIN_SESSION_SECRET_PATH, `${secret}\n`, { encoding: "utf8", mode: 0o600 });
  return secret;
}

function getAdminTtlMs() {
  return DEFAULT_ADMIN_TTL_HOURS * HOUR_MS;
}

export function getAdminCookieName() {
  return ADMIN_COOKIE_NAME;
}

export function getAdminCookieOptions() {
  return {
    ...secureSessionCookieBase(),
    maxAge: Math.round(getAdminTtlMs() / 1000),
  };
}

export function clearAdminCookieOptions() {
  return {
    ...getAdminCookieOptions(),
    maxAge: 0,
  };
}

export function normalizeAdminNextPath(value: string | undefined | null) {
  const candidate = (value || "").trim();
  if (!candidate.startsWith("/") || candidate.startsWith("//")) {
    return "/admin/secrets";
  }
  const hashless = candidate.split("#", 1)[0] || "/admin/secrets";
  const pathname = hashless.split("?", 1)[0] || "/admin/secrets";
  if (pathname === "/admin/unlock" || pathname.startsWith("/api/admin/session")) {
    return "/admin/secrets";
  }
  return hashless || "/admin/secrets";
}

export function buildAdminSessionToken(email: string, now = Date.now()) {
  if (isElectronEnvironment()) {
    return "";
  }
  const secret = getAdminSessionSecret();
  const expiresAt = now + getAdminTtlMs();
  const emailNormalized = normalizeAdminEmail(email);
  const encodedEmail = Buffer.from(emailNormalized, "utf8").toString("base64url");
  const payload = `${ADMIN_TOKEN_VERSION}.${expiresAt}.${encodedEmail}`;
  const signature = signAdminPayload(payload, secret);
  return `${payload}.${signature}`;
}

export function readAdminSessionToken(token: string | undefined | null, now = Date.now()): AdminSession | null {
  if (isElectronEnvironment()) {
    return null;
  }
  const secret = getAdminSessionSecret();
  if (!secret || !token) {
    return null;
  }
  const [version, expiresAtRaw, encodedEmail, signature] = token.split(".");
  if (version !== ADMIN_TOKEN_VERSION || !expiresAtRaw || !encodedEmail || !signature) {
    return null;
  }
  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt) || expiresAt <= now) {
    return null;
  }
  const expectedSignature = signAdminPayload(`${version}.${expiresAtRaw}.${encodedEmail}`, secret);
  if (!constantTimeEqual(signature, expectedSignature)) {
    return null;
  }

  try {
    const email = normalizeAdminEmail(Buffer.from(encodedEmail, "base64url").toString("utf8"));
    if (!email) {
      return null;
    }
    return { email, expiresAt };
  } catch {
    return null;
  }
}

export function verifyAdminSessionToken(token: string | undefined | null, now = Date.now()) {
  return Boolean(readAdminSessionToken(token, now));
}

export function verifyAdminRequest(request: NextRequest, options: { requireSameOrigin?: boolean } = {}) {
  return Boolean(getAdminSessionFromRequest(request, options));
}

export function getAdminSessionFromRequest(request: NextRequest, options: { requireSameOrigin?: boolean } = {}) {
  const token = request.cookies.get(ADMIN_COOKIE_NAME)?.value;
  const session = readAdminSessionToken(token);
  if (!session) {
    return null;
  }
  if (options.requireSameOrigin && !requestHasSameOrigin(request)) {
    return null;
  }
  return session;
}

export async function requireAdminPageAccess(nextPath = "/admin/secrets") {
  if (isElectronEnvironment()) {
    notFound();
  }
  const cookieStore = await cookies();
  const token = cookieStore.get(ADMIN_COOKIE_NAME)?.value;
  if (verifyAdminSessionToken(token)) {
    return;
  }
  const unlockPath = `/admin/unlock?next=${encodeURIComponent(normalizeAdminNextPath(nextPath))}`;
  redirect(unlockPath);
}
