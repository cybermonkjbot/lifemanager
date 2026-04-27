import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { readLocalInstanceConfig } from "./instance-config";
import { secureSessionCookieBase } from "./secure-cookies";

const TENANT_SESSION_COOKIE_NAME = "odogwu_tenant_session";
const TENANT_SESSION_TOKEN_VERSION = "v1";
const TENANT_USER_SESSION_TOKEN_VERSION = "v2";
const DEFAULT_TENANT_SESSION_TTL_HOURS = 12;
const MIN_TENANT_SESSION_TTL_HOURS = 1;
const MAX_TENANT_SESSION_TTL_HOURS = 24 * 14;
const HOUR_MS = 60 * 60 * 1000;

export type TenantSessionRole = "owner" | "admin" | "member";

export type TenantSessionIdentity = {
  userId?: string;
  email: string;
  role: TenantSessionRole;
  isSuperAdmin: boolean;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function constantTimeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function ttlHours() {
  const parsed = Number(process.env.ODOGWU_TENANT_SESSION_TTL_HOURS || DEFAULT_TENANT_SESSION_TTL_HOURS);
  return Number.isFinite(parsed)
    ? clamp(Math.round(parsed), MIN_TENANT_SESSION_TTL_HOURS, MAX_TENANT_SESSION_TTL_HOURS)
    : DEFAULT_TENANT_SESSION_TTL_HOURS;
}

function signPayload(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function hashEmail(email: string) {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("base64url");
}

async function resolveTenantSessionSecret() {
  const config = await readLocalInstanceConfig();
  return (
    process.env.ODOGWU_TENANT_SESSION_SECRET ||
    process.env.SLM_INSTANCE_COOKIE_SECRET ||
    config?.pin?.cookieSecret ||
    ""
  );
}

export function getTenantSessionCookieName() {
  return TENANT_SESSION_COOKIE_NAME;
}

export function getTenantSessionCookieOptions() {
  const hours = ttlHours();
  return {
    ...secureSessionCookieBase(),
    maxAge: hours * 60 * 60,
  };
}

export function clearTenantSessionCookieOptions() {
  return {
    ...getTenantSessionCookieOptions(),
    maxAge: 0,
  };
}

function encode(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decode(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function normalizeRole(value: string): TenantSessionRole {
  return value === "owner" || value === "admin" || value === "member" ? value : "member";
}

export async function buildTenantSessionToken(identity?: TenantSessionIdentity, now = Date.now()) {
  const config = await readLocalInstanceConfig();
  if (config?.preferences.serviceMode === "self_hosted") {
    return "";
  }
  const tenantId = config?.account?.tenantId || "";
  const deviceId = config?.account?.deviceId || "";
  const email = identity?.email || config?.account?.email || "";
  const secret = await resolveTenantSessionSecret();
  if (!tenantId || !deviceId || !secret) {
    return "";
  }

  const expiresAt = now + ttlHours() * HOUR_MS;
  const payload = identity
    ? [
        TENANT_USER_SESSION_TOKEN_VERSION,
        expiresAt,
        encode(tenantId),
        encode(deviceId),
        encode(identity.userId || ""),
        normalizeRole(identity.role),
        identity.isSuperAdmin ? "1" : "0",
        hashEmail(email),
      ].join(".")
    : [
        TENANT_SESSION_TOKEN_VERSION,
        expiresAt,
        encode(tenantId),
        encode(deviceId),
        hashEmail(email),
      ].join(".");
  const signature = signPayload(payload, secret);
  return `${payload}.${signature}`;
}

export async function currentInstanceRequiresTenantSession() {
  const config = await readLocalInstanceConfig();
  return Boolean(
    config?.setupCompleted &&
      config.preferences.serviceMode === "hosted" &&
      config.account?.tenantId,
  );
}

export async function verifyTenantSessionToken(token: string | undefined | null, now = Date.now()) {
  if (!token) {
    return null;
  }
  const parts = token.split(".");
  const version = parts[0];
  const isLegacyToken = version === TENANT_SESSION_TOKEN_VERSION && parts.length === 6;
  const isUserToken = version === TENANT_USER_SESSION_TOKEN_VERSION && parts.length === 9;
  if (!isLegacyToken && !isUserToken) {
    return null;
  }

  const expiresAtRaw = parts[1];
  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt) || expiresAt <= now) {
    return null;
  }

  const secret = await resolveTenantSessionSecret();
  if (!secret) {
    return null;
  }
  const signature = parts[parts.length - 1];
  const payload = parts.slice(0, -1).join(".");
  if (!constantTimeEqual(signature, signPayload(payload, secret))) {
    return null;
  }

  const tenantId = decode(parts[2]);
  const deviceId = decode(parts[3]);
  const config = await readLocalInstanceConfig();
  if (config?.account?.tenantId !== tenantId || config.account.deviceId !== deviceId) {
    return null;
  }

  if (isLegacyToken && parts[4] !== hashEmail(config.account.email || "")) {
    return null;
  }

  if (isUserToken) {
    return {
      tenantId,
      deviceId,
      userId: decode(parts[4]) || null,
      role: normalizeRole(parts[5]),
      isSuperAdmin: parts[6] === "1",
      expiresAt,
    };
  }

  return {
    tenantId,
    deviceId,
    userId: null,
    role: "owner" as const,
    isSuperAdmin: true,
    expiresAt,
  };
}

export async function hasValidTenantSession(token: string | undefined | null, now = Date.now()) {
  if (!(await currentInstanceRequiresTenantSession())) {
    return true;
  }
  return Boolean(await verifyTenantSessionToken(token, now));
}
