import { createHash } from "node:crypto";
import { convexRefs } from "@/lib/convex-refs";
import { createConvexClient } from "@/lib/convex-server";

export function hashTenantConnectorToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function verifyTenantConnectorToken(
  token: string,
  provider?: "whatsapp" | "instagram" | "imessage" | "telegram",
) {
  const normalized = token.trim();
  if (!normalized) {
    return null;
  }
  return await createConvexClient().mutation(convexRefs.tenantAccountsVerifyConnectorToken, {
    tokenHash: hashTenantConnectorToken(normalized),
    ...(provider ? { provider } : {}),
  });
}
