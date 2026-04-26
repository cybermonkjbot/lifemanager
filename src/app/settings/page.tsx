import { DashboardPage } from "@/components/dashboard-page";
import { LiveSettings } from "@/components/live-settings";

export default async function SettingsPage() {
  return (
    <DashboardPage title="Settings" subtitle="Adjust runtime defaults, automation thresholds, and shared media.">
      <LiveSettings />
    </DashboardPage>
  );
}
