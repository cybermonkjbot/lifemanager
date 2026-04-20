import { NextResponse } from "next/server";
import { requireInstanceApiAccess } from "../../../../../lib/instance-guard";
import { getInstagramSetupManager } from "../../../../../lib/instagram-setup/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const unauthorized = await requireInstanceApiAccess(request);
  if (unauthorized) {
    return unauthorized;
  }

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
