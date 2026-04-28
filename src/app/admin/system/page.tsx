import { AdminLivePage } from "@/components/admin-live-page";
import { LiveSystem } from "@/components/live-system";

export default async function AdminSystemPage() {
  return (
    <AdminLivePage
      title="Runtime System"
      nextPath="/admin/system"
      eyebrow="Runtime Operations"
      description="Inspect provider health, queue pressure, AI test output, transcription events, and live logs."
      showLogWatcher
    >
      <LiveSystem />
    </AdminLivePage>
  );
}
