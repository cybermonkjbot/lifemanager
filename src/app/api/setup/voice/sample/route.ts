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
