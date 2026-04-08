import { DashboardShell } from "@/components/dashboard-shell";
import { LiveTools } from "@/components/live-tools";

export default async function ToolsPage() {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL || process.env.CONVEX_URL || "";

  return (
    <DashboardShell
      title="Tool Playground"
      subtitle="Run retrieval, memory, style, and search tools against live conversation context."
      convexUrl={convexUrl}
    >
      <LiveTools />
    </DashboardShell>
  );
}
