import { snoozeDraft } from "@/lib/convex-server";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const form = await request.formData();
  const draftId = String(form.get("draftId") || "");
  const minutes = Number(form.get("minutes") || 30);

  if (draftId) {
    await snoozeDraft(draftId, minutes);
  }

  return NextResponse.redirect(new URL("/", request.url));
}
