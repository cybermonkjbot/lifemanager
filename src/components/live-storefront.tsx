"use client";

import { LoadingBlock } from "@/components/loading-state";
import { useTenantScopeArgs } from "@/components/tenant-scope-provider";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useMemo, useState, type FormEvent } from "react";

type StorefrontSettings = {
  productUse?: "personal" | "business";
  businessBrandName?: string;
  businessBrandVoice?: string;
  businessOfferSummary?: string;
  storefrontEnabled?: boolean;
  storefrontSlug?: string;
  storefrontFeeBps?: number;
  liveChatEnabled?: boolean;
  liveChatWelcomeMessage?: string;
};

type StorefrontProduct = {
  _id: Id<"storefrontProducts">;
  slug: string;
  name: string;
  description: string;
  price: number;
  currency: string;
  stockStatus: "in_stock" | "limited" | "preorder" | "sold_out";
  imageUrl?: string;
  tags: string[];
  salesNotes?: string;
  active: boolean;
  sortOrder: number;
};

type OrderIntent = {
  _id: Id<"storefrontOrderIntents">;
  threadId?: Id<"threads">;
  customerName?: string;
  customerContact?: string;
  customerMessage?: string;
  estimatedTotal: number;
  currency: string;
  status: "new" | "contacted" | "confirmed" | "paid" | "closed" | "cancelled";
  paymentStatus?: "unpaid" | "pending" | "paid" | "failed" | "refunded";
  paymentLink?: string;
  platformFeeAmount?: number;
  merchantReceivableAmount?: number;
  createdAt: number;
  items: Array<{ name: string; quantity: number }>;
};

type PayoutAccount = {
  provider: "flutterwave" | "manual";
  country: string;
  currency: string;
  bankCode: string;
  bankName: string;
  accountNumberMasked: string;
  accountName: string;
  businessLegalName?: string;
  kycStatus: "missing" | "submitted" | "verified" | "rejected";
  verificationNotes?: string;
  updatedAt: number;
};

type ProductDraft = {
  productId?: Id<"storefrontProducts">;
  name: string;
  slug: string;
  description: string;
  price: string;
  currency: string;
  stockStatus: StorefrontProduct["stockStatus"];
  imageUrl: string;
  tags: string;
  salesNotes: string;
  active: boolean;
  sortOrder: string;
};

type PayoutDraft = {
  country: string;
  currency: string;
  bankCode: string;
  bankName: string;
  accountNumber: string;
  accountName: string;
  businessLegalName: string;
};

const emptyProductDraft: ProductDraft = {
  name: "",
  slug: "",
  description: "",
  price: "",
  currency: "NGN",
  stockStatus: "in_stock",
  imageUrl: "",
  tags: "",
  salesNotes: "",
  active: true,
  sortOrder: "1000",
};
const emptyPayoutDraft: PayoutDraft = {
  country: "NG",
  currency: "NGN",
  bankCode: "",
  bankName: "",
  accountNumber: "",
  accountName: "",
  businessLegalName: "",
};
const publicAppUrl = (process.env.NEXT_PUBLIC_APP_URL || "https://odogwuhq.com").replace(/\/+$/, "");

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

function productToDraft(product: StorefrontProduct): ProductDraft {
  return {
    productId: product._id,
    name: product.name,
    slug: product.slug,
    description: product.description,
    price: String(product.price),
    currency: product.currency,
    stockStatus: product.stockStatus,
    imageUrl: product.imageUrl || "",
    tags: product.tags.join(", "),
    salesNotes: product.salesNotes || "",
    active: product.active,
    sortOrder: String(product.sortOrder),
  };
}

export function LiveStorefront() {
  const tenantScope = useTenantScopeArgs();
  const settings = useQuery(api.settings.get, tenantScope) as StorefrontSettings | undefined;
  const products = useQuery(api.storefront.listProducts, { ...tenantScope, includeInactive: true }) as StorefrontProduct[] | undefined;
  const orderIntents = useQuery(api.storefront.listOrderIntents, { ...tenantScope, status: "new", limit: 8 }) as OrderIntent[] | undefined;
  const payoutAccount = useQuery(api.storefront.getPayoutAccount, tenantScope) as PayoutAccount | null | undefined;
  const upsertProduct = useMutation(api.storefront.upsertProduct);
  const setProductActive = useMutation(api.storefront.setProductActive);
  const updateOrderIntentStatus = useMutation(api.storefront.updateOrderIntentStatus);
  const [draft, setDraft] = useState<ProductDraft>(emptyProductDraft);
  const [payoutDraft, setPayoutDraft] = useState<PayoutDraft>(emptyPayoutDraft);
  const [pending, setPending] = useState(false);
  const [payoutPending, setPayoutPending] = useState(false);
  const [notice, setNotice] = useState("");
  const [payoutNotice, setPayoutNotice] = useState("");
  const activeProducts = useMemo(() => (products || []).filter((product) => product.active), [products]);

  const saveProduct = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    setNotice("");
    try {
      await upsertProduct({
        ...tenantScope,
        productId: draft.productId,
        name: draft.name,
        slug: draft.slug || undefined,
        description: draft.description,
        price: Number(draft.price) || 0,
        currency: draft.currency,
        stockStatus: draft.stockStatus,
        imageUrl: draft.imageUrl || undefined,
        tags: draft.tags.split(",").map((tag) => tag.trim()).filter(Boolean),
        salesNotes: draft.salesNotes || undefined,
        active: draft.active,
        sortOrder: Number(draft.sortOrder) || 1000,
      });
      setDraft(emptyProductDraft);
      setNotice("Product saved.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not save product.");
    } finally {
      setPending(false);
    }
  };

  const savePayoutAccount = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPayoutPending(true);
    setPayoutNotice("");
    try {
      const response = await fetch("/api/storefront/payout-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          country: payoutDraft.country,
          currency: payoutDraft.currency,
          bankCode: payoutDraft.bankCode,
          bankName: payoutDraft.bankName,
          accountNumber: payoutDraft.accountNumber,
          accountName: payoutDraft.accountName,
          businessLegalName: payoutDraft.businessLegalName || undefined,
        }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        throw new Error(body.error || "Could not save payout details.");
      }
      setPayoutDraft(emptyPayoutDraft);
      setPayoutNotice("Payout details submitted for review.");
    } catch (error) {
      setPayoutNotice(error instanceof Error ? error.message : "Could not save payout details.");
    } finally {
      setPayoutPending(false);
    }
  };

  const toggleProduct = async (product: StorefrontProduct) => {
    setNotice("");
    try {
      await setProductActive({ ...tenantScope, productId: product._id, active: !product.active });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not update product.");
    }
  };

  const markOrderIntent = async (orderIntentId: Id<"storefrontOrderIntents">, status: OrderIntent["status"]) => {
    setNotice("");
    try {
      await updateOrderIntentStatus({ ...tenantScope, orderIntentId, status });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not update order intent.");
    }
  };

  if (!settings || !products || !orderIntents || payoutAccount === undefined) {
    return (
      <section className="storefront-workspace">
        <article className="panel-card">
          <h3>Storefront</h3>
          <LoadingBlock label="Loading storefront controls..." rows={4} />
        </article>
      </section>
    );
  }

  const slug = settings.storefrontSlug || "your-brand";
  const publicPath = `/shop/${slug}`;
  const feePercent = ((settings.storefrontFeeBps ?? 250) / 100).toFixed(2).replace(/\.00$/, "");
  const configured =
    Boolean(settings.businessBrandName?.trim()) &&
    Boolean(settings.businessOfferSummary?.trim()) &&
    Boolean(settings.storefrontSlug?.trim());

  return (
    <section className="storefront-workspace">
      <div className="storefront-command-strip">
        <div>
          <p className="queue-meta">Hosted by OdogwuHQ</p>
          <h2>{settings.businessBrandName || "Business storefront"}</h2>
          <p>
            A chat-aided shop for customers who want help choosing, asking, ordering, or moving from interest to payment.
          </p>
        </div>
        <div className="storefront-actions">
          <Link className="btn btn-primary" href="/settings?section=business">
            Edit controls
          </Link>
          <Link className="btn btn-ghost" href={publicPath}>
            Preview shop
          </Link>
        </div>
      </div>

      <div className="panel-grid two-col">
        <article className="panel-card">
          <h3>Readiness</h3>
          <div className="storefront-readiness-list">
            <div>
              <span>Workspace</span>
              <strong>{settings.productUse === "business" ? "Business" : "Personal mode"}</strong>
            </div>
            <div>
              <span>Storefront</span>
              <strong>{settings.storefrontEnabled ? "Enabled" : "Disabled"}</strong>
            </div>
            <div>
              <span>Livechat</span>
              <strong>{settings.liveChatEnabled ? "Enabled" : "Disabled"}</strong>
            </div>
            <div>
              <span>Platform fee</span>
              <strong>{feePercent}%</strong>
            </div>
            <div>
              <span>Payout account</span>
              <strong>{payoutAccount?.kycStatus === "verified" ? "Verified" : payoutAccount ? "Needs review" : "Missing"}</strong>
            </div>
          </div>
          {!configured ? (
            <p className="instance-lock-error">
              Add a brand name, offer summary, and storefront slug before treating this as publish-ready.
            </p>
          ) : null}
        </article>

        <article className="panel-card">
          <h3>Livechat Embed</h3>
          <p className="queue-meta">
            Businesses with an existing site can drop this hosted chat entry point into their own pages.
          </p>
          <pre className="storefront-embed-code">
{`<script
  async
  src="${publicAppUrl}/livechat.js"
  data-tenant="${slug}"
></script>`}
          </pre>
          <p className="queue-meta">{settings.liveChatWelcomeMessage}</p>
        </article>

        <article className="panel-card">
          <h3>Brand Voice</h3>
          <p>{settings.businessBrandVoice || "No brand voice has been written yet."}</p>
        </article>

        <article className="panel-card">
          <h3>Offer Memory</h3>
          <p>{settings.businessOfferSummary || "No offer summary has been written yet."}</p>
        </article>
      </div>

      <article className="panel-card storefront-product-editor">
        <h3>Weekend payouts</h3>
        <p className="queue-meta">
          Customers pay OdogwuHQ first. Your verified payout account receives the business net after platform fees.
        </p>
        {payoutNotice ? <p className="queue-meta">{payoutNotice}</p> : null}
        {payoutAccount ? (
          <div className="storefront-readiness-list">
            <div>
              <span>Account</span>
              <strong>{payoutAccount.bankName} {payoutAccount.accountNumberMasked}</strong>
            </div>
            <div>
              <span>Name</span>
              <strong>{payoutAccount.accountName}</strong>
            </div>
            <div>
              <span>Status</span>
              <strong>{payoutAccount.kycStatus}</strong>
            </div>
            <div>
              <span>Currency</span>
              <strong>{payoutAccount.currency}</strong>
            </div>
          </div>
        ) : null}
        <form className="stack compact" onSubmit={savePayoutAccount} aria-busy={payoutPending}>
          <div className="storefront-form-row">
            <label className="stack compact">
              <span className="queue-meta">Country</span>
              <input
                type="text"
                maxLength={2}
                value={payoutDraft.country}
                onChange={(event) => setPayoutDraft((prev) => ({ ...prev, country: event.target.value.toUpperCase() }))}
                disabled={payoutPending}
              />
            </label>
            <label className="stack compact">
              <span className="queue-meta">Currency</span>
              <input
                type="text"
                maxLength={3}
                value={payoutDraft.currency}
                onChange={(event) => setPayoutDraft((prev) => ({ ...prev, currency: event.target.value.toUpperCase() }))}
                disabled={payoutPending}
              />
            </label>
            <label className="stack compact">
              <span className="queue-meta">Bank code</span>
              <input
                type="text"
                value={payoutDraft.bankCode}
                placeholder={payoutAccount?.bankCode || "044"}
                onChange={(event) => setPayoutDraft((prev) => ({ ...prev, bankCode: event.target.value }))}
                disabled={payoutPending}
              />
            </label>
          </div>
          <div className="storefront-form-row">
            <label className="stack compact">
              <span className="queue-meta">Bank name</span>
              <input
                type="text"
                value={payoutDraft.bankName}
                placeholder={payoutAccount?.bankName || "Access Bank"}
                onChange={(event) => setPayoutDraft((prev) => ({ ...prev, bankName: event.target.value }))}
                disabled={payoutPending}
              />
            </label>
            <label className="stack compact">
              <span className="queue-meta">Account number</span>
              <input
                type="text"
                inputMode="numeric"
                value={payoutDraft.accountNumber}
                placeholder={payoutAccount?.accountNumberMasked || "0123456789"}
                onChange={(event) => setPayoutDraft((prev) => ({ ...prev, accountNumber: event.target.value.replace(/\D/g, "") }))}
                disabled={payoutPending}
              />
            </label>
          </div>
          <div className="storefront-form-row">
            <label className="stack compact">
              <span className="queue-meta">Account name</span>
              <input
                type="text"
                value={payoutDraft.accountName}
                placeholder={payoutAccount?.accountName || "Business account name"}
                onChange={(event) => setPayoutDraft((prev) => ({ ...prev, accountName: event.target.value }))}
                disabled={payoutPending}
              />
            </label>
            <label className="stack compact">
              <span className="queue-meta">Legal business name</span>
              <input
                type="text"
                value={payoutDraft.businessLegalName}
                placeholder={payoutAccount?.businessLegalName || settings.businessBrandName || "Registered business name"}
                onChange={(event) => setPayoutDraft((prev) => ({ ...prev, businessLegalName: event.target.value }))}
                disabled={payoutPending}
              />
            </label>
          </div>
          <button className="btn btn-primary" type="submit" disabled={payoutPending}>
            {payoutPending ? "Submitting..." : payoutAccount ? "Update payout details" : "Submit payout details"}
          </button>
        </form>
      </article>

      <div className="panel-grid two-col">
        <article className="panel-card storefront-product-editor">
          <h3>{draft.productId ? "Edit product" : "Add product"}</h3>
          <form className="stack compact" onSubmit={saveProduct} aria-busy={pending}>
            {notice ? <p className="queue-meta">{notice}</p> : null}
            <label className="stack compact">
              <span className="queue-meta">Product name</span>
              <input
                type="text"
                value={draft.name}
                placeholder="Signature package, consultation, dress, meal plan..."
                onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))}
                disabled={pending}
              />
            </label>
            <div className="storefront-form-row">
              <label className="stack compact">
                <span className="queue-meta">Price</span>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={draft.price}
                  placeholder="0"
                  onChange={(event) => setDraft((prev) => ({ ...prev, price: event.target.value }))}
                  disabled={pending}
                />
              </label>
              <label className="stack compact">
                <span className="queue-meta">Currency</span>
                <input
                  type="text"
                  value={draft.currency}
                  maxLength={3}
                  onChange={(event) => setDraft((prev) => ({ ...prev, currency: event.target.value.toUpperCase() }))}
                  disabled={pending}
                />
              </label>
              <label className="stack compact">
                <span className="queue-meta">Status</span>
                <select
                  value={draft.stockStatus}
                  onChange={(event) =>
                    setDraft((prev) => ({ ...prev, stockStatus: event.target.value as StorefrontProduct["stockStatus"] }))
                  }
                  disabled={pending}
                >
                  <option value="in_stock">In stock</option>
                  <option value="limited">Limited</option>
                  <option value="preorder">Preorder</option>
                  <option value="sold_out">Sold out</option>
                </select>
              </label>
            </div>
            <label className="stack compact">
              <span className="queue-meta">Description</span>
              <textarea
                rows={4}
                value={draft.description}
                placeholder="What customers should know before asking or ordering."
                onChange={(event) => setDraft((prev) => ({ ...prev, description: event.target.value }))}
                disabled={pending}
              />
            </label>
            <div className="storefront-form-row">
              <label className="stack compact">
                <span className="queue-meta">Slug</span>
                <input
                  type="text"
                  value={draft.slug}
                  placeholder="auto-generated"
                  onChange={(event) =>
                    setDraft((prev) => ({ ...prev, slug: event.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, "-") }))
                  }
                  disabled={pending}
                />
              </label>
              <label className="stack compact">
                <span className="queue-meta">Sort order</span>
                <input
                  type="number"
                  value={draft.sortOrder}
                  onChange={(event) => setDraft((prev) => ({ ...prev, sortOrder: event.target.value }))}
                  disabled={pending}
                />
              </label>
            </div>
            <label className="stack compact">
              <span className="queue-meta">Image URL</span>
              <input
                type="url"
                value={draft.imageUrl}
                placeholder="https://..."
                onChange={(event) => setDraft((prev) => ({ ...prev, imageUrl: event.target.value }))}
                disabled={pending}
              />
            </label>
            <label className="stack compact">
              <span className="queue-meta">Tags</span>
              <input
                type="text"
                value={draft.tags}
                placeholder="best seller, delivery, premium"
                onChange={(event) => setDraft((prev) => ({ ...prev, tags: event.target.value }))}
                disabled={pending}
              />
            </label>
            <label className="stack compact">
              <span className="queue-meta">Sales notes</span>
              <textarea
                rows={3}
                value={draft.salesNotes}
                placeholder="Answers the assistant may use, upsell notes, limits, or payment rules."
                onChange={(event) => setDraft((prev) => ({ ...prev, salesNotes: event.target.value }))}
                disabled={pending}
              />
            </label>
            <label className="settings-toggle-row">
              <input
                type="checkbox"
                checked={draft.active}
                onChange={(event) => setDraft((prev) => ({ ...prev, active: event.target.checked }))}
                disabled={pending}
              />
              <span>
                <strong>Visible in shop</strong>
                <small>Inactive products stay in the manager but are hidden publicly.</small>
              </span>
            </label>
            <div className="storefront-actions">
              <button className="btn btn-primary" type="submit" disabled={pending || !draft.name.trim()}>
                {pending ? "Saving..." : "Save product"}
              </button>
              {draft.productId ? (
                <button className="btn btn-ghost" type="button" onClick={() => setDraft(emptyProductDraft)} disabled={pending}>
                  New product
                </button>
              ) : null}
            </div>
          </form>
        </article>

        <article className="panel-card">
          <h3>Catalog</h3>
          <p className="queue-meta">
            {activeProducts.length} visible product{activeProducts.length === 1 ? "" : "s"} for the hosted shop.
          </p>
          <div className="storefront-product-list">
            {products.length === 0 ? (
              <p className="empty-line">Add the first product to make the shop useful.</p>
            ) : (
              products.map((product) => (
                <div className="storefront-product-row" key={product._id}>
                  <div>
                    <strong>{product.name}</strong>
                    <span>
                      {formatMoney(product.price, product.currency)} · {product.stockStatus.replace("_", " ")}
                    </span>
                    <p>{product.description || "No description yet."}</p>
                  </div>
                  <div className="storefront-product-actions">
                    <button className="btn btn-ghost" type="button" onClick={() => setDraft(productToDraft(product))}>
                      Edit
                    </button>
                    <button className="btn btn-ghost" type="button" onClick={() => void toggleProduct(product)}>
                      {product.active ? "Hide" : "Show"}
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </article>
      </div>

      <article className="panel-card">
        <h3>New order intents</h3>
        <div className="storefront-order-list">
          {orderIntents.length === 0 ? (
            <p className="empty-line">New storefront order requests will appear here before they become full inbox work.</p>
          ) : (
            orderIntents.map((intent) => (
              <div className="storefront-order-row" key={intent._id}>
                <div>
                  <strong>{intent.customerName || intent.customerContact || "New customer"}</strong>
                  <span>{new Date(intent.createdAt).toLocaleString()}</span>
                  <p>{intent.customerMessage || intent.items.map((item) => `${item.quantity}x ${item.name}`).join(", ")}</p>
                  <span>
                    Payment: {intent.paymentStatus || "unpaid"}
                    {intent.platformFeeAmount ? ` · fee ${formatMoney(intent.platformFeeAmount, intent.currency)}` : ""}
                    {intent.merchantReceivableAmount ? ` · net ${formatMoney(intent.merchantReceivableAmount, intent.currency)}` : ""}
                  </span>
                </div>
                <div className="storefront-order-actions">
                  <strong>{formatMoney(intent.estimatedTotal, intent.currency)}</strong>
                  {intent.paymentLink ? (
                    <a className="btn btn-ghost" href={intent.paymentLink} target="_blank" rel="noreferrer">
                      Payment link
                    </a>
                  ) : null}
                  {intent.threadId ? (
                    <Link className="btn btn-ghost" href={`/conversations?threadId=${intent.threadId}`}>
                      Open thread
                    </Link>
                  ) : null}
                  <button className="btn btn-ghost" type="button" onClick={() => void markOrderIntent(intent._id, "contacted")}>
                    Contacted
                  </button>
                  <button className="btn btn-primary" type="button" onClick={() => void markOrderIntent(intent._id, "confirmed")}>
                    Confirmed
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </article>
    </section>
  );
}
