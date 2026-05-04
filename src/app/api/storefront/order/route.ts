import { createConvexClient } from "@/lib/convex-server";
import { rateLimitJsonResponse } from "@/lib/rate-limit";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type OrderRequestBody = {
  storefrontSlug?: string;
  customerName?: string;
  customerContact?: string;
  customerMessage?: string;
  items?: Array<{
    productId?: string;
    name?: string;
    quantity?: number;
    unitPrice?: number;
    currency?: string;
  }>;
  source?: "hosted_shop" | "embed" | "manual";
};

function publicOrderItems(body: OrderRequestBody) {
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
    scope: "storefront.order",
    identity: request.headers.get("x-forwarded-for") || request.headers.get("user-agent") || "anonymous",
    limit: 12,
    windowMs: 60 * 60 * 1000,
    penaltyMs: 20 * 60 * 1000,
  });
  if (limited) {
    return limited;
  }

  const body = await request.json().catch(() => null) as OrderRequestBody | null;
  if (!body?.storefrontSlug || !Array.isArray(body.items)) {
    return Response.json({ error: "Storefront slug and items are required." }, { status: 400 });
  }
  if (body.items.length === 0 || body.items.some((item) => !item.productId)) {
    return Response.json({ error: "Order requests require a published storefront product." }, { status: 400 });
  }
  const hasContactPath = Boolean(body.customerContact?.trim() || body.customerMessage?.trim());
  if (!hasContactPath) {
    return Response.json({ error: "Add contact details or a message so the business can follow up." }, { status: 400 });
  }

  try {
    const id = await createConvexClient().mutation(api.storefront.createOrderIntent, {
      storefrontSlug: body.storefrontSlug,
      customerName: body.customerName,
      customerContact: body.customerContact,
      customerMessage: body.customerMessage,
      items: publicOrderItems(body),
      source: body.source === "embed" ? "embed" : "hosted_shop",
    });
    return Response.json({ id });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not create order request." },
      { status: 400 },
    );
  }
}
