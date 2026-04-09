import { NextResponse } from "next/server";
import { getInstagramSetupManager } from "../../../../../lib/instagram-setup/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const manager = getInstagramSetupManager();
  const state = await manager.resetAuth();
  return NextResponse.json(state);
}
