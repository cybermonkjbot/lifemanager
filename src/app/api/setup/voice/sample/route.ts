import { NextRequest, NextResponse } from "next/server";
import { requireRuntimeControlApiAccess } from "@/lib/instance-guard";
import { readLocalInstanceConfig } from "@/lib/instance-config";
import { isLoopbackHostname, requestHasValidSetupBootstrapSecret } from "@/lib/setup-bootstrap-auth";
import { rateLimitJsonResponse } from "@/lib/rate-limit";
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
  const limited = await rateLimitJsonResponse(request, {
    scope: "setup.voice_sample",
    identity: request.headers.get("x-setup-secret") || request.headers.get("authorization") || "setup",
    limit: 6,
    windowMs: 60 * 60 * 1000,
    penaltyMs: 30 * 60 * 1000,
  });
  if (limited) {
    return limited;
  }

  const unauthorized = await requireVoiceSetupAccess(request);
  if (unauthorized) {
    return unauthorized;
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data." }, { status: 400 });
  }

  const sample = formData.get("sample");
  const promptTextRaw = formData.get("promptText");
  const promptText = typeof promptTextRaw === "string" ? promptTextRaw : "";

  if (!(sample instanceof Blob)) {
    return NextResponse.json({ error: "Audio sample is required." }, { status: 400 });
  }

  const arrayBuffer = await sample.arrayBuffer();
  const audioBytes = Buffer.from(arrayBuffer);

  if (audioBytes.length === 0) {
    return NextResponse.json({ error: "Audio sample is empty." }, { status: 400 });
  }

  const manager = getVoiceNoteSetupManager();
  const state = await manager.saveSample({
    audioBytes,
    mimeType: "type" in sample ? sample.type : undefined,
    promptText,
  });

  return NextResponse.json(state);
}
