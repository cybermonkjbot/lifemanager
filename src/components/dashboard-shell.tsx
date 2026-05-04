import { ConvexAppProvider } from "@/components/convex-app-provider";
import { AdminMasqueradeBanner } from "@/components/admin-masquerade-banner";
import { requireInstancePageAccess } from "@/lib/instance-guard";
import { getAdminCookieName, verifyAdminSessionToken } from "@/lib/admin-auth";
import { getAdminMasqueradeCookieName, readAdminMasqueradeToken } from "@/lib/admin-masquerade";
import { LogWatcher } from "@/components/log-watcher";
import { RuntimeStateOverlay } from "@/components/runtime-state-overlay";
import { RuntimeStatusProvider } from "@/components/runtime-status-provider";
import { ShellControlsModal } from "@/components/shell-controls-modal";
import { ShellNavigation } from "@/components/shell-navigation";
import { SetupPreparationProgress } from "@/components/setup-preparation-progress";
import { SubscriptionTrialBanner } from "@/components/subscription-trial-banner";
import { TenantScopeProvider } from "@/components/tenant-scope-provider";
import { isInstancePinEnabled } from "@/lib/instance-pin";
import { isElectronEnvironment } from "@/lib/runtime-env";
import { SetupNotice } from "@/components/setup-notice";
import { dashboardNavItems } from "@/lib/ui/dashboard-nav";
import { WorkspaceHeaderControls } from "@/components/workspace-header-controls";
import { BrandLogo } from "@/components/brand-logo";
import { SessionExitControl } from "@/components/session-exit-control";
import { convexRefs } from "@/lib/convex-refs";
import { createConvexClient } from "@/lib/convex-server";
import { readLocalInstanceConfig } from "@/lib/instance-config";
import { getTenantSessionCookieName, verifyTenantSessionToken } from "@/lib/tenant-session";
import { cookies } from "next/headers";
import Link from "next/link";
import { ReactNode } from "react";

type BillingBannerStatus = "trialing" | "active" | "past_due" | "paused" | "canceled" | "self_hosted" | "unknown";

type BillingBannerState = {
  billingStatus: BillingBannerStatus;
  trialEndsAt: number | null;
  plan: "personal_connector" | "business_whatsapp";
} | null;

type DashboardShellProps = {
  title: string;
  subtitle: string;
  children: ReactNode;
  convexUrl?: string;
  autonomyPaused?: boolean;
  showLogWatcher?: boolean;
  logWatcherDefaultExpanded?: boolean;
  hideViewHeader?: boolean;
  hideShellChrome?: boolean;
};

function normalizeHostedPlan(value: unknown): "personal_connector" | "business_whatsapp" {
  return value === "business_whatsapp" ? "business_whatsapp" : "personal_connector";
}

async function loadBillingBannerState(convexUrl?: string): Promise<BillingBannerState> {
  const config = await readLocalInstanceConfig();
  if (!config?.setupCompleted || config.preferences.serviceMode !== "hosted" || !config.account?.tenantId) {
    return null;
  }

  const fallback: BillingBannerState = {
    billingStatus: config.account.billingStatus,
    trialEndsAt: config.account.trialEndsAt,
    plan: "personal_connector",
  };

  try {
    const summary = await createConvexClient(convexUrl).query(convexRefs.billingGetTenantBillingSummary, {
      tenantId: config.account.tenantId,
    }) as {
      tenant?: {
        billingStatus?: BillingBannerStatus;
        trialEndsAt?: number;
        plan?: string;
      };
    } | null;
    if (!summary?.tenant) {
      return fallback;
    }
    return {
      billingStatus: summary.tenant.billingStatus || fallback.billingStatus,
      trialEndsAt: Number.isFinite(Number(summary.tenant.trialEndsAt)) ? Number(summary.tenant.trialEndsAt) : fallback.trialEndsAt,
      plan: normalizeHostedPlan(summary.tenant.plan),
    };
  } catch {
    return fallback;
  }
}

export async function DashboardShell({
  title,
  subtitle,
  children,
  convexUrl,
  autonomyPaused,
  showLogWatcher = false,
  logWatcherDefaultExpanded = true,
  hideViewHeader = false,
  hideShellChrome = false,
}: DashboardShellProps) {
  await requireInstancePageAccess();

  const realtimeEnabled = Boolean(convexUrl);
  const convexAuthEnabled = process.env.ODOGWU_REQUIRE_CONVEX_AUTH === "1";
  const pinEnabled = await isInstancePinEnabled();
  const cookieStore = await cookies();
  const localConfig = await readLocalInstanceConfig();
  const tenantSession = await verifyTenantSessionToken(cookieStore.get(getTenantSessionCookieName())?.value);
  const desktopAdminDisabled = isElectronEnvironment();
  const adminEnabled = !desktopAdminDisabled && verifyAdminSessionToken(cookieStore.get(getAdminCookieName())?.value);
  const masqueradeSession = desktopAdminDisabled
    ? null
    : readAdminMasqueradeToken(cookieStore.get(getAdminMasqueradeCookieName())?.value);
  const hostedTenant = localConfig?.preferences.serviceMode === "hosted";
  const tenantScopeId = masqueradeSession?.tenantId || (hostedTenant ? localConfig?.account?.tenantId : "") || undefined;
  const canManageRuntime =
    !hostedTenant ||
    tenantSession?.role === "owner" ||
    tenantSession?.role === "admin" ||
    Boolean(masqueradeSession);
  const visibleNavItems = dashboardNavItems.filter(
    (item) => (!item.adminOnly || adminEnabled) && (!item.runtimeControlOnly || canManageRuntime),
  );
  const billingBanner = await loadBillingBannerState(convexUrl);

  return (
    <div className="shell-root">
      <ConvexAppProvider convexUrl={convexUrl} authEnabled={realtimeEnabled && convexAuthEnabled}>
        <TenantScopeProvider tenantId={tenantScopeId}>
          <RuntimeStatusProvider enabled={realtimeEnabled}>
            {realtimeEnabled ? <RuntimeStateOverlay canManageRuntime={canManageRuntime} /> : null}
            <div className="shell-main-wrap">
              {masqueradeSession ? <AdminMasqueradeBanner session={masqueradeSession} /> : null}
              {!hideShellChrome ? (
                <>
                  <header className="shell-topbar">
                    <div className="brand-block">
                      <BrandLogo priority />
                    </div>
                    <div className="shell-topbar-actions">
                      {pinEnabled ? (
                        <SessionExitControl />
                      ) : null}
                      <Link href="/code" className="btn btn-ghost btn-icon" aria-label="Open Code Lab" title="Open Code Lab">
                        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                          <path
                            fill="currentColor"
                            d="M4 5.75A1.75 1.75 0 0 1 5.75 4h12.5A1.75 1.75 0 0 1 20 5.75v12.5A1.75 1.75 0 0 1 18.25 20H5.75A1.75 1.75 0 0 1 4 18.25V5.75Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h12.5a.25.25 0 0 0 .25-.25V5.75a.25.25 0 0 0-.25-.25H5.75Zm2.22 4.03a.75.75 0 0 1 1.06 0l2 2a.75.75 0 0 1 0 1.06l-2 2a.75.75 0 1 1-1.06-1.06L9.44 12l-1.47-1.47a.75.75 0 0 1 0-1.06Zm4.28 4.72a.75.75 0 0 1 .75-.75h3a.75.75 0 0 1 0 1.5h-3a.75.75 0 0 1-.75-.75Z"
                          />
                        </svg>
                        <span className="sr-only">Open Code Lab</span>
                      </Link>
                      {canManageRuntime ? <ShellControlsModal realtimeEnabled={realtimeEnabled} fallbackPaused={autonomyPaused} /> : null}
                      <WorkspaceHeaderControls className="shell-menu-mobile" items={visibleNavItems} showMenu />
                    </div>
                  </header>

                  <ShellNavigation items={visibleNavItems} />
                  <SetupPreparationProgress variant="compact" />
                </>
              ) : null}

              <main className="shell-main">
                {!hideViewHeader ? (
                  <>
                    <header className="view-header">
                      <div className="view-header-main">
                        <h1 className="panel-title">{title}</h1>
                        <p className="panel-subtitle">{subtitle}</p>
                      </div>
                      <WorkspaceHeaderControls items={visibleNavItems} />
                    </header>
                    <h2 className="sr-only">Page sections</h2>
                  </>
                ) : null}
                <div className="shell-view-scroll">
                  {!realtimeEnabled ? <SetupNotice error={null} /> : null}
                  {billingBanner ? (
                    <SubscriptionTrialBanner
                      billingStatus={billingBanner.billingStatus}
                      trialEndsAt={billingBanner.trialEndsAt}
                      plan={billingBanner.plan}
                    />
                  ) : null}
                  {children}
                </div>
              </main>
              {showLogWatcher ? <LogWatcher defaultExpanded={logWatcherDefaultExpanded} /> : null}
            </div>
          </RuntimeStatusProvider>
        </TenantScopeProvider>
      </ConvexAppProvider>
    </div>
  );
}
