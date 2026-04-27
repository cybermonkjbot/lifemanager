import { AdminLivePage } from "@/components/admin-live-page";
import { LiveSystemsDesign } from "@/components/live-systems-design";

export default async function AdminSystemsDesignPage() {
  return (
    <AdminLivePage title="Systems Design" nextPath="/admin/systems-design" showLogWatcher logWatcherDefaultExpanded={false}>
      <LiveSystemsDesign />
    </AdminLivePage>
  );
}
