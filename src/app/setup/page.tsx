import { DashboardShell } from "@/components/dashboard-shell";
import { SetupWizard } from "@/components/setup-wizard";

export default async function SetupPage() {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL || process.env.CONVEX_URL || "";

  return (
    <DashboardShell
      title="Setup Wizard"
      subtitle="Pair WhatsApp, verify connection, and get the worker ready."
      convexUrl={convexUrl}
    >
      <SetupWizard realtimeEnabled={Boolean(convexUrl)} />
    </DashboardShell>
  );
}
