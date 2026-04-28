import { getWhatsAppSetupManager } from "../../../../../lib/whatsapp-setup/session";
import { requireRuntimeControlApiAccess } from "../../../../../lib/instance-guard";
import { convexRefs } from "@/lib/convex-refs";
import { createConvexClient } from "@/lib/convex-server";
import { decryptLocalSecret, readLocalInstanceConfig } from "@/lib/instance-config";
import { hashTenantConnectorToken } from "@/lib/tenant-connector-token";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

async function markWhatsAppDisconnected() {
  const connector = await readConnectorTokenHash();
  if (!connector) {
    return;
  }

  await createConvexClient().mutation(convexRefs.connectedAccountsMarkDisconnectedFromConnector, {
    ...connector,
    provider: "whatsapp",
    authState: "disconnected",
    lastSeenAt: Date.now(),
  });
}

export async function POST(request: Request) {
  const unauthorized = await requireRuntimeControlApiAccess(request);
  if (unauthorized) {
    return unauthorized;
  }

  const manager = getWhatsAppSetupManager();
  const state = await manager.resetAuth();
  if (state.status !== "error") {
    await markWhatsAppDisconnected().catch(() => undefined);
  }
  return NextResponse.json(state);
}
