import { createHash, createPrivateKey, createPublicKey, createSign, generateKeyPairSync, type KeyObject } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Id } from "../../convex/_generated/dataModel";
import { getRuntimeDataPath } from "./runtime/paths";

const AUTH_PRIVATE_KEY_PATH = getRuntimeDataPath("convex-auth-private-key.pem");
const DEFAULT_AUDIENCE = "odogwu-hq";
const TOKEN_TTL_SECONDS = 5 * 60;

export type ConvexAuthIdentity = {
  tenantId?: string | null;
  deviceId?: string | null;
  email?: string | null;
  role?: "owner" | "admin" | "member";
  isSuperAdmin?: boolean;
  subject?: string | null;
};

function base64UrlJson(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function readConfiguredPrivateKey() {
  const encoded = process.env.ODOGWU_CONVEX_AUTH_PRIVATE_KEY_B64;
  if (encoded?.trim()) {
    return Buffer.from(encoded.trim(), "base64").toString("utf8");
  }

  const raw = process.env.ODOGWU_CONVEX_AUTH_PRIVATE_KEY;
  if (raw?.trim()) {
    return raw.includes("\\n") ? raw.replace(/\\n/g, "\n") : raw;
  }

  return "";
}

function getOrCreatePrivateKeyPem() {
  const configured = readConfiguredPrivateKey();
  if (configured) {
    return configured;
  }

  try {
    const existing = readFileSync(AUTH_PRIVATE_KEY_PATH, "utf8").trim();
    if (existing) {
      return existing;
    }
  } catch {
    // Fall through and create a local development key.
  }

  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  mkdirSync(dirname(AUTH_PRIVATE_KEY_PATH), { recursive: true });
  writeFileSync(AUTH_PRIVATE_KEY_PATH, `${privateKey}\n`, { encoding: "utf8", mode: 0o600 });
  return privateKey;
}

function getPrivateKey() {
  return createPrivateKey(getOrCreatePrivateKeyPem());
}

function publicJwkFromPrivateKey(privateKey: KeyObject) {
  const publicKey = createPublicKey(privateKey);
  const jwk = publicKey.export({ format: "jwk" }) as JsonWebKey;
  const thumbprint = createHash("sha256")
    .update(JSON.stringify({ e: jwk.e, kty: jwk.kty, n: jwk.n }))
    .digest("base64url");
  return {
    ...jwk,
    kid: thumbprint,
    use: "sig",
    alg: "RS256",
  };
}

export function getConvexAuthAudience() {
  return process.env.ODOGWU_CONVEX_AUTH_AUDIENCE || DEFAULT_AUDIENCE;
}

export function getConvexAuthIssuer(origin?: string) {
  return (
    process.env.ODOGWU_CONVEX_AUTH_ISSUER ||
    process.env.NEXT_PUBLIC_ODOGWU_APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    origin ||
    "http://localhost:3000"
  ).replace(/\/+$/, "");
}

export function getConvexAuthJwks() {
  const privateKey = getPrivateKey();
  return {
    keys: [publicJwkFromPrivateKey(privateKey)],
  };
}

export function buildConvexAuthToken(identity: ConvexAuthIdentity, options: { issuer: string; now?: number }) {
  const nowSeconds = Math.floor((options.now ?? Date.now()) / 1000);
  const privateKey = getPrivateKey();
  const jwk = publicJwkFromPrivateKey(privateKey);
  const tenantId = (identity.tenantId || "").trim();
  const email = (identity.email || "").trim().toLowerCase();
  const subject = (identity.subject || email || tenantId || "local").trim();
  const payload = {
    iss: options.issuer,
    sub: subject,
    aud: getConvexAuthAudience(),
    iat: nowSeconds,
    exp: nowSeconds + TOKEN_TTL_SECONDS,
    ...(email ? { email, name: email } : {}),
    ...(tenantId ? { tenantId: tenantId as Id<"tenantAccounts"> } : {}),
    ...(identity.deviceId ? { deviceId: identity.deviceId } : {}),
    ...(identity.role ? { role: identity.role } : {}),
    ...(identity.isSuperAdmin ? { isSuperAdmin: true } : {}),
  };
  const header = {
    alg: "RS256",
    typ: "JWT",
    kid: jwk.kid,
  };
  const signingInput = `${base64UrlJson(header)}.${base64UrlJson(payload)}`;
  const signature = createSign("RSA-SHA256").update(signingInput).end().sign(privateKey, "base64url");
  return `${signingInput}.${signature}`;
}
