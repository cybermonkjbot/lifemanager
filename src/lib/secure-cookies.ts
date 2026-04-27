import type { NextRequest } from "next/server";
import { isElectronEnvironment } from "./runtime-env";

export function shouldUseSecureCookies() {
  if (process.env.ODOGWU_ALLOW_INSECURE_COOKIES === "1") {
    return false;
  }
  if (process.env.ODOGWU_DESKTOP === "1" || process.env.NEXT_PUBLIC_ODOGWU_DESKTOP === "1") {
    return false;
  }
  return process.env.NODE_ENV === "production";
}

export function secureSessionCookieBase() {
  return {
    httpOnly: true,
    sameSite: "strict" as const,
    secure: shouldUseSecureCookies(),
    path: "/",
  };
}

export function requestHasSameOrigin(request: Request | NextRequest) {
  const requestUrl = new URL(request.url);
  const origin = request.headers.get("origin");
  if (origin) {
    return origin === requestUrl.origin || requestHasEquivalentDesktopLoopbackOrigin(requestUrl, origin);
  }

  const referer = request.headers.get("referer");
  if (!referer) {
    return false;
  }

  try {
    const refererUrl = new URL(referer);
    return refererUrl.origin === requestUrl.origin || requestHasEquivalentDesktopLoopbackOrigin(requestUrl, refererUrl.origin);
  } catch {
    return false;
  }
}

function requestHasEquivalentDesktopLoopbackOrigin(requestUrl: URL, candidateOrigin: string) {
  if (!isElectronEnvironment()) {
    return false;
  }

  try {
    const candidateUrl = new URL(candidateOrigin);
    return (
      requestUrl.protocol === candidateUrl.protocol &&
      requestUrl.port === candidateUrl.port &&
      isDesktopLoopbackHost(requestUrl.hostname) &&
      isDesktopLoopbackHost(candidateUrl.hostname)
    );
  } catch {
    return false;
  }
}

function isDesktopLoopbackHost(hostname: string) {
  const normalized = hostname.toLowerCase();
  return normalized === "127.0.0.1" || normalized === "localhost" || normalized === "::1" || normalized === "[::1]";
}
