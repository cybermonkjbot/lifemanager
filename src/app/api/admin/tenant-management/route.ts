import { NextRequest, NextResponse } from "next/server";
import { getAdminSessionFromRequest } from "@/lib/admin-auth";
import { convexRefs } from "@/lib/convex-refs";
import { createConvexClient } from "@/lib/convex-server";
import { createLocalPinRecord } from "@/lib/instance-config";
import { getConvexAdminSecret } from "@/lib/managed-secret-crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PLANS = new Set(["personal_connector", "business_whatsapp", "self_hosted"]);
const BILLING_STATUSES = new Set(["trialing", "active", "past_due", "paused", "canceled"]);
const TENANT_ROLES = new Set(["owner", "admin", "member"]);
const MIN_PIN_LENGTH = 4;

type TenantUserRow = {
  _id: string;
  email: string;
  role: "owner" | "admin" | "member";
};

type TenantDetail = {
  tenant: {
    _id: string;
  };
  users: TenantUserRow[];
};

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function requireString(value: unknown, label: string) {
  const next = typeof value === "string" ? value.trim() : "";
  if (!next) {
    throw new Error(`${label} is required.`);
  }
  return next;
}

function normalizeOptionalString(value: unknown) {
  const next = typeof value === "string" ? value.trim() : "";
  return next || undefined;
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function createPinPatch(pin: unknown) {
  const normalized = typeof pin === "string" ? pin.trim() : "";
  if (!normalized) {
    return {};
  }
  if (normalized.length < MIN_PIN_LENGTH) {
    throw new Error("Tenant user PIN must be at least 4 characters.");
  }
  const record = createLocalPinRecord(normalized);
  return {
    pinSalt: record.salt,
    pinHash: record.hash,
    pinUpdatedAt: record.updatedAt,
  };
}

async function loadTenantDetail(tenantId: string) {
  return await createConvexClient().query(convexRefs.tenantAccountsAdminGet, {
    adminSecret: getConvexAdminSecret(),
    tenantId,
  }) as TenantDetail;
}

export async function GET(request: NextRequest) {
  if (!getAdminSessionFromRequest(request)) {
    return unauthorized();
  }

  try {
    const tenantId = requireString(request.nextUrl.searchParams.get("tenantId"), "Tenant ID");
    const detail = await loadTenantDetail(tenantId);
    return NextResponse.json({ detail });
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error, "Failed to load tenant.") }, { status: 400 });
  }
}

export async function PATCH(request: NextRequest) {
  if (!getAdminSessionFromRequest(request, { requireSameOrigin: true })) {
    return unauthorized();
  }

  try {
    const body = await request.json() as {
      tenantId?: unknown;
      plan?: unknown;
      billingStatus?: unknown;
      trialEndsAt?: unknown;
      subscriptionExpiresAt?: unknown;
      subscriptionPauseReason?: unknown;
    };
    const tenantId = requireString(body.tenantId, "Tenant ID");
    const plan = requireString(body.plan, "Plan");
    const billingStatus = requireString(body.billingStatus, "Billing status");
    const trialEndsAt = typeof body.trialEndsAt === "number" ? body.trialEndsAt : Number(body.trialEndsAt);
    const subscriptionExpiresAt =
      body.subscriptionExpiresAt === undefined || body.subscriptionExpiresAt === null || body.subscriptionExpiresAt === ""
        ? undefined
        : typeof body.subscriptionExpiresAt === "number"
          ? body.subscriptionExpiresAt
          : Number(body.subscriptionExpiresAt);
    if (!PLANS.has(plan)) {
      throw new Error("Invalid subscription plan.");
    }
    if (!BILLING_STATUSES.has(billingStatus)) {
      throw new Error("Invalid billing status.");
    }
    if (!Number.isFinite(trialEndsAt)) {
      throw new Error("Trial end date is required.");
    }
    if (subscriptionExpiresAt !== undefined && !Number.isFinite(subscriptionExpiresAt)) {
      throw new Error("Subscription expiry date is invalid.");
    }

    await createConvexClient().mutation(convexRefs.tenantAccountsAdminUpdateSubscription, {
      adminSecret: getConvexAdminSecret(),
      tenantId,
      plan,
      billingStatus,
      trialEndsAt,
      subscriptionExpiresAt,
      subscriptionPauseReason: normalizeOptionalString(body.subscriptionPauseReason),
    });
    const detail = await loadTenantDetail(tenantId);
    return NextResponse.json({ detail });
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error, "Failed to update subscription.") }, { status: 400 });
  }
}

export async function POST(request: NextRequest) {
  if (!getAdminSessionFromRequest(request, { requireSameOrigin: true })) {
    return unauthorized();
  }

  try {
    const body = await request.json() as {
      tenantId?: unknown;
      email?: unknown;
      displayName?: unknown;
      role?: unknown;
      isSuperAdmin?: unknown;
      pin?: unknown;
    };
    const tenantId = requireString(body.tenantId, "Tenant ID");
    const email = requireString(body.email, "Tenant user email");
    const role = requireString(body.role, "Tenant role");
    if (!TENANT_ROLES.has(role)) {
      throw new Error("Invalid tenant role.");
    }

    const detail = await loadTenantDetail(tenantId);
    const existing = detail.users.find((user) => normalizeEmail(user.email) === normalizeEmail(email));
    const pinPatch = createPinPatch(body.pin);
    if (!existing && !("pinHash" in pinPatch)) {
      throw new Error("Set a PIN when creating a tenant user.");
    }

    await createConvexClient().mutation(convexRefs.tenantAccountsAdminUpsertUser, {
      adminSecret: getConvexAdminSecret(),
      tenantId,
      email,
      displayName: normalizeOptionalString(body.displayName),
      role,
      isSuperAdmin: body.isSuperAdmin === true,
      ...pinPatch,
    });
    return NextResponse.json({ detail: await loadTenantDetail(tenantId) });
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error, "Failed to save tenant user.") }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  if (!getAdminSessionFromRequest(request, { requireSameOrigin: true })) {
    return unauthorized();
  }

  try {
    const body = await request.json() as {
      tenantId?: unknown;
      userId?: unknown;
    };
    const tenantId = requireString(body.tenantId, "Tenant ID");
    const userId = requireString(body.userId, "Tenant user ID");
    await createConvexClient().mutation(convexRefs.tenantAccountsAdminRemoveUser, {
      adminSecret: getConvexAdminSecret(),
      tenantId,
      userId,
    });
    return NextResponse.json({ detail: await loadTenantDetail(tenantId) });
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error, "Failed to remove tenant user.") }, { status: 400 });
  }
}
