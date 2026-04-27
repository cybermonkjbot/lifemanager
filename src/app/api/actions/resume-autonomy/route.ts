import { resumeAutonomy } from "@/lib/convex-server";
import { requireRuntimeControlApiAccess } from "@/lib/instance-guard";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const unauthorized = await requireRuntimeControlApiAccess(request, "redirect");
  if (unauthorized) {
    return unauthorized;
  }

  await resumeAutonomy();
  return NextResponse.redirect(new URL("/system", request.url));
}
