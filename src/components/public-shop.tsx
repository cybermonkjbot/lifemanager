"use client";

import type { Id } from "../../convex/_generated/dataModel";
import { useMemo, useState, type FormEvent } from "react";

export type PublicProduct = {
  _id: Id<"storefrontProducts">;
  slug: string;
  name: string;
  description: string;
  price: number;
  currency: string;
  stockStatus: "in_stock" | "limited" | "preorder" | "sold_out";
  imageUrl?: string;
  tags: string[];
};

export type PublicProfile = {
  slug: string;
  displayName: string;
  offerSummary: string;
  liveChatEnabled: boolean;
  liveChatWelcomeMessage: string;
  checkoutEnabled: boolean;
};

type PublicShopProps = {
  profile: PublicProfile;
  products: PublicProduct[];
  initialProductSlug?: string;
  paymentResult?: string;
  paymentMessage?: string;
};

function formatMoney(value: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: value % 1 === 0 ? 0 : 2,
    }).format(value);
  } catch {
    return `${currency} ${value.toLocaleString()}`;
  }
}

export function PublicShop({ profile, products, initialProductSlug, paymentResult, paymentMessage }: PublicShopProps) {
  const initialProduct = products.find((product) => product.slug === initialProductSlug) || products[0];
  const [selectedId, setSelectedId] = useState<Id<"storefrontProducts"> | "">(initialProduct?._id || "");
  const [customerName, setCustomerName] = useState("");
  const [customerContact, setCustomerContact] = useState("");
  const [customerMessage, setCustomerMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [checkoutPending, setCheckoutPending] = useState(false);
  const [notice, setNotice] = useState("");
  const selectedProduct = useMemo(
    () => products.find((product) => product._id === selectedId) || products[0],
    [products, selectedId],
  );

  const submitOrder = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedProduct) {
      return;
    }
    setPending(true);
    setNotice("");
    try {
      const response = await fetch("/api/storefront/order", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          storefrontSlug: profile.slug,
          customerName: customerName || undefined,
          customerContact: customerContact || undefined,
          customerMessage: customerMessage || undefined,
          items: [
            {
              productId: selectedProduct._id,
              name: selectedProduct.name,
              quantity: 1,
              unitPrice: selectedProduct.price,
              currency: selectedProduct.currency,
            },
          ],
          source: "hosted_shop",
        }),
      });
      const data = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) {
        throw new Error(data?.error || "Could not send request.");
      }
      setNotice("Request sent. The business can follow up from their OdogwuHQ inbox.");
      setCustomerMessage("");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not send request.");
    } finally {
      setPending(false);
    }
  };

  const startCheckout = async () => {
    if (!selectedProduct) {
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerContact.trim())) {
      setNotice("Add an email address in the contact field before checkout.");
      return;
    }
    setCheckoutPending(true);
    setNotice("");
    try {
      const response = await fetch("/api/storefront/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          storefrontSlug: profile.slug,
          customerName: customerName || undefined,
          customerContact: customerContact || undefined,
          customerEmail: customerContact || undefined,
          customerMessage: customerMessage || undefined,
          items: [
            {
              productId: selectedProduct._id,
              name: selectedProduct.name,
              quantity: 1,
              unitPrice: selectedProduct.price,
              currency: selectedProduct.currency,
            },
          ],
        }),
      });
      const data = await response.json().catch(() => null) as { paymentLink?: string; error?: string } | null;
      if (!response.ok || !data?.paymentLink) {
        throw new Error(data?.error || "Could not start checkout.");
      }
      window.location.href = data.paymentLink;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not start checkout.");
      setCheckoutPending(false);
    }
  };

  return (
    <main className="public-shop-shell">
      <section className="public-shop-hero">
        <p className="queue-meta">Chat-aided storefront</p>
        <h1>{profile.displayName}</h1>
        <p>{profile.offerSummary || "Ask a question, choose what fits, and get help moving from interest to order."}</p>
        <div className="public-shop-actions">
          <a className="btn btn-primary" href="#order">
            Start an order
          </a>
          {profile.liveChatEnabled ? (
            <a className="btn btn-ghost" href={`/?storefront=${encodeURIComponent(profile.slug)}`}>
              Livechat
            </a>
          ) : null}
        </div>
      </section>

      <section className="public-shop-products" aria-label="Products">
        {products.length === 0 ? (
          <article className="public-shop-empty">
            <h2>No products yet</h2>
            <p>This storefront is live, but the catalog is still being prepared.</p>
          </article>
        ) : (
          products.map((product) => (
            <button
              type="button"
              className={`public-shop-product ${selectedProduct?._id === product._id ? "selected" : ""}`}
              key={product._id}
              onClick={() => setSelectedId(product._id)}
            >
              {product.imageUrl ? (
                <span
                  className="public-shop-product-image"
                  style={{ backgroundImage: `url("${product.imageUrl.replace(/"/g, "%22")}")` }}
                />
              ) : null}
              <span>
                <strong>{product.name}</strong>
                <small>{product.description}</small>
              </span>
              <em>{formatMoney(product.price, product.currency)}</em>
            </button>
          ))
        )}
      </section>

      <section className="public-shop-order" id="order" aria-label="Order request">
        <div>
          <p className="queue-meta">Selected</p>
          <h2>{selectedProduct?.name || "Choose a product"}</h2>
          <p>{selectedProduct?.description || profile.liveChatWelcomeMessage}</p>
          {selectedProduct ? <strong>{formatMoney(selectedProduct.price, selectedProduct.currency)}</strong> : null}
          {paymentResult ? (
            <p className="public-shop-payment-notice">
              {paymentResult === "success"
                ? "Payment confirmed. The business can follow up from their OdogwuHQ inbox."
                : paymentMessage || "Payment could not be confirmed yet."}
            </p>
          ) : null}
        </div>
        <form onSubmit={submitOrder}>
          {notice ? <p className="queue-meta">{notice}</p> : null}
          <input
            type="text"
            value={customerName}
            placeholder="Name"
            maxLength={120}
            onChange={(event) => setCustomerName(event.target.value)}
            disabled={pending}
          />
          <input
            type="text"
            inputMode="email"
            value={customerContact}
            placeholder="Email for checkout, or WhatsApp/phone for follow-up"
            maxLength={160}
            onChange={(event) => setCustomerContact(event.target.value)}
            disabled={pending || checkoutPending}
          />
          <textarea
            value={customerMessage}
            rows={4}
            placeholder="Ask a question or share delivery/payment details."
            maxLength={1200}
            onChange={(event) => setCustomerMessage(event.target.value)}
            disabled={pending || checkoutPending}
          />
          {profile.checkoutEnabled ? (
            <button className="btn btn-primary" type="button" disabled={checkoutPending || pending || !selectedProduct} onClick={() => void startCheckout()}>
              {checkoutPending ? "Opening checkout..." : "Pay now"}
            </button>
          ) : null}
          <button className="btn btn-ghost" type="submit" disabled={pending || checkoutPending || !selectedProduct}>
            {pending ? "Sending..." : "Send request"}
          </button>
        </form>
      </section>
    </main>
  );
}
