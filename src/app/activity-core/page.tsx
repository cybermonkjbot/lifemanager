import { DashboardShell } from "@/components/dashboard-shell";
import { LiveActivityCore } from "@/components/live-activity-core";

const defaultSplineScene = "https://my.spline.design/interactiveaiassistant-1MceEbo4oJdzWd3AQPZq9CSB/";

export default async function ActivityCorePage() {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL || process.env.CONVEX_URL || "";
  const splineSceneUrl = process.env.NEXT_PUBLIC_SPLINE_ACTIVITY_SCENE_URL || defaultSplineScene;

  return (
    <DashboardShell
      title="Activity Core"
      subtitle="Centered Spline object with live activity + media signals, glowing states, and inline filters."
      convexUrl={convexUrl}
    >
      <LiveActivityCore splineSceneUrl={splineSceneUrl} />
    </DashboardShell>
  );
}
