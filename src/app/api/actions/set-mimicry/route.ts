import { setMimicry } from "@/lib/convex-server";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const form = await request.formData();
  const mimicryLevel = Number(form.get("mimicryLevel") || 0.72);
  await setMimicry(mimicryLevel);
  return NextResponse.redirect(new URL("/style-lab", request.url));
}
