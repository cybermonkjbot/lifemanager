import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { AppConfig } from "./config";
import { isTenantBusinessSellingEnabled } from "./billingAccess";

function normalizeSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export async function syncStorefrontProfileFromConfig(
  ctx: MutationCtx,
  tenantId: Id<"tenantAccounts"> | undefined,
  config: Pick<
    AppConfig,
    | "businessBrandName"
    | "businessBrandVoice"
    | "businessOfferSummary"
    | "storefrontEnabled"
    | "storefrontSlug"
    | "storefrontFeeBps"
    | "liveChatEnabled"
    | "liveChatWelcomeMessage"
  >,
) {
  const now = Date.now();
  const slug = normalizeSlug(config.storefrontSlug);
  const displayName = config.businessBrandName.trim().slice(0, 120);
  const sellingEnabled = await isTenantBusinessSellingEnabled(ctx, tenantId, now);
  const existing = await ctx.db
    .query("storefrontProfiles")
    .withIndex("by_tenantId", (q) => q.eq("tenantId", tenantId))
    .first();

  const patch = {
    slug,
    displayName,
    offerSummary: config.businessOfferSummary.trim().slice(0, 2000),
    brandVoice: config.businessBrandVoice.trim().slice(0, 2000),
    enabled: Boolean(sellingEnabled && config.storefrontEnabled && slug && displayName),
    liveChatEnabled: Boolean(sellingEnabled && config.liveChatEnabled),
    liveChatWelcomeMessage: config.liveChatWelcomeMessage.trim().slice(0, 600),
    feeBps: Math.round(Math.max(0, Math.min(config.storefrontFeeBps, 2000))),
    updatedAt: now,
  };

  if (existing) {
    await ctx.db.patch(existing._id, patch);
    return existing._id;
  }

  return await ctx.db.insert("storefrontProfiles", {
    tenantId,
    ...patch,
    createdAt: now,
  });
}
