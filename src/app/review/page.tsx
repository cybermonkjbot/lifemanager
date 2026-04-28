import { DashboardPage } from "@/components/dashboard-page";
import { LiveQueue } from "@/components/live-queue";

export default async function ReviewPage() {
  return (
    <DashboardPage title="Review" subtitle="Approve replies, confirm follow-ups, turn notes into tasks, and clear safety holds.">
      <LiveQueue />
    </DashboardPage>
  );
}
