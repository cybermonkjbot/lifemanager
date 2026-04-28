import { AdminLivePage } from "@/components/admin-live-page";
import { LiveSelfImprovement } from "@/components/live-self-improvement";

export default async function AdminSelfImprovementPage() {
  return (
    <AdminLivePage
      title="Self-Improvement Runs"
      nextPath="/admin/self-improvement"
      eyebrow="Automation Oversight"
      description="Review Codex improvement cycles, captured prompts, run status, and failure details."
    >
      <LiveSelfImprovement />
    </AdminLivePage>
  );
}
