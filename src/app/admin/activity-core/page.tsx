import { AdminLivePage } from "@/components/admin-live-page";
import { LiveActivityCore } from "@/components/live-activity-core";

const defaultSplineScene = "https://my.spline.design/interactiveaiassistant-1MceEbo4oJdzWd3AQPZq9CSB/";

export default async function AdminActivityCorePage() {
  const splineSceneUrl = process.env.NEXT_PUBLIC_SPLINE_ACTIVITY_SCENE_URL || defaultSplineScene;

  return (
    <AdminLivePage
      title="Activity Core"
      nextPath="/admin/activity-core"
      eyebrow="Signal Operations"
      description="Audit live activity, media events, and backend signal classification from one operator surface."
    >
      <LiveActivityCore splineSceneUrl={splineSceneUrl} showAccountFilter />
    </AdminLivePage>
  );
}
