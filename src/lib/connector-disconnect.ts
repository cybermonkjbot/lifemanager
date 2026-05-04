import { convexRefs } from "@/lib/convex-refs";
import { createConvexClient } from "@/lib/convex-server";
import { decryptLocalSecret, readLocalInstanceConfig } from "@/lib/instance-config";
import { hashTenantConnectorToken } from "@/lib/tenant-connector-token";
import type { ConnectorProvider } from "@/lib/tenant-connector-runtime";

async function readConnectorTokenHash() {
  const config = await readLocalInstanceConfig();
  const account = config?.account;
  const rawToken =
    process.env.ODOGWU_CONNECTOR_TOKEN?.trim() ||
    account?.connectorToken?.trim() ||
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

export async function markProviderDisconnectedFromLocalConnector(provider: ConnectorProvider) {
  const connector = await readConnectorTokenHash();
  if (!connector) {
    return;
  }

  await createConvexClient().mutation(convexRefs.connectedAccountsMarkDisconnectedFromConnector, {
    ...connector,
    provider,
    authState: "disconnected",
    lastSeenAt: Date.now(),
  });
}

export async function markProvidersDisconnectedFromLocalConnector(providers: ConnectorProvider[]) {
  await Promise.allSettled(providers.map((provider) => markProviderDisconnectedFromLocalConnector(provider)));
}
