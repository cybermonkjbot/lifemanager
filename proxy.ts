import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  getInstancePinCookieName,
  resolveInstanceGateState,
  verifyInstancePinSessionToken,
} from "./src/lib/instance-pin";
import { gatewayApiKeyConfigured, requestHasGatewayApiKey } from "./src/lib/api-gateway-auth";
import {
  getSetupBootstrapCookieName,
  isLoopbackHostname,
  requestHasValidSetupBootstrapSecret,
  setupBootstrapConfigured,
  verifySetupBootstrapCookie,
} from "./src/lib/setup-bootstrap-auth";

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
  const setupApiRequest = pathname.startsWith("/api/setup/");
  const setupPageRequest = pathname.startsWith("/setup");
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
    if (setupPageRequest || setupApiRequest) {
      if (!setupApiRequest) {
        return NextResponse.next();
      }

      const bootstrapCookie = request.cookies.get(getSetupBootstrapCookieName())?.value;
      const hasBootstrapAccess =
        isLoopbackHostname(request.nextUrl.hostname) ||
        verifySetupBootstrapCookie(bootstrapCookie) ||
        requestHasValidSetupBootstrapSecret(request.headers);
      if (hasBootstrapAccess) {
        return NextResponse.next();
      }

      const detail = setupBootstrapConfigured()
        ? "Setup is locked. Complete first-run setup from localhost or provide a valid setup bootstrap secret."
        : "Setup is locked. Complete first-run setup from localhost or configure SLM_SETUP_SECRET for remote bootstrap.";
      return NextResponse.json(
        {
          error: detail,
        },
        { status: 403 },
      );
    }

    if (gatewayRequest) {
      return gatewayJsonResponse(503, "Instance setup is incomplete.");
    }

    return NextResponse.redirect(new URL("/setup", request.url), 302);
  }

  if (gatewayRequest && !gatewayApiKeyConfigured()) {
    return gatewayJsonResponse(503, "API gateway is disabled until SLM_API_GATEWAY_KEY is configured.");
  }

  if (!gate.pinEnabled) {
    if (gatewayRequest && !gatewayApiKeyConfigured()) {
      return gatewayJsonResponse(503, "API gateway is disabled until SLM_API_GATEWAY_KEY is configured.");
    }
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
