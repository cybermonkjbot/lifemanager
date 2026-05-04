import { createConvexClient } from "@/lib/convex-server";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";

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

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as OrderRequestBody | null;
  if (!body?.storefrontSlug || !Array.isArray(body.items)) {
    return Response.json({ error: "Storefront slug and items are required." }, { status: 400 });
  }

  try {
    const id = await createConvexClient().mutation(api.storefront.createOrderIntent, {
      storefrontSlug: body.storefrontSlug,
      customerName: body.customerName,
      customerContact: body.customerContact,
      customerMessage: body.customerMessage,
      items: body.items.map((item) => ({
        ...(item.productId ? { productId: item.productId as Id<"storefrontProducts"> } : {}),
        name: item.name || "",
        quantity: item.quantity || 1,
        unitPrice: item.unitPrice || 0,
        currency: item.currency || "NGN",
      })),
      source: body.source || "hosted_shop",
    });
    return Response.json({ id });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not create order request." },
      { status: 400 },
    );
  }
}
