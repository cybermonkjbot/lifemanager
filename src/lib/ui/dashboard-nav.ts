export type DashboardNavItem = {
  href: string;
  label: string;
  businessLabel?: string;
  description: string;
  businessDescription?: string;
  primary?: boolean;
  adminOnly?: boolean;
  runtimeControlOnly?: boolean;
  businessOnly?: boolean;
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
    businessLabel: "Sales Review",
    description: "Approve replies, confirm follow-ups, clear tasks, and check safety holds.",
    businessDescription: "Approve customer replies, sales follow-ups, handoffs, and safety holds.",
    primary: true,
  },
  {
    href: "/conversations",
    label: "Conversations",
    businessLabel: "Customers",
    description: "Inspect threads, context, drafts, and per-chat controls.",
    businessDescription: "Inspect customer threads, lead context, drafts, and per-chat controls.",
    primary: true,
  },
  {
    href: "/storefront",
    label: "Storefront",
    description: "Control the hosted chat-aided storefront and livechat embed.",
    primary: true,
    businessOnly: true,
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
    href: "/activity-core",
    label: "Activity Core",
    description: "Watch live tenant activity, media, and system signals.",
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
