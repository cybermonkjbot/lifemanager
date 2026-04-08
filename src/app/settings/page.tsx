import { DashboardPage } from "@/components/dashboard-page";
import { LiveSettings } from "@/components/live-settings";

export default async function SettingsPage() {
  return (
    <DashboardPage title="Settings" subtitle="Configure runtime defaults, profiles, and shared media assets.">
      <LiveSettings />
    </DashboardPage>
  );
}
