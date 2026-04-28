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

export async function POST(request: NextRequest) {
  const unauthorized = await requireVoiceSetupAccess(request);
  if (unauthorized) {
    return unauthorized;
  }

  let modelId: string | undefined;
  try {
    const body = (await request.json()) as { modelId?: unknown };
    modelId = typeof body.modelId === "string" ? body.modelId : undefined;
  } catch {
    // keep default model id when body is missing/invalid
  }

  const manager = getVoiceNoteSetupManager();
  const state = await manager.install({ modelId });
  return NextResponse.json(state);
}
