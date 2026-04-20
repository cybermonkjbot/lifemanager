import { NextResponse } from "next/server";
import {
  clearInstancePinCookieOptions,
  getInstancePinCookieName,
} from "@/lib/instance-pin";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const response = NextResponse.redirect(new URL("/unlock", request.url), 303);
  response.cookies.set(getInstancePinCookieName(), "", clearInstancePinCookieOptions());
  return response;
}
