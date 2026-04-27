import { AdminLivePage } from "@/components/admin-live-page";
import { LiveSystem } from "@/components/live-system";

export default async function AdminSystemPage() {
  return (
    <AdminLivePage title="System" nextPath="/admin/system" showLogWatcher>
      <LiveSystem />
    </AdminLivePage>
  );
}
