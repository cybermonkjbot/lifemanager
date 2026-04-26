import { NextRequest, NextResponse } from "next/server";
import {
  createLocalPinRecord,
  readLocalInstanceConfig,
  resolveInstanceSetupState,
  sanitizeInstanceSetupPreferences,
  writeLocalSoulMarkdown,
  writeLocalInstanceConfig,
} from "@/lib/instance-config";
import { syncInstancePreferencesToConvex } from "@/lib/instance-setup-sync";
import {
  buildInstancePinSessionToken,
  getInstancePinCookieName,
  getInstancePinCookieOptions,
  matchesInstancePin,
  resolveInstancePinSource,
} from "@/lib/instance-pin";
import { DEFAULT_INSTANCE_SETUP_PREFERENCES, type InstanceSetupPreferences } from "@/lib/instance-setup-types";
import {
  buildSetupBootstrapCookie,
  clearSetupBootstrapCookieOptions,
  getSetupBootstrapCookieName,
  getSetupBootstrapCookieOptions,
  isLoopbackHostname,
  requestHasValidSetupBootstrapSecret,
  setupBootstrapConfigured,
} from "@/lib/setup-bootstrap-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SetupInstancePayload = {
  pin?: unknown;
  setupSecret?: unknown;
  preferences?: Partial<InstanceSetupPreferences> | null;
  setupCompleted?: unknown;
  beginFullSetup?: unknown;
  issueSession?: unknown;
};

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "Failed to save setup state.";
}

export async function GET() {
  const state = await resolveInstanceSetupState();
  return NextResponse.json(state);
}

export async function POST(request: NextRequest) {
  let payload: SetupInstancePayload;

  try {
    payload = (await request.json()) as SetupInstancePayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  try {
    const current = await readLocalInstanceConfig();
    const currentState = await resolveInstanceSetupState();
    const isLocalBootstrap = isLoopbackHostname(request.nextUrl.hostname);
    const hasValidSetupSecret = requestHasValidSetupBootstrapSecret(request.headers);
    if (!currentState.setupCompleted && !isLocalBootstrap && !hasValidSetupSecret) {
      const message = setupBootstrapConfigured()
        ? "Remote setup requires the configured setup bootstrap secret."
        : "Remote setup is disabled until SLM_SETUP_SECRET is configured. Complete setup from localhost instead.";
      return NextResponse.json({ error: message }, { status: 403 });
    }

    const pinSource = await resolveInstancePinSource();
    const requestedPin = typeof payload.pin === "string" ? payload.pin.trim() : "";
    const nextPreferences = sanitizeInstanceSetupPreferences({
      ...(current?.preferences || DEFAULT_INSTANCE_SETUP_PREFERENCES),
      ...(payload.preferences || {}),
    });
    const wantsCompletion = payload.setupCompleted === true;
    const beginsFullSetup = payload.beginFullSetup === true;
    const shouldIssueSession = payload.issueSession === true;

    if (pinSource === "env" && requestedPin && !(await matchesInstancePin(requestedPin))) {
      return NextResponse.json({ error: "This instance PIN is managed by environment configuration." }, { status: 400 });
    }

    if (pinSource !== "env" && requestedPin && requestedPin.length < 4) {
      return NextResponse.json({ error: "PIN must be at least 4 characters." }, { status: 400 });
    }

    const now = Date.now();
    const pinRecord =
      pinSource === "env"
        ? current?.pin || null
        : requestedPin
          ? createLocalPinRecord(requestedPin, current?.pin?.cookieSecret, now)
          : current?.pin || null;

    if (wantsCompletion && pinSource !== "env" && !pinRecord) {
      return NextResponse.json({ error: "Set an instance PIN before finishing setup." }, { status: 400 });
    }

    const nextConfig = {
      version: 1 as const,
      setupCompleted: beginsFullSetup ? false : wantsCompletion ? true : current?.setupCompleted === true,
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
      pin: pinRecord,
      preferences: nextPreferences,
      setupAiSettingsToolConsumedAt: beginsFullSetup ? null : current?.setupAiSettingsToolConsumedAt ?? null,
    };

    await writeLocalInstanceConfig(nextConfig);
    await writeLocalSoulMarkdown(nextPreferences.soulProfile, nextPreferences.soulPrivacy);

    let preferencesSynced = false;
    try {
      preferencesSynced = await syncInstancePreferencesToConvex(nextPreferences);
    } catch {
      preferencesSynced = false;
    }

    const pinWillBeEnabled = pinSource === "env" || Boolean(pinRecord);
    const canIssueSession = Boolean(
      shouldIssueSession &&
        requestedPin.length > 0 &&
        (pinSource === "env" ? await matchesInstancePin(requestedPin) : pinRecord),
    );
    const body = {
      state: await resolveInstanceSetupState(),
      preferencesSynced,
      issuedSession: canIssueSession,
      redirectPath: nextConfig.setupCompleted ? (canIssueSession ? "/" : pinWillBeEnabled ? "/unlock" : "/") : "/setup",
    };
    const response = NextResponse.json(body);

    if (canIssueSession) {
      const token = await buildInstancePinSessionToken();
      response.cookies.set(getInstancePinCookieName(), token, getInstancePinCookieOptions());
    }

    if (nextConfig.setupCompleted) {
      response.cookies.set(getSetupBootstrapCookieName(), "", clearSetupBootstrapCookieOptions());
    } else if (setupBootstrapConfigured() && (isLocalBootstrap || hasValidSetupSecret)) {
      response.cookies.set(getSetupBootstrapCookieName(), buildSetupBootstrapCookie(), getSetupBootstrapCookieOptions());
    }

    return response;
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
