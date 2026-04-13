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
    description: "Overview of queues, conversations, and daily priorities.",
    primary: true,
  },
  {
    href: "/queue",
    label: "Queue",
    description: "Process pending replies, follow-ups, and safety checks.",
    primary: true,
  },
  {
    href: "/conversations",
    label: "Conversations",
    description: "Open thread history and review draft responses.",
    primary: true,
  },
  {
    href: "/status",
    label: "Status",
    description: "Review status drafts, posts, and approval flow.",
    primary: true,
  },
  {
    href: "/media",
    label: "Media",
    description: "Browse saved media and jump to source threads.",
    primary: true,
  },
  {
    href: "/memes",
    label: "Memes",
    description: "Create memes and manage generated outputs.",
    primary: true,
  },
  {
    href: "/backlog",
    label: "Backlog",
    description: "Prioritize unread threads and restart stale conversations.",
    primary: true,
  },
  {
    href: "/followups",
    label: "Follow-ups",
    description: "Track scheduled outreach and completion.",
    primary: true,
  },
  {
    href: "/activity-core",
    label: "Activity Core",
    description: "View live activity and media signals in one stream.",
    primary: true,
  },
  {
    href: "/systems-design",
    label: "Systems Design",
    description: "Inspect runtime topology and service links.",
    primary: true,
  },
  {
    href: "/setup",
    label: "Setup",
    description: "Connect channels and verify worker health.",
  },
  {
    href: "/style-lab",
    label: "Style Lab",
    description: "Adjust voice traits and persona packs.",
  },
  {
    href: "/rules",
    label: "Rules",
    description: "Set communication boundaries and ignore lists.",
  },
  {
    href: "/settings",
    label: "Settings",
    description: "Tune runtime defaults and automation behavior.",
  },
  {
    href: "/system",
    label: "System",
    description: "Inspect health checks, logs, and provider traces.",
  },
  {
    href: "/self-improvement",
    label: "Self Improvement",
    description: "Review manual and scheduled improvement runs.",
  },
];
