import { NextRequest, NextResponse } from "next/server";
import { convexRefs } from "@/lib/convex-refs";
import { createConvexClient } from "@/lib/convex-server";
import { resolveManagedSecretValue } from "@/lib/managed-secrets-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type FlutterwaveVerifyResponse = {
  status?: string;
  message?: string;
  data?: {
    id?: number;
    tx_ref?: string;
    status?: string;
    amount?: number;
    currency?: string;
    charged_at?: string;
    customer?: {
      id?: string | number;
      email?: string;
    };
    subscription_id?: string | number;
    payment_plan?: string | number;
    next_payment_date?: string;
    expires_at?: string;
  };
};

function toTimestamp(value?: string) {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

async function verifyFlutterwaveTransaction(args: { secretKey: string; transactionId?: string; txRef?: string }) {
  const url = args.transactionId
    ? `https://api.flutterwave.com/v3/transactions/${encodeURIComponent(args.transactionId)}/verify`
    : `https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=${encodeURIComponent(args.txRef || "")}`;
  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${args.secretKey}`,
    },
  });
  const payload = await response.json().catch(() => ({})) as FlutterwaveVerifyResponse;
  if (!response.ok || payload.status !== "success" || !payload.data) {
    throw new Error(payload.message || `Flutterwave verification failed (${response.status}).`);
  }
  return payload.data;
}

export async function GET(request: NextRequest) {
  const secretKey = await resolveManagedSecretValue("flutterwave.secretKey");
  const redirect = new URL("/system", request.url);
  try {
    if (!secretKey) {
      throw new Error("We couldn't verify the payment right now. Contact support and we'll help you finish setup.");
    }
    const txRef = request.nextUrl.searchParams.get("tx_ref") || undefined;
    const transactionId = request.nextUrl.searchParams.get("transaction_id") || undefined;
    const verified = await verifyFlutterwaveTransaction({ secretKey, transactionId, txRef });
    await createConvexClient().mutation(convexRefs.billingRecordFlutterwaveEvent, {
      eventType: "checkout.callback",
      txRef: verified.tx_ref || txRef,
      transactionId: verified.id ? String(verified.id) : transactionId,
      status: verified.status,
      amount: verified.amount,
      currency: verified.currency,
      customerEmail: verified.customer?.email,
      flutterwaveCustomerId: verified.customer?.id ? String(verified.customer.id) : undefined,
      flutterwaveSubscriptionId: verified.subscription_id ? String(verified.subscription_id) : undefined,
      flutterwavePaymentPlanId: verified.payment_plan ? String(verified.payment_plan) : undefined,
      chargedAt: toTimestamp(verified.charged_at),
      currentPeriodEndsAt: toTimestamp(verified.next_payment_date || verified.expires_at),
      payloadSummary: JSON.stringify(verified).slice(0, 1800),
    });
    redirect.searchParams.set("billing", verified.status === "successful" ? "success" : "pending");
  } catch (error) {
    redirect.searchParams.set("billing", "error");
    redirect.searchParams.set("message", error instanceof Error ? error.message.slice(0, 160) : "Payment verification failed.");
  }
  return NextResponse.redirect(redirect);
}
