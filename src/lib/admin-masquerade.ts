import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { NextRequest } from "next/server";
import { getRuntimeDataPath } from "./runtime/paths";

const ADMIN_MASQUERADE_COOKIE_NAME = "odogwu_admin_masquerade";
const ADMIN_MASQUERADE_TOKEN_VERSION = "v1";
const ADMIN_MASQUERADE_TTL_MS = 2 * 60 * 60 * 1000;
const ADMIN_MASQUERADE_SECRET_PATH = getRuntimeDataPath("admin-masquerade-secret");

export type AdminMasqueradeSession = {
  adminEmail: string;
  tenantId: string;
  tenantEmail: string;
  expiresAt: number;
};

function constantTimeEqual(left: string, right: string) {
  const a = Buffer.from(left.normalize("NFKC"));
  const b = Buffer.from(right.normalize("NFKC"));
  return a.length === b.length && timingSafeEqual(a, b);
}

function encode(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decode(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function getMasqueradeSecret() {
  try {
    const existing = readFileSync(ADMIN_MASQUERADE_SECRET_PATH, "utf8").trim();
    if (existing) {
      return existing;
    }
  } catch {
    // Fall through and create a local masquerade secret.
  }

  const secret = randomBytes(32).toString("hex");
  mkdirSync(dirname(ADMIN_MASQUERADE_SECRET_PATH), { recursive: true });
  writeFileSync(ADMIN_MASQUERADE_SECRET_PATH, `${secret}\n`, { encoding: "utf8", mode: 0o600 });
  return secret;
}

function signPayload(payload: string) {
  return createHmac("sha256", getMasqueradeSecret()).update(payload).digest("base64url");
}

export function getAdminMasqueradeCookieName() {
  return ADMIN_MASQUERADE_COOKIE_NAME;
}

export function getAdminMasqueradeCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.round(ADMIN_MASQUERADE_TTL_MS / 1000),
  };
}

export function clearAdminMasqueradeCookieOptions() {
  return {
    ...getAdminMasqueradeCookieOptions(),
    maxAge: 0,
  };
}

export function buildAdminMasqueradeToken(args: {
  adminEmail: string;
  tenantId: string;
  tenantEmail: string;
  now?: number;
}) {
  const expiresAt = (args.now || Date.now()) + ADMIN_MASQUERADE_TTL_MS;
  const payload = [
    ADMIN_MASQUERADE_TOKEN_VERSION,
    expiresAt,
    encode(args.adminEmail.trim().toLowerCase()),
    encode(args.tenantId.trim()),
    encode(args.tenantEmail.trim().toLowerCase()),
  ].join(".");
  return `${payload}.${signPayload(payload)}`;
}

export function readAdminMasqueradeToken(token: string | undefined | null, now = Date.now()): AdminMasqueradeSession | null {
  if (!token) {
    return null;
  }
  const parts = token.split(".");
  if (parts.length !== 6) {
    return null;
  }
  const [version, expiresAtRaw, adminEmailRaw, tenantIdRaw, tenantEmailRaw, signature] = parts;
  if (version !== ADMIN_MASQUERADE_TOKEN_VERSION) {
    return null;
  }
  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt) || expiresAt <= now) {
    return null;
  }
  const payload = [version, expiresAtRaw, adminEmailRaw, tenantIdRaw, tenantEmailRaw].join(".");
  if (!constantTimeEqual(signature, signPayload(payload))) {
    return null;
  }
  try {
    return {
      adminEmail: decode(adminEmailRaw),
      tenantId: decode(tenantIdRaw),
      tenantEmail: decode(tenantEmailRaw),
      expiresAt,
    };
  } catch {
    return null;
  }
}

export function getAdminMasqueradeFromRequest(request: NextRequest) {
  return readAdminMasqueradeToken(request.cookies.get(ADMIN_MASQUERADE_COOKIE_NAME)?.value);
}
