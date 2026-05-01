import { NextRequest, NextResponse } from "next/server";
import {
  buildAdminSessionToken,
  clearAdminCookieOptions,
  getAdminCookieName,
  getAdminCookieOptions,
  normalizeAdminNextPath,
  verifyAdminRequest,
} from "@/lib/admin-auth";
import { AdminCredentialBackendUnavailableError, verifyAdminCredentials } from "@/lib/admin-users";
import { consumeRequestRateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { isElectronEnvironment } from "@/lib/runtime-env";
import { requestHasSameOrigin } from "@/lib/secure-cookies";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (isElectronEnvironment()) {
    return NextResponse.json({ error: "Admin functionality is disabled in the desktop app." }, { status: 404 });
  }

  if (!requestHasSameOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }

  const formData = await request.formData();
  const email = String(formData.get("email") || "");
  const pin = String(formData.get("pin") || "");
  const nextPath = normalizeAdminNextPath(String(formData.get("next") || ""));
  const decision = await consumeRequestRateLimit(request, {
    scope: "auth.admin",
    identity: email,
    limit: 6,
    windowMs: 10 * 60 * 1000,
    penaltyMs: 15 * 60 * 1000,
  });
  if (!decision.allowed) {
    const headers = rateLimitHeaders(decision);
    return NextResponse.redirect(
      new URL(`/admin/unlock?next=${encodeURIComponent(nextPath)}&error=rate_limited`, request.url),
      { status: 303, headers },
    );
  }
  let admin: Awaited<ReturnType<typeof verifyAdminCredentials>>;
  try {
    admin = await verifyAdminCredentials(email, pin);
  } catch (error) {
    if (error instanceof AdminCredentialBackendUnavailableError) {
      return NextResponse.redirect(
        new URL(`/admin/unlock?next=${encodeURIComponent(nextPath)}&error=backend_unavailable`, request.url),
        303,
      );
    }
    throw error;
  }
  if (!admin) {
    return NextResponse.redirect(new URL(`/admin/unlock?next=${encodeURIComponent(nextPath)}&error=1`, request.url), 303);
  }
  const response = NextResponse.redirect(new URL(nextPath, request.url), 303);
  response.cookies.set(getAdminCookieName(), buildAdminSessionToken(admin.email), getAdminCookieOptions());
  return response;
}

export async function DELETE(request: NextRequest) {
  if (isElectronEnvironment()) {
    return NextResponse.json({ error: "Admin functionality is disabled in the desktop app." }, { status: 404 });
  }

  if (!verifyAdminRequest(request, { requireSameOrigin: true })) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.set(getAdminCookieName(), "", clearAdminCookieOptions());
  return response;
}
