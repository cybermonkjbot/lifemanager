import { getWhatsAppSetupManager } from "@/lib/whatsapp-setup/session";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const manager = getWhatsAppSetupManager();
  const state = await manager.stop();
  return NextResponse.json(state);
}
