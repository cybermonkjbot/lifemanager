import { DashboardShell } from "@/components/dashboard-shell";
import { LiveMedia } from "@/components/live-media";

export default async function MediaPage() {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL || process.env.CONVEX_URL || "";

  return (
    <DashboardShell
      title="Media"
      subtitle="Unified dashboard for stickers, images, video, audio, and documents across conversation threads."
      convexUrl={convexUrl}
    >
      <LiveMedia />
    </DashboardShell>
  );
}
