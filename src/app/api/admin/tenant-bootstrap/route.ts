import { NextRequest, NextResponse } from "next/server";
import { getAdminSessionFromRequest } from "@/lib/admin-auth";
import { convexRefs } from "@/lib/convex-refs";
import { createConvexClient } from "@/lib/convex-server";
import { createLocalPinRecord } from "@/lib/instance-config";
import { getConvexAdminSecret } from "@/lib/managed-secret-crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIN_PIN_LENGTH = 4;

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function requireString(value: unknown, label: string) {
  const next = typeof value === "string" ? value.trim() : "";
  if (!next) {
    throw new Error(`${label} is required.`);
  }
  return next;
}

export async function POST(request: NextRequest) {
  if (!getAdminSessionFromRequest(request, { requireSameOrigin: true })) {
    return unauthorized();
  }

  try {
    const body = await request.json() as {
      email?: unknown;
      displayName?: unknown;
      pin?: unknown;
      batchSize?: unknown;
    };
    const email = requireString(body.email, "Owner email");
    const displayName = typeof body.displayName === "string" ? body.displayName.trim() : "";
    const pin = requireString(body.pin, "Owner PIN");
    const batchSize = typeof body.batchSize === "number" ? body.batchSize : Number(body.batchSize || 100);

    if (pin.length < MIN_PIN_LENGTH) {
      throw new Error("Owner PIN must be at least 4 characters.");
    }
    if (!Number.isFinite(batchSize)) {
      throw new Error("Batch size must be a number.");
    }

    const pinRecord = createLocalPinRecord(pin);
    const result = await createConvexClient().mutation(convexRefs.tenantAccountsAdminSeedOwnerAndBackfill, {
      adminSecret: getConvexAdminSecret(),
      email,
      displayName,
      pinSalt: pinRecord.salt,
      pinHash: pinRecord.hash,
      pinUpdatedAt: pinRecord.updatedAt,
      batchSize,
    });

    return NextResponse.json({ result });
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error, "Failed to bootstrap tenant.") }, { status: 400 });
  }
}
