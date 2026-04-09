import { NextResponse } from "next/server";
import { getInstagramSetupManager } from "../../../../../lib/instagram-setup/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let username: string | undefined;
  let password: string | undefined;

  try {
    const body = (await request.json()) as { username?: string; password?: string };
    username = body.username;
    password = body.password;
  } catch {
    // handled by manager validation
  }

  const manager = getInstagramSetupManager();
  const state = await manager.start({ username, password });
  return NextResponse.json(state);
}
