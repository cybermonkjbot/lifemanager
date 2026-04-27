import { NextResponse } from "next/server";
import {
  clearInstancePinCookieOptions,
  getInstancePinCookieName,
} from "@/lib/instance-pin";
import {
  clearTenantSessionCookieOptions,
  getTenantSessionCookieName,
} from "@/lib/tenant-session";
import { requestHasSameOrigin } from "@/lib/secure-cookies";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!requestHasSameOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }

  const response = NextResponse.redirect(new URL("/unlock", request.url), 303);
  response.cookies.set(getInstancePinCookieName(), "", clearInstancePinCookieOptions());
  response.cookies.set(getTenantSessionCookieName(), "", clearTenantSessionCookieOptions());
  return response;
}
