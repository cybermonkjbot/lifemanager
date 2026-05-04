import { NextResponse } from "next/server";
import { requireRuntimeControlApiAccess } from "../../../../../lib/instance-guard";
import { getTelegramSetupManager } from "../../../../../lib/telegram-setup/session";
import { markProviderDisconnectedFromLocalConnector } from "@/lib/connector-disconnect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const unauthorized = await requireRuntimeControlApiAccess(request);
  if (unauthorized) {
    return unauthorized;
  }

  const manager = getTelegramSetupManager();
  const state = await manager.resetAuth();
  if (state.status !== "error") {
    await markProviderDisconnectedFromLocalConnector("telegram").catch(() => undefined);
  }
  return NextResponse.json(state);
}
