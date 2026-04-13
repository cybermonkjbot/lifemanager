"use client";

import { UIModal } from "@/components/ui-modal";
import type { DashboardNavItem } from "@/lib/ui/dashboard-nav";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState } from "react";

export type NavItem = DashboardNavItem;

type ShellNavigationProps = {
  items: NavItem[];
};

function isActive(pathname: string, href: string) {
  if (href === "/") {
    return pathname === "/";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function ShellNavigation({ items }: ShellNavigationProps) {
  const pathname = usePathname() || "/";
  const [workspaceOpen, setWorkspaceOpen] = useState(false);

  const primaryItems = useMemo(() => items.filter((item) => item.primary), [items]);
  const secondaryItems = useMemo(() => items.filter((item) => !item.primary), [items]);

  return (
    <>
      <div className="shell-tabbar" role="navigation" aria-label="Workspace sections">
        <div className="shell-tabs-row" aria-label="Primary workspaces">
          {primaryItems.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`shell-tab ${active ? "shell-tab-active" : ""}`}
                aria-current={active ? "page" : undefined}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
        <button type="button" className="btn btn-ghost" onClick={() => setWorkspaceOpen(true)}>
          All Sections
        </button>
      </div>

      <UIModal
        open={workspaceOpen}
        onClose={() => setWorkspaceOpen(false)}
        title="All Sections"
        description="Open any workspace from one list."
      >
        <div className="workspace-modal-list">
          {[...primaryItems, ...secondaryItems].map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`workspace-modal-link ${active ? "workspace-modal-link-active" : ""}`}
                onClick={() => setWorkspaceOpen(false)}
              >
                <span>{item.label}</span>
                <span className="queue-meta">{item.description}</span>
              </Link>
            );
          })}
        </div>
      </UIModal>
    </>
  );
}
