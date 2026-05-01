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

  let body: { code?: string; password?: string } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    // handled by manager validation
  }

  const manager = getTelegramSetupManager();
  const state = await manager.submitChallenge(body);
  return NextResponse.json(state);
}
