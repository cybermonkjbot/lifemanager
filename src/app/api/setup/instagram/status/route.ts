import { NextResponse } from "next/server";
import { requireInstanceApiAccess } from "../../../../../lib/instance-guard";
import { getInstagramSetupManager } from "../../../../../lib/instagram-setup/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const unauthorized = await requireInstanceApiAccess(request);
  if (unauthorized) {
    return unauthorized;
  }

  const manager = getInstagramSetupManager();
  const state = await manager.getState();
  return NextResponse.json(state);
}
