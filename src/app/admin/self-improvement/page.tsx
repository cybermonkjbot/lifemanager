import { AdminLivePage } from "@/components/admin-live-page";
import { LiveSelfImprovement } from "@/components/live-self-improvement";

export default async function AdminSelfImprovementPage() {
  return (
    <AdminLivePage title="Self Improvement" nextPath="/admin/self-improvement">
      <LiveSelfImprovement />
    </AdminLivePage>
  );
}
