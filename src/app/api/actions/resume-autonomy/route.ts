import { resumeAutonomy } from "@/lib/convex-server";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  await resumeAutonomy();
  return NextResponse.redirect(new URL("/system", request.url));
}
