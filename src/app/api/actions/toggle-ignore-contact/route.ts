import { upsertIgnoreContact } from "@/lib/convex-server";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const form = await request.formData();
  const targetValue = String(form.get("targetValue") || "");
  const enabled = String(form.get("enabled") || "true") === "true";

  if (targetValue) {
    await upsertIgnoreContact(targetValue, enabled);
  }

  return NextResponse.redirect(new URL("/rules", request.url));
}
