import { createHmac, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { convexRefs } from "@/lib/convex-refs";
import { createConvexClient } from "@/lib/convex-server";
import { resolveManagedSecretValue } from "@/lib/managed-secrets-server";
import { rateLimitJsonResponse } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_WEBHOOK_BODY_BYTES = 256 * 1024;

type FlutterwaveWebhook = {
  event?: string;
  id?: string | number;
  data?: Record<string, unknown> & {
    id?: string | number;
    tx_ref?: string;
    status?: string;
    amount?: number;
    currency?: string;
    charged_at?: string;
    next_payment_date?: string;
    expires_at?: string;
    customer?: {
      id?: string | number;
      email?: string;
    };
    subscription_id?: string | number;
    subscription?: {
      id?: string | number;
      status?: string;
    };
    payment_plan?: string | number | {
      id?: string | number;
    };
  };
};

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
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

function toTimestamp(value: unknown) {
  const parsed = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

function stringifyId(value: unknown) {
  return value === undefined || value === null || value === "" ? undefined : String(value);
}

function paymentPlanId(value: unknown) {
  if (typeof value === "object" && value && "id" in value) {
    return stringifyId((value as { id?: unknown }).id);
  }
  return stringifyId(value);
}

export async function POST(request: NextRequest) {
  try {
    const limited = await rateLimitJsonResponse(request, {
      scope: "billing.flutterwave_webhook",
      identity: "flutterwave",
      limit: 120,
      windowMs: 60 * 1000,
      penaltyMs: 60 * 1000,
    });
    if (limited) {
      return limited;
    }
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_WEBHOOK_BODY_BYTES) {
      return NextResponse.json({ error: "Webhook body is too large." }, { status: 413 });
    }
    const expectedHash = await resolveManagedSecretValue("flutterwave.webhookHash");
    if (!expectedHash) {
      return NextResponse.json({ error: "Flutterwave webhook hash is not configured." }, { status: 500 });
    }
    const rawBody = await request.text();
    if (Buffer.byteLength(rawBody, "utf8") > MAX_WEBHOOK_BODY_BYTES) {
      return NextResponse.json({ error: "Webhook body is too large." }, { status: 413 });
    }
    if (!hasValidFlutterwaveSignature(rawBody, expectedHash, request)) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const payload = JSON.parse(rawBody) as FlutterwaveWebhook;
    const data = payload.data || {};
    await createConvexClient().mutation(convexRefs.billingRecordFlutterwaveEvent, {
      eventType: payload.event || "flutterwave.webhook",
      providerEventId: stringifyId(payload.id || data.id),
      txRef: stringifyId(data.tx_ref),
      transactionId: stringifyId(data.id),
      status: stringifyId(data.subscription?.status || data.status),
      amount: typeof data.amount === "number" ? data.amount : undefined,
      currency: typeof data.currency === "string" ? data.currency : undefined,
      customerEmail: typeof data.customer?.email === "string" ? data.customer.email : undefined,
      flutterwaveCustomerId: stringifyId(data.customer?.id),
      flutterwaveSubscriptionId: stringifyId(data.subscription_id || data.subscription?.id),
      flutterwavePaymentPlanId: paymentPlanId(data.payment_plan),
      chargedAt: toTimestamp(data.charged_at),
      currentPeriodEndsAt: toTimestamp(data.next_payment_date || data.expires_at),
      payloadSummary: JSON.stringify(payload).slice(0, 1800),
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Webhook handling failed." }, { status: 500 });
  }
}
