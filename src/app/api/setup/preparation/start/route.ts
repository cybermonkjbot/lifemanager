import { NextRequest, NextResponse } from "next/server";
import { requireInstanceApiAccess } from "@/lib/instance-guard";
import { readLocalInstanceConfig } from "@/lib/instance-config";
import { startSetupPreparation } from "@/lib/setup-preparation";
import { isLoopbackHostname, requestHasValidSetupBootstrapSecret } from "@/lib/setup-bootstrap-auth";
import { rateLimitJsonResponse } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requirePreparationAccess(request: NextRequest) {
  const config = await readLocalInstanceConfig();
  if (!config?.setupCompleted) {
    if (isLoopbackHostname(request.nextUrl.hostname) || requestHasValidSetupBootstrapSecret(request.headers)) {
      return null;
    }
  }
  return await requireInstanceApiAccess(request);
}

export async function POST(request: NextRequest) {
  const limited = await rateLimitJsonResponse(request, {
    scope: "setup.preparation_start",
    identity: request.headers.get("x-setup-secret") || request.headers.get("authorization") || "setup",
    limit: 6,
    windowMs: 10 * 60 * 1000,
    penaltyMs: 10 * 60 * 1000,
  });
  if (limited) {
    return limited;
  }

  const unauthorized = await requirePreparationAccess(request);
  if (unauthorized) {
    return unauthorized;
  }

  return NextResponse.json(await startSetupPreparation());
}
