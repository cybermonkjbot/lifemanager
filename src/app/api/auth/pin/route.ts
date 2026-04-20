import { NextRequest, NextResponse } from "next/server";
import {
  buildInstancePinSessionToken,
  getInstancePinCookieName,
  getInstancePinCookieOptions,
  isInstancePinEnabled,
  matchesInstancePin,
  normalizeInstanceNextPath,
} from "@/lib/instance-pin";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const pin = String(form.get("pin") || "");
  const next = normalizeInstanceNextPath(String(form.get("next") || "/"));

  if (!(await isInstancePinEnabled())) {
    return NextResponse.redirect(new URL(next, request.url), 303);
  }

  if (!(await matchesInstancePin(pin))) {
    const unlockUrl = new URL("/unlock", request.url);
    unlockUrl.searchParams.set("error", "invalid_pin");
    unlockUrl.searchParams.set("next", next);
    return NextResponse.redirect(unlockUrl, 303);
  }

  const token = await buildInstancePinSessionToken();
  const response = NextResponse.redirect(new URL(next, request.url), 303);
  response.cookies.set(getInstancePinCookieName(), token, getInstancePinCookieOptions());
  return response;
}
