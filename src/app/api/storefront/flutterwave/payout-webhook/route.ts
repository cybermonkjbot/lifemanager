import { createHmac, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { convexRefs } from "@/lib/convex-refs";
import { createConvexClient } from "@/lib/convex-server";
import { getConvexAdminSecret } from "@/lib/managed-secret-crypto";
import { resolveManagedSecretValue } from "@/lib/managed-secrets-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function hasValidFlutterwaveSignature(rawBody: string, secretHash: string, request: NextRequest) {
  const verifHash = request.headers.get("verif-hash") || "";
  if (verifHash && safeEqual(verifHash, secretHash)) {
    return true;
  }
  const signature = request.headers.get("flutterwave-signature") || "";
  if (!signature) {
    return false;
  }
  const expected = createHmac("sha256", secretHash).update(rawBody).digest("hex");
  return safeEqual(signature, expected);
}

function normalizeTransferStatus(value: unknown): "pending" | "processing" | "successful" | "failed" {
  const status = String(value || "").trim().toLowerCase();
  if (status === "successful" || status === "success" || status === "completed") {
    return "successful";
  }
  if (status === "failed" || status === "failure") {
    return "failed";
  }
  if (status === "new" || status === "pending") {
    return "pending";
  }
  return "processing";
}

function stringifyId(value: unknown) {
  if (value === null || value === undefined) {
    return undefined;
  }
  return String(value);
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const expectedHash = await resolveManagedSecretValue("flutterwave.webhookHash");
  if (!expectedHash || !hasValidFlutterwaveSignature(rawBody, expectedHash, request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const payload = JSON.parse(rawBody || "{}") as {
    event?: string;
    data?: {
      id?: string | number;
      reference?: string;
      status?: string;
      complete_message?: string;
    };
  };
  const reference = payload.data?.reference;
  if (!reference) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  await createConvexClient().mutation(convexRefs.storefrontAdminRecordPayoutTransferResult, {
    adminSecret: getConvexAdminSecret(),
    transferReference: reference,
    transferId: stringifyId(payload.data?.id),
    status: normalizeTransferStatus(payload.data?.status),
    failureReason: payload.data?.complete_message,
    providerPayloadSummary: JSON.stringify({
      event: payload.event,
      status: payload.data?.status,
      completeMessage: payload.data?.complete_message,
    }).slice(0, 1000),
  });

  return NextResponse.json({ ok: true });
}
