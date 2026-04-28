import { createConvexClient } from "@/lib/convex-server";
import { convexRefs } from "@/lib/convex-refs";
import { requireInstanceApiAccess } from "@/lib/instance-guard";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function readAdminSecret() {
  return process.env.ODOGWU_CONVEX_ADMIN_SECRET || process.env.ODOGWU_ADMIN_SECRET || process.env.SLM_ADMIN_SECRET || "";
}

function parseFindingId(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

export async function POST(request: Request) {
  const unauthorized = await requireInstanceApiAccess(request);
  if (unauthorized) {
    return unauthorized;
  }

  const adminSecret = readAdminSecret();
  if (!adminSecret) {
    return NextResponse.json({ error: "Missing admin secret for conversation quality findings." }, { status: 500 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const findingId = parseFindingId(body.findingId);
  if (!findingId) {
    return NextResponse.json({ error: "findingId is required." }, { status: 400 });
  }

  const convex = createConvexClient();
  await convex.mutation(convexRefs.conversationQualityDismissFinding, {
    adminSecret,
    findingId,
  });
  return NextResponse.json({ ok: true });
}
