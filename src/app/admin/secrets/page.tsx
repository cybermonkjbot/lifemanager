import { AdminSecretsDashboard } from "@/components/admin-secrets-dashboard";
import { requireAdminPageAccess } from "@/lib/admin-auth";
import { getAdminMasqueradeCookieName, readAdminMasqueradeToken } from "@/lib/admin-masquerade";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

export default async function AdminSecretsPage() {
  await requireAdminPageAccess("/admin/secrets");
  const cookieStore = await cookies();
  const masqueradeSession = readAdminMasqueradeToken(cookieStore.get(getAdminMasqueradeCookieName())?.value);
  return <AdminSecretsDashboard masqueradeSession={masqueradeSession} />;
}
