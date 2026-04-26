import { NextRequest, NextResponse } from "next/server";
import { requireInstanceApiAccess } from "@/lib/instance-guard";
import { getVoiceNoteSetupManager } from "@/lib/voice-note/setup-manager";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const unauthorized = await requireInstanceApiAccess(request);
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
