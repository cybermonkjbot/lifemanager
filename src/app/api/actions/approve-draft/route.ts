import { approveDraft } from "@/lib/convex-server";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const form = await request.formData();
  const draftId = String(form.get("draftId") || "");

  if (draftId) {
    await approveDraft(draftId);
  }

  return NextResponse.redirect(new URL("/", request.url));
}
