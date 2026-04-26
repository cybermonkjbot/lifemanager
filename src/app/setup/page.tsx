import { ConvexAppProvider } from "@/components/convex-app-provider";
import { SetupOnboarding } from "@/components/setup-onboarding";
import { resolveInstanceSetupState } from "@/lib/instance-config";
import { getConvexUrl } from "@/lib/runtime-env";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const convexUrl = getConvexUrl();
  const initialInstanceState = await resolveInstanceSetupState();

  return (
    <ConvexAppProvider convexUrl={convexUrl}>
      <SetupOnboarding
        realtimeEnabled={Boolean(convexUrl)}
        initialInstanceState={initialInstanceState}
      />
    </ConvexAppProvider>
  );
}
