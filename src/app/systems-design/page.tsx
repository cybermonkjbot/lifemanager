import { DashboardShell } from "@/components/dashboard-shell";
import { LiveSystemsDesign } from "@/components/live-systems-design";

export default async function SystemsDesignPage() {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL || process.env.CONVEX_URL || "";

  return (
    <DashboardShell
      title="Systems Design"
      subtitle="Topology canvas of every runtime service, connection flow, and per-service logs."
      convexUrl={convexUrl}
      showLogWatcher
    >
      <LiveSystemsDesign />
    </DashboardShell>
  );
}
