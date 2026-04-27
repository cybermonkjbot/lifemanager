import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { convexRefs } from "./convex-refs";
import { createConvexClient } from "./convex-server";
import { readLocalInstanceConfig } from "./instance-config";
import { matchesInstancePin } from "./instance-pin";
import { getConvexAdminSecret } from "./managed-secret-crypto";

const MIN_ADMIN_PIN_LENGTH = 4;

type AdminCredential = {
  email: string;
  emailNormalized: string;
  pinSalt: string;
  pinHash: string;
  canMasqueradeTenants: boolean;
  createdAt: number;
  updatedAt: number;
  createdBy?: string;
};

export type PublicAdminUser = {
  email: string;
  source: "convex" | "bootstrap";
  canMasqueradeTenants: boolean;
  createdAt: number | null;
  updatedAt: number | null;
  createdBy?: string;
};

function normalizePin(value: string | undefined | null) {
  return (value || "").trim();
}

export function normalizeAdminEmail(value: string | undefined | null) {
  return (value || "").trim().toLowerCase();
}

export function isValidAdminEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function hashPin(pin: string, salt: string) {
  return scryptSync(pin, salt, 64).toString("hex");
}

function createPinHash(pin: string) {
  const salt = randomBytes(16).toString("hex");
  return {
    pinSalt: salt,
    pinHash: hashPin(normalizePin(pin), salt),
  };
}

function verifyPin(pin: string, salt: string, hash: string) {
  try {
    const expected = Buffer.from(hash, "hex");
    const actual = Buffer.from(hashPin(normalizePin(pin), salt), "hex");
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function getOptionalAdminSecretForConvex() {
  return getConvexAdminSecret() || null;
}

function requireAdminSecretForConvex() {
  const adminSecret = getOptionalAdminSecretForConvex();
  if (!adminSecret) {
    throw new Error("Convex admin backend secret is not configured.");
  }
  return adminSecret;
}

async function hasConfiguredConvexAdmins(adminSecret: string) {
  return await createConvexClient().query(convexRefs.adminUsersHasAny, {
    adminSecret,
  });
}

async function resolveBootstrapAdmin(emailNormalized: string): Promise<PublicAdminUser | null> {
  const config = await readLocalInstanceConfig();
  const ownerEmail = normalizeAdminEmail(config?.account?.email);
  if (!ownerEmail || ownerEmail !== emailNormalized) {
    return null;
  }
  return {
    email: config?.account?.email || ownerEmail,
    source: "bootstrap",
    canMasqueradeTenants: true,
    createdAt: config?.createdAt ?? null,
    updatedAt: config?.updatedAt ?? null,
  };
}

export async function listAdminUsers(): Promise<PublicAdminUser[]> {
  const adminSecret = getOptionalAdminSecretForConvex();
  const rows = adminSecret
    ? (await createConvexClient().query(convexRefs.adminUsersList, {
        adminSecret,
        limit: 200,
      })) as Array<{
        email: string;
        canMasqueradeTenants: boolean;
        createdAt: number;
        updatedAt: number;
        createdBy?: string;
      }>
    : [];

  if (rows.length > 0) {
    return rows.map((admin) => ({
      email: admin.email,
      source: "convex",
      canMasqueradeTenants: admin.canMasqueradeTenants === true,
      createdAt: admin.createdAt,
      updatedAt: admin.updatedAt,
      createdBy: admin.createdBy,
    }));
  }

  const config = await readLocalInstanceConfig();
  const ownerEmail = normalizeAdminEmail(config?.account?.email);
  if (!ownerEmail) {
    return [];
  }
  return [{
    email: config?.account?.email || ownerEmail,
    source: "bootstrap",
    canMasqueradeTenants: true,
    createdAt: config?.createdAt ?? null,
    updatedAt: config?.updatedAt ?? null,
  }];
}

export async function verifyAdminCredentials(email: string, pin: string) {
  const emailNormalized = normalizeAdminEmail(email);
  const normalizedPin = normalizePin(pin);
  if (!isValidAdminEmail(emailNormalized) || normalizedPin.length < MIN_ADMIN_PIN_LENGTH) {
    return null;
  }

  const adminSecret = getOptionalAdminSecretForConvex();
  let hasConvexAdmins = false;
  if (adminSecret) {
    const credential = (await createConvexClient().query(convexRefs.adminUsersGetCredential, {
      adminSecret,
      email: emailNormalized,
    })) as AdminCredential | null;
    if (credential && verifyPin(normalizedPin, credential.pinSalt, credential.pinHash)) {
      return {
        email: credential.email,
        emailNormalized,
        canMasqueradeTenants: credential.canMasqueradeTenants === true,
        source: "convex" as const,
      };
    }
    hasConvexAdmins = await hasConfiguredConvexAdmins(adminSecret);
  }

  if (!hasConvexAdmins) {
    const bootstrapAdmin = await resolveBootstrapAdmin(emailNormalized);
    if (bootstrapAdmin && await matchesInstancePin(normalizedPin)) {
      return {
        email: bootstrapAdmin.email,
        emailNormalized,
        canMasqueradeTenants: true,
        source: "bootstrap" as const,
      };
    }
  }

  return null;
}

export async function upsertAdminUser(args: { email: string; pin: string; createdBy: string; canMasqueradeTenants?: boolean }) {
  const emailNormalized = normalizeAdminEmail(args.email);
  const pin = normalizePin(args.pin);
  if (!isValidAdminEmail(emailNormalized)) {
    throw new Error("Enter a valid admin email.");
  }
  if (pin.length < MIN_ADMIN_PIN_LENGTH) {
    throw new Error("Admin PIN must be at least 4 characters.");
  }

  const hashed = createPinHash(pin);
  const admin = (await createConvexClient().mutation(convexRefs.adminUsersUpsert, {
    adminSecret: requireAdminSecretForConvex(),
    email: args.email.trim(),
    ...hashed,
    canMasqueradeTenants: args.canMasqueradeTenants === true,
    createdBy: normalizeAdminEmail(args.createdBy),
  })) as {
    email: string;
    canMasqueradeTenants: boolean;
    createdAt: number;
    updatedAt: number;
    createdBy?: string;
  };
  return {
    email: admin.email,
    source: "convex" as const,
    canMasqueradeTenants: admin.canMasqueradeTenants === true,
    createdAt: admin.createdAt,
    updatedAt: admin.updatedAt,
    createdBy: admin.createdBy,
  };
}

export async function removeAdminUser(email: string, currentAdminEmail: string) {
  await createConvexClient().mutation(convexRefs.adminUsersRemove, {
    adminSecret: requireAdminSecretForConvex(),
    email,
    currentAdminEmail,
  });
}

export async function getAdminCapabilities(email: string) {
  const emailNormalized = normalizeAdminEmail(email);
  const capabilities = (await createConvexClient().query(convexRefs.adminUsersGetCapabilities, {
    adminSecret: requireAdminSecretForConvex(),
    email: emailNormalized,
  })) as {
    email: string;
    emailNormalized: string;
    canMasqueradeTenants: boolean;
  } | null;
  return capabilities;
}

export async function adminCanMasqueradeTenants(email: string) {
  const capabilities = await getAdminCapabilities(email);
  return capabilities?.canMasqueradeTenants === true;
}
