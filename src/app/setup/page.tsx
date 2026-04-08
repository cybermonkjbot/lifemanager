import { DashboardPage } from "@/components/dashboard-page";
import { getConvexUrl } from "@/lib/runtime-env";
import { SetupWizard } from "@/components/setup-wizard";

export default async function SetupPage() {
  const convexUrl = getConvexUrl();

  return (
    <DashboardPage title="Setup Wizard" subtitle="Pair WhatsApp and verify the worker connection.">
      <SetupWizard realtimeEnabled={Boolean(convexUrl)} />
    </DashboardPage>
  );
}
