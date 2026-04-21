import { createTodoFromCandidate } from "@/lib/convex-server";
import { requireInstanceApiAccess } from "@/lib/instance-guard";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const unauthorized = await requireInstanceApiAccess(request, "redirect");
  if (unauthorized) {
    return unauthorized;
  }

  const form = await request.formData();
  const candidateId = String(form.get("candidateId") || "");

  if (candidateId) {
    await createTodoFromCandidate(candidateId);
  }

  return NextResponse.redirect(new URL("/", request.url));
}
