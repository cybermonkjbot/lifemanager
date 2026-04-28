import { AdminLivePage } from "@/components/admin-live-page";
import { LiveSystemsDesign } from "@/components/live-systems-design";

export default async function AdminSystemsDesignPage() {
  return (
    <AdminLivePage
      title="Service Topology"
      nextPath="/admin/systems-design"
      eyebrow="Architecture Operations"
      description="Map runtime services, dependencies, recent logs, and hot paths for admin diagnosis."
      showLogWatcher
      logWatcherDefaultExpanded={false}
    >
      <LiveSystemsDesign />
    </AdminLivePage>
  );
}
