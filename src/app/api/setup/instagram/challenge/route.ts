import { NextResponse } from "next/server";
import { getInstagramSetupManager } from "../../../../../lib/instagram-setup/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let code: string | undefined;

  try {
    const body = (await request.json()) as { code?: string };
    code = body.code;
  } catch {
    // handled by manager validation
  }

  const manager = getInstagramSetupManager();
  const state = await manager.submitChallenge({ code });
  return NextResponse.json(state);
}
