import { AdminMasqueradeBanner } from "@/components/admin-masquerade-banner";
import { AdminConsoleShell } from "@/components/admin-console-shell";
import { AdminEntitlementsDashboard, type AdminSubscriptionConfig } from "@/components/admin-config-dashboards";
import { requireAdminPageAccess } from "@/lib/admin-auth";
import { getAdminMasqueradeCookieName, readAdminMasqueradeToken } from "@/lib/admin-masquerade";
import { convexRefs } from "@/lib/convex-refs";
import { createConvexClient } from "@/lib/convex-server";
import { getConvexAdminSecret } from "@/lib/managed-secret-crypto";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

export default async function AdminEntitlementsPage() {
  await requireAdminPageAccess("/admin/entitlements");
  const cookieStore = await cookies();
  const masqueradeSession = readAdminMasqueradeToken(cookieStore.get(getAdminMasqueradeCookieName())?.value);
  const config = (await createConvexClient().query(convexRefs.adminPlatformSubscriptionConfig, {
    adminSecret: getConvexAdminSecret(),
  })) as AdminSubscriptionConfig;

  return (
    <AdminConsoleShell>
      {masqueradeSession ? <AdminMasqueradeBanner session={masqueradeSession} /> : null}
      <header className="admin-console-header">
        <div>
          <p className="admin-kicker">Limits</p>
          <h1>Entitlements</h1>
          <p>Configure plan limits for seats, devices, channels, and AI usage.</p>
        </div>
      </header>
      <AdminEntitlementsDashboard initialConfig={config} />
    </AdminConsoleShell>
  );
}
