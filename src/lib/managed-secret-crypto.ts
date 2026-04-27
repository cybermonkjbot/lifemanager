import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";

const ALGORITHM = "aes-256-gcm";

export type EncryptedManagedSecret = {
  algorithm: typeof ALGORITHM;
  iv: string;
  tag: string;
  encryptedValue: string;
};

function readSecret(name: string) {
  return process.env[name]?.trim() || "";
}

export function getAdminSecret() {
  return readSecret("ODOGWU_ADMIN_SECRET") || readSecret("SLM_ADMIN_SECRET");
}

export function getConvexAdminSecret() {
  return readSecret("ODOGWU_CONVEX_ADMIN_SECRET") || getAdminSecret();
}

export function getManagedSecretsKey() {
  return readSecret("ODOGWU_MANAGED_SECRETS_KEY") || readSecret("SLM_MANAGED_SECRETS_KEY");
}

export function requireAdminSecret() {
  const secret = getAdminSecret();
  if (!secret) {
    throw new Error("Admin secret is not configured.");
  }
  return secret;
}

export function requireManagedSecretsKey() {
  const secret = getManagedSecretsKey();
  if (!secret) {
    throw new Error("Managed secrets encryption key is not configured.");
  }
  return secret;
}

export function secretMatches(provided: string | null | undefined, expected = getAdminSecret()) {
  if (!provided || !expected) {
    return false;
  }
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function deriveKey(secret: string) {
  return createHash("sha256").update(secret).digest();
}

export function encryptManagedSecret(value: string, secret = requireManagedSecretsKey()): EncryptedManagedSecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, deriveKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return {
    algorithm: ALGORITHM,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    encryptedValue: encrypted.toString("base64"),
  };
}

export function decryptManagedSecret(payload: EncryptedManagedSecret, secret = requireManagedSecretsKey()) {
  if (payload.algorithm !== ALGORITHM) {
    throw new Error("Unsupported managed secret encryption algorithm.");
  }
  const decipher = createDecipheriv(ALGORITHM, deriveKey(secret), Buffer.from(payload.iv, "base64"));
  decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(payload.encryptedValue, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export function maskSecretPreview(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  if (trimmed.length <= 8) {
    return "configured";
  }
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
}
