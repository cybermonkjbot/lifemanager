import { ConvexAppProvider } from "@/components/convex-app-provider";
import { LogWatcher } from "@/components/log-watcher";
import { RuntimeStateOverlay } from "@/components/runtime-state-overlay";
import { ShellControlsModal } from "@/components/shell-controls-modal";
import { ShellNavigation } from "@/components/shell-navigation";
import { SetupNotice } from "@/components/setup-notice";
import { ReactNode } from "react";

type DashboardShellProps = {
  title: string;
  subtitle: string;
  children: ReactNode;
  convexUrl?: string;
  autonomyPaused?: boolean;
  showLogWatcher?: boolean;
};

const navItems = [
  {
    href: "/",
    label: "Queue",
    description: "Process actionable replies, follow-ups, and safety items.",
    primary: true,
  },
  {
    href: "/conversations",
    label: "Conversations",
    description: "Read context and tune thread-level communication.",
    primary: true,
  },
  {
    href: "/status",
    label: "Status",
    description: "View status timeline and pending status approvals.",
    primary: true,
  },
  {
    href: "/media",
    label: "Media",
    description: "Unified gallery for stickers and all captured message media.",
    primary: true,
  },
  {
    href: "/backlog",
    label: "Backlog",
    description: "Triage unread threads and restart stale relationships.",
    primary: true,
  },
  {
    href: "/followups",
    label: "Follow-ups",
    description: "Confirm and track scheduled outreach commitments.",
    primary: true,
  },
  {
    href: "/activity-core",
    label: "Activity Core",
    description: "Visual activity sphere with glowing runtime status.",
    primary: true,
  },
  {
    href: "/systems-design",
    label: "Systems Design",
    description: "Canvas map of connected services and runtime links.",
    primary: true,
  },
  {
    href: "/setup",
    label: "Setup",
    description: "Pair WhatsApp and run environment checks.",
  },
  {
    href: "/style-lab",
    label: "Style Lab",
    description: "Tune mimicry and voice behavior.",
  },
  {
    href: "/rules",
    label: "Rules",
    description: "Adjust guardrails, boundaries, and initiations.",
  },
  {
    href: "/settings",
    label: "Settings",
    description: "Configure runtime defaults and queue behavior.",
  },
  {
    href: "/system",
    label: "System",
    description: "Inspect health, logs, and provider traces.",
  },
];

export function DashboardShell({
  title,
  subtitle,
  children,
  convexUrl,
  autonomyPaused,
  showLogWatcher = false,
}: DashboardShellProps) {
  const realtimeEnabled = Boolean(convexUrl);

  return (
    <div className="shell-root">
      <ConvexAppProvider convexUrl={convexUrl}>
        {realtimeEnabled ? <RuntimeStateOverlay /> : null}
        <div className="shell-main-wrap">
          <header className="shell-topbar">
            <div className="brand-block">
              <p className="brand-kicker">Social Life Manager</p>
              <p className="brand-title">WhatsApp Brain</p>
              <p className="brand-note">Operational console for conversations, queueing, and follow-through.</p>
            </div>
            <ShellControlsModal realtimeEnabled={realtimeEnabled} fallbackPaused={autonomyPaused} />
          </header>

          <ShellNavigation items={navItems} />

          <section className="view-header">
            <h1 className="panel-title">{title}</h1>
            <p className="panel-subtitle">{subtitle}</p>
          </section>

          <main className="shell-main">
            {!realtimeEnabled ? <SetupNotice error={null} /> : null}
            {children}
          </main>
          {showLogWatcher ? <LogWatcher /> : null}
        </div>
      </ConvexAppProvider>
    </div>
  );
}
