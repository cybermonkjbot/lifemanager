import { DashboardPage } from "@/components/dashboard-page";
import { LiveActivityCore } from "@/components/live-activity-core";

const defaultSplineScene = "https://my.spline.design/interactiveaiassistant-1MceEbo4oJdzWd3AQPZq9CSB/";

export default async function ActivityCorePage() {
  const splineSceneUrl = process.env.NEXT_PUBLIC_SPLINE_ACTIVITY_SCENE_URL || defaultSplineScene;

  return (
    <DashboardPage
      title="Activity Core"
      subtitle="Watch live activity and media signals for your tenant."
      businessTitle="Business Activity"
      businessSubtitle="Watch live customer, storefront, media, and automation signals for this tenant."
    >
      <LiveActivityCore splineSceneUrl={splineSceneUrl} />
    </DashboardPage>
  );
}
