import { DashboardShell } from "@/components/dashboard-shell";
import { SetupNotice } from "@/components/setup-notice";
import { SetupWizard } from "@/components/setup-wizard";
import { getSystemPageData } from "@/lib/data";

export default async function SetupPage() {
  const systemData = await getSystemPageData();
  const autonomyPaused = Boolean(systemData.health?.config?.autonomyPaused);

  return (
    <DashboardShell
      title="Setup Wizard"
      subtitle="Pair WhatsApp, verify connection, and get the worker ready."
      autonomyPaused={autonomyPaused}
    >
      {!systemData.ready ? <SetupNotice error={systemData.error} /> : null}
      <SetupWizard />
    </DashboardShell>
  );
}
