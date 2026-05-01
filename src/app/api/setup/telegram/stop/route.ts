import { NextResponse } from "next/server";
import { requireRuntimeControlApiAccess } from "../../../../../lib/instance-guard";
import { getTelegramSetupManager } from "../../../../../lib/telegram-setup/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const unauthorized = await requireRuntimeControlApiAccess(request);
  if (unauthorized) {
    return unauthorized;
  }

  const manager = getTelegramSetupManager();
  const state = await manager.stop();
  return NextResponse.json(state);
}
