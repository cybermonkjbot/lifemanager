import { hashTenantConnectorToken } from "@/lib/tenant-connector-token";
import { NextResponse } from "next/server";
import {
  clearInstancePinCookieOptions,
  getInstancePinCookieName,
} from "@/lib/instance-pin";
import { getInstagramSetupManager } from "@/lib/instagram-setup/session";
import { convexRefs } from "@/lib/convex-refs";
import { createConvexClient } from "@/lib/convex-server";
import { decryptLocalSecret, readLocalInstanceConfig } from "@/lib/instance-config";
import {
  clearTenantSessionCookieOptions,
  getTenantSessionCookieName,
} from "@/lib/tenant-session";
import { requestHasSameOrigin } from "@/lib/secure-cookies";
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

async function readConnectorTokenHash() {
  const config = await readLocalInstanceConfig();
  const account = config?.account;
  const rawToken =
    process.env.ODOGWU_CONNECTOR_TOKEN?.trim() ||
    account?.connectorToken.trim() ||
    decryptLocalSecret(
      account?.connectorTokenEncrypted,
      account?.connectorTokenIv,
      account?.connectorTokenTag,
      config?.pin?.cookieSecret,
    ).trim();

  if (!config?.account?.tenantId || !config.account.deviceId || !rawToken) {
    return null;
  }

  return {
    tenantId: config.account.tenantId,
    deviceId: config.account.deviceId,
    connectorTokenHash: hashTenantConnectorToken(rawToken),
  };
}

async function markConnectedAppsDisconnected() {
  const connector = await readConnectorTokenHash();
  if (!connector) {
    return;
  }

  const client = createConvexClient();
  await Promise.allSettled(
    (["whatsapp", "instagram"] as const).map((provider) =>
      client.mutation(convexRefs.connectedAccountsMarkDisconnectedFromConnector, {
        ...connector,
        provider,
        authState: "disconnected",
        lastSeenAt: Date.now(),
      }),
    ),
  );
}

async function disconnectConnectedApps() {
  await Promise.allSettled([
    getWhatsAppSetupManager().resetAuth(),
    getInstagramSetupManager().resetAuth(),
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
