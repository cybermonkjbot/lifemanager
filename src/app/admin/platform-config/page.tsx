import { AdminMasqueradeBanner } from "@/components/admin-masquerade-banner";
import { AdminConsoleShell } from "@/components/admin-console-shell";
import { AdminPlatformConfigDashboard, type AdminPlatformConfig } from "@/components/admin-config-dashboards";
import { requireAdminPageAccess } from "@/lib/admin-auth";
import { getAdminMasqueradeCookieName, readAdminMasqueradeToken } from "@/lib/admin-masquerade";
import { convexRefs } from "@/lib/convex-refs";
import { createConvexClient } from "@/lib/convex-server";
import { getConvexAdminSecret } from "@/lib/managed-secret-crypto";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

export default async function AdminPlatformConfigPage() {
  await requireAdminPageAccess("/admin/platform-config");
  const cookieStore = await cookies();
  const masqueradeSession = readAdminMasqueradeToken(cookieStore.get(getAdminMasqueradeCookieName())?.value);
  const config = (await createConvexClient().query(convexRefs.adminPlatformPlatformConfig, {
    adminSecret: getConvexAdminSecret(),
  })) as AdminPlatformConfig;

  return (
    <AdminConsoleShell>
      {masqueradeSession ? <AdminMasqueradeBanner session={masqueradeSession} /> : null}
      <header className="admin-console-header">
        <div>
          <p className="admin-kicker">Runtime Config</p>
          <h1>Platform Config</h1>
          <p>Tune AI runtime behavior, queue throughput, quiet hours, rate limits, and retention.</p>
        </div>
      </header>
      <AdminPlatformConfigDashboard initialConfig={config} />
    </AdminConsoleShell>
  );
}
