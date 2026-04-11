export type DashboardNavItem = {
  href: string;
  label: string;
  description: string;
  primary?: boolean;
};

export const dashboardNavItems: DashboardNavItem[] = [
  {
    href: "/",
    label: "Home",
    description: "Launch point for queue, conversations, and daily workflows.",
    primary: true,
  },
  {
    href: "/queue",
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
  {
    href: "/self-improvement",
    label: "Self Improve",
    description: "Audit manual + auto self-improvement runs and reports.",
  },
];
