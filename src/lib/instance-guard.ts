import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import {
  getInstancePinCookieName,
  isInstancePinEnabled,
  normalizeInstanceNextPath,
  verifyInstancePinSessionToken,
} from "./instance-pin";

type UnauthorizedResponseKind = "json" | "redirect";

function readCookieValue(rawCookieHeader: string | null, cookieName: string) {
  if (!rawCookieHeader) {
    return undefined;
  }

  for (const part of rawCookieHeader.split(";")) {
    const [name, ...valueParts] = part.trim().split("=");
    if (name === cookieName) {
      return valueParts.join("=");
    }
  }

  return undefined;
}

function buildUnlockUrl(request: Request) {
  const requestUrl = new URL(request.url);
  const nextPath = normalizeInstanceNextPath(`${requestUrl.pathname}${requestUrl.search}`);
  const unlockUrl = new URL("/unlock", request.url);
  if (nextPath !== "/") {
    unlockUrl.searchParams.set("next", nextPath);
  }
  return unlockUrl;
}

async function hasValidInstanceSession(token: string | undefined) {
  if (!(await isInstancePinEnabled())) {
    return true;
  }

  return await verifyInstancePinSessionToken(token);
}

export async function requireInstancePageAccess() {
  const cookieStore = await cookies();
  const token = cookieStore.get(getInstancePinCookieName())?.value;

  if (await hasValidInstanceSession(token)) {
    return;
  }

  redirect("/unlock");
}

export async function requireInstanceApiAccess(
  request: Request,
  kind: UnauthorizedResponseKind = "json",
) {
  const token = readCookieValue(request.headers.get("cookie"), getInstancePinCookieName());

  if (await hasValidInstanceSession(token)) {
    return null;
  }

  const unlockUrl = buildUnlockUrl(request);
  if (kind === "redirect") {
    return NextResponse.redirect(unlockUrl, 303);
  }

  return NextResponse.json(
    {
      error: "Instance PIN required.",
      redirectPath: `${unlockUrl.pathname}${unlockUrl.search}`,
    },
    { status: 401 },
  );
}
