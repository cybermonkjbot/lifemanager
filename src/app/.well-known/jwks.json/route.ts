import { getConvexAuthJwks } from "@/lib/convex-auth-token";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(getConvexAuthJwks(), {
    headers: {
      "Cache-Control": "public, max-age=300",
    },
  });
}
