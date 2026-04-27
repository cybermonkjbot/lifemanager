import { NextResponse } from "next/server";
import { requireRuntimeControlApiAccess } from "@/lib/instance-guard";
import { getVoiceNoteSetupManager } from "@/lib/voice-note/setup-manager";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const unauthorized = await requireRuntimeControlApiAccess(request);
  if (unauthorized) {
    return unauthorized;
  }

  const manager = getVoiceNoteSetupManager();
  const state = await manager.reset();
  return NextResponse.json(state);
}
