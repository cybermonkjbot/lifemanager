import { NextResponse } from "next/server";
import { requireRuntimeControlApiAccess } from "../../../../../lib/instance-guard";
import { getInstagramSetupManager } from "../../../../../lib/instagram-setup/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const unauthorized = await requireRuntimeControlApiAccess(request);
  if (unauthorized) {
    return unauthorized;
  }

  const manager = getInstagramSetupManager();
  const state = await manager.restartWorker();
  return NextResponse.json(state);
}
