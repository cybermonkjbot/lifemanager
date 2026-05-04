import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { assertTenantBillingActive, assertTenantBusinessSellingEnabled, isTenantBusinessSellingEnabled } from "./lib/billingAccess";
import { resolveTenantForMutation, resolveTenantForQuery } from "./lib/tenantSecurity";

const tenantScopeArgs = {
  tenantId: v.optional(v.id("tenantAccounts")),
  connectorTokenHash: v.optional(v.string()),
};

const stockStatusValidator = v.union(
  v.literal("in_stock"),
  v.literal("limited"),
  v.literal("preorder"),
  v.literal("sold_out"),
);

const orderItemValidator = v.object({
  productId: v.optional(v.id("storefrontProducts")),
  name: v.string(),
  quantity: v.number(),
  unitPrice: v.number(),
  currency: v.string(),
});

function normalizeSlug(value: string, fallback: string) {
  const source = value.trim() || fallback.trim();
  return (
    source
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "item"
  );
}

function normalizeCurrency(value: string | undefined) {
  const currency = (value || "NGN").trim().toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3);
  return currency || "NGN";
}

function cleanPayoutText(value: string | undefined, limit: number) {
  return (value || "").trim().replace(/\s+/g, " ").slice(0, limit);
}

function normalizeCountry(value: string | undefined) {
  const country = (value || "NG").trim().toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2);
  return country || "NG";
}

function normalizeAccountNumber(value: string) {
  return value.trim().replace(/\D/g, "").slice(0, 24);
}

async function readPayoutAccountForTenant(
  ctx: QueryCtx | MutationCtx,
  tenantId: Id<"tenantAccounts"> | undefined,
) {
  return await ctx.db
    .query("storefrontPayoutAccounts")
    .withIndex("by_tenantId", (q) => q.eq("tenantId", tenantId))
    .first();
}

function publicPayoutAccount(account: Doc<"storefrontPayoutAccounts"> | null) {
  if (!account) {
    return null;
  }
  return {
    _id: account._id,
    provider: account.provider,
    country: account.country,
    currency: account.currency,
    bankCode: account.bankCode,
    bankName: account.bankName,
    accountNumberMasked: account.accountNumberLast4 ? `****${account.accountNumberLast4}` : "",
    accountNumberLast4: account.accountNumberLast4,
    accountName: account.accountName,
    businessLegalName: account.businessLegalName,
    kycStatus: account.kycStatus,
    verificationNotes: account.verificationNotes,
    verifiedAt: account.verifiedAt,
    updatedAt: account.updatedAt,
  };
}

function normalizeTags(values: string[] | undefined) {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const value of values || []) {
    const tag = value.trim().slice(0, 40);
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) {
      continue;
    }
    seen.add(key);
    tags.push(tag);
    if (tags.length >= 8) {
      break;
    }
  }
  return tags;
}

function normalizeCustomerKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9@.+_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function buildOrderMessage(args: {
  displayName: string;
  items: Array<{ name: string; quantity: number; unitPrice: number; currency: string }>;
  estimatedTotal: number;
  currency: string;
  customerName?: string;
  customerContact?: string;
  customerMessage?: string;
}) {
  const itemLines = args.items.map((item) => {
    const quantityPrefix = item.quantity > 1 ? `${item.quantity}x ` : "";
    return `- ${quantityPrefix}${item.name} (${item.currency} ${item.unitPrice.toLocaleString()})`;
  });
  return [
    `Storefront order request for ${args.displayName}`,
    args.customerName ? `Customer: ${args.customerName}` : undefined,
    args.customerContact ? `Contact: ${args.customerContact}` : undefined,
    "Items:",
    ...itemLines,
    `Estimated total: ${args.currency} ${args.estimatedTotal.toLocaleString()}`,
    args.customerMessage ? `Customer note: ${args.customerMessage}` : undefined,
  ]
    .filter(Boolean)
    .join("\n");
}

async function insertLedgerEntryIfMissing(
  ctx: MutationCtx,
  args: {
    tenantId: Id<"tenantAccounts"> | undefined;
    orderIntentId: Id<"storefrontOrderIntents">;
    kind: "gross_payment" | "platform_fee" | "merchant_receivable";
    direction: "credit" | "debit";
    amount: number;
    currency: string;
    description: string;
    createdAt: number;
  },
) {
  const existing = await ctx.db
    .query("storefrontLedgerEntries")
    .withIndex("by_orderIntentId_and_kind", (q) => q.eq("orderIntentId", args.orderIntentId).eq("kind", args.kind))
    .first();
  if (existing) {
    return existing._id;
  }
  return await ctx.db.insert("storefrontLedgerEntries", {
    tenantId: args.tenantId,
    orderIntentId: args.orderIntentId,
    kind: args.kind,
    direction: args.direction,
    status: "available",
    amount: Math.max(0, Math.round(args.amount * 100) / 100),
    currency: normalizeCurrency(args.currency),
    description: args.description.slice(0, 500),
    availableAt: args.createdAt,
    createdAt: args.createdAt,
    updatedAt: args.createdAt,
  });
}

async function normalizeOrderItems(
  ctx: MutationCtx,
  tenantId: Id<"tenantAccounts"> | undefined,
  rawItems: Array<{
    productId?: Id<"storefrontProducts">;
    name: string;
    quantity: number;
    unitPrice: number;
    currency: string;
  }>,
) {
  const items: Array<{
    productId?: Id<"storefrontProducts">;
    name: string;
    quantity: number;
    unitPrice: number;
    currency: string;
  }> = [];

  for (const item of rawItems.slice(0, 20)) {
    const quantity = Math.max(1, Math.min(Math.round(item.quantity), 99));
    if (item.productId) {
      const product = await ctx.db.get(item.productId);
      if (!product || product.tenantId !== tenantId || !product.active || product.stockStatus === "sold_out") {
        throw new Error("One of the selected products is not available.");
      }
      items.push({
        productId: product._id,
        name: product.name,
        quantity,
        unitPrice: Math.max(0, Math.round(product.price * 100) / 100),
        currency: normalizeCurrency(product.currency),
      });
      continue;
    }

    const name = item.name.trim().slice(0, 120);
    if (!name) {
      continue;
    }
    items.push({
      name,
      quantity,
      unitPrice: Math.max(0, Math.round(item.unitPrice * 100) / 100),
      currency: normalizeCurrency(item.currency),
    });
  }

  return items;
}

async function assertProductTenant(
  productTenantId: Id<"tenantAccounts"> | undefined,
  authorizedTenantId: Id<"tenantAccounts"> | undefined,
) {
  if (authorizedTenantId && productTenantId !== authorizedTenantId) {
    throw new Error("You do not have access to this product.");
  }
}

export const listProducts = query({
  args: {
    ...tenantScopeArgs,
    includeInactive: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const tenantId = await resolveTenantForQuery(ctx, args);
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 200);
    if (!(await isTenantBusinessSellingEnabled(ctx, tenantId))) {
      return [];
    }

    if (args.includeInactive) {
      return await ctx.db
        .query("storefrontProducts")
        .withIndex("by_tenantId_and_updatedAt", (q) => q.eq("tenantId", tenantId))
        .order("desc")
        .take(limit);
    }

    return await ctx.db
      .query("storefrontProducts")
      .withIndex("by_tenantId_and_active_and_sortOrder", (q) => q.eq("tenantId", tenantId).eq("active", true))
      .order("asc")
      .take(limit);
  },
});

export const listOrderIntents = query({
  args: {
    ...tenantScopeArgs,
    status: v.optional(v.union(v.literal("new"), v.literal("contacted"), v.literal("confirmed"), v.literal("paid"), v.literal("closed"), v.literal("cancelled"))),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const tenantId = await resolveTenantForQuery(ctx, args);
    const status = args.status || "new";
    const limit = Math.min(Math.max(args.limit ?? 30, 1), 100);
    if (!(await isTenantBusinessSellingEnabled(ctx, tenantId))) {
      return [];
    }
    return await ctx.db
      .query("storefrontOrderIntents")
      .withIndex("by_tenantId_and_status_and_createdAt", (q) => q.eq("tenantId", tenantId).eq("status", status))
      .order("desc")
      .take(limit);
  },
});

export const searchProductsForSelling = query({
  args: {
    ...tenantScopeArgs,
    query: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const tenantId = await resolveTenantForQuery(ctx, args);
    if (!(await isTenantBusinessSellingEnabled(ctx, tenantId))) {
      return { profile: null, products: [] };
    }

    const profile = await ctx.db
      .query("storefrontProfiles")
      .withIndex("by_tenantId", (q) => q.eq("tenantId", tenantId))
      .first();
    if (!profile?.enabled) {
      return { profile: profile || null, products: [] };
    }

    const products = await ctx.db
      .query("storefrontProducts")
      .withIndex("by_tenantId_and_active_and_sortOrder", (q) => q.eq("tenantId", tenantId).eq("active", true))
      .order("asc")
      .take(200);

    const tokens = args.query
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 2)
      .slice(0, 16);
    const scored = products
      .filter((product) => product.stockStatus !== "sold_out")
      .map((product, index) => {
        const haystack = [
          product.name,
          product.description,
          product.salesNotes || "",
          product.tags.join(" "),
          product.stockStatus.replace("_", " "),
        ]
          .join(" ")
          .toLowerCase();
        const score = tokens.reduce((sum, token) => sum + (haystack.includes(token) ? 1 : 0), 0);
        return { product, score, index };
      })
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }
        return left.index - right.index;
      });

    const limit = Math.min(Math.max(args.limit ?? 5, 1), 8);
    return {
      profile,
      products: scored
        .filter((entry, index) => entry.score > 0 || index < Math.min(limit, 3))
        .slice(0, limit)
        .map((entry) => entry.product),
    };
  },
});

export const upsertProduct = mutation({
  args: {
    ...tenantScopeArgs,
    productId: v.optional(v.id("storefrontProducts")),
    name: v.string(),
    slug: v.optional(v.string()),
    description: v.string(),
    price: v.number(),
    currency: v.optional(v.string()),
    stockStatus: stockStatusValidator,
    imageUrl: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    salesNotes: v.optional(v.string()),
    active: v.optional(v.boolean()),
    sortOrder: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const tenantId = await resolveTenantForMutation(ctx, args);
    await assertTenantBillingActive(ctx, tenantId);
    await assertTenantBusinessSellingEnabled(ctx, tenantId);

    const now = Date.now();
    const name = args.name.trim().slice(0, 120);
    if (!name) {
      throw new Error("Product name is required.");
    }
    const slug = normalizeSlug(args.slug || "", name);
    const existingWithSlug = await ctx.db
      .query("storefrontProducts")
      .withIndex("by_tenantId_and_slug", (q) => q.eq("tenantId", tenantId).eq("slug", slug))
      .first();
    if (existingWithSlug && existingWithSlug._id !== args.productId) {
      throw new Error("Another product already uses this slug.");
    }

    const patch = {
      tenantId,
      slug,
      name,
      description: args.description.trim().slice(0, 1600),
      price: Math.max(0, Math.round(args.price * 100) / 100),
      currency: normalizeCurrency(args.currency),
      stockStatus: args.stockStatus,
      imageUrl: args.imageUrl?.trim().slice(0, 1000) || undefined,
      tags: normalizeTags(args.tags),
      salesNotes: args.salesNotes?.trim().slice(0, 1600) || undefined,
      active: args.active ?? true,
      sortOrder: Math.round(args.sortOrder ?? 1000),
      updatedAt: now,
    };

    if (args.productId) {
      const product = await ctx.db.get(args.productId);
      if (!product) {
        throw new Error("Product not found.");
      }
      await assertProductTenant(product.tenantId, tenantId);
      await ctx.db.patch(args.productId, patch);
      return args.productId;
    }

    return await ctx.db.insert("storefrontProducts", {
      ...patch,
      createdAt: now,
    });
  },
});

export const setProductActive = mutation({
  args: {
    ...tenantScopeArgs,
    productId: v.id("storefrontProducts"),
    active: v.boolean(),
  },
  handler: async (ctx, args) => {
    const tenantId = await resolveTenantForMutation(ctx, args);
    await assertTenantBillingActive(ctx, tenantId);
    await assertTenantBusinessSellingEnabled(ctx, tenantId);
    const product = await ctx.db.get(args.productId);
    if (!product) {
      throw new Error("Product not found.");
    }
    await assertProductTenant(product.tenantId, tenantId);
    await ctx.db.patch(args.productId, {
      active: args.active,
      updatedAt: Date.now(),
    });
    return args.productId;
  },
});

export const getPayoutAccount = query({
  args: tenantScopeArgs,
  handler: async (ctx, args) => {
    const tenantId = await resolveTenantForQuery(ctx, args);
    return publicPayoutAccount(await readPayoutAccountForTenant(ctx, tenantId));
  },
});

export const upsertPayoutAccount = mutation({
  args: {
    ...tenantScopeArgs,
    provider: v.optional(v.union(v.literal("flutterwave"), v.literal("manual"))),
    country: v.optional(v.string()),
    currency: v.optional(v.string()),
    bankCode: v.string(),
    bankName: v.string(),
    encryptedAccountNumber: v.object({
      algorithm: v.string(),
      iv: v.string(),
      tag: v.string(),
      encryptedValue: v.string(),
    }),
    accountNumberLast4: v.string(),
    accountName: v.string(),
    businessLegalName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const tenantId = await resolveTenantForMutation(ctx, args);
    await assertTenantBusinessSellingEnabled(ctx, tenantId);
    const now = Date.now();
    const accountNumberLast4 = normalizeAccountNumber(args.accountNumberLast4).slice(-4);
    const bankCode = cleanPayoutText(args.bankCode, 40).toUpperCase();
    const bankName = cleanPayoutText(args.bankName, 120);
    const accountName = cleanPayoutText(args.accountName, 160);
    if (!bankCode || !bankName || accountNumberLast4.length < 4 || !accountName) {
      throw new Error("Add a valid bank, account number, and account name for payouts.");
    }

    const existing = await readPayoutAccountForTenant(ctx, tenantId);
    const patch = {
      provider: args.provider || "flutterwave" as const,
      country: normalizeCountry(args.country),
      currency: normalizeCurrency(args.currency),
      bankCode,
      bankName,
      accountNumber: undefined,
      encryptedAccountNumber: {
        algorithm: args.encryptedAccountNumber.algorithm,
        iv: args.encryptedAccountNumber.iv,
        tag: args.encryptedAccountNumber.tag,
        encryptedValue: args.encryptedAccountNumber.encryptedValue,
      },
      accountNumberLast4,
      accountName,
      businessLegalName: cleanPayoutText(args.businessLegalName, 180) || undefined,
      kycStatus: "submitted" as const,
      verificationNotes: undefined,
      verifiedAt: undefined,
      updatedAt: now,
    };
    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return publicPayoutAccount({ ...existing, ...patch });
    }
    const id = await ctx.db.insert("storefrontPayoutAccounts", {
      tenantId,
      ...patch,
      createdAt: now,
    });
    return publicPayoutAccount(await ctx.db.get(id));
  },
});

export const updateOrderIntentStatus = mutation({
  args: {
    ...tenantScopeArgs,
    orderIntentId: v.id("storefrontOrderIntents"),
    status: v.union(v.literal("new"), v.literal("contacted"), v.literal("confirmed"), v.literal("paid"), v.literal("closed"), v.literal("cancelled")),
  },
  handler: async (ctx, args) => {
    const tenantId = await resolveTenantForMutation(ctx, args);
    await assertTenantBillingActive(ctx, tenantId);
    await assertTenantBusinessSellingEnabled(ctx, tenantId);
    const intent = await ctx.db.get(args.orderIntentId);
    if (!intent) {
      throw new Error("Order intent not found.");
    }
    if (tenantId && intent.tenantId !== tenantId) {
      throw new Error("You do not have access to this order intent.");
    }
    if (intent.followUpId && args.status !== "new") {
      const followUp = await ctx.db.get(intent.followUpId);
      if (followUp && followUp.status === "suggested") {
        await ctx.db.patch(followUp._id, {
          status: "cancelled",
          updatedAt: Date.now(),
        });
      }
    }
    await ctx.db.patch(args.orderIntentId, {
      status: args.status,
      updatedAt: Date.now(),
    });
    return args.orderIntentId;
  },
});

export const prepareOrderCheckout = mutation({
  args: {
    orderIntentId: v.id("storefrontOrderIntents"),
    txRef: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const intent = await ctx.db.get(args.orderIntentId);
    if (!intent) {
      throw new Error("Order intent not found.");
    }
    if (!(await isTenantBusinessSellingEnabled(ctx, intent.tenantId))) {
      throw new Error("Checkout is not available for this storefront.");
    }
    const profile = await ctx.db
      .query("storefrontProfiles")
      .withIndex("by_slug", (q) => q.eq("slug", intent.storefrontSlug))
      .first();
    if (!profile || profile.tenantId !== intent.tenantId || !profile.enabled) {
      throw new Error("Storefront is not available.");
    }
    if ((intent.paymentStatus === "paid" || intent.status === "paid") && intent.paidAt) {
      throw new Error("This order has already been paid.");
    }

    const paymentAmount = Math.max(0, Math.round(intent.estimatedTotal * 100) / 100);
    if (paymentAmount <= 0) {
      throw new Error("Order total must be greater than zero.");
    }
    const feeBps = Math.max(0, Math.min(Math.round(profile.feeBps || 0), 2000));
    const platformFeeAmount = Math.round(paymentAmount * feeBps) / 10000;
    const roundedPlatformFeeAmount = Math.round(platformFeeAmount * 100) / 100;
    const merchantReceivableAmount = Math.max(0, Math.round((paymentAmount - roundedPlatformFeeAmount) * 100) / 100);

    await ctx.db.patch(intent._id, {
      paymentStatus: "pending",
      paymentProvider: "flutterwave",
      paymentTxRef: args.txRef.trim(),
      paymentAmount,
      platformFeeAmount: roundedPlatformFeeAmount,
      merchantReceivableAmount,
      paymentUpdatedAt: now,
      updatedAt: now,
    });

    return {
      orderIntentId: intent._id,
      storefrontSlug: intent.storefrontSlug,
      displayName: profile.displayName,
      customerName: intent.customerName,
      customerContact: intent.customerContact,
      amount: paymentAmount,
      currency: intent.currency,
      description: intent.items.map((item) => `${item.quantity}x ${item.name}`).join(", ").slice(0, 240),
    };
  },
});

export const attachOrderCheckoutLink = mutation({
  args: {
    orderIntentId: v.id("storefrontOrderIntents"),
    txRef: v.string(),
    paymentLink: v.string(),
  },
  handler: async (ctx, args) => {
    const intent = await ctx.db.get(args.orderIntentId);
    if (!intent || intent.paymentTxRef !== args.txRef) {
      throw new Error("Order checkout not found.");
    }
    await ctx.db.patch(intent._id, {
      paymentLink: args.paymentLink.trim().slice(0, 1000),
      paymentUpdatedAt: Date.now(),
      updatedAt: Date.now(),
    });
    return intent._id;
  },
});

export const recordOrderPaymentEvent = mutation({
  args: {
    txRef: v.optional(v.string()),
    transactionId: v.optional(v.string()),
    status: v.optional(v.string()),
    amount: v.optional(v.number()),
    currency: v.optional(v.string()),
    customerEmail: v.optional(v.string()),
    payloadSummary: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const txRef = args.txRef?.trim();
    if (!txRef) {
      throw new Error("Missing storefront payment reference.");
    }
    const intent = await ctx.db
      .query("storefrontOrderIntents")
      .withIndex("by_paymentTxRef", (q) => q.eq("paymentTxRef", txRef))
      .first();
    if (!intent) {
      throw new Error("Storefront order payment not found.");
    }

    const successful = args.status === "successful" || args.status === "success";
    const paidAmountMatches = typeof args.amount !== "number" || Math.round(args.amount * 100) === Math.round((intent.paymentAmount || intent.estimatedTotal) * 100);
    const paidCurrencyMatches = !args.currency || normalizeCurrency(args.currency) === normalizeCurrency(intent.currency);
    const paid = successful && paidAmountMatches && paidCurrencyMatches;

    await ctx.db.patch(intent._id, {
      paymentStatus: paid ? "paid" : "failed",
      status: paid ? "paid" : intent.status,
      paymentTransactionId: args.transactionId || intent.paymentTransactionId,
      paidAt: paid ? now : intent.paidAt,
      paymentUpdatedAt: now,
      updatedAt: now,
    });

    if (paid && intent.followUpId) {
      const followUp = await ctx.db.get(intent.followUpId);
      if (followUp && followUp.status === "suggested") {
        await ctx.db.patch(followUp._id, {
          status: "cancelled",
          updatedAt: now,
        });
      }
    }

    if (paid) {
      const grossAmount = Math.max(0, Math.round((intent.paymentAmount || intent.estimatedTotal) * 100) / 100);
      const feeAmount = Math.max(0, Math.round((intent.platformFeeAmount || 0) * 100) / 100);
      const merchantAmount = Math.max(0, Math.round((intent.merchantReceivableAmount ?? (grossAmount - feeAmount)) * 100) / 100);
      await insertLedgerEntryIfMissing(ctx, {
        tenantId: intent.tenantId,
        orderIntentId: intent._id,
        kind: "gross_payment",
        direction: "credit",
        amount: grossAmount,
        currency: intent.currency,
        description: `Gross storefront payment for ${intent.storefrontSlug}`,
        createdAt: now,
      });
      await insertLedgerEntryIfMissing(ctx, {
        tenantId: intent.tenantId,
        orderIntentId: intent._id,
        kind: "platform_fee",
        direction: "credit",
        amount: feeAmount,
        currency: intent.currency,
        description: `OdogwuHQ platform fee for ${intent.storefrontSlug}`,
        createdAt: now,
      });
      await insertLedgerEntryIfMissing(ctx, {
        tenantId: intent.tenantId,
        orderIntentId: intent._id,
        kind: "merchant_receivable",
        direction: "credit",
        amount: merchantAmount,
        currency: intent.currency,
        description: `Business payout receivable for ${intent.storefrontSlug}`,
        createdAt: now,
      });
    }

    await ctx.db.insert("systemEvents", {
      tenantId: intent.tenantId,
      source: "convex",
      eventType: paid ? "storefront.payment.paid" : "storefront.payment.failed",
      threadId: intent.threadId,
      detail: JSON.stringify({
        txRef,
        transactionId: args.transactionId,
        status: args.status,
        amount: args.amount,
        currency: args.currency,
        customerEmail: args.customerEmail,
        payload: args.payloadSummary?.slice(0, 600),
      }).slice(0, 1800),
      createdAt: now,
    });

    return {
      orderIntentId: intent._id,
      storefrontSlug: intent.storefrontSlug,
      status: paid ? "paid" : "failed",
    };
  },
});

export const getPublicStorefront = query({
  args: {
    slug: v.string(),
    productLimit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const slug = normalizeSlug(args.slug, args.slug);
    const profile = await ctx.db
      .query("storefrontProfiles")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();
    if (!profile || !profile.enabled) {
      return null;
    }

    const productLimit = Math.min(Math.max(args.productLimit ?? 60, 1), 100);
    const products = await ctx.db
      .query("storefrontProducts")
      .withIndex("by_tenantId_and_active_and_sortOrder", (q) => q.eq("tenantId", profile.tenantId).eq("active", true))
      .order("asc")
      .take(productLimit);

    return {
      profile,
      products: products.filter((product) => product.stockStatus !== "sold_out"),
    };
  },
});

export const createOrderIntent = mutation({
  args: {
    storefrontSlug: v.string(),
    customerName: v.optional(v.string()),
    customerContact: v.optional(v.string()),
    customerMessage: v.optional(v.string()),
    items: v.array(orderItemValidator),
    source: v.optional(v.union(v.literal("hosted_shop"), v.literal("embed"), v.literal("manual"))),
  },
  handler: async (ctx, args) => {
    const slug = normalizeSlug(args.storefrontSlug, args.storefrontSlug);
    const profile = await ctx.db
      .query("storefrontProfiles")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();
    if (!profile || !profile.enabled) {
      throw new Error("Storefront is not available.");
    }
    if (!(await isTenantBusinessSellingEnabled(ctx, profile.tenantId))) {
      throw new Error("Storefront is not available.");
    }

    const items = await normalizeOrderItems(ctx, profile.tenantId, args.items);
    if (items.length === 0) {
      throw new Error("Choose at least one item.");
    }

    const currency = items[0]?.currency || "NGN";
    const estimatedTotal = Math.round(
      items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0) * 100,
    ) / 100;
    const now = Date.now();
    const customerName = args.customerName?.trim().slice(0, 120) || undefined;
    const customerContact = args.customerContact?.trim().slice(0, 160) || undefined;
    const customerMessage = args.customerMessage?.trim().slice(0, 1200) || undefined;
    const source = args.source || "hosted_shop";
    const orderIntentId = await ctx.db.insert("storefrontOrderIntents", {
      tenantId: profile.tenantId,
      storefrontSlug: slug,
      customerName,
      customerContact,
      customerMessage,
      items,
      estimatedTotal,
      currency,
      source,
      status: "new",
      paymentStatus: "unpaid",
      createdAt: now,
      updatedAt: now,
    });
    const customerKey = normalizeCustomerKey(customerContact || customerName || String(orderIntentId));
    const threadJid = `storefront:${slug}:${customerKey}`;
    const threadTitle = customerName || customerContact || `${profile.displayName} storefront customer`;
    const existingThread = await ctx.db
      .query("threads")
      .withIndex("by_tenantId_and_jid", (q) => q.eq("tenantId", profile.tenantId).eq("jid", threadJid))
      .first();
    const messageText = buildOrderMessage({
      displayName: profile.displayName,
      items,
      estimatedTotal,
      currency,
      customerName,
      customerContact,
      customerMessage,
    });
    const threadId = existingThread
      ? existingThread._id
      : await ctx.db.insert("threads", {
          tenantId: profile.tenantId,
          jid: threadJid,
          title: threadTitle,
          isGroup: false,
          isIgnored: false,
          threadKind: "direct",
          isArchived: false,
          lastMessageAt: now,
          createdAt: now,
          updatedAt: now,
        });

    if (existingThread) {
      await ctx.db.patch(existingThread._id, {
        title: existingThread.title || threadTitle,
        lastMessageAt: Math.max(existingThread.lastMessageAt, now),
        updatedAt: now,
      });
    }

    const sourceMessageId = await ctx.db.insert("messages", {
      tenantId: profile.tenantId,
      threadId,
      direction: "inbound",
      origin: "live",
      providerMessageId: `storefront-order:${orderIntentId}`,
      senderJid: threadJid,
      text: messageText,
      messageType: "text",
      messageAt: now,
      createdAt: now,
    });
    const followUpId = await ctx.db.insert("followUps", {
      tenantId: profile.tenantId,
      threadId,
      sourceMessageId,
      reason: `Storefront order request from ${threadTitle}`,
      draftText: "Thanks for your order request. I will confirm availability, delivery, and payment next steps shortly.",
      dueAt: now,
      kind: "request",
      direction: "inbound",
      confidence: 0.96,
      normalizedKey: `storefront:${orderIntentId}`,
      sourceSnippet: messageText.slice(0, 240),
      status: "suggested",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(orderIntentId, {
      threadId,
      sourceMessageId,
      followUpId,
      updatedAt: now,
    });
    return orderIntentId;
  },
});

export const upsertLiveChatSession = mutation({
  args: {
    storefrontSlug: v.string(),
    visitorId: v.string(),
    customerName: v.optional(v.string()),
    customerContact: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const slug = normalizeSlug(args.storefrontSlug, args.storefrontSlug);
    const visitorId = args.visitorId.trim().slice(0, 160);
    if (!visitorId) {
      throw new Error("Visitor id is required.");
    }
    const profile = await ctx.db
      .query("storefrontProfiles")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();
    if (!profile || !profile.enabled || !profile.liveChatEnabled) {
      throw new Error("Livechat is not available.");
    }

    const now = Date.now();
    const existing = await ctx.db
      .query("storefrontLiveChatSessions")
      .withIndex("by_storefrontSlug_and_visitorId", (q) => q.eq("storefrontSlug", slug).eq("visitorId", visitorId))
      .first();
    const patch = {
      tenantId: profile.tenantId,
      customerName: args.customerName?.trim().slice(0, 120) || undefined,
      customerContact: args.customerContact?.trim().slice(0, 160) || undefined,
      status: "open" as const,
      lastMessageAt: now,
      updatedAt: now,
    };
    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return existing._id;
    }
    return await ctx.db.insert("storefrontLiveChatSessions", {
      storefrontSlug: slug,
      visitorId,
      ...patch,
      createdAt: now,
    });
  },
});

function readAdminSecret() {
  return process.env.ODOGWU_CONVEX_ADMIN_SECRET || process.env.ODOGWU_ADMIN_SECRET || process.env.SLM_ADMIN_SECRET || "";
}

function requireAdmin(adminSecret: string) {
  const expected = readAdminSecret();
  if (!expected || adminSecret !== expected) {
    throw new Error("Unauthorized.");
  }
}

function summarizeLedger(entries: Array<{
  tenantId?: Id<"tenantAccounts">;
  orderIntentId?: Id<"storefrontOrderIntents">;
  amount: number;
  currency: string;
}>) {
  const byTenant = new Map<string, {
    tenantId?: Id<"tenantAccounts">;
    grossAmount: number;
    feeAmount: number;
    netAmount: number;
    orderIds: Set<string>;
  }>();
  for (const entry of entries) {
    const key = String(entry.tenantId || "platform");
    const existing = byTenant.get(key) || {
      tenantId: entry.tenantId,
      grossAmount: 0,
      feeAmount: 0,
      netAmount: 0,
      orderIds: new Set<string>(),
    };
    existing.netAmount += entry.amount;
    if (entry.orderIntentId) {
      existing.orderIds.add(String(entry.orderIntentId));
    }
    byTenant.set(key, existing);
  }
  return [...byTenant.values()];
}

async function summarizePayoutReceivables(
  ctx: MutationCtx,
  entries: Array<{
    tenantId?: Id<"tenantAccounts">;
    orderIntentId?: Id<"storefrontOrderIntents">;
    amount: number;
    currency: string;
  }>,
) {
  const byTenant = new Map<string, {
    tenantId?: Id<"tenantAccounts">;
    grossAmount: number;
    feeAmount: number;
    netAmount: number;
    orderIds: Set<string>;
  }>();
  const seenOrders = new Set<string>();

  for (const entry of entries) {
    const key = String(entry.tenantId || "platform");
    const existing = byTenant.get(key) || {
      tenantId: entry.tenantId,
      grossAmount: 0,
      feeAmount: 0,
      netAmount: 0,
      orderIds: new Set<string>(),
    };
    existing.netAmount += entry.amount;
    if (entry.orderIntentId) {
      const orderKey = String(entry.orderIntentId);
      existing.orderIds.add(orderKey);
      if (!seenOrders.has(orderKey)) {
        seenOrders.add(orderKey);
        const order = await ctx.db.get(entry.orderIntentId);
        if (order) {
          existing.grossAmount += order.paymentAmount || order.estimatedTotal || 0;
          existing.feeAmount += order.platformFeeAmount || 0;
        }
      }
    }
    byTenant.set(key, existing);
  }

  return [...byTenant.values()];
}

export const adminPayoutOps = query({
  args: {
    adminSecret: v.string(),
    currency: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    requireAdmin(args.adminSecret);
    const currency = normalizeCurrency(args.currency);
    const limit = Math.min(Math.max(args.limit ?? 200, 1), 500);
    const receivables = await ctx.db
      .query("storefrontLedgerEntries")
      .withIndex("by_status_and_currency_and_createdAt", (q) => q.eq("status", "available").eq("currency", currency))
      .order("asc")
      .take(limit);
    const merchantReceivables = receivables.filter((entry) => entry.kind === "merchant_receivable");
    const tenantSummaries = await Promise.all(summarizeLedger(merchantReceivables).map(async (summary) => ({
      tenantId: summary.tenantId,
      netAmount: Math.round(summary.netAmount * 100) / 100,
      orderCount: summary.orderIds.size,
      payoutAccount: publicPayoutAccount(await readPayoutAccountForTenant(ctx, summary.tenantId)),
    })));
    const draftBatches = await ctx.db
      .query("storefrontPayoutBatches")
      .withIndex("by_currency_and_status_and_createdAt", (q) => q.eq("currency", currency).eq("status", "draft"))
      .order("desc")
      .take(10);
    const processingBatches = await ctx.db
      .query("storefrontPayoutBatches")
      .withIndex("by_currency_and_status_and_createdAt", (q) => q.eq("currency", currency).eq("status", "processing"))
      .order("desc")
      .take(10);
    const batches = [...draftBatches, ...processingBatches]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 10);
    return {
      currency,
      availableNetAmount: Math.round(merchantReceivables.reduce((sum, entry) => sum + entry.amount, 0) * 100) / 100,
      availableEntryCount: merchantReceivables.length,
      tenantSummaries,
      draftBatches: batches,
    };
  },
});

export const adminCreateWeekendPayoutBatch = mutation({
  args: {
    adminSecret: v.string(),
    currency: v.optional(v.string()),
    payoutWindowStart: v.optional(v.number()),
    payoutWindowEnd: v.optional(v.number()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireAdmin(args.adminSecret);
    const now = Date.now();
    const currency = normalizeCurrency(args.currency);
    const payoutWindowStart = args.payoutWindowStart ?? 0;
    const payoutWindowEnd = args.payoutWindowEnd ?? now;
    const available = await ctx.db
      .query("storefrontLedgerEntries")
      .withIndex("by_status_and_currency_and_createdAt", (q) => q.eq("status", "available").eq("currency", currency))
      .order("asc")
      .take(500);
    const receivables = available.filter((entry) =>
      entry.kind === "merchant_receivable" &&
      entry.createdAt >= payoutWindowStart &&
      entry.createdAt <= payoutWindowEnd
    );
    if (receivables.length === 0) {
      throw new Error("No available merchant receivables for this payout window.");
    }

    const orderIds = new Set(receivables.flatMap((entry) => entry.orderIntentId ? [String(entry.orderIntentId)] : []));
    const tenantSummaries = await summarizePayoutReceivables(ctx, receivables);
    const totalGrossAmount = Math.round(tenantSummaries.reduce((sum, summary) => sum + summary.grossAmount, 0) * 100) / 100;
    const totalFeeAmount = Math.round(tenantSummaries.reduce((sum, summary) => sum + summary.feeAmount, 0) * 100) / 100;
    const totalNetAmount = Math.round(tenantSummaries.reduce((sum, summary) => sum + summary.netAmount, 0) * 100) / 100;
    const batchId = await ctx.db.insert("storefrontPayoutBatches", {
      currency,
      status: "draft",
      payoutWindowStart,
      payoutWindowEnd,
      totalGrossAmount,
      totalFeeAmount,
      totalNetAmount,
      tenantCount: tenantSummaries.length,
      orderCount: orderIds.size,
      notes: args.notes?.trim().slice(0, 1000) || undefined,
      createdAt: now,
      updatedAt: now,
    });

    for (const summary of tenantSummaries) {
      const payoutAccount = await readPayoutAccountForTenant(ctx, summary.tenantId);
      const itemId = await ctx.db.insert("storefrontPayoutBatchItems", {
        batchId,
        tenantId: summary.tenantId,
        currency,
        grossAmount: Math.round(summary.grossAmount * 100) / 100,
        feeAmount: Math.round(summary.feeAmount * 100) / 100,
        netAmount: Math.round(summary.netAmount * 100) / 100,
        orderCount: summary.orderIds.size,
        status: "pending",
        payoutAccountId: payoutAccount?._id,
        payoutAccountLabel: payoutAccount ? `${payoutAccount.bankName} ****${payoutAccount.accountNumberLast4}` : undefined,
        transferProvider: payoutAccount?.provider,
        createdAt: now,
        updatedAt: now,
      });
      for (const entry of receivables.filter((candidate) => candidate.tenantId === summary.tenantId)) {
        await ctx.db.patch(entry._id, {
          status: "payout_pending",
          payoutBatchId: batchId,
          payoutBatchItemId: itemId,
          updatedAt: now,
        });
      }
    }

    return batchId;
  },
});

export const adminSetPayoutAccountStatus = mutation({
  args: {
    adminSecret: v.string(),
    tenantId: v.optional(v.id("tenantAccounts")),
    status: v.union(v.literal("submitted"), v.literal("verified"), v.literal("rejected")),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireAdmin(args.adminSecret);
    const account = await readPayoutAccountForTenant(ctx, args.tenantId);
    if (!account) {
      throw new Error("Payout account not found.");
    }
    const now = Date.now();
    await ctx.db.patch(account._id, {
      kycStatus: args.status,
      verificationNotes: cleanPayoutText(args.notes, 1000) || undefined,
      verifiedAt: args.status === "verified" ? now : undefined,
      updatedAt: now,
    });
    return account._id;
  },
});

export const adminPreparePayoutBatchTransfers = mutation({
  args: {
    adminSecret: v.string(),
    batchId: v.id("storefrontPayoutBatches"),
    callbackUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireAdmin(args.adminSecret);
    const now = Date.now();
    const batch = await ctx.db.get(args.batchId);
    if (!batch) {
      throw new Error("Payout batch not found.");
    }
    if (batch.status === "paid" || batch.status === "cancelled") {
      throw new Error("This payout batch cannot be initiated.");
    }
    const items = await ctx.db
      .query("storefrontPayoutBatchItems")
      .withIndex("by_batchId", (q) => q.eq("batchId", args.batchId))
      .take(500);
    const transfers = [];
    for (const item of items) {
      if (item.status === "paid" || item.transferStatus === "successful") {
        continue;
      }
      const account = item.payoutAccountId ? await ctx.db.get(item.payoutAccountId) : await readPayoutAccountForTenant(ctx, item.tenantId);
      if (!account || account.kycStatus !== "verified") {
        await ctx.db.patch(item._id, {
          status: "failed",
          transferStatus: "failed",
          failureReason: "Missing verified payout account.",
          updatedAt: now,
        });
        continue;
      }
      const transferReference = item.transferReference || `odogwu_payout_${item._id}_${now}`;
      await ctx.db.patch(item._id, {
        status: "pending",
        payoutAccountId: account._id,
        payoutAccountLabel: `${account.bankName} ****${account.accountNumberLast4}`,
        transferProvider: "flutterwave",
        transferReference,
        transferStatus: "pending",
        initiatedAt: now,
        updatedAt: now,
      });
      transfers.push({
        batchItemId: item._id,
        tenantId: item.tenantId,
        amount: Math.round(item.netAmount * 100) / 100,
        currency: item.currency,
        reference: transferReference,
        accountBank: account.bankCode,
        encryptedAccountNumber: account.encryptedAccountNumber,
        bankName: account.bankName,
        accountName: account.accountName,
        narration: `OdogwuHQ weekend payout ${String(item._id).slice(-8)}`,
        callbackUrl: args.callbackUrl,
      });
    }
    await ctx.db.patch(args.batchId, {
      status: "processing",
      updatedAt: now,
    });
    return { batchId: args.batchId, transfers };
  },
});

async function markPayoutItemPaid(
  ctx: MutationCtx,
  args: {
    item: Doc<"storefrontPayoutBatchItems">;
    batchId: Id<"storefrontPayoutBatches">;
    now: number;
    externalReference?: string;
    notes?: string;
  },
) {
  await ctx.db.patch(args.item._id, {
    status: "paid",
    transferStatus: "successful",
    externalReference: args.externalReference || args.item.externalReference,
    notes: args.notes || args.item.notes,
    paidAt: args.now,
    updatedAt: args.now,
  });
  const entries = await ctx.db
    .query("storefrontLedgerEntries")
    .withIndex("by_payoutBatchId", (q) => q.eq("payoutBatchId", args.batchId))
    .take(500);
  const receivables = entries.filter((entry) => entry.kind === "merchant_receivable" && entry.payoutBatchItemId === args.item._id);
  const alreadyDebited = entries.some((entry) => entry.kind === "merchant_payout" && entry.payoutBatchItemId === args.item._id);
  for (const entry of receivables) {
    await ctx.db.patch(entry._id, {
      status: "paid",
      updatedAt: args.now,
    });
    if (!alreadyDebited) {
      await ctx.db.insert("storefrontLedgerEntries", {
        tenantId: entry.tenantId,
        payoutBatchId: args.batchId,
        payoutBatchItemId: entry.payoutBatchItemId,
        kind: "merchant_payout",
        direction: "debit",
        status: "paid",
        amount: entry.amount,
        currency: entry.currency,
        description: `Weekend payout for receivable ${entry._id}`,
        createdAt: args.now,
        updatedAt: args.now,
      });
    }
  }
}

export const adminRecordPayoutTransferResult = mutation({
  args: {
    adminSecret: v.string(),
    transferReference: v.string(),
    transferId: v.optional(v.string()),
    status: v.union(v.literal("pending"), v.literal("processing"), v.literal("successful"), v.literal("failed")),
    failureReason: v.optional(v.string()),
    providerPayloadSummary: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireAdmin(args.adminSecret);
    const now = Date.now();
    const item = await ctx.db
      .query("storefrontPayoutBatchItems")
      .withIndex("by_transferReference", (q) => q.eq("transferReference", args.transferReference.trim()))
      .first();
    if (!item) {
      throw new Error("Payout transfer reference not found.");
    }
    const nextItemStatus = args.status === "successful" ? "paid" : args.status === "failed" ? "failed" : "pending";
    await ctx.db.patch(item._id, {
      status: nextItemStatus,
      transferId: args.transferId || item.transferId,
      transferStatus: args.status,
      failureReason: cleanPayoutText(args.failureReason || args.providerPayloadSummary, 1000) || undefined,
      updatedAt: now,
    });
    if (args.status === "successful") {
      await markPayoutItemPaid(ctx, {
        item: { ...item, transferId: args.transferId || item.transferId, transferStatus: args.status },
        batchId: item.batchId,
        now,
        externalReference: args.transferId || args.transferReference,
        notes: cleanPayoutText(args.providerPayloadSummary, 1000) || undefined,
      });
    }

    const batchItems = await ctx.db
      .query("storefrontPayoutBatchItems")
      .withIndex("by_batchId", (q) => q.eq("batchId", item.batchId))
      .take(500);
    const patchedItems = batchItems.map((candidate) =>
      candidate._id === item._id
        ? { ...candidate, status: nextItemStatus, transferStatus: args.status }
        : candidate
    );
    const allPaid = patchedItems.length > 0 && patchedItems.every((candidate) => candidate.status === "paid");
    await ctx.db.patch(item.batchId, {
      status: allPaid ? "paid" : "processing",
      paidAt: allPaid ? now : undefined,
      updatedAt: now,
    });
    return item._id;
  },
});

export const adminMarkPayoutBatchPaid = mutation({
  args: {
    adminSecret: v.string(),
    batchId: v.id("storefrontPayoutBatches"),
    externalReference: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireAdmin(args.adminSecret);
    const now = Date.now();
    const batch = await ctx.db.get(args.batchId);
    if (!batch) {
      throw new Error("Payout batch not found.");
    }
    if (batch.status === "paid") {
      throw new Error("Payout batch is already marked paid.");
    }
    const items = await ctx.db
      .query("storefrontPayoutBatchItems")
      .withIndex("by_batchId", (q) => q.eq("batchId", args.batchId))
      .take(500);
    for (const item of items) {
      await markPayoutItemPaid(ctx, {
        item,
        batchId: args.batchId,
        now,
        externalReference: args.externalReference?.trim().slice(0, 160) || item.externalReference,
        notes: args.notes?.trim().slice(0, 1000) || item.notes,
      });
    }
    await ctx.db.patch(args.batchId, {
      status: "paid",
      notes: args.notes?.trim().slice(0, 1000) || batch.notes,
      paidAt: now,
      updatedAt: now,
    });
    return args.batchId;
  },
});
