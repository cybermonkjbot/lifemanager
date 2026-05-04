export type AdminNavItem = {
  href: string;
  label: string;
  eyebrow?: string;
  description?: string;
};

export const adminPrimaryNavItems: AdminNavItem[] = [
  { href: "/admin", label: "Overview", eyebrow: "Command", description: "Platform health and usage" },
  { href: "/admin/access", label: "Access", eyebrow: "Admins", description: "Admin users and permissions" },
  { href: "/admin/secrets", label: "Secrets", eyebrow: "Runtime", description: "Managed provider credentials" },
  { href: "/admin/tenants", label: "Tenants", eyebrow: "Accounts", description: "Tenant access and billing" },
];

export const adminOperationsNavItems: AdminNavItem[] = [
  { href: "/admin/subscriptions", label: "Subscriptions", eyebrow: "Plans", description: "Plan prices and checkout config" },
  { href: "/admin/entitlements", label: "Entitlements", eyebrow: "Limits", description: "Plan limits and capabilities" },
  { href: "/admin/billing", label: "Billing", eyebrow: "Ops", description: "Subscription events and reconciliation" },
  { href: "/admin/payouts", label: "Payouts", eyebrow: "Storefront", description: "Weekend business payout batches" },
  { href: "/admin/platform-config", label: "Platform Config", eyebrow: "Config", description: "Runtime defaults and limits" },
  { href: "/admin/integrations", label: "Integrations", eyebrow: "Health", description: "Provider readiness and coverage" },
  { href: "/admin/audit", label: "Audit", eyebrow: "Events", description: "Admin and platform event feed" },
  { href: "/admin/spending", label: "Spending", eyebrow: "Usage", description: "Azure AI cost controls" },
  { href: "/admin/system", label: "System", eyebrow: "Runtime", description: "Provider, queue, and event health" },
  { href: "/admin/activity-core", label: "Activity Core", eyebrow: "Signals", description: "Live activity and media signals" },
  { href: "/admin/systems-design", label: "Service Topology", eyebrow: "Topology", description: "Runtime service map" },
  { href: "/admin/self-improvement", label: "Self-Improvement", eyebrow: "Runs", description: "Codex improvement cycles" },
];
