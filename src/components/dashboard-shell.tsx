import Link from "next/link";
import { ReactNode } from "react";

type DashboardShellProps = {
  title: string;
  subtitle: string;
  children: ReactNode;
  autonomyPaused?: boolean;
};

const navItems = [
  { href: "/", label: "Queue" },
  { href: "/conversations", label: "Conversations" },
  { href: "/followups", label: "Follow-ups" },
  { href: "/style-lab", label: "Style Lab" },
  { href: "/rules", label: "Rules" },
  { href: "/system", label: "System" },
];

export function DashboardShell({ title, subtitle, children, autonomyPaused }: DashboardShellProps) {
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

      <div className="shell-main-wrap">
        <header className="shell-topbar">
          <div>
            <p className="panel-kicker">Action Studio</p>
            <h2 className="panel-title">{title}</h2>
            <p className="panel-subtitle">{subtitle}</p>
          </div>

          <div className="topbar-controls">
            <span className={`status-pill ${autonomyPaused ? "status-paused" : "status-active"}`}>
              {autonomyPaused ? "Autonomy Paused" : "Autonomy Active"}
            </span>
            <form action={autonomyPaused ? "/api/actions/resume-autonomy" : "/api/actions/pause-autonomy"} method="post">
              <button type="submit" className="btn btn-primary">
                {autonomyPaused ? "Resume" : "Pause"}
              </button>
            </form>
          </div>
        </header>

        <main className="shell-main">{children}</main>
      </div>
    </div>
  );
}
