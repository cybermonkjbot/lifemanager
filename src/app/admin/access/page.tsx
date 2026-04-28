import { AdminMasqueradeBanner } from "@/components/admin-masquerade-banner";
import { AdminConsoleShell } from "@/components/admin-console-shell";
import { AdminAccessDashboard } from "@/components/admin-config-dashboards";
import { requireAdminPageAccess } from "@/lib/admin-auth";
import { getAdminMasqueradeCookieName, readAdminMasqueradeToken } from "@/lib/admin-masquerade";
import { listAdminUsers } from "@/lib/admin-users";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

export default async function AdminAccessPage() {
  await requireAdminPageAccess("/admin/access");
  const cookieStore = await cookies();
  const masqueradeSession = readAdminMasqueradeToken(cookieStore.get(getAdminMasqueradeCookieName())?.value);
  const admins = await listAdminUsers();

  return (
    <AdminConsoleShell>
      {masqueradeSession ? <AdminMasqueradeBanner session={masqueradeSession} /> : null}
      <header className="admin-console-header">
        <div>
          <p className="admin-kicker">Admins</p>
          <h1>Access</h1>
          <p>Manage who can unlock the admin console and which admins can enter tenant context.</p>
        </div>
      </header>
      <AdminAccessDashboard initialAdmins={admins} />
    </AdminConsoleShell>
  );
}
