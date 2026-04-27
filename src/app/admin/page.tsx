import { AdminMasqueradeBanner } from "@/components/admin-masquerade-banner";
import { AdminConsoleShell } from "@/components/admin-console-shell";
import { AdminOverviewDashboard } from "@/components/admin-overview-dashboard";
import { requireAdminPageAccess } from "@/lib/admin-auth";
import { getAdminMasqueradeCookieName, readAdminMasqueradeToken } from "@/lib/admin-masquerade";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  await requireAdminPageAccess("/admin");
  const cookieStore = await cookies();
  const masqueradeSession = readAdminMasqueradeToken(cookieStore.get(getAdminMasqueradeCookieName())?.value);

  return (
    <AdminConsoleShell>
      {masqueradeSession ? <AdminMasqueradeBanner session={masqueradeSession} /> : null}
      <header className="admin-console-header">
        <div>
          <h1>Admin</h1>
        </div>
      </header>

      <AdminOverviewDashboard />
    </AdminConsoleShell>
  );
}
