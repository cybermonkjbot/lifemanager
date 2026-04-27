import { NextRequest, NextResponse } from "next/server";
import {
  buildAdminSessionToken,
  clearAdminCookieOptions,
  getAdminCookieName,
  getAdminCookieOptions,
  normalizeAdminNextPath,
  verifyAdminRequest,
} from "@/lib/admin-auth";
import { verifyAdminCredentials } from "@/lib/admin-users";
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
  const admin = await verifyAdminCredentials(email, pin);
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
