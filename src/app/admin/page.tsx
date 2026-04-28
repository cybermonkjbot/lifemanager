import { AdminMasqueradeBanner } from "@/components/admin-masquerade-banner";
import { AdminConsoleShell } from "@/components/admin-console-shell";
import { AdminOverviewDashboard, type OverviewMetrics } from "@/components/admin-overview-dashboard";
import { requireAdminPageAccess } from "@/lib/admin-auth";
import { getAdminMasqueradeCookieName, readAdminMasqueradeToken } from "@/lib/admin-masquerade";
import { convexRefs } from "@/lib/convex-refs";
import { createConvexClient } from "@/lib/convex-server";
import { getConvexAdminSecret } from "@/lib/managed-secret-crypto";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  await requireAdminPageAccess("/admin");
  const cookieStore = await cookies();
  const masqueradeSession = readAdminMasqueradeToken(cookieStore.get(getAdminMasqueradeCookieName())?.value);
  let initialMetrics: OverviewMetrics | null = null;
  let initialMetricsError = "";

  try {
    initialMetrics = (await createConvexClient().query(convexRefs.systemAdminOverviewMetrics, {
      adminSecret: getConvexAdminSecret(),
      days: 14,
    })) as OverviewMetrics;
  } catch (error) {
    initialMetricsError = error instanceof Error ? error.message : "Failed to load metrics.";
  }

  return (
    <AdminConsoleShell>
      {masqueradeSession ? <AdminMasqueradeBanner session={masqueradeSession} /> : null}
      <header className="admin-console-header">
        <div>
          <p className="admin-kicker">Command</p>
          <h1>Admin Overview</h1>
          <p>Monitor tenants, provider readiness, cost trends, and recent platform activity.</p>
        </div>
      </header>

      <AdminOverviewDashboard initialMetrics={initialMetrics} initialMetricsError={initialMetricsError} />
    </AdminConsoleShell>
  );
}
