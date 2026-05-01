import { upsertIgnoreTarget } from "@/lib/convex-server";
import { requireInstanceApiAccess } from "@/lib/instance-guard";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const unauthorized = await requireInstanceApiAccess(request, "redirect");
  if (unauthorized) {
    return unauthorized;
  }

  const form = await request.formData();
  const targetValue = String(form.get("targetValue") || "");
  const enabled = String(form.get("enabled") || "true") === "true";
  const targetTypeRaw = String(form.get("targetType") || "").trim();
  const targetType = targetTypeRaw === "contact" || targetTypeRaw === "group" || targetTypeRaw === "keyword" ? targetTypeRaw : undefined;
  const providerRaw = String(form.get("provider") || "").trim();
  const provider =
    providerRaw === "whatsapp" || providerRaw === "instagram" || providerRaw === "imessage" || providerRaw === "telegram"
      ? providerRaw
      : undefined;

  if (targetValue) {
    await upsertIgnoreTarget(targetValue, enabled, targetType, provider);
  }

  return NextResponse.redirect(new URL("/settings?section=rules", request.url));
}
