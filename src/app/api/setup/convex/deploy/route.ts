import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { requireRuntimeControlApiAccess } from "@/lib/instance-guard";
import {
  readLocalInstanceConfig,
  resolveInstanceSetupState,
  sanitizeInstanceSetupPreferences,
  writeLocalInstanceConfig,
} from "@/lib/instance-config";
import { type InstanceSetupPreferences } from "@/lib/instance-setup-types";
import { syncInstancePreferencesToConvex } from "@/lib/instance-setup-sync";
import {
  isLoopbackHostname,
  requestHasValidSetupBootstrapSecret,
  setupBootstrapConfigured,
} from "@/lib/setup-bootstrap-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DeployPayload = {
  preferences?: Partial<InstanceSetupPreferences> | null;
};

type CommandResult = {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "Failed to set up Convex backend.";
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
  return !normalized || normalized.includes("example.") || normalized.includes("your-");
}

function validateSelfHostedBackendConfig(preferences: InstanceSetupPreferences) {
  const { selfHosted } = preferences;
  const convexUrl = parseHttpUrl(selfHosted.convexUrl);
  if (!convexUrl || isPlaceholderValue(selfHosted.convexUrl)) {
    return "Enter your real Convex deployment URL before setting up the backend.";
  }
  return "";
}

function compactOutput(value: string) {
  const normalized = value
    .replace(/\u001b\[[0-9;]*m/g, "")
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .join("\n")
    .trim();
  if (normalized.length <= 6000) {
    return normalized;
  }
  return `${normalized.slice(0, 2800)}\n...\n${normalized.slice(-2800)}`;
}

function redactSecrets(value: string, secrets: string[]) {
  return secrets.reduce((output, secret) => {
    const trimmed = secret.trim();
    return trimmed ? output.split(trimmed).join("[redacted]") : output;
  }, value);
}

function runCommand(command: string, args: string[], env: NodeJS.ProcessEnv, timeoutMs = 300000): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env,
      shell: false,
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: stderr || error.message, timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}

async function markBackendProvisioned(preferences: InstanceSetupPreferences) {
  const provisionedPreferences: InstanceSetupPreferences = {
    ...preferences,
    selfHosted: {
      ...preferences.selfHosted,
      convexDeployKey: "",
      convexBackendProvisionedAt: Date.now(),
    },
  };
  const current = await readLocalInstanceConfig().catch(() => null);
  if (current) {
    await writeLocalInstanceConfig({
      ...current,
      updatedAt: Date.now(),
      preferences: provisionedPreferences,
    });
  }
  return provisionedPreferences;
}

async function verifyBackend(preferences: InstanceSetupPreferences) {
  try {
    await syncInstancePreferencesToConvex(preferences);
    return true;
  } catch {
    return false;
  }
}

function convexBinaryPath() {
  const localBinary = path.join(process.cwd(), "node_modules", ".bin", process.platform === "win32" ? "convex.cmd" : "convex");
  return existsSync(localBinary) ? localBinary : "convex";
}

export async function POST(request: NextRequest) {
  let payload: DeployPayload;

  try {
    payload = (await request.json()) as DeployPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  try {
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

    const preferences = sanitizeInstanceSetupPreferences({
      ...currentState.preferences,
      ...(payload.preferences || {}),
    });
    if (preferences.serviceMode !== "self_hosted") {
      return NextResponse.json({ skipped: true, preferences });
    }

    const validationError = validateSelfHostedBackendConfig(preferences);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    process.env.CONVEX_URL = process.env.CONVEX_URL || preferences.selfHosted.convexUrl;
    process.env.NEXT_PUBLIC_CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL || preferences.selfHosted.convexUrl;

    if (await verifyBackend(preferences)) {
      const provisionedPreferences = await markBackendProvisioned(preferences);
      return NextResponse.json({
        status: "ready",
        deployed: false,
        message: "Convex backend is already reachable.",
        preferences: provisionedPreferences,
      });
    }

    const deployKey = preferences.selfHosted.convexDeployKey.trim() || (process.env.CONVEX_DEPLOY_KEY || "").trim();
    const adminKey = (process.env.CONVEX_SELF_HOSTED_ADMIN_KEY || "").trim();
    if (!deployKey && !adminKey) {
      return NextResponse.json(
        {
          error:
            "Convex backend is not ready yet. Add a Convex deploy key, then run setup again.",
          needsCredentials: true,
        },
        { status: 409 },
      );
    }

    const tempDir = await mkdtemp(path.join(tmpdir(), "odogwu-convex-"));
    const envFilePath = path.join(tempDir, "deploy.env");
    const secrets = [deployKey, adminKey].filter(Boolean);
    try {
      const envLines = deployKey
        ? [`CONVEX_DEPLOY_KEY=${deployKey}`]
        : [
            `CONVEX_SELF_HOSTED_URL=${preferences.selfHosted.convexUrl}`,
            `CONVEX_SELF_HOSTED_ADMIN_KEY=${adminKey}`,
          ];
      await writeFile(envFilePath, `${envLines.join("\n")}\n`, "utf8");

      const env: NodeJS.ProcessEnv = {
        ...process.env,
        CONVEX_URL: preferences.selfHosted.convexUrl,
        NEXT_PUBLIC_CONVEX_URL: preferences.selfHosted.convexUrl,
      };
      if (deployKey) {
        delete env.CONVEX_SELF_HOSTED_URL;
        delete env.CONVEX_SELF_HOSTED_ADMIN_KEY;
      } else {
        delete env.CONVEX_DEPLOY_KEY;
        delete env.CONVEX_DEPLOYMENT;
      }

      const result = await runCommand(
        convexBinaryPath(),
        ["deploy", "--env-file", envFilePath, "--typecheck", "try", "--codegen", "enable"],
        env,
      );
      const output = compactOutput(redactSecrets(`${result.stdout}\n${result.stderr}`, secrets));
      if (result.timedOut || result.code !== 0) {
        return NextResponse.json(
          {
            error: result.timedOut
              ? "Convex deploy timed out. Check the deployment key and network, then retry."
              : "Convex deploy failed. Check the output and retry.",
            output,
          },
          { status: 502 },
        );
      }

      if (!(await verifyBackend(preferences))) {
        return NextResponse.json(
          {
            error:
              "Convex deploy finished, but the app could not call the deployed backend. Make sure the Convex URL matches the deployment key.",
            output,
          },
          { status: 502 },
        );
      }

      const provisionedPreferences = await markBackendProvisioned(preferences);
      return NextResponse.json({
        status: "ready",
        deployed: true,
        message: "Convex backend deployed and verified.",
        output,
        preferences: provisionedPreferences,
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
