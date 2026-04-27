import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import {
  getAdminCookieName,
  readAdminSessionToken,
} from "./admin-auth";
import {
  getAdminMasqueradeCookieName,
  readAdminMasqueradeToken,
} from "./admin-masquerade";
import {
  getInstancePinCookieName,
  isInstancePinEnabled,
  normalizeInstanceNextPath,
  resolveInstanceGateState,
  verifyInstancePinSessionToken,
} from "./instance-pin";
import { convexRefs } from "./convex-refs";
import { createConvexClient, getConvexUrl } from "./convex-server";
import { readLocalInstanceConfig } from "./instance-config";
import {
  getTenantSessionCookieName,
  hasValidTenantSession,
  verifyTenantSessionToken,
} from "./tenant-session";

type UnauthorizedResponseKind = "json" | "redirect";
type PageAccessOptions = {
  allowBillingRequired?: boolean;
};

function readCookieValue(rawCookieHeader: string | null, cookieName: string) {
  if (!rawCookieHeader) {
    return undefined;
  }

  for (const part of rawCookieHeader.split(";")) {
    const [name, ...valueParts] = part.trim().split("=");
    if (name === cookieName) {
      return valueParts.join("=");
    }
  }

  return undefined;
}

function buildUnlockUrl(request: Request) {
  const requestUrl = new URL(request.url);
  const nextPath = normalizeInstanceNextPath(`${requestUrl.pathname}${requestUrl.search}`);
  const unlockUrl = new URL("/unlock", request.url);
  if (nextPath !== "/") {
    unlockUrl.searchParams.set("next", nextPath);
  }
  return unlockUrl;
}

async function hasValidInstanceSession(token: string | undefined) {
  if (!(await isInstancePinEnabled())) {
    return true;
  }

  return await verifyInstancePinSessionToken(token);
}

async function hasValidTenantPageSession(token: string | undefined) {
  return await hasValidTenantSession(token);
}

function tenantBillingIsActive(status: string | undefined, trialEndsAt: number | null | undefined, now = Date.now()) {
  if (status === "active") {
    return true;
  }
  return status === "trialing" && typeof trialEndsAt === "number" && trialEndsAt >= now;
}

async function currentTenantNeedsBilling() {
  const config = await readLocalInstanceConfig();
  if (!config?.setupCompleted || config.preferences.serviceMode !== "hosted" || !config.account?.tenantId) {
    return false;
  }

  try {
    const summary = await createConvexClient(getConvexUrl()).query(convexRefs.billingGetTenantBillingSummary, {
      tenantId: config.account.tenantId,
    }) as {
      tenant?: {
        billingStatus?: string;
        trialEndsAt?: number | null;
      };
    } | null;
    if (summary?.tenant) {
      return !tenantBillingIsActive(summary.tenant.billingStatus, summary.tenant.trialEndsAt);
    }
  } catch {
    // Fall back to local state if Convex cannot be reached.
  }

  return !tenantBillingIsActive(config.account.billingStatus, config.account.trialEndsAt);
}

function hasValidAdminMasqueradeSession(adminToken: string | undefined, masqueradeToken: string | undefined) {
  const adminSession = readAdminSessionToken(adminToken);
  const masqueradeSession = readAdminMasqueradeToken(masqueradeToken);
  return Boolean(adminSession && masqueradeSession && adminSession.email === masqueradeSession.adminEmail);
}

export async function requireInstancePageAccess(options: PageAccessOptions = {}) {
  const gate = await resolveInstanceGateState();
  if (!gate.setupCompleted) {
    redirect("/setup");
  }

  const cookieStore = await cookies();
  const instanceToken = cookieStore.get(getInstancePinCookieName())?.value;
  const tenantToken = cookieStore.get(getTenantSessionCookieName())?.value;
  const adminToken = cookieStore.get(getAdminCookieName())?.value;
  const masqueradeToken = cookieStore.get(getAdminMasqueradeCookieName())?.value;
  const validTenantSession = (await hasValidInstanceSession(instanceToken)) && (await hasValidTenantPageSession(tenantToken));
  const validAdminMasquerade = hasValidAdminMasqueradeSession(adminToken, masqueradeToken);

  if (validTenantSession || validAdminMasquerade) {
    if (validTenantSession && !validAdminMasquerade && !options.allowBillingRequired && await currentTenantNeedsBilling()) {
      redirect("/billing/restore");
    }
    return;
  }

  redirect("/unlock");
}

export async function requireAuthenticatedPageAccess() {
  await requireInstancePageAccess();
}

export async function requireRuntimeControlPageAccess() {
  const gate = await resolveInstanceGateState();
  if (!gate.setupCompleted) {
    return;
  }

  await requireInstancePageAccess();
  if (gate.preferences.serviceMode !== "hosted") {
    return;
  }

  const cookieStore = await cookies();
  const tenantSession = await verifyTenantSessionToken(cookieStore.get(getTenantSessionCookieName())?.value);
  const adminToken = cookieStore.get(getAdminCookieName())?.value;
  const masqueradeToken = cookieStore.get(getAdminMasqueradeCookieName())?.value;
  if (
    tenantSession?.role === "owner" ||
    tenantSession?.role === "admin" ||
    hasValidAdminMasqueradeSession(adminToken, masqueradeToken)
  ) {
    return;
  }

  redirect("/");
}

export async function requireInstanceApiAccess(
  request: Request,
  kind: UnauthorizedResponseKind = "json",
) {
  const token = readCookieValue(request.headers.get("cookie"), getInstancePinCookieName());
  const tenantToken = readCookieValue(request.headers.get("cookie"), getTenantSessionCookieName());
  const adminToken = readCookieValue(request.headers.get("cookie"), getAdminCookieName());
  const masqueradeToken = readCookieValue(request.headers.get("cookie"), getAdminMasqueradeCookieName());
  const validTenantSession = (await hasValidInstanceSession(token)) && (await hasValidTenantSession(tenantToken));
  const validAdminMasquerade = hasValidAdminMasqueradeSession(adminToken, masqueradeToken);

  if (validTenantSession || validAdminMasquerade) {
    const requestUrl = new URL(request.url);
    const isBillingCheckout = requestUrl.pathname === "/api/billing/flutterwave/checkout";
    if (validTenantSession && !validAdminMasquerade && !isBillingCheckout && await currentTenantNeedsBilling()) {
      return NextResponse.json(
        {
          error: "Choose a plan to keep using the app.",
          redirectPath: "/billing/restore",
        },
        { status: 402 },
      );
    }
    return null;
  }

  const unlockUrl = buildUnlockUrl(request);
  if (kind === "redirect") {
    return NextResponse.redirect(unlockUrl, 303);
  }

  return NextResponse.json(
    {
      error: "Please unlock the app first.",
      redirectPath: `${unlockUrl.pathname}${unlockUrl.search}`,
    },
    { status: 401 },
  );
}

export async function requireRuntimeControlApiAccess(
  request: Request,
  kind: UnauthorizedResponseKind = "json",
) {
  const unauthorized = await requireInstanceApiAccess(request, kind);
  if (unauthorized) {
    return unauthorized;
  }

  const gate = await resolveInstanceGateState();
  if (gate.preferences.serviceMode !== "hosted") {
    return null;
  }

  const tenantToken = readCookieValue(request.headers.get("cookie"), getTenantSessionCookieName());
  const tenantSession = await verifyTenantSessionToken(tenantToken);
  const adminToken = readCookieValue(request.headers.get("cookie"), getAdminCookieName());
  const masqueradeToken = readCookieValue(request.headers.get("cookie"), getAdminMasqueradeCookieName());
  if (
    tenantSession?.role === "owner" ||
    tenantSession?.role === "admin" ||
    hasValidAdminMasqueradeSession(adminToken, masqueradeToken)
  ) {
    return null;
  }

  if (kind === "redirect") {
    return NextResponse.redirect(new URL("/", request.url), 303);
  }

  return NextResponse.json(
    {
      error: "You need owner or admin access for this action.",
    },
    { status: 403 },
  );
}
