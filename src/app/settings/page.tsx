import { DashboardPage } from "@/components/dashboard-page";
import { LiveSettings } from "@/components/live-settings";

export default async function SettingsPage() {
  return (
    <DashboardPage title="Settings" subtitle="Configure runtime defaults, global personality profiles, and shared media assets.">
      <LiveSettings />
    </DashboardPage>
  );
}
