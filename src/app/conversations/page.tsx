import { DashboardPage } from "@/components/dashboard-page";
import { LiveConversations } from "@/components/live-conversations";
import { WorkspaceHeaderControls } from "@/components/workspace-header-controls";
import { getAdminCookieName, verifyAdminSessionToken } from "@/lib/admin-auth";
import { getAdminMasqueradeCookieName, readAdminMasqueradeToken } from "@/lib/admin-masquerade";
import { readLocalInstanceConfig } from "@/lib/instance-config";
import { isElectronEnvironment } from "@/lib/runtime-env";
import { getTenantSessionCookieName, verifyTenantSessionToken } from "@/lib/tenant-session";
import { dashboardNavItems } from "@/lib/ui/dashboard-nav";
import { cookies } from "next/headers";

export default async function ConversationsPage({
  searchParams,
}: {
  searchParams: Promise<{ threadId?: string }>;
}) {
  const params = await searchParams;
  const cookieStore = await cookies();
  const adminEnabled = !isElectronEnvironment() && verifyAdminSessionToken(cookieStore.get(getAdminCookieName())?.value);
  const localConfig = await readLocalInstanceConfig();
  const tenantSession = await verifyTenantSessionToken(cookieStore.get(getTenantSessionCookieName())?.value);
  const masqueradeSession = isElectronEnvironment()
    ? null
    : readAdminMasqueradeToken(cookieStore.get(getAdminMasqueradeCookieName())?.value);
  const hostedTenant = localConfig?.preferences.serviceMode === "hosted";
  const canManageRuntime =
    !hostedTenant ||
    tenantSession?.role === "owner" ||
    tenantSession?.role === "admin" ||
    Boolean(masqueradeSession);
  const navItems = dashboardNavItems.filter(
    (item) => (!item.adminOnly || adminEnabled) && (!item.runtimeControlOnly || canManageRuntime),
  );

  return (
    <DashboardPage title="" subtitle="" hideViewHeader hideShellChrome>
      <div className="conversations-page-controls">
        <WorkspaceHeaderControls className="view-header-actions conversations-header-actions" items={navItems} showMenu />
      </div>
      <LiveConversations initialThreadId={params.threadId} />
    </DashboardPage>
  );
}
