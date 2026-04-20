import { pauseAutonomy } from "@/lib/convex-server";
import { requireInstanceApiAccess } from "@/lib/instance-guard";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const unauthorized = await requireInstanceApiAccess(request, "redirect");
  if (unauthorized) {
    return unauthorized;
  }

  await pauseAutonomy();
  return NextResponse.redirect(new URL("/system", request.url));
}
