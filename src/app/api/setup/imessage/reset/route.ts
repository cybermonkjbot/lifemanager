import { NextResponse } from "next/server";
import { requireRuntimeControlApiAccess } from "../../../../../lib/instance-guard";
import { getIMessageSetupManager } from "../../../../../lib/imessage-setup/session";
import { markProviderDisconnectedFromLocalConnector } from "@/lib/connector-disconnect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const unauthorized = await requireRuntimeControlApiAccess(request);
  if (unauthorized) {
    return unauthorized;
  }

  const manager = getIMessageSetupManager();
  const state = await manager.resetAuth();
  if (state.status !== "error") {
    await markProviderDisconnectedFromLocalConnector("imessage").catch(() => undefined);
  }
  return NextResponse.json(state);
}
