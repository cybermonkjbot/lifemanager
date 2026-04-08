import { DashboardPage } from "@/components/dashboard-page";
import { getConvexUrl } from "@/lib/runtime-env";
import { SetupWizard } from "@/components/setup-wizard";

export default async function SetupPage() {
  const convexUrl = getConvexUrl();

  return (
    <DashboardPage title="Setup Wizard" subtitle="Pair WhatsApp, verify connection, and get the worker ready.">
      <SetupWizard realtimeEnabled={Boolean(convexUrl)} />
    </DashboardPage>
  );
}
