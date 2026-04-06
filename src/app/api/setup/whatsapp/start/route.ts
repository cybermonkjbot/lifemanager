import { getWhatsAppSetupManager } from "../../../../../lib/whatsapp-setup/session";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let mode: "qr" | "pairing_code" = "qr";
  let phoneNumber: string | undefined;

  try {
    const body = (await request.json()) as { mode?: string; phoneNumber?: string };
    if (body.mode === "pairing_code") {
      mode = "pairing_code";
      phoneNumber = body.phoneNumber;
    }
  } catch {
    // allow empty body for backwards-compatible QR starts
  }

  const manager = getWhatsAppSetupManager();
  const state = await manager.start({ mode, phoneNumber });
  return NextResponse.json(state);
}
