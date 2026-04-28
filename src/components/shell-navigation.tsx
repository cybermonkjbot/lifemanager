"use client";

import type { DashboardNavItem } from "@/lib/ui/dashboard-nav";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo } from "react";

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

  const primaryItems = useMemo(() => items.filter((item) => item.primary), [items]);

  return (
    <div className="shell-tabbar" role="navigation" aria-label="Main sections">
      <div className="shell-tabs-row" aria-label="Primary sections">
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
    </div>
  );
}
