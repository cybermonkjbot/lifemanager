import { confirmFollowup } from "@/lib/convex-server";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const form = await request.formData();
  const followUpId = String(form.get("followUpId") || "");

  if (followUpId) {
    await confirmFollowup(followUpId);
  }

  return NextResponse.redirect(new URL("/followups", request.url));
}
