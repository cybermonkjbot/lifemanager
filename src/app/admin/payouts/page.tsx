import { AdminMasqueradeBanner } from "@/components/admin-masquerade-banner";
import { AdminConsoleShell } from "@/components/admin-console-shell";
import { AdminStorefrontPayoutsDashboard, type StorefrontPayoutOps } from "@/components/admin-storefront-payouts-dashboard";
import { requireAdminPageAccess } from "@/lib/admin-auth";
import { getAdminMasqueradeCookieName, readAdminMasqueradeToken } from "@/lib/admin-masquerade";
import { convexRefs } from "@/lib/convex-refs";
import { createConvexClient } from "@/lib/convex-server";
import { getConvexAdminSecret } from "@/lib/managed-secret-crypto";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

export default async function AdminPayoutsPage() {
  await requireAdminPageAccess("/admin/payouts");
  const cookieStore = await cookies();
  const masqueradeSession = readAdminMasqueradeToken(cookieStore.get(getAdminMasqueradeCookieName())?.value);
  const ops = (await createConvexClient().query(convexRefs.storefrontAdminPayoutOps, {
    adminSecret: getConvexAdminSecret(),
    currency: "NGN",
  })) as StorefrontPayoutOps;

  return (
    <AdminConsoleShell>
      {masqueradeSession ? <AdminMasqueradeBanner session={masqueradeSession} /> : null}
      <header className="admin-console-header">
        <div>
          <p className="admin-kicker">Storefront Money</p>
          <h1>Payouts</h1>
          <p>Customers pay OdogwuHQ first. Review business receivables and create weekend payout batches.</p>
        </div>
      </header>
      <AdminStorefrontPayoutsDashboard initialOps={ops} />
    </AdminConsoleShell>
  );
}
