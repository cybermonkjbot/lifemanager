import { NextRequest, NextResponse } from "next/server";
import { convexRefs } from "@/lib/convex-refs";
import { createConvexClient } from "@/lib/convex-server";
import { readLocalInstanceConfig } from "@/lib/instance-config";
import { requireInstanceApiAccess } from "@/lib/instance-guard";
import { resolveManagedSecretValue } from "@/lib/managed-secrets-server";
import { rateLimitJsonResponse } from "@/lib/rate-limit";
import { getTenantSessionCookieName, verifyTenantSessionToken } from "@/lib/tenant-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Plan = "personal_connector" | "business_whatsapp";

const CHECKOUT_UNAVAILABLE_MESSAGE = "Checkout is not available right now. Contact support and we'll help you get set up.";

function cleanBaseUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return withProtocol.replace(/\/+$/, "");
}

function parsePlan(value: unknown, fallback: string): Plan {
  const plan = typeof value === "string" ? value.trim() : fallback;
  if (plan === "personal_connector" || plan === "business_whatsapp") {
    return plan;
  }
  throw new Error("Choose a hosted subscription plan.");
}

function parseAmount(value: string) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(CHECKOUT_UNAVAILABLE_MESSAGE);
  }
  return amount;
}

async function readPlanConfig(plan: Plan) {
  const [currencyRaw, personalAmountRaw, businessAmountRaw, personalPlanId, businessPlanId] = await Promise.all([
    resolveManagedSecretValue("billing.currency"),
    resolveManagedSecretValue("billing.personalAmount"),
    resolveManagedSecretValue("billing.businessAmount"),
    resolveManagedSecretValue("flutterwave.personalPlanId"),
    resolveManagedSecretValue("flutterwave.businessPlanId"),
  ]);
  const currency = (currencyRaw || "NGN").trim().toUpperCase();
  if (plan === "personal_connector") {
    return {
      amount: parseAmount(personalAmountRaw),
      currency,
      paymentPlanId: personalPlanId.trim(),
    };
  }
  return {
    amount: parseAmount(businessAmountRaw),
    currency,
    paymentPlanId: businessPlanId.trim(),
  };
}

export async function POST(request: NextRequest) {
  const unauthorized = await requireInstanceApiAccess(request, "json");
  if (unauthorized) {
    return unauthorized;
  }
  const limited = await rateLimitJsonResponse(request, {
    scope: "billing.checkout",
    identity: request.cookies.get(getTenantSessionCookieName())?.value || "",
    limit: 5,
    windowMs: 60 * 60 * 1000,
    penaltyMs: 30 * 60 * 1000,
  });
  if (limited) {
    return limited;
  }

  try {
    const tenantSession = await verifyTenantSessionToken(request.cookies.get(getTenantSessionCookieName())?.value);
    if (!tenantSession || (tenantSession.role !== "owner" && tenantSession.role !== "admin")) {
      return NextResponse.json({ error: "Only an account owner or admin can manage billing." }, { status: 403 });
    }

    const localConfig = await readLocalInstanceConfig();
    const tenantEmail = localConfig?.account?.email || "";
    if (!tenantEmail) {
      throw new Error("Add your account email before starting checkout.");
    }
    const body = await request.json().catch(() => ({})) as { plan?: unknown };
    const plan = parsePlan(body.plan, localConfig?.account?.billingStatus === "self_hosted" ? "self_hosted" : "personal_connector");
    const config = await readPlanConfig(plan);
    if (!config.paymentPlanId) {
      throw new Error(CHECKOUT_UNAVAILABLE_MESSAGE);
    }

    const secretKey = await resolveManagedSecretValue("flutterwave.secretKey");
    if (!secretKey) {
      throw new Error(CHECKOUT_UNAVAILABLE_MESSAGE);
    }
    const baseUrl =
      cleanBaseUrl(await resolveManagedSecretValue("billing.redirectBaseUrl")) ||
      cleanBaseUrl(process.env.NEXT_PUBLIC_APP_URL || "") ||
      new URL(request.url).origin;
    const txRef = `odogwu_${tenantSession.tenantId}_${Date.now()}`;
    const redirectUrl = `${baseUrl}/api/billing/flutterwave/callback?tx_ref=${encodeURIComponent(txRef)}`;

    const checkout = await createConvexClient().mutation(convexRefs.billingCreateCheckoutFromTenantSession, {
      tenantId: tenantSession.tenantId,
      deviceId: tenantSession.deviceId,
      email: tenantEmail,
      plan,
      amount: config.amount,
      currency: config.currency,
      flutterwavePaymentPlanId: config.paymentPlanId,
      txRef,
    }) as { email: string; displayName: string };

    const response = await fetch("https://api.flutterwave.com/v3/payments", {
      method: "POST",
      headers: {
        authorization: `Bearer ${secretKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        tx_ref: txRef,
        amount: config.amount,
        currency: config.currency,
        redirect_url: redirectUrl,
        payment_plan: config.paymentPlanId,
        customer: {
          email: checkout.email,
          name: checkout.displayName || localConfig?.account?.displayName || checkout.email,
        },
        meta: {
          tenantId: tenantSession.tenantId,
          plan,
        },
        customizations: {
          title: "OdogwuHQ subscription",
          description: plan.replace(/_/g, " "),
        },
      }),
    });
    const payload = await response.json().catch(() => ({})) as { data?: { link?: string }; message?: string };
    if (!response.ok || !payload.data?.link) {
      throw new Error(payload.message || `Flutterwave checkout failed (${response.status}).`);
    }
    await createConvexClient().mutation(convexRefs.billingAttachCheckoutLinkFromTenantSession, {
      tenantId: tenantSession.tenantId,
      deviceId: tenantSession.deviceId,
      email: tenantEmail,
      txRef,
      paymentLink: payload.data.link,
    });

    return NextResponse.json({ paymentLink: payload.data.link, txRef });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to start subscription checkout." }, { status: 400 });
  }
}
