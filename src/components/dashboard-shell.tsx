import { ConvexAppProvider } from "@/components/convex-app-provider";
import { LogWatcher } from "@/components/log-watcher";
import { RuntimeStateOverlay } from "@/components/runtime-state-overlay";
import { ShellControlsModal } from "@/components/shell-controls-modal";
import { ShellNavigation } from "@/components/shell-navigation";
import { SetupNotice } from "@/components/setup-notice";
import { dashboardNavItems } from "@/lib/ui/dashboard-nav";
import { ReactNode } from "react";

type DashboardShellProps = {
  title: string;
  subtitle: string;
  children: ReactNode;
  convexUrl?: string;
  autonomyPaused?: boolean;
  showLogWatcher?: boolean;
  hideViewHeader?: boolean;
  hideShellChrome?: boolean;
};

export function DashboardShell({
  title,
  subtitle,
  children,
  convexUrl,
  autonomyPaused,
  showLogWatcher = false,
  hideViewHeader = false,
  hideShellChrome = false,
}: DashboardShellProps) {
  const realtimeEnabled = Boolean(convexUrl);

  return (
    <div className="shell-root">
      <ConvexAppProvider convexUrl={convexUrl}>
        {realtimeEnabled ? <RuntimeStateOverlay /> : null}
        <div className="shell-main-wrap">
          {!hideShellChrome ? (
            <>
              <header className="shell-topbar">
                <div className="brand-block">
                  <p className="brand-kicker">Social Life Manager</p>
                  <p className="brand-title">WhatsApp Brain</p>
                  <p className="brand-note">Workspaces for queue, conversations, follow-ups, and system health.</p>
                </div>
                <ShellControlsModal realtimeEnabled={realtimeEnabled} fallbackPaused={autonomyPaused} />
              </header>

              <ShellNavigation items={dashboardNavItems} />
            </>
          ) : null}

          <main className="shell-main">
            {!hideViewHeader ? (
              <>
                <header className="view-header">
                  <h1 className="panel-title">{title}</h1>
                  <p className="panel-subtitle">{subtitle}</p>
                </header>
                <h2 className="sr-only">Workspace sections</h2>
              </>
            ) : null}
            {!realtimeEnabled ? <SetupNotice error={null} /> : null}
            {children}
          </main>
          {showLogWatcher ? <LogWatcher /> : null}
        </div>
      </ConvexAppProvider>
    </div>
  );
}
