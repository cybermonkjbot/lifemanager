import { approveDraft } from "@/lib/convex-server";
import { requireInstanceApiAccess } from "@/lib/instance-guard";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const unauthorized = await requireInstanceApiAccess(request, "redirect");
  if (unauthorized) {
    return unauthorized;
  }

  const form = await request.formData();
  const draftId = String(form.get("draftId") || "");

  if (draftId) {
    await approveDraft(draftId, { sendImmediately: true });
  }

  return NextResponse.redirect(new URL("/", request.url));
}
