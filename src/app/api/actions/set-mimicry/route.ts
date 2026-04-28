import { setMimicry } from "@/lib/convex-server";
import { requireInstanceApiAccess } from "@/lib/instance-guard";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const unauthorized = await requireInstanceApiAccess(request, "redirect");
  if (unauthorized) {
    return unauthorized;
  }

  const form = await request.formData();
  const mimicryLevel = Number(form.get("mimicryLevel") || 0.72);
  await setMimicry(mimicryLevel);
  return NextResponse.redirect(new URL("/settings?section=style", request.url));
}
