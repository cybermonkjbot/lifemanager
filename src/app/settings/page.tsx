import { DashboardShell } from "@/components/dashboard-shell";
import { LiveSettings } from "@/components/live-settings";

export default async function SettingsPage() {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL || process.env.CONVEX_URL || "";

  return (
    <DashboardShell
      title="Settings"
      subtitle="Configure runtime defaults, global personality profiles, and shared media assets."
      convexUrl={convexUrl}
    >
      <LiveSettings />
    </DashboardShell>
  );
}
