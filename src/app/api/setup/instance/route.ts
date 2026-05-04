import { NextRequest, NextResponse } from "next/server";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { convexRefs } from "@/lib/convex-refs";
import { createConvexClient } from "@/lib/convex-server";
import {
  createLocalPinRecord,
  readLocalInstanceConfig,
  resolveInstanceSetupState,
  sanitizeInstanceAccountProfile,
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
import { LEGAL_POLICY_VERSIONS } from "@/lib/legal-policies";
import { requireRuntimeControlApiAccess } from "@/lib/instance-guard";
import {
  buildSetupBootstrapCookie,
  clearSetupBootstrapCookieOptions,
  getSetupBootstrapCookieName,
  getSetupBootstrapCookieOptions,
  isLoopbackHostname,
  remoteSetupAccessMessage,
  requestHasValidSetupBootstrapSecret,
  setupBootstrapConfigured,
} from "@/lib/setup-bootstrap-auth";
import { rateLimitJsonResponse } from "@/lib/rate-limit";
import {
  buildTenantSessionToken,
  getTenantSessionCookieName,
  getTenantSessionCookieOptions,
} from "@/lib/tenant-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MANAGED_SETUP_FAILED_MESSAGE =
  "We couldn't finish managed setup. Check your internet connection and try again. If this keeps happening, contact support.";

type SetupInstancePayload = {
  pin?: unknown;
  setupSecret?: unknown;
  preferences?: Partial<InstanceSetupPreferences> | null;
  account?: unknown;
  setupCompleted?: unknown;
  beginFullSetup?: unknown;
  issueSession?: unknown;
  legalAccepted?: unknown;
};

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "Failed to save setup state.";
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function parseHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

function isPlaceholderValue(value: string) {
  const normalized = value.trim().toLowerCase();
  return (
    !normalized ||
    normalized === "test-key" ||
    normalized === "your-api-key" ||
    normalized.includes("example.") ||
    normalized.includes("your-")
  );
}

function validateSelfHostedSetup(preferences: InstanceSetupPreferences) {
  const { selfHosted } = preferences;
  const convexUrl = parseHttpUrl(selfHosted.convexUrl);
  if (!convexUrl) {
    return "Enter your real Convex deployment URL.";
  }
  if (isPlaceholderValue(selfHosted.convexUrl)) {
    return "Replace the placeholder Convex URL with your real self-hosted Convex deployment.";
  }

  const aiBaseUrl = parseHttpUrl(selfHosted.aiBaseUrl);
  if (!aiBaseUrl || isPlaceholderValue(selfHosted.aiBaseUrl)) {
    return "Enter the real AI base URL you want this self-hosted instance to use.";
  }
  if (isPlaceholderValue(selfHosted.aiModel)) {
    return "Enter the real AI model for this self-hosted instance.";
  }
  if (isPlaceholderValue(selfHosted.aiApiKey)) {
    return "Enter a real AI API key. Placeholder keys like test-key cannot finish setup.";
  }
  return "";
}

function stripSelfHostedDeployCredentials(preferences: InstanceSetupPreferences): InstanceSetupPreferences {
  if (preferences.serviceMode !== "self_hosted") {
    return preferences;
  }
  return {
    ...preferences,
    selfHosted: {
      ...preferences.selfHosted,
      convexDeployKey: "",
    },
  };
}

function hashConnectorToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function createConnectorToken() {
  return `odogwu_ct_${randomBytes(32).toString("base64url")}`;
}

function tokenPreview(token: string) {
  return `${token.slice(0, 12)}...${token.slice(-6)}`;
}

export async function GET(request: NextRequest) {
  const state = await resolveInstanceSetupState();
  if (state.setupCompleted) {
    const unauthorized = await requireRuntimeControlApiAccess(request);
    if (unauthorized) {
      return unauthorized;
    }
  }
  return NextResponse.json(state);
}

export async function POST(request: NextRequest) {
  const limited = await rateLimitJsonResponse(request, {
    scope: "setup.instance",
    identity: request.headers.get("x-setup-secret") || request.headers.get("authorization") || "setup",
    limit: 10,
    windowMs: 60 * 1000,
    penaltyMs: 5 * 60 * 1000,
  });
  if (limited) {
    return limited;
  }

  let payload: SetupInstancePayload;

  try {
    payload = (await request.json()) as SetupInstancePayload;
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
      return NextResponse.json({ error: remoteSetupAccessMessage() }, { status: 403 });
    }

    const pinSource = await resolveInstancePinSource();
    const requestedPin = typeof payload.pin === "string" ? payload.pin.trim() : "";
    const nextPreferences = sanitizeInstanceSetupPreferences({
      ...(current?.preferences || DEFAULT_INSTANCE_SETUP_PREFERENCES),
      ...(payload.preferences || {}),
    });
    const accountInput = typeof payload.account === "object" && payload.account ? (payload.account as Record<string, unknown>) : {};
    const requestedAccount = sanitizeInstanceAccountProfile({
      ...(current?.account || {}),
      email: typeof accountInput.email === "string" ? accountInput.email : current?.account?.email,
      displayName: typeof accountInput.displayName === "string" ? accountInput.displayName : current?.account?.displayName,
    });
    const nextAccount = {
      ...requestedAccount,
      billingStatus: nextPreferences.serviceMode === "self_hosted" ? "self_hosted" as const : requestedAccount.billingStatus,
      deviceId: requestedAccount.deviceId || current?.account?.deviceId || randomUUID(),
    };
    if (nextPreferences.serviceMode === "self_hosted") {
      nextAccount.tenantId = "";
      nextAccount.connectorToken = "";
      nextAccount.connectorTokenEncrypted = "";
      nextAccount.connectorTokenIv = "";
      nextAccount.connectorTokenTag = "";
      nextAccount.connectorTokenExpiresAt = null;
      nextAccount.trialStartedAt = null;
      nextAccount.trialEndsAt = null;
    }
    const wantsCompletion = payload.setupCompleted === true;
    const beginsFullSetup = payload.beginFullSetup === true;
    const shouldIssueSession = payload.issueSession === true;
    const wantsLegalAcceptance = payload.legalAccepted === true;

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

    const legalAcceptance = wantsLegalAcceptance
      ? {
          accepted: true,
          acceptedAt: now,
          privacyPolicyVersion: LEGAL_POLICY_VERSIONS.privacyPolicy,
          termsVersion: LEGAL_POLICY_VERSIONS.terms,
        }
      : current?.legalAcceptance;

    const legalAcceptanceIsCurrent =
      legalAcceptance?.accepted === true &&
      legalAcceptance.privacyPolicyVersion === LEGAL_POLICY_VERSIONS.privacyPolicy &&
      legalAcceptance.termsVersion === LEGAL_POLICY_VERSIONS.terms;

    if (wantsCompletion && !legalAcceptanceIsCurrent) {
      return NextResponse.json({ error: "Accept the Privacy Policy and Terms before finishing setup." }, { status: 400 });
    }

    if (wantsCompletion && nextPreferences.serviceMode === "hosted" && !isValidEmail(nextAccount.email)) {
      return NextResponse.json({ error: "Enter a valid email before finishing managed setup." }, { status: 400 });
    }

    if ((payload.preferences || wantsCompletion) && nextPreferences.serviceMode === "self_hosted") {
      const selfHostedError = validateSelfHostedSetup(nextPreferences);
      if (selfHostedError) {
        return NextResponse.json({ error: selfHostedError }, { status: 400 });
      }
    }

    const envManagedPin = pinSource === "env" ? (process.env.SLM_INSTANCE_PIN || "").trim() : "";
    const backendPinRecord =
      pinRecord ||
      (envManagedPin ? createLocalPinRecord(envManagedPin, undefined, now) : null);

    let tenantRegistrationError = "";
    let tenantSessionIdentity:
      | {
          userId?: string;
          email: string;
          role: "owner";
          isSuperAdmin: true;
        }
      | undefined;
    if (nextPreferences.serviceMode === "hosted" && isValidEmail(nextAccount.email)) {
      try {
        const registered = (await createConvexClient().mutation(convexRefs.tenantAccountsRegisterFromDesktop, {
          email: nextAccount.email,
          displayName: nextAccount.displayName,
          deviceId: nextAccount.deviceId,
          serviceMode: "hosted",
          plan: nextPreferences.productUse === "business" ? "business_whatsapp" : "personal_connector",
          ...(backendPinRecord
            ? {
                pinSalt: backendPinRecord.salt,
                pinHash: backendPinRecord.hash,
                pinUpdatedAt: backendPinRecord.updatedAt,
              }
            : {}),
        })) as {
          tenantId: string;
          userId?: string;
          trialStartedAt: number;
          trialEndsAt: number;
          billingStatus: "trialing" | "active" | "past_due" | "paused" | "canceled";
          pinConfigured: boolean;
        };
        nextAccount.tenantId = registered.tenantId;
        nextAccount.trialStartedAt = registered.trialStartedAt;
        nextAccount.trialEndsAt = registered.trialEndsAt;
        nextAccount.billingStatus = registered.billingStatus;
        tenantSessionIdentity = {
          userId: registered.userId,
          email: nextAccount.email,
          role: "owner",
          isSuperAdmin: true,
        };
        if (backendPinRecord) {
          const connectorToken = createConnectorToken();
          const connectorTokenExpiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
          await createConvexClient().mutation(convexRefs.tenantAccountsIssueConnectorToken, {
            email: nextAccount.email,
            pinHash: backendPinRecord.hash,
            deviceId: nextAccount.deviceId,
            tokenHash: hashConnectorToken(connectorToken),
            tokenPreview: tokenPreview(connectorToken),
            expiresAt: connectorTokenExpiresAt,
          });
          nextAccount.connectorToken = connectorToken;
          nextAccount.connectorTokenExpiresAt = connectorTokenExpiresAt;
        }
      } catch (error) {
        void error;
        tenantRegistrationError = MANAGED_SETUP_FAILED_MESSAGE;
      }
    }

    if (wantsCompletion && nextPreferences.serviceMode === "hosted" && !nextAccount.tenantId) {
      return NextResponse.json(
        {
          error: tenantRegistrationError || MANAGED_SETUP_FAILED_MESSAGE,
        },
        { status: 502 },
      );
    }

    const persistedPreferences = stripSelfHostedDeployCredentials(nextPreferences);
    const nextConfig = {
      version: 1 as const,
      setupCompleted:
        beginsFullSetup
          ? false
          : wantsCompletion && nextPreferences.serviceMode !== "self_hosted"
            ? true
            : current?.setupCompleted === true,
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
      pin: pinRecord,
      legalAcceptance,
      preferences: persistedPreferences,
      account: nextAccount,
      setupAiSettingsToolConsumedAt: beginsFullSetup ? null : current?.setupAiSettingsToolConsumedAt ?? null,
    };

    await writeLocalInstanceConfig(nextConfig);
    await writeLocalSoulMarkdown(nextPreferences.soulProfile, nextPreferences.soulPrivacy);

    if (nextPreferences.serviceMode === "self_hosted" && nextPreferences.selfHosted.convexUrl) {
      process.env.CONVEX_URL = process.env.CONVEX_URL || nextPreferences.selfHosted.convexUrl;
      process.env.NEXT_PUBLIC_CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL || nextPreferences.selfHosted.convexUrl;
    }

    let preferencesSynced = false;
    try {
      preferencesSynced = await syncInstancePreferencesToConvex(nextPreferences);
    } catch {
      preferencesSynced = false;
    }

    let responseConfig = nextConfig;
    if (nextPreferences.serviceMode === "self_hosted" && preferencesSynced) {
      responseConfig = {
        ...nextConfig,
        setupCompleted: beginsFullSetup ? false : wantsCompletion ? true : nextConfig.setupCompleted,
        preferences: {
          ...nextPreferences,
          selfHosted: {
            ...persistedPreferences.selfHosted,
            convexBackendProvisionedAt: nextPreferences.selfHosted.convexBackendProvisionedAt || now,
          },
        },
      };
      await writeLocalInstanceConfig(responseConfig);
    }

    if (wantsCompletion && nextPreferences.serviceMode === "self_hosted" && !preferencesSynced) {
      return NextResponse.json(
        {
          error:
            "Self-hosted Convex backend is not ready yet. Run the backend setup step so the app can deploy and verify its Convex functions.",
        },
        { status: 502 },
      );
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
      redirectPath: responseConfig.setupCompleted ? (canIssueSession ? "/" : pinWillBeEnabled ? "/unlock" : "/") : "/setup",
    };
    const response = NextResponse.json(body);

    if (canIssueSession) {
      const token = await buildInstancePinSessionToken();
      response.cookies.set(getInstancePinCookieName(), token, getInstancePinCookieOptions());
      const tenantSessionToken = await buildTenantSessionToken(tenantSessionIdentity);
      if (tenantSessionToken) {
        response.cookies.set(getTenantSessionCookieName(), tenantSessionToken, getTenantSessionCookieOptions());
      }
    }

    if (responseConfig.setupCompleted) {
      response.cookies.set(getSetupBootstrapCookieName(), "", clearSetupBootstrapCookieOptions());
    } else if (setupBootstrapConfigured() && (isLocalBootstrap || hasValidSetupSecret)) {
      response.cookies.set(getSetupBootstrapCookieName(), buildSetupBootstrapCookie(), getSetupBootstrapCookieOptions());
    }

    return response;
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
