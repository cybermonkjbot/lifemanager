import { NextRequest, NextResponse } from "next/server";
import {
  readLocalInstanceConfig,
  resolveInstanceSetupState,
  sanitizeInstanceSetupPreferences,
  sanitizeInstanceSoulProfile,
  writeLocalInstanceConfig,
  writeLocalSoulMarkdown,
} from "@/lib/instance-config";
import { syncInstancePreferencesToConvex } from "@/lib/instance-setup-sync";
import { DEFAULT_INSTANCE_SETUP_PREFERENCES, type InstanceSetupPreferences } from "@/lib/instance-setup-types";
import { requireRuntimeControlApiAccess } from "@/lib/instance-guard";
import {
  isLoopbackHostname,
  requestHasValidSetupBootstrapSecret,
  setupBootstrapConfigured,
} from "@/lib/setup-bootstrap-auth";
import { generateSetupPreferencesWithAiTool } from "@/worker/ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SetupAiSettingsPayload = {
  preferences?: Partial<InstanceSetupPreferences> | null;
};

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "Failed to run setup AI settings tool.";
}

export async function POST(request: NextRequest) {
  let payload: SetupAiSettingsPayload;

  try {
    payload = (await request.json()) as SetupAiSettingsPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  try {
    const current = await readLocalInstanceConfig();
    const currentState = await resolveInstanceSetupState();
    if (currentState.setupCompleted) {
      const unauthorized = await requireRuntimeControlApiAccess(request);
      if (unauthorized) {
        return unauthorized;
      }
    }

    const isLocalBootstrap = isLoopbackHostname(request.nextUrl.hostname);
    const hasValidSetupSecret = requestHasValidSetupBootstrapSecret(request.headers);

    if (!currentState.setupCompleted && !isLocalBootstrap && !hasValidSetupSecret) {
      const message = setupBootstrapConfigured()
        ? "Remote setup requires the configured setup bootstrap secret."
        : "Remote setup is disabled until SLM_SETUP_SECRET is configured. Complete setup from localhost instead.";
      return NextResponse.json({ error: message }, { status: 403 });
    }

    if (currentState.setupCompleted) {
      return NextResponse.json({ error: "The setup AI settings tool is disabled after setup completes." }, { status: 409 });
    }

    if (!currentState.setupAiSettingsToolAvailable) {
      return NextResponse.json({ error: "The setup AI settings tool has already been used for this setup run." }, { status: 409 });
    }

    const currentPreferences = sanitizeInstanceSetupPreferences({
      ...(current?.preferences || DEFAULT_INSTANCE_SETUP_PREFERENCES),
      ...(payload.preferences || {}),
    });
    const soulProfile = sanitizeInstanceSoulProfile(currentPreferences.soulProfile);
    const aiResult = await generateSetupPreferencesWithAiTool({
      soulProfile,
      currentPreferences: {
        ...currentPreferences,
        soulProfile,
      },
    });
    const nextPreferences = sanitizeInstanceSetupPreferences(aiResult.preferences);
    const now = Date.now();

    await writeLocalInstanceConfig({
      version: 1,
      setupCompleted: false,
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
      pin: current?.pin || null,
      legalAcceptance: current?.legalAcceptance,
      preferences: nextPreferences,
      account: current?.account,
      setupAiSettingsToolConsumedAt: now,
    });
    await writeLocalSoulMarkdown(nextPreferences.soulProfile, nextPreferences.soulPrivacy);

    let preferencesSynced = false;
    try {
      preferencesSynced = await syncInstancePreferencesToConvex(nextPreferences);
    } catch {
      preferencesSynced = false;
    }

    return NextResponse.json({
      state: await resolveInstanceSetupState(),
      preferences: nextPreferences,
      rationale: aiResult.rationale,
      provider: aiResult.provider,
      model: aiResult.model,
      latencyMs: aiResult.latencyMs,
      preferencesSynced,
      toolDisabled: true,
    });
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
