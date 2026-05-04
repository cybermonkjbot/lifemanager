import { PublicShop } from "@/components/public-shop";
import type { PublicProduct, PublicProfile } from "@/components/public-shop";
import { createConvexClient } from "@/lib/convex-server";
import { api } from "../../../../convex/_generated/api";

export const dynamic = "force-dynamic";

export default async function ShopPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ product?: string; payment?: string; message?: string }>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  let storefront: { profile: PublicProfile; products: PublicProduct[] } | null = null;
  try {
    storefront = await createConvexClient().query(api.storefront.getPublicStorefront, { slug });
  } catch {
    storefront = null;
  }

  if (storefront) {
    return (
      <PublicShop
        profile={storefront.profile}
        products={storefront.products}
        initialProductSlug={query.product}
        paymentResult={query.payment}
        paymentMessage={query.message}
      />
    );
  }

  const brand =
    slug
      .split("-")
      .filter(Boolean)
      .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
      .join(" ") || "Storefront";

  return (
    <main className="public-shop-shell">
      <section className="public-shop-hero">
        <p className="queue-meta">Chat-aided storefront</p>
        <h1>{brand}</h1>
        <p>
          This storefront is not published yet.
        </p>
        <div className="public-shop-actions">
          <a className="btn btn-ghost" href="/storefront">
            Manage storefront
          </a>
        </div>
      </section>
      <section className="public-shop-grid" aria-label="Storefront support">
        <article>
          <span>01</span>
          <h2>Find the right fit</h2>
          <p>Customers can ask questions before they buy.</p>
        </article>
        <article>
          <span>02</span>
          <h2>Confirm next steps</h2>
          <p>OdogwuHQ helps collect the details needed to complete an order.</p>
        </article>
        <article>
          <span>03</span>
          <h2>Return to inbox</h2>
          <p>Livechat stays connected to the tenant conversation workflow.</p>
        </article>
      </section>
    </main>
  );
}
