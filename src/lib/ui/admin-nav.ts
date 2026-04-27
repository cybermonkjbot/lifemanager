export type AdminNavItem = {
  href: string;
  label: string;
  eyebrow?: string;
};

export const adminPrimaryNavItems: AdminNavItem[] = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/secrets", label: "Secrets", eyebrow: "Runtime" },
  { href: "/admin/tenants", label: "Tenants", eyebrow: "Accounts" },
];

export const adminOperationsNavItems: AdminNavItem[] = [
  { href: "/admin/spending", label: "Spending", eyebrow: "Usage" },
  { href: "/admin/system", label: "System", eyebrow: "Runtime" },
  { href: "/admin/activity-core", label: "Activity Core", eyebrow: "Signals" },
  { href: "/admin/systems-design", label: "Systems Design", eyebrow: "Topology" },
  { href: "/admin/self-improvement", label: "Self Improvement", eyebrow: "Runs" },
];
