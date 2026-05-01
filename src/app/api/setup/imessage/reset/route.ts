import { NextResponse } from "next/server";
import { requireRuntimeControlApiAccess } from "../../../../../lib/instance-guard";
import { getIMessageSetupManager } from "../../../../../lib/imessage-setup/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const unauthorized = await requireRuntimeControlApiAccess(request);
  if (unauthorized) {
    return unauthorized;
  }

  const manager = getIMessageSetupManager();
  const state = await manager.resetAuth();
  return NextResponse.json(state);
}
