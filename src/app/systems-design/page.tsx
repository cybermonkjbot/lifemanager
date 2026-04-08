import { DashboardPage } from "@/components/dashboard-page";
import { LiveSystemsDesign } from "@/components/live-systems-design";

export default async function SystemsDesignPage() {
  return (
    <DashboardPage title="Systems Design" subtitle="Topology canvas of every runtime service, connection flow, and per-service logs." showLogWatcher>
      <LiveSystemsDesign />
    </DashboardPage>
  );
}
