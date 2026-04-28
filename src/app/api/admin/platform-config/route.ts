import { NextRequest, NextResponse } from "next/server";
import { getAdminSessionFromRequest } from "@/lib/admin-auth";
import { convexRefs } from "@/lib/convex-refs";
import { createConvexClient } from "@/lib/convex-server";
import { getConvexAdminSecret } from "@/lib/managed-secret-crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
}

export async function PATCH(request: NextRequest) {
  if (!getAdminSessionFromRequest(request, { requireSameOrigin: true })) {
    return unauthorized();
  }

  try {
    const body = (await request.json()) as { config?: unknown };
    await createConvexClient().mutation(convexRefs.adminPlatformSavePlatformConfig, {
      adminSecret: getConvexAdminSecret(),
      config: body.config,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save platform config.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
