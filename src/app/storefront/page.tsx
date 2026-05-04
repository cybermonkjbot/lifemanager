import { DashboardPage } from "@/components/dashboard-page";
import { LiveStorefront } from "@/components/live-storefront";

export default async function StorefrontPage() {
  return (
    <DashboardPage title="Storefront" subtitle="Control the hosted chat-aided shop and livechat path for this business.">
      <LiveStorefront />
    </DashboardPage>
  );
}
