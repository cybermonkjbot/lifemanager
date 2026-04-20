import { snoozeDraft } from "@/lib/convex-server";
import { requireInstanceApiAccess } from "@/lib/instance-guard";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const unauthorized = await requireInstanceApiAccess(request, "redirect");
  if (unauthorized) {
    return unauthorized;
  }

  const form = await request.formData();
  const draftId = String(form.get("draftId") || "");
  const minutes = Number(form.get("minutes") || 30);

  if (draftId) {
    await snoozeDraft(draftId, minutes);
  }

  return NextResponse.redirect(new URL("/", request.url));
}
