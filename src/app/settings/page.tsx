import { DashboardPage } from "@/components/dashboard-page";
import { LiveSettings } from "@/components/live-settings";

export default async function SettingsPage() {
  return (
    <DashboardPage
      title="Settings"
      subtitle="Choose how OdogwuHQ replies, waits, and uses media."
      businessTitle="Business Settings"
      businessSubtitle="Tune brand voice, customer replies, storefront, livechat, automation, and media."
    >
      <LiveSettings />
    </DashboardPage>
  );
}
