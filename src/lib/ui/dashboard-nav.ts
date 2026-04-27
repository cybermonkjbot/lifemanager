export type DashboardNavItem = {
  href: string;
  label: string;
  description: string;
  primary?: boolean;
  adminOnly?: boolean;
  runtimeControlOnly?: boolean;
};

export const dashboardNavItems: DashboardNavItem[] = [
  {
    href: "/",
    label: "Home",
    description: "Ask for a read on chats, drafts, and system state.",
    primary: true,
  },
  {
    href: "/queue",
    label: "Queue",
    description: "Review drafts, follow-ups, tasks, and safety flags.",
    primary: true,
  },
  {
    href: "/conversations",
    label: "Conversations",
    description: "Inspect threads, context, drafts, and per-chat controls.",
    primary: true,
  },
  {
    href: "/status",
    label: "Status",
    description: "Review status drafts and posted updates.",
    primary: true,
  },
  {
    href: "/media",
    label: "Media",
    description: "Browse captured media with source-thread context.",
    primary: true,
  },
  {
    href: "/memes",
    label: "Memes",
    description: "Generate, preview, and approve meme assets.",
    primary: true,
  },
  {
    href: "/backlog",
    label: "Backlog",
    description: "Triage stale or unresolved threads before reconnecting.",
    primary: true,
  },
  {
    href: "/followups",
    label: "Follow-ups",
    description: "Confirm, reschedule, or dismiss conversation reminders.",
    primary: true,
  },
  {
    href: "/setup",
    label: "Setup",
    description: "Secure the app and connect message channels.",
    runtimeControlOnly: true,
  },
  {
    href: "/style-lab",
    label: "Style Lab",
    description: "Tune voice matching, persona packs, and rollback history.",
  },
  {
    href: "/rules",
    label: "Rules",
    description: "Set ignore lists, boundaries, and send constraints.",
  },
  {
    href: "/settings",
    label: "Settings",
    description: "Adjust runtime defaults and automation thresholds.",
  },
];

export const publicDashboardNavItems = dashboardNavItems.filter((item) => !item.adminOnly && !item.runtimeControlOnly);
