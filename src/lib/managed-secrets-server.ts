import { convexRefs } from "@/lib/convex-refs";
import { createConvexClient } from "@/lib/convex-server";
import { getManagedSecretEnvFallback } from "@/lib/managed-secret-definitions";
import {
  decryptManagedSecret,
  getConvexAdminSecret,
  type EncryptedManagedSecret,
} from "@/lib/managed-secret-crypto";

type StoredSecretPayload = EncryptedManagedSecret & {
  key: string;
};

type ManagedApiStyle = "auto" | "responses" | "chat_completions";

function normalizeManagedApiStyle(value: string): ManagedApiStyle | "" {
  return value === "responses" || value === "chat_completions" || value === "auto" ? value : "";
}

export async function getManagedStoredSecretValue(key: string) {
  const adminSecret = getConvexAdminSecret();
  if (!adminSecret) {
    return "";
  }

  try {
    const client = createConvexClient();
    const stored = (await client.query(convexRefs.adminSecretsGetEncrypted, {
      adminSecret,
      key,
    })) as StoredSecretPayload | null;
    if (!stored) {
      return "";
    }
    return decryptManagedSecret(stored);
  } catch {
    return "";
  }
}

export async function resolveManagedSecretValue(key: string) {
  return (await getManagedStoredSecretValue(key)) || getManagedSecretEnvFallback(key);
}

export async function getManagedAiRuntimeOverrides() {
  const [
    endpoint,
    apiKey,
    model,
    apiStyle,
    imageEndpoint,
    imageApiKey,
    imageModel,
    videoEndpoint,
    videoApiKey,
    videoModel,
  ] = await Promise.all([
    resolveManagedSecretValue("azure.ai.endpoint"),
    resolveManagedSecretValue("azure.ai.apiKey"),
    resolveManagedSecretValue("azure.ai.model"),
    resolveManagedSecretValue("azure.ai.apiStyle"),
    resolveManagedSecretValue("azure.image.endpoint"),
    resolveManagedSecretValue("azure.image.apiKey"),
    resolveManagedSecretValue("azure.image.model"),
    resolveManagedSecretValue("azure.video.endpoint"),
    resolveManagedSecretValue("azure.video.apiKey"),
    resolveManagedSecretValue("azure.video.model"),
  ]);

  const normalizedApiStyle = normalizeManagedApiStyle(apiStyle);

  return {
    ...(endpoint ? { endpoint } : {}),
    ...(apiKey ? { apiKey } : {}),
    ...(model ? { model } : {}),
    ...(normalizedApiStyle ? { apiStyle: normalizedApiStyle } : {}),
    ...(imageEndpoint ? { imageEndpoint } : {}),
    ...(imageApiKey ? { imageApiKey } : {}),
    ...(imageModel ? { imageModel } : {}),
    ...(videoEndpoint ? { videoEndpoint } : {}),
    ...(videoApiKey ? { videoApiKey } : {}),
    ...(videoModel ? { videoModel } : {}),
  };
}
