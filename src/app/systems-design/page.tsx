import { DashboardPage } from "@/components/dashboard-page";
import { LiveSystemsDesign } from "@/components/live-systems-design";

export default async function SystemsDesignPage() {
  return (
    <DashboardPage title="Systems Design" subtitle="Trace service links, dependencies, and recent logs." showLogWatcher logWatcherDefaultExpanded={false}>
      <LiveSystemsDesign />
    </DashboardPage>
  );
}
