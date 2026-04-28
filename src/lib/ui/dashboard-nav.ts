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
    href: "/review",
    label: "Review",
    description: "Approve replies, confirm follow-ups, clear tasks, and check safety holds.",
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
    label: "Catch Up",
    description: "Pick up stale conversations before they become review items.",
    primary: true,
  },
  {
    href: "/setup",
    label: "Setup",
    description: "Secure the app and connect message channels.",
    runtimeControlOnly: true,
  },
  {
    href: "/settings",
    label: "Settings",
    description: "Adjust runtime, automation, style, media, and rules.",
    primary: true,
  },
];

export const publicDashboardNavItems = dashboardNavItems.filter((item) => !item.adminOnly && !item.runtimeControlOnly);
