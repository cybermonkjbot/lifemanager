import { convexRefs } from "./convex-refs";
import { createConvexClient, getConvexUrl } from "./convex-server";
import { readLocalInstanceConfig } from "./instance-config";

export type BillingSnapshot = {
  billingStatus?: string;
  trialEndsAt?: number | null;
  subscriptionExpiresAt?: number | null;
};

export function hostedBillingIsActive(snapshot: BillingSnapshot, now = Date.now()) {
  if (snapshot.billingStatus === "trialing") {
    return typeof snapshot.trialEndsAt === "number" && snapshot.trialEndsAt >= now;
  }
  if (snapshot.billingStatus === "active") {
    return typeof snapshot.subscriptionExpiresAt !== "number" || snapshot.subscriptionExpiresAt > now;
  }
  return false;
}

export async function getCurrentHostedBillingGate(now = Date.now()) {
  const config = await readLocalInstanceConfig();
  if (!config?.setupCompleted || config.preferences.serviceMode !== "hosted" || !config.account?.tenantId) {
    return {
      billingRequired: false,
      billingStatus: config?.account?.billingStatus || "unknown",
    };
  }

  try {
    const summary = await createConvexClient(getConvexUrl()).query(convexRefs.billingGetTenantBillingSummary, {
      tenantId: config.account.tenantId,
    }) as {
      tenant?: BillingSnapshot;
    } | null;

    if (summary?.tenant) {
      return {
        billingRequired: !hostedBillingIsActive(summary.tenant, now),
        billingStatus: summary.tenant.billingStatus || "unknown",
      };
    }
  } catch {
    // Fall back to local state if Convex cannot be reached.
  }

  return {
    billingRequired: !hostedBillingIsActive(config.account, now),
    billingStatus: config.account.billingStatus,
  };
}
