import { createConvexClient } from "@/lib/convex-server";
import { convexRefs } from "@/lib/convex-refs";
import { requireInstanceApiAccess } from "@/lib/instance-guard";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function readAdminSecret() {
  return process.env.ODOGWU_CONVEX_ADMIN_SECRET || process.env.ODOGWU_ADMIN_SECRET || process.env.SLM_ADMIN_SECRET || "";
}

export async function POST(request: Request) {
  const unauthorized = await requireInstanceApiAccess(request);
  if (unauthorized) {
    return unauthorized;
  }

  const adminSecret = readAdminSecret();
  if (!adminSecret) {
    return NextResponse.json({ error: "Missing admin secret for conversation quality review." }, { status: 500 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const rawMaxThreads = Number(body.maxThreads);
  const maxThreads = Number.isFinite(rawMaxThreads) ? Math.max(1, Math.min(Math.round(rawMaxThreads), 30)) : 30;
  const convex = createConvexClient();
  const result = await convex.action(convexRefs.conversationQualityRunManual, {
    adminSecret,
    maxThreads,
  });

  return NextResponse.json({
    ok: true,
    result,
  });
}
