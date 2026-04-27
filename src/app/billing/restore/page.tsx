import { BillingRestoreCard } from "@/components/billing-restore-card";
import { BrandLogo } from "@/components/brand-logo";
import { convexRefs } from "@/lib/convex-refs";
import { createConvexClient, getConvexUrl } from "@/lib/convex-server";
import { readLocalInstanceConfig } from "@/lib/instance-config";
import { requireInstancePageAccess } from "@/lib/instance-guard";

type BillingStatus = "trialing" | "active" | "past_due" | "paused" | "canceled" | "self_hosted" | "unknown";
type HostedPlan = "personal_connector" | "business_whatsapp";

function normalizePlan(value: unknown): HostedPlan {
  return value === "business_whatsapp" ? "business_whatsapp" : "personal_connector";
}

async function loadBillingState() {
  const config = await readLocalInstanceConfig();
  const tenantId = config?.account?.tenantId;
  const fallback = {
    billingStatus: config?.account?.billingStatus || "unknown" as BillingStatus,
    plan: "personal_connector" as HostedPlan,
  };
  if (!tenantId) {
    return fallback;
  }

  try {
    const summary = await createConvexClient(getConvexUrl()).query(convexRefs.billingGetTenantBillingSummary, {
      tenantId,
    }) as {
      tenant?: {
        billingStatus?: BillingStatus;
        plan?: HostedPlan;
      };
    } | null;
    return {
      billingStatus: summary?.tenant?.billingStatus || fallback.billingStatus,
      plan: normalizePlan(summary?.tenant?.plan),
    };
  } catch {
    return fallback;
  }
}

export default async function BillingRestorePage() {
  await requireInstancePageAccess({ allowBillingRequired: true });
  const billingState = await loadBillingState();

  return (
    <main className="instance-lock-shell">
      <section className="instance-lock-card">
        <BrandLogo className="instance-lock-logo" priority />
        <BillingRestoreCard billingStatus={billingState.billingStatus} plan={billingState.plan} />
      </section>
    </main>
  );
}
