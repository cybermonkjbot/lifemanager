import { NextRequest, NextResponse } from "next/server";
import { getAdminSessionFromRequest } from "@/lib/admin-auth";
import { listAdminUsers, removeAdminUser, upsertAdminUser } from "@/lib/admin-users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

export async function GET(request: NextRequest) {
  if (!getAdminSessionFromRequest(request)) {
    return unauthorized();
  }
  return NextResponse.json({ admins: await listAdminUsers() });
}

export async function POST(request: NextRequest) {
  const session = getAdminSessionFromRequest(request, { requireSameOrigin: true });
  if (!session) {
    return unauthorized();
  }

  try {
    const body = (await request.json()) as {
      email?: unknown;
      pin?: unknown;
      canMasqueradeTenants?: unknown;
    };
    const email = typeof body.email === "string" ? body.email : "";
    const pin = typeof body.pin === "string" ? body.pin : "";
    const admin = await upsertAdminUser({
      email,
      pin,
      canMasqueradeTenants: body.canMasqueradeTenants === true,
      createdBy: session.email,
    });
    return NextResponse.json({ admin, admins: await listAdminUsers() });
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error, "Failed to save admin user.") }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  const session = getAdminSessionFromRequest(request, { requireSameOrigin: true });
  if (!session) {
    return unauthorized();
  }

  try {
    const body = (await request.json()) as {
      email?: unknown;
    };
    const email = typeof body.email === "string" ? body.email : "";
    await removeAdminUser(email, session.email);
    return NextResponse.json({ ok: true, admins: await listAdminUsers() });
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error, "Failed to remove admin user.") }, { status: 400 });
  }
}
