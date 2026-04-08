import { DashboardPage } from "@/components/dashboard-page";
import { LiveSystemsDesign } from "@/components/live-systems-design";

export default async function SystemsDesignPage() {
  return (
    <DashboardPage title="Systems Design" subtitle="Inspect runtime topology, service links, and recent logs." showLogWatcher>
      <LiveSystemsDesign />
    </DashboardPage>
  );
}
