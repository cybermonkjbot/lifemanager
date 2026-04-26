import { NextResponse } from "next/server";
import { requireInstanceApiAccess } from "@/lib/instance-guard";
import { getVoiceNoteSetupManager } from "@/lib/voice-note/setup-manager";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const unauthorized = await requireInstanceApiAccess(request);
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
