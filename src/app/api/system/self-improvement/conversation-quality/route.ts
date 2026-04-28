import { createConvexClient } from "@/lib/convex-server";
import { convexRefs } from "@/lib/convex-refs";
import { requireInstanceApiAccess } from "@/lib/instance-guard";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function readAdminSecret() {
  return process.env.ODOGWU_CONVEX_ADMIN_SECRET || process.env.ODOGWU_ADMIN_SECRET || process.env.SLM_ADMIN_SECRET || "";
}

export async function GET(request: Request) {
  const unauthorized = await requireInstanceApiAccess(request);
  if (unauthorized) {
    return unauthorized;
  }

  const adminSecret = readAdminSecret();
  if (!adminSecret) {
    return NextResponse.json({ error: "Missing admin secret for conversation quality findings." }, { status: 500 });
  }

  const url = new URL(request.url);
  const requestedLimit = Number(url.searchParams.get("limit"));
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(Math.round(requestedLimit), 200)) : 100;
  const convex = createConvexClient();
  const data = await convex.query(convexRefs.conversationQualityListForAdmin, {
    adminSecret,
    limit,
  });

  return NextResponse.json(data);
}
