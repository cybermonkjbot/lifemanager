import { buildConvexAuthToken, getConvexAuthIssuer } from "@/lib/convex-auth-token";
import { getAdminCookieName, readAdminSessionToken } from "@/lib/admin-auth";
import { getAdminMasqueradeCookieName, readAdminMasqueradeToken } from "@/lib/admin-masquerade";
import { readLocalInstanceConfig } from "@/lib/instance-config";
import { getTenantSessionCookieName, verifyTenantSessionToken } from "@/lib/tenant-session";
import { requestHasSameOrigin } from "@/lib/secure-cookies";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const cookieStore = await cookies();
  const config = await readLocalInstanceConfig();
  const origin = new URL(request.url).origin;
  const issuer = getConvexAuthIssuer(origin);

  const adminSession = readAdminSessionToken(cookieStore.get(getAdminCookieName())?.value);
  const masqueradeSession = readAdminMasqueradeToken(cookieStore.get(getAdminMasqueradeCookieName())?.value);
  if (adminSession && masqueradeSession) {
    return NextResponse.json(
      {
        token: buildConvexAuthToken(
          {
            tenantId: masqueradeSession.tenantId,
            email: masqueradeSession.adminEmail,
            role: "admin",
            isSuperAdmin: true,
            subject: `admin:${masqueradeSession.adminEmail}:tenant:${masqueradeSession.tenantId}`,
          },
          { issuer },
        ),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  if (adminSession) {
    return NextResponse.json(
      {
        token: buildConvexAuthToken(
          {
            email: adminSession.email,
            role: "admin",
            isSuperAdmin: true,
            subject: `admin:${adminSession.email}`,
          },
          { issuer },
        ),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const tenantSession = await verifyTenantSessionToken(cookieStore.get(getTenantSessionCookieName())?.value);
  if (tenantSession) {
    return NextResponse.json(
      {
        token: buildConvexAuthToken(
          {
            tenantId: tenantSession.tenantId,
            deviceId: tenantSession.deviceId,
            email: config?.account?.email,
            role: tenantSession.role,
            isSuperAdmin: tenantSession.isSuperAdmin,
            subject: tenantSession.userId || `${tenantSession.tenantId}:${tenantSession.deviceId}`,
          },
          { issuer },
        ),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  if (config?.setupCompleted && config.preferences.serviceMode === "self_hosted" && requestHasSameOrigin(request)) {
    return NextResponse.json(
      {
        token: buildConvexAuthToken(
          {
            email: config.account?.email,
            role: "owner",
            isSuperAdmin: true,
            subject: "self-hosted-local-instance",
          },
          { issuer },
        ),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json({ error: "Not authenticated" }, { status: 401, headers: { "Cache-Control": "no-store" } });
}
