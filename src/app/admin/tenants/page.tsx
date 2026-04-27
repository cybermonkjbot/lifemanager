import { AdminTenantsDashboard } from "@/components/admin-tenants-dashboard";
import { requireAdminPageAccess } from "@/lib/admin-auth";
import { getAdminMasqueradeCookieName, readAdminMasqueradeToken } from "@/lib/admin-masquerade";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

export default async function AdminTenantsPage() {
  await requireAdminPageAccess("/admin/tenants");
  const cookieStore = await cookies();
  const masqueradeSession = readAdminMasqueradeToken(cookieStore.get(getAdminMasqueradeCookieName())?.value);
  return <AdminTenantsDashboard masqueradeSession={masqueradeSession} />;
}
