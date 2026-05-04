import { NextResponse } from "next/server";
import { requireRuntimeControlApiAccess } from "../../../../../lib/instance-guard";
import { getInstagramSetupManager } from "../../../../../lib/instagram-setup/session";
import { markProviderDisconnectedFromLocalConnector } from "@/lib/connector-disconnect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const unauthorized = await requireRuntimeControlApiAccess(request);
  if (unauthorized) {
    return unauthorized;
  }

  const manager = getInstagramSetupManager();
  const state = await manager.resetAuth();
  if (state.status !== "error") {
    await markProviderDisconnectedFromLocalConnector("instagram").catch(() => undefined);
  }
  return NextResponse.json(state);
}
