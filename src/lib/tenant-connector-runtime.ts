import { decryptLocalSecret, readLocalInstanceConfig } from "@/lib/instance-config";
import { convexRefs } from "@/lib/convex-refs";
import { createConvexClient } from "@/lib/convex-server";
import { hashTenantConnectorToken } from "@/lib/tenant-connector-token";

export type ConnectorProvider = "whatsapp" | "instagram" | "imessage" | "telegram";

export type LocalTenantConnectorCredentials = {
  tenantId: string;
  deviceId: string;
  connectorToken: string;
  connectorTokenHash: string;
};

export async function readLocalTenantConnectorCredentials(): Promise<LocalTenantConnectorCredentials | null> {
  const config = await readLocalInstanceConfig();
  if (!config || config.preferences.serviceMode !== "hosted") {
    return null;
  }

  const account = config.account;
  const connectorToken =
    process.env.ODOGWU_CONNECTOR_TOKEN?.trim() ||
    account?.connectorToken.trim() ||
    decryptLocalSecret(
      account?.connectorTokenEncrypted,
      account?.connectorTokenIv,
      account?.connectorTokenTag,
      config.pin?.cookieSecret,
    ).trim();

  if (!account?.tenantId || !account.deviceId || !connectorToken) {
    return null;
  }

  return {
    tenantId: account.tenantId,
    deviceId: account.deviceId,
    connectorToken,
    connectorTokenHash: hashTenantConnectorToken(connectorToken),
  };
}

export function tenantConnectorEnv(
  credentials: LocalTenantConnectorCredentials | null,
): Partial<NodeJS.ProcessEnv> {
  if (!credentials) {
    return {};
  }

  return {
    ODOGWU_SERVICE_MODE: "hosted",
    ODOGWU_TENANT_ID: credentials.tenantId,
    ODOGWU_DEVICE_ID: credentials.deviceId,
    ODOGWU_CONNECTOR_TOKEN: credentials.connectorToken,
  };
}

export async function verifyLocalTenantConnectorAccess(provider: ConnectorProvider) {
  const credentials = await readLocalTenantConnectorCredentials();
  if (!credentials) {
    return true;
  }
  const verified = await createConvexClient()
    .mutation(convexRefs.tenantAccountsVerifyConnectorToken, {
      tokenHash: credentials.connectorTokenHash,
      provider,
    })
    .catch(() => null);
  return Boolean(verified);
}
