import { NextRequest, NextResponse } from "next/server";
import {
  buildAdminMasqueradeToken,
  clearAdminMasqueradeCookieOptions,
  getAdminMasqueradeCookieName,
  getAdminMasqueradeCookieOptions,
  getAdminMasqueradeFromRequest,
} from "@/lib/admin-masquerade";
import { getAdminSessionFromRequest } from "@/lib/admin-auth";
import { adminCanMasqueradeTenants } from "@/lib/admin-users";
import { convexRefs } from "@/lib/convex-refs";
import { createConvexClient } from "@/lib/convex-server";
import { getConvexAdminSecret } from "@/lib/managed-secret-crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TenantRow = {
  _id: string;
  email: string;
  displayName?: string;
};

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
}

function forbidden() {
  return NextResponse.json({ error: "Tenant masquerade is not enabled for this admin." }, { status: 403 });
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

async function findTenant(tenantId: string) {
  const tenants = (await createConvexClient().query(convexRefs.tenantAccountsAdminList, {
    adminSecret: getConvexAdminSecret(),
    limit: 200,
  })) as TenantRow[];
  return tenants.find((tenant) => tenant._id === tenantId) || null;
}

export async function GET(request: NextRequest) {
  const session = getAdminSessionFromRequest(request);
  if (!session) {
    return unauthorized();
  }
  return NextResponse.json({
    masquerade: getAdminMasqueradeFromRequest(request),
    canMasqueradeTenants: await adminCanMasqueradeTenants(session.email),
  });
}

export async function POST(request: NextRequest) {
  const session = getAdminSessionFromRequest(request, { requireSameOrigin: true });
  if (!session) {
    return unauthorized();
  }
  if (!await adminCanMasqueradeTenants(session.email)) {
    return forbidden();
  }

  try {
    const body = (await request.json()) as { tenantId?: unknown };
    const tenantId = typeof body.tenantId === "string" ? body.tenantId.trim() : "";
    if (!tenantId) {
      return NextResponse.json({ error: "Tenant ID is required." }, { status: 400 });
    }
    const tenant = await findTenant(tenantId);
    if (!tenant) {
      return NextResponse.json({ error: "Tenant was not found." }, { status: 404 });
    }
    const token = buildAdminMasqueradeToken({
      adminEmail: session.email,
      tenantId: tenant._id,
      tenantEmail: tenant.email,
    });
    const response = NextResponse.json({
      masquerade: {
        adminEmail: session.email,
        tenantId: tenant._id,
        tenantEmail: tenant.email,
        tenantDisplayName: tenant.displayName || "",
      },
    });
    response.cookies.set(getAdminMasqueradeCookieName(), token, getAdminMasqueradeCookieOptions());
    return response;
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error, "Failed to start tenant masquerade.") }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const session = getAdminSessionFromRequest(request, { requireSameOrigin: true });
  if (!session) {
    return unauthorized();
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.set(getAdminMasqueradeCookieName(), "", clearAdminMasqueradeCookieOptions());
  return response;
}
