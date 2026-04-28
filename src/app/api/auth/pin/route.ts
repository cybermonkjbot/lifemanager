import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { convexRefs } from "@/lib/convex-refs";
import { createConvexClient } from "@/lib/convex-server";
import {
  createLocalPinHash,
  readLocalInstanceConfig,
  sanitizeInstanceAccountProfile,
  writeLocalInstanceConfig,
} from "@/lib/instance-config";
import { DEFAULT_INSTANCE_SETUP_PREFERENCES } from "@/lib/instance-setup-types";
import {
  buildInstancePinSessionToken,
  getInstancePinCookieName,
  getInstancePinCookieOptions,
  isInstancePinEnabled,
  matchesInstancePin,
  normalizeInstanceNextPath,
} from "@/lib/instance-pin";
import {
  buildTenantSessionToken,
  getTenantSessionCookieName,
  getTenantSessionCookieOptions,
} from "@/lib/tenant-session";
import { requestHasSameOrigin } from "@/lib/secure-cookies";
import { consumeRequestRateLimit, rateLimitHeaders } from "@/lib/rate-limit";

export const runtime = "nodejs";

function normalizeEmail(value: string | null | undefined) {
  return (value || "").trim().toLowerCase();
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function wantsJsonResponse(request: NextRequest) {
  return (
    request.headers.get("accept")?.includes("application/json") ||
    request.headers.get("x-requested-with") === "fetch"
  );
}

function loginErrorMessage(code: string) {
  if (code === "invalid_email") {
    return "Enter the email for your account.";
  }
  if (code === "pin_disabled") {
    return "Your app PIN is not set up.";
  }
  if (code === "invalid_origin") {
    return "This unlock request was blocked. Refresh the app and try again.";
  }
  if (code === "rate_limited") {
    return "Too many unlock attempts. Try again shortly.";
  }
  return "That email and PIN do not match an account.";
}

function loginErrorResponse(request: NextRequest, next: string, code: string, status = 400, email?: string) {
  if (wantsJsonResponse(request)) {
    return NextResponse.json(
      {
        ok: false,
        error: code,
        message: loginErrorMessage(code),
      },
      { status },
    );
  }

  const unlockUrl = new URL("/unlock", request.url);
  unlockUrl.searchParams.set("error", code);
  unlockUrl.searchParams.set("next", next);
  if (email) {
    unlockUrl.searchParams.set("email", email);
  }
  return NextResponse.redirect(unlockUrl, 303);
}

async function loginRateLimitResponse(request: NextRequest, next: string, email: string, scope: string) {
  const decision = await consumeRequestRateLimit(request, {
    scope,
    identity: email || "local-pin",
    limit: 8,
    windowMs: 10 * 60 * 1000,
    penaltyMs: 15 * 60 * 1000,
  });
  if (decision.allowed) {
    return null;
  }

  const headers = rateLimitHeaders(decision);
  if (wantsJsonResponse(request)) {
    return NextResponse.json(
      {
        ok: false,
        error: "rate_limited",
        message: loginErrorMessage("rate_limited"),
      },
      { status: 429, headers },
    );
  }

  const unlockUrl = new URL("/unlock", request.url);
  unlockUrl.searchParams.set("error", "rate_limited");
  unlockUrl.searchParams.set("next", next);
  if (email) {
    unlockUrl.searchParams.set("email", email);
  }
  return NextResponse.redirect(unlockUrl, { status: 303, headers });
}

type VerifiedTenantLogin = {
  tenantId: string;
  userId?: string;
  email: string;
  displayName: string;
  role: "owner" | "admin" | "member";
  isSuperAdmin: boolean;
  billingStatus: "trialing" | "active" | "past_due" | "paused" | "canceled";
  accessStatus?: "active" | "billing_required";
  trialStartedAt: number;
  trialEndsAt: number;
};

async function attachLoginCookies(
  response: NextResponse,
  tenantSessionIdentity?: {
    userId?: string;
    email: string;
    role: "owner" | "admin" | "member";
    isSuperAdmin: boolean;
  },
) {
  const token = await buildInstancePinSessionToken();
  response.cookies.set(getInstancePinCookieName(), token, getInstancePinCookieOptions());
  const tenantSessionToken = await buildTenantSessionToken(tenantSessionIdentity);
  if (tenantSessionToken) {
    response.cookies.set(getTenantSessionCookieName(), tenantSessionToken, getTenantSessionCookieOptions());
  }
}

async function verifyHostedTenantLogin(args: {
  email: string;
  pin: string;
  deviceId: string;
  expectedTenantId?: string;
}) {
  const client = createConvexClient();
  const salt = (await client.mutation(convexRefs.tenantAccountsGetLoginPinSalt, {
    email: args.email,
    deviceId: args.deviceId,
    expectedTenantId: args.expectedTenantId,
  })) as { pinSalt: string | null } | null;
  if (!salt?.pinSalt) {
    return null;
  }
  const pinHash = createLocalPinHash(args.pin, salt.pinSalt);
  return (await client.mutation(convexRefs.tenantAccountsVerifyTenantLogin, {
    email: args.email,
    pinHash,
    deviceId: args.deviceId,
    expectedTenantId: args.expectedTenantId,
  })) as VerifiedTenantLogin | null;
}

export async function POST(request: NextRequest) {
  if (!requestHasSameOrigin(request)) {
    return loginErrorResponse(request, "/", "invalid_origin", 403);
  }

  const form = await request.formData();
  const email = normalizeEmail(String(form.get("email") || ""));
  const pin = String(form.get("pin") || "");
  const next = normalizeInstanceNextPath(String(form.get("next") || "/"));

  if (!(await isInstancePinEnabled())) {
    if (wantsJsonResponse(request)) {
      return NextResponse.json({ ok: true, next });
    }
    return NextResponse.redirect(new URL(next, request.url), 303);
  }

  const config = await readLocalInstanceConfig();
  const serviceMode = config?.preferences.serviceMode || "hosted";
  let tenantSessionIdentity:
    | {
        userId?: string;
        email: string;
        role: "owner" | "admin" | "member";
        isSuperAdmin: boolean;
      }
    | undefined;
  if (serviceMode === "hosted") {
    if (!email || !isValidEmail(email)) {
      return loginErrorResponse(request, next, "invalid_email", 400);
    }

    const deviceId = config?.account?.deviceId || randomUUID();
    const limited = await loginRateLimitResponse(request, next, email, "auth.pin.hosted");
    if (limited) {
      return limited;
    }
    const verified = await verifyHostedTenantLogin({
      email,
      pin,
      deviceId,
      expectedTenantId: config?.account?.tenantId || undefined,
    }).catch(() => null);
    if (!verified) {
      return loginErrorResponse(request, next, "invalid_login", 401, email);
    }

    const now = Date.now();
    await writeLocalInstanceConfig({
      version: 1,
      setupCompleted: config?.setupCompleted === true,
      createdAt: config?.createdAt || now,
      updatedAt: now,
      pin: config?.pin || null,
      legalAcceptance: config?.legalAcceptance,
      preferences: config?.preferences || DEFAULT_INSTANCE_SETUP_PREFERENCES,
      account: sanitizeInstanceAccountProfile({
        ...(config?.account || {}),
        email: verified.email,
        displayName: verified.displayName,
        tenantId: verified.tenantId,
        deviceId,
        billingStatus: verified.billingStatus,
        trialStartedAt: verified.trialStartedAt,
        trialEndsAt: verified.trialEndsAt,
      }),
      setupAiSettingsToolConsumedAt: config?.setupAiSettingsToolConsumedAt ?? null,
    });
    tenantSessionIdentity = {
      userId: verified.userId,
      email: verified.email,
      role: verified.role,
      isSuperAdmin: verified.isSuperAdmin,
    };

  } else {
    const limited = await loginRateLimitResponse(request, next, email, "auth.pin.local");
    if (limited) {
      return limited;
    }
    if (!(await matchesInstancePin(pin))) {
      return loginErrorResponse(request, next, "invalid_login", 401, email);
    }
  }

  const response = wantsJsonResponse(request)
    ? NextResponse.json({ ok: true, next })
    : NextResponse.redirect(new URL(next, request.url), 303);
  await attachLoginCookies(response, tenantSessionIdentity);
  return response;
}
