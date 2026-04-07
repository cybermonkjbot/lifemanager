import { DashboardShell } from "@/components/dashboard-shell";
import { LiveStyleLab } from "@/components/live-style-lab";

export default async function StyleLabPage() {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL || process.env.CONVEX_URL || "";

  return (
    <DashboardShell
      title="Style Lab"
      subtitle="Tune mimicry, inspect learned traits, and manage persona packs."
      convexUrl={convexUrl}
    >
      <LiveStyleLab />
    </DashboardShell>
  );
}
