import { createConvexClient } from "@/lib/convex-server";
import { resolveManagedSecretValue } from "@/lib/managed-secrets-server";
import { api } from "../../../../../../convex/_generated/api";

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
      email?: string;
    };
  };
};

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

export async function GET(request: Request) {
  const url = new URL(request.url);
  const txRef = url.searchParams.get("tx_ref") || undefined;
  const transactionId = url.searchParams.get("transaction_id") || undefined;
  const secretKey = await resolveManagedSecretValue("flutterwave.secretKey");
  let redirectSlug = "";
  let result = "error";
  let message = "";

  try {
    if (!secretKey) {
      throw new Error("We could not verify payment right now.");
    }
    if (!txRef && !transactionId) {
      throw new Error("Missing payment reference.");
    }
    const verified = await verifyFlutterwaveTransaction({ secretKey, transactionId, txRef });
    const recorded = await createConvexClient().mutation(api.storefront.recordOrderPaymentEvent, {
      txRef: verified.tx_ref || txRef,
      transactionId: verified.id ? String(verified.id) : transactionId,
      status: verified.status,
      amount: verified.amount,
      currency: verified.currency,
      customerEmail: verified.customer?.email,
      payloadSummary: JSON.stringify(verified).slice(0, 1800),
    });
    redirectSlug = recorded.storefrontSlug;
    result = recorded.status === "paid" ? "success" : "failed";
  } catch (error) {
    result = "error";
    message = error instanceof Error ? error.message.slice(0, 160) : "Payment verification failed.";
  }

  const redirect = new URL(redirectSlug ? `/shop/${encodeURIComponent(redirectSlug)}` : "/", url.origin);
  redirect.searchParams.set("payment", result);
  if (message) {
    redirect.searchParams.set("message", message);
  }
  return Response.redirect(redirect);
}
