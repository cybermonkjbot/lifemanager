import { NextRequest, NextResponse } from "next/server";
import { requireRuntimeControlApiAccess } from "@/lib/instance-guard";
import { readLocalInstanceConfig } from "@/lib/instance-config";
import { isLoopbackHostname, requestHasValidSetupBootstrapSecret } from "@/lib/setup-bootstrap-auth";
import { getVoiceNoteSetupManager } from "@/lib/voice-note/setup-manager";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireVoiceSetupAccess(request: NextRequest) {
  const config = await readLocalInstanceConfig();
  if (!config?.setupCompleted) {
    if (isLoopbackHostname(request.nextUrl.hostname) || requestHasValidSetupBootstrapSecret(request.headers)) {
      return null;
    }
  }
  return await requireRuntimeControlApiAccess(request);
}

export async function GET(request: NextRequest) {
  const unauthorized = await requireVoiceSetupAccess(request);
  if (unauthorized) {
    return unauthorized;
  }

  const manager = getVoiceNoteSetupManager();
  const state = await manager.getState();
  const includeLog = request.nextUrl.searchParams.get("log") === "1";
  const installLog = includeLog ? await manager.readInstallLog() : undefined;

  return NextResponse.json({
    ...state,
    installLog,
  });
}
