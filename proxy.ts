import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  getInstancePinCookieName,
  resolveInstanceGateState,
  verifyInstancePinSessionToken,
} from "./src/lib/instance-pin";
import { gatewayApiKeyConfigured, requestHasGatewayApiKey } from "./src/lib/api-gateway-auth";

const PUBLIC_FILE_REGEX = /\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml)$/i;
const GATEWAY_PATH_PREFIX = "/api/gateway/";
const GATEWAY_CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, X-API-Key",
};

function gatewayJsonResponse(status: number, message: string) {
  return NextResponse.json(
    {
      error: {
        message,
        type: "authentication_error",
        param: null,
      },
    },
    {
      status,
      headers: GATEWAY_CORS_HEADERS,
    },
  );
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const gatewayRequest = pathname.startsWith(GATEWAY_PATH_PREFIX);
  if (
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico" ||
    PUBLIC_FILE_REGEX.test(pathname)
  ) {
    return NextResponse.next();
  }

  if (gatewayRequest && request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        ...GATEWAY_CORS_HEADERS,
        "Access-Control-Max-Age": "86400",
      },
    });
  }

  const gate = await resolveInstanceGateState();

  if (!gate.setupCompleted) {
    if (pathname.startsWith("/setup") || pathname.startsWith("/api/setup/")) {
      return NextResponse.next();
    }

    if (gatewayRequest) {
      return gatewayJsonResponse(503, "Instance setup is incomplete.");
    }

    return NextResponse.redirect(new URL("/setup", request.url), 302);
  }

  if (!gate.pinEnabled) {
    return NextResponse.next();
  }

  if (gatewayRequest && gatewayApiKeyConfigured() && requestHasGatewayApiKey(request.headers)) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/unlock") || pathname.startsWith("/api/auth/pin")) {
    return NextResponse.next();
  }

  const token = request.cookies.get(getInstancePinCookieName())?.value;
  if (await verifyInstancePinSessionToken(token)) {
    return NextResponse.next();
  }

  if (gatewayRequest) {
    return gatewayJsonResponse(401, "Unlock this instance first or provide a valid API gateway key.");
  }

  const unlockUrl = new URL("/unlock", request.url);
  unlockUrl.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(unlockUrl, 302);
}

export const config = {
  matcher: "/:path*",
};
