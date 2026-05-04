import { NextRequest, NextResponse } from "next/server";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { createConvexClient } from "@/lib/convex-server";
import { requireRuntimeControlApiAccess } from "@/lib/instance-guard";
import { encryptManagedSecret } from "@/lib/managed-secret-crypto";
import { rateLimitJsonResponse } from "@/lib/rate-limit";
import { getTenantSessionCookieName, verifyTenantSessionToken } from "@/lib/tenant-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PayoutAccountBody = {
  country?: string;
  currency?: string;
  bankCode?: string;
  bankName?: string;
  accountNumber?: string;
  accountName?: string;
  businessLegalName?: string;
};

function normalizeAccountNumber(value: string | undefined) {
  return (value || "").trim().replace(/\D/g, "").slice(0, 24);
}

export async function POST(request: NextRequest) {
  const unauthorized = await requireRuntimeControlApiAccess(request, "json");
  if (unauthorized) {
    return unauthorized;
  }
  const limited = await rateLimitJsonResponse(request, {
    scope: "storefront.payout_account",
    identity: request.cookies.get(getTenantSessionCookieName())?.value || request.headers.get("user-agent") || "anonymous",
    limit: 10,
    windowMs: 60 * 60 * 1000,
    penaltyMs: 20 * 60 * 1000,
  });
  if (limited) {
    return limited;
  }

  try {
    const tenantSession = await verifyTenantSessionToken(request.cookies.get(getTenantSessionCookieName())?.value);
    if (!tenantSession || (tenantSession.role !== "owner" && tenantSession.role !== "admin")) {
      return NextResponse.json({ error: "Only an account owner or admin can update payout details." }, { status: 403 });
    }

    const body = (await request.json().catch(() => ({}))) as PayoutAccountBody;
    const accountNumber = normalizeAccountNumber(body.accountNumber);
    if (accountNumber.length < 6) {
      throw new Error("Add a valid payout account number.");
    }
    const payoutAccount = await createConvexClient().mutation(api.storefront.upsertPayoutAccount, {
      tenantId: tenantSession.tenantId as Id<"tenantAccounts">,
      provider: "flutterwave",
      country: body.country,
      currency: body.currency,
      bankCode: body.bankCode || "",
      bankName: body.bankName || "",
      encryptedAccountNumber: encryptManagedSecret(accountNumber),
      accountNumberLast4: accountNumber.slice(-4),
      accountName: body.accountName || "",
      businessLegalName: body.businessLegalName,
    });
    return NextResponse.json({ payoutAccount });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save payout details." },
      { status: 400 },
    );
  }
}
