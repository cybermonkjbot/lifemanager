import { NextResponse } from "next/server";
import {
  clearInstancePinCookieOptions,
  getInstancePinCookieName,
} from "@/lib/instance-pin";
import { getInstagramSetupManager } from "@/lib/instagram-setup/session";
import {
  clearTenantSessionCookieOptions,
  getTenantSessionCookieName,
} from "@/lib/tenant-session";
import { requestHasSameOrigin } from "@/lib/secure-cookies";
import { markProvidersDisconnectedFromLocalConnector } from "@/lib/connector-disconnect";
import { getIMessageSetupManager } from "@/lib/imessage-setup/session";
import { getTelegramSetupManager } from "@/lib/telegram-setup/session";
import { getWhatsAppSetupManager } from "@/lib/whatsapp-setup/session";

export const runtime = "nodejs";

type LogoutMode = "lock" | "nuke";

function normalizeLogoutMode(value: FormDataEntryValue | null): LogoutMode {
  return value === "nuke" ? "nuke" : "lock";
}

function clearSessionCookies(response: NextResponse) {
  response.cookies.set(getInstancePinCookieName(), "", clearInstancePinCookieOptions());
  response.cookies.set(getTenantSessionCookieName(), "", clearTenantSessionCookieOptions());
}

async function markConnectedAppsDisconnected() {
  await markProvidersDisconnectedFromLocalConnector(["whatsapp", "instagram", "imessage", "telegram"]);
}

async function disconnectConnectedApps() {
  await Promise.allSettled([
    getWhatsAppSetupManager().resetAuth(),
    getInstagramSetupManager().resetAuth(),
    getIMessageSetupManager().resetAuth(),
    getTelegramSetupManager().resetAuth(),
  ]);
  await markConnectedAppsDisconnected().catch(() => undefined);
}

export async function POST(request: Request) {
  if (!requestHasSameOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }

  const form = await request.formData().catch(() => null);
  const mode = normalizeLogoutMode(form?.get("mode") ?? null);
  if (mode === "nuke") {
    await disconnectConnectedApps();
  }

  const response = NextResponse.redirect(new URL("/unlock", request.url), 303);
  clearSessionCookies(response);
  return response;
}
