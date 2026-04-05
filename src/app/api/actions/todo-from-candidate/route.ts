import { createTodoFromCandidate } from "@/lib/convex-server";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const form = await request.formData();
  const candidateId = String(form.get("candidateId") || "");

  if (candidateId) {
    await createTodoFromCandidate(candidateId);
  }

  return NextResponse.redirect(new URL("/", request.url));
}
