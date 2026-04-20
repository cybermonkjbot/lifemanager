import { getWhatsAppSetupManager } from "../../../../../lib/whatsapp-setup/session";
import { requireInstanceApiAccess } from "../../../../../lib/instance-guard";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const unauthorized = await requireInstanceApiAccess(request);
  if (unauthorized) {
    return unauthorized;
  }

  const manager = getWhatsAppSetupManager();
  const state = await manager.stop();
  return NextResponse.json(state);
}
