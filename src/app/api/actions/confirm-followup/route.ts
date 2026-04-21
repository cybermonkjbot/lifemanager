import { confirmFollowup } from "@/lib/convex-server";
import { requireInstanceApiAccess } from "@/lib/instance-guard";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const unauthorized = await requireInstanceApiAccess(request, "redirect");
  if (unauthorized) {
    return unauthorized;
  }

  const form = await request.formData();
  const followUpId = String(form.get("followUpId") || "");

  if (followUpId) {
    await confirmFollowup(followUpId);
  }

  return NextResponse.redirect(new URL("/followups", request.url));
}
