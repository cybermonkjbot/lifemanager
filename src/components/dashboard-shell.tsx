import { AutonomyControls } from "@/components/autonomy-controls";
import { ConvexAppProvider } from "@/components/convex-app-provider";
import Link from "next/link";
import { ReactNode } from "react";

type DashboardShellProps = {
  title: string;
  subtitle: string;
  children: ReactNode;
  convexUrl?: string;
  autonomyPaused?: boolean;
};

const navItems = [
  { href: "/setup", label: "Setup" },
  { href: "/", label: "Queue" },
  { href: "/conversations", label: "Conversations" },
  { href: "/followups", label: "Follow-ups" },
  { href: "/style-lab", label: "Style Lab" },
  { href: "/rules", label: "Rules" },
  { href: "/system", label: "System" },
];

export function DashboardShell({ title, subtitle, children, convexUrl, autonomyPaused }: DashboardShellProps) {
  return (
    <div className="shell-root">
      <aside className="shell-nav">
        <div className="brand-block">
          <p className="brand-kicker">Social Life Manager</p>
          <h1 className="brand-title">WhatsApp Brain</h1>
          <p className="brand-note">Local-first command center for your social autopilot.</p>
        </div>

        <nav className="nav-links">
          {navItems.map((item) => (
            <Link key={item.href} href={item.href} className="nav-link">
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>

      <ConvexAppProvider convexUrl={convexUrl}>
        <div className="shell-main-wrap">
          <header className="shell-topbar">
            <div>
              <p className="panel-kicker">Action Studio</p>
              <h2 className="panel-title">{title}</h2>
              <p className="panel-subtitle">{subtitle}</p>
            </div>

            <AutonomyControls realtimeEnabled={Boolean(convexUrl)} fallbackPaused={autonomyPaused} />
          </header>

          <main className="shell-main">{children}</main>
        </div>
      </ConvexAppProvider>
    </div>
  );
}
