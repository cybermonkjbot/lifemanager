import { AdminMasqueradeBanner } from "@/components/admin-masquerade-banner";
import { AdminConsoleShell } from "@/components/admin-console-shell";
import { ConvexAppProvider } from "@/components/convex-app-provider";
import { LogWatcher } from "@/components/log-watcher";
import { requireAdminPageAccess } from "@/lib/admin-auth";
import { getAdminMasqueradeCookieName, readAdminMasqueradeToken } from "@/lib/admin-masquerade";
import { getConvexUrl } from "@/lib/runtime-env";
import { cookies } from "next/headers";
import type { ReactNode } from "react";

type AdminLivePageProps = {
  title: string;
  nextPath: string;
  children: ReactNode;
  showLogWatcher?: boolean;
  logWatcherDefaultExpanded?: boolean;
};

export async function AdminLivePage({
  title,
  nextPath,
  children,
  showLogWatcher = false,
  logWatcherDefaultExpanded = true,
}: AdminLivePageProps) {
  await requireAdminPageAccess(nextPath);
  const cookieStore = await cookies();
  const masqueradeSession = readAdminMasqueradeToken(cookieStore.get(getAdminMasqueradeCookieName())?.value);

  return (
    <AdminConsoleShell>
      <ConvexAppProvider convexUrl={getConvexUrl()}>
        {masqueradeSession ? <AdminMasqueradeBanner session={masqueradeSession} /> : null}
        <header className="admin-console-header">
          <div>
            <h1>{title}</h1>
          </div>
        </header>
        {children}
        {showLogWatcher ? <LogWatcher defaultExpanded={logWatcherDefaultExpanded} /> : null}
      </ConvexAppProvider>
    </AdminConsoleShell>
  );
}
