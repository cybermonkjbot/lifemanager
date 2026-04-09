import { DashboardPage } from "@/components/dashboard-page";
import { getConvexUrl } from "@/lib/runtime-env";
import { SetupWizard } from "@/components/setup-wizard";

export default async function SetupPage() {
  const convexUrl = getConvexUrl();

  return (
    <DashboardPage title="Setup Wizard" subtitle="Connect WhatsApp and Instagram, then verify both workers.">
      <SetupWizard realtimeEnabled={Boolean(convexUrl)} />
    </DashboardPage>
  );
}
