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

function tenantNeedsBilling(verified: VerifiedTenantLogin) {
  if (verified.accessStatus === "billing_required") {
    return true;
  }
  if (verified.billingStatus !== "active" && verified.billingStatus !== "trialing") {
    return true;
  }
  return verified.billingStatus === "trialing" && verified.trialEndsAt < Date.now();
}

function billingRequiredMessage(status: VerifiedTenantLogin["billingStatus"]) {
  if (status === "past_due") {
    return "Your account's subscription did not go through. Continue to billing to update payment.";
  }
  if (status === "canceled") {
    return "Your account's subscription is canceled. Continue to billing to restart it.";
  }
  return "Your account's free trial is over. Continue to billing to choose a plan.";
}

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
  const salt = (await client.query(convexRefs.tenantAccountsGetLoginPinSalt, {
    email: args.email,
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
      preferences: config?.preferences || DEFAULT_INSTANCE_SETUP_PREFERENCES,
      account: sanitizeInstanceAccountProfile({
        ...(config?.account || {}),
        email: config?.account?.email || verified.email,
        displayName: config?.account?.displayName || verified.displayName,
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

    if (tenantNeedsBilling(verified)) {
      const billingPath = `/billing/restore?next=${encodeURIComponent(next)}`;
      const response = wantsJsonResponse(request)
        ? NextResponse.json({
            ok: false,
            error: "billing_required",
            paymentRequired: true,
            billingStatus: verified.billingStatus,
            message: billingRequiredMessage(verified.billingStatus),
            next: billingPath,
          }, { status: 402 })
        : NextResponse.redirect(new URL(billingPath, request.url), 303);
      await attachLoginCookies(response, tenantSessionIdentity);
      return response;
    }
  } else if (!(await matchesInstancePin(pin))) {
    return loginErrorResponse(request, next, "invalid_login", 401, email);
  }

  const response = wantsJsonResponse(request)
    ? NextResponse.json({ ok: true, next })
    : NextResponse.redirect(new URL(next, request.url), 303);
  await attachLoginCookies(response, tenantSessionIdentity);
  return response;
}
