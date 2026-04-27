import { NextRequest, NextResponse } from "next/server";
import { verifyAdminRequest } from "@/lib/admin-auth";
import { convexRefs } from "@/lib/convex-refs";
import { createConvexClient } from "@/lib/convex-server";
import { getConvexAdminSecret } from "@/lib/managed-secret-crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    if (!verifyAdminRequest(request)) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }
    const tenants = await createConvexClient().query(convexRefs.tenantAccountsAdminList, {
      adminSecret: getConvexAdminSecret(),
      limit: 200,
    });
    return NextResponse.json({ tenants });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load tenants.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
