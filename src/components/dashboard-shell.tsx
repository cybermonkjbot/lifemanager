import { ConvexAppProvider } from "@/components/convex-app-provider";
import { LogWatcher } from "@/components/log-watcher";
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
    href: "/tools",
    label: "Tool Playground",
    description: "Run and inspect all chat-context tools with live thread data.",
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
        <div className="shell-main-wrap">
          <header className="shell-topbar">
            <div className="brand-block">
              <p className="brand-kicker">Social Life Manager</p>
              <h1 className="brand-title">WhatsApp Brain</h1>
              <p className="brand-note">Focused workspace: one active job at a time.</p>
            </div>
            <ShellControlsModal realtimeEnabled={realtimeEnabled} fallbackPaused={autonomyPaused} />
          </header>

          <ShellNavigation items={navItems} />

          <section className="view-header">
            <p className="panel-kicker">Focused Workspace</p>
            <h2 className="panel-title">{title}</h2>
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
