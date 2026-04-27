"use client";

import { UIModal } from "@/components/ui-modal";
import { dashboardNavItems, publicDashboardNavItems } from "@/lib/ui/dashboard-nav";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

type WorkspaceHeaderControlsProps = {
  className?: string;
  items?: typeof dashboardNavItems;
  showBack?: boolean;
  showMenu?: boolean;
};

function isActive(pathname: string, href: string) {
  if (href === "/") {
    return pathname === "/";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function WorkspaceHeaderControls({
  className,
  items = publicDashboardNavItems,
  showBack = false,
  showMenu = false,
}: WorkspaceHeaderControlsProps) {
  const router = useRouter();
  const pathname = usePathname() || "/";
  const [menuOpen, setMenuOpen] = useState(false);
  const visibleItems = items;

  const onBack = () => {
    if (window.history.length > 1) {
      router.back();
      return;
    }
    router.push("/");
  };

  return (
    <>
      <div className={className || "view-header-actions"} aria-label="Page controls">
        {showBack ? (
          <button type="button" className="btn btn-ghost" onClick={onBack} aria-label="Go back">
            ← Back
          </button>
        ) : null}
        {showMenu ? (
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            onClick={() => setMenuOpen(true)}
            aria-label="Open page menu"
            title="Open page menu"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path fill="currentColor" d="M4 6h16v2H4V6Zm0 5h16v2H4v-2Zm0 5h16v2H4v-2Z" />
            </svg>
            <span className="sr-only">Open page menu</span>
          </button>
        ) : null}
      </div>

      <UIModal
        open={showMenu && menuOpen}
        onClose={() => setMenuOpen(false)}
        title="Menu"
      >
        <div className="workspace-modal-list">
          {visibleItems.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`workspace-modal-link ${active ? "workspace-modal-link-active" : ""}`}
                onClick={() => setMenuOpen(false)}
              >
                <span>{item.label}</span>
              </Link>
            );
          })}
          <form action="/api/auth/pin/logout" method="post">
            <button type="submit" className="workspace-modal-link workspace-modal-button">
              <span>Log out</span>
            </button>
          </form>
        </div>
      </UIModal>
    </>
  );
}
