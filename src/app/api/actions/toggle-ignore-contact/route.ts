import { upsertIgnoreTarget } from "@/lib/convex-server";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const form = await request.formData();
  const targetValue = String(form.get("targetValue") || "");
  const enabled = String(form.get("enabled") || "true") === "true";
  const targetTypeRaw = String(form.get("targetType") || "").trim();
  const targetType = targetTypeRaw === "contact" || targetTypeRaw === "group" || targetTypeRaw === "keyword" ? targetTypeRaw : undefined;

  if (targetValue) {
    await upsertIgnoreTarget(targetValue, enabled, targetType);
  }

  return NextResponse.redirect(new URL("/rules", request.url));
}
