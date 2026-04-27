import { ConvexAppProvider } from "@/components/convex-app-provider";
import { SetupOnboarding } from "@/components/setup-onboarding";
import { resolveInstanceSetupState } from "@/lib/instance-config";
import { requireRuntimeControlPageAccess } from "@/lib/instance-guard";
import { getConvexUrl } from "@/lib/runtime-env";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const initialInstanceState = await resolveInstanceSetupState();
  if (initialInstanceState.setupCompleted) {
    await requireRuntimeControlPageAccess();
  }
  const selfHostedConvexUrl =
    initialInstanceState.preferences.serviceMode === "self_hosted"
      ? initialInstanceState.preferences.selfHosted.convexUrl
      : "";
  const convexUrl = selfHostedConvexUrl || getConvexUrl();

  return (
    <ConvexAppProvider convexUrl={convexUrl}>
      <SetupOnboarding
        realtimeEnabled={Boolean(convexUrl)}
        initialInstanceState={initialInstanceState}
      />
    </ConvexAppProvider>
  );
}
