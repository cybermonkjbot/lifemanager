import { NextRequest, NextResponse } from "next/server";
import { getAdminSessionFromRequest, verifyAdminRequest } from "@/lib/admin-auth";
import { convexRefs } from "@/lib/convex-refs";
import { createConvexClient } from "@/lib/convex-server";
import {
  getManagedSecretDefinition,
  getManagedSecretEnvFallback,
  MANAGED_SECRET_DEFINITIONS,
} from "@/lib/managed-secret-definitions";
import {
  encryptManagedSecret,
  getConvexAdminSecret,
  maskSecretPreview,
  requireManagedSecretsKey,
} from "@/lib/managed-secret-crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KEY_PATTERN = /^[a-zA-Z0-9_.:-]{3,120}$/;

type ManagedSecretRow = {
  key: string;
  valuePreview: string;
  updatedAt: number;
  updatedBy: string;
  envFallbackConfigured?: boolean;
};

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
}

function getAdminIdentity(request: NextRequest) {
  return request.headers.get("x-admin-identity")?.trim().slice(0, 120) || getAdminSessionFromRequest(request)?.email || "admin";
}

function buildStatus(rows: ManagedSecretRow[]) {
  const storedByKey = new Map(rows.map((row) => [row.key, row]));
  return MANAGED_SECRET_DEFINITIONS.map((definition) => {
    const stored = storedByKey.get(definition.key);
    const envValue = getManagedSecretEnvFallback(definition.key);
    const envFallbackConfigured = Boolean(stored?.envFallbackConfigured || envValue);
    return {
      ...definition,
      configuredInConvex: Boolean(stored),
      envFallbackConfigured,
      valuePreview: stored?.valuePreview || (envFallbackConfigured ? "env fallback configured" : ""),
      updatedAt: stored?.updatedAt || null,
      updatedBy: stored?.updatedBy || "",
    };
  });
}

export async function GET(request: NextRequest) {
  try {
    if (!verifyAdminRequest(request)) {
      return unauthorized();
    }

    const client = createConvexClient();
    const rows = (await client.query(convexRefs.adminSecretsList, {
      adminSecret: getConvexAdminSecret(),
    })) as ManagedSecretRow[];

    return NextResponse.json({
      secrets: buildStatus(rows),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load managed secrets.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!verifyAdminRequest(request, { requireSameOrigin: true })) {
      return unauthorized();
    }

    const body = (await request.json()) as {
      key?: unknown;
      value?: unknown;
      clear?: unknown;
    };
    const key = typeof body.key === "string" ? body.key.trim() : "";
    if (!KEY_PATTERN.test(key)) {
      return NextResponse.json({ error: "Invalid managed secret key." }, { status: 400 });
    }
    if (!getManagedSecretDefinition(key)) {
      return NextResponse.json({ error: "Unknown managed secret key." }, { status: 400 });
    }

    const client = createConvexClient();
    if (body.clear === true) {
      await client.mutation(convexRefs.adminSecretsRemove, {
        adminSecret: getConvexAdminSecret(),
        key,
      });
      return NextResponse.json({ ok: true });
    }

    const value = typeof body.value === "string" ? body.value.trim() : "";
    if (!value) {
      return NextResponse.json({ error: "Secret value is required." }, { status: 400 });
    }
    if (value.length > 8000) {
      return NextResponse.json({ error: "Secret value is too long." }, { status: 400 });
    }

    const encrypted = encryptManagedSecret(value, requireManagedSecretsKey());
    const definition = getManagedSecretDefinition(key);
    await client.mutation(convexRefs.adminSecretsUpsert, {
      adminSecret: getConvexAdminSecret(),
      key,
      ...encrypted,
      valuePreview: definition?.secret ? maskSecretPreview(value) : value.slice(0, 120),
      updatedBy: getAdminIdentity(request),
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save managed secret.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
