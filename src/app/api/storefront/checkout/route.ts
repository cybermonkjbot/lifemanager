import { createConvexClient } from "@/lib/convex-server";
import { resolveManagedSecretValue } from "@/lib/managed-secrets-server";
import { rateLimitJsonResponse } from "@/lib/rate-limit";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CheckoutRequestBody = {
  storefrontSlug?: string;
  customerName?: string;
  customerContact?: string;
  customerEmail?: string;
  customerMessage?: string;
  items?: Array<{
    productId?: string;
    name?: string;
    quantity?: number;
    unitPrice?: number;
    currency?: string;
  }>;
};

function cleanBaseUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return withProtocol.replace(/\/+$/, "");
}

function readEmail(body: CheckoutRequestBody) {
  const raw = (body.customerEmail || body.customerContact || "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw) ? raw : "";
}

function checkoutItems(body: CheckoutRequestBody) {
  return (body.items || []).slice(0, 5).map((item) => ({
    productId: item.productId as Id<"storefrontProducts">,
    name: item.name || "",
    quantity: item.quantity || 1,
    unitPrice: item.unitPrice || 0,
    currency: item.currency || "NGN",
  }));
}

export async function POST(request: Request) {
  const limited = await rateLimitJsonResponse(request, {
    scope: "storefront.checkout",
    identity: request.headers.get("x-forwarded-for") || request.headers.get("user-agent") || "anonymous",
    limit: 8,
    windowMs: 60 * 60 * 1000,
    penaltyMs: 20 * 60 * 1000,
  });
  if (limited) {
    return limited;
  }

  const body = await request.json().catch(() => null) as CheckoutRequestBody | null;
  if (!body?.storefrontSlug || !Array.isArray(body.items)) {
    return Response.json({ error: "Storefront slug and items are required." }, { status: 400 });
  }
  if (body.items.length === 0 || body.items.some((item) => !item.productId)) {
    return Response.json({ error: "Checkout requires a published storefront product." }, { status: 400 });
  }
  const email = readEmail(body);
  if (!email) {
    return Response.json({ error: "Add an email address so payment can be verified and receipted." }, { status: 400 });
  }

  try {
    const secretKey = await resolveManagedSecretValue("flutterwave.secretKey");
    if (!secretKey) {
      throw new Error("Checkout is not available right now.");
    }

    const convex = createConvexClient();
    const orderIntentId = await convex.mutation(api.storefront.createOrderIntent, {
      storefrontSlug: body.storefrontSlug,
      customerName: body.customerName,
      customerContact: body.customerContact || email,
      customerMessage: body.customerMessage,
      items: checkoutItems(body),
      source: "hosted_shop",
    });
    const txRef = `store_${orderIntentId}_${Date.now()}`;
    const prepared = await convex.mutation(api.storefront.prepareOrderCheckout, {
      orderIntentId,
      txRef,
    });

    const baseUrl =
      cleanBaseUrl(await resolveManagedSecretValue("billing.redirectBaseUrl")) ||
      cleanBaseUrl(process.env.NEXT_PUBLIC_APP_URL || "") ||
      new URL(request.url).origin;
    const redirectUrl = `${baseUrl}/api/storefront/flutterwave/callback?tx_ref=${encodeURIComponent(txRef)}`;

    const response = await fetch("https://api.flutterwave.com/v3/payments", {
      method: "POST",
      headers: {
        authorization: `Bearer ${secretKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        tx_ref: txRef,
        amount: prepared.amount,
        currency: prepared.currency,
        redirect_url: redirectUrl,
        customer: {
          email,
          name: body.customerName || prepared.customerName || email,
        },
        meta: {
          orderIntentId,
          tenantId: "tenantId" in prepared ? prepared.tenantId : undefined,
          storefrontSlug: prepared.storefrontSlug,
          kind: "storefront_order",
        },
        customizations: {
          title: prepared.displayName,
          description: prepared.description || "Storefront order",
        },
      }),
    });
    const payload = await response.json().catch(() => ({})) as { data?: { link?: string }; message?: string };
    if (!response.ok || !payload.data?.link) {
      throw new Error(payload.message || `Flutterwave checkout failed (${response.status}).`);
    }

    await convex.mutation(api.storefront.attachOrderCheckoutLink, {
      orderIntentId,
      txRef,
      paymentLink: payload.data.link,
    });

    return Response.json({ orderIntentId, txRef, paymentLink: payload.data.link });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to start checkout." },
      { status: 400 },
    );
  }
}
