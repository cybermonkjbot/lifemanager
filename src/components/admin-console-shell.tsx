"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { adminOperationsNavItems, adminPrimaryNavItems } from "@/lib/ui/admin-nav";

type AdminConsoleShellProps = {
  children: ReactNode;
};

function isActive(pathname: string, href: string) {
  if (href === "/admin") {
    return pathname === "/admin";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

function AdminNavLink({
  item,
  active,
}: {
  item: {
    href: string;
    label: string;
    eyebrow?: string;
    description?: string;
  };
  active: boolean;
}) {
  return (
    <Link
      key={item.href}
      className={active ? "admin-nav-active" : undefined}
      href={item.href}
      aria-current={active ? "page" : undefined}
    >
      <span className="admin-nav-label-row">
        <strong>{item.label}</strong>
      </span>
      {item.description ? <span className="admin-nav-description">{item.description}</span> : null}
    </Link>
  );
}

export function AdminConsoleShell({ children }: AdminConsoleShellProps) {
  const pathname = usePathname() || "/admin";

  const endAdminSession = async () => {
    await fetch("/api/admin/session", { method: "DELETE" });
    window.location.href = "/admin/unlock";
  };

  return (
    <main className="admin-console-shell">
      <aside className="admin-command-rail">
        <div className="admin-rail-top">
          <Link className="admin-rail-brand" href="/admin">
            <span>Admin</span>
            <strong>OdogwuHQ</strong>
          </Link>
          <nav className="admin-nav-stack" aria-label="Admin sections">
            {adminPrimaryNavItems.map((item) => {
              const active = isActive(pathname, item.href);
              return <AdminNavLink key={item.href} item={item} active={active} />;
            })}
          </nav>
          <nav className="admin-nav-stack admin-nav-secondary" aria-label="Admin operations">
            <span>Operations</span>
            {adminOperationsNavItems.map((item) => {
              const active = isActive(pathname, item.href);
              return <AdminNavLink key={item.href} item={item} active={active} />;
            })}
          </nav>
        </div>
        <div className="admin-rail-session">
          <button className="admin-logout-button" type="button" onClick={() => void endAdminSession()}>
            End session
          </button>
        </div>
      </aside>
      <section className="admin-console-main">{children}</section>
    </main>
  );
}
