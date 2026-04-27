import { createConvexClient } from "@/lib/convex-server";
import { requireInstanceApiAccess } from "@/lib/instance-guard";
import { makeFunctionReference } from "convex/server";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

function asRecord(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export async function POST(request: Request) {
  const unauthorized = await requireInstanceApiAccess(request, "json");
  if (unauthorized) {
    return unauthorized;
  }

  const body = asRecord(await request.json().catch(() => null));
  const outboxIds = Array.isArray(body.outboxIds)
    ? body.outboxIds.filter((value): value is string => typeof value === "string" && value.trim().length > 0).slice(0, 100)
    : [];

  if (!outboxIds.length) {
    return NextResponse.json({ error: "Missing outboxIds to check." }, { status: 400 });
  }

  const convex = createConvexClient();
  const rows = await convex.query(makeFunctionReference<"query">("outbox:getStatuses"), {
    outboxIds,
  });

  return NextResponse.json({
    ok: true,
    rows,
  });
}
