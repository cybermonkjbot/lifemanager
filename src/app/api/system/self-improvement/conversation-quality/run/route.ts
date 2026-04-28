import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import { createConvexClient } from "@/lib/convex-server";
import { convexRefs } from "@/lib/convex-refs";
import { requireRuntimeControlApiAccess } from "@/lib/instance-guard";
import { rateLimitJsonResponse } from "@/lib/rate-limit";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SELF_IMPROVE_LOCK_PATH = ".slm/self-improvement/runner.lock";
const MAX_PROMPT_CHARS = 12_000;

function readAdminSecret() {
  return process.env.ODOGWU_CONVEX_ADMIN_SECRET || process.env.ODOGWU_ADMIN_SECRET || process.env.SLM_ADMIN_SECRET || "";
}

function parseFindingId(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

async function selfImproveRunActive() {
  try {
    await stat(SELF_IMPROVE_LOCK_PATH);
    return true;
  } catch {
    return false;
  }
}

function appendTail(current: string, chunk: string, limit = 12_000) {
  const next = `${current}${chunk}`;
  if (next.length <= limit) {
    return next;
  }
  return next.slice(next.length - limit);
}

async function markFinished(args: {
  adminSecret: string;
  findingId: string;
  launchedSelfImproveRunId: string;
  success: boolean;
  errorMessage?: string;
}) {
  try {
    const convex = createConvexClient();
    await convex.mutation(convexRefs.conversationQualityMarkFindingRunFinished, args);
  } catch {
    // The local self-improvement run has already finished; avoid crashing the route worker on status update issues.
  }
}

export async function POST(request: Request) {
  const unauthorized = await requireRuntimeControlApiAccess(request);
  if (unauthorized) {
    return unauthorized;
  }
  const limited = await rateLimitJsonResponse(request, {
    scope: "runtime.self_improvement_run",
    identity: request.headers.get("cookie") || "",
    limit: 3,
    windowMs: 60 * 60 * 1000,
    penaltyMs: 30 * 60 * 1000,
  });
  if (limited) {
    return limited;
  }

  const adminSecret = readAdminSecret();
  if (!adminSecret) {
    return NextResponse.json({ error: "Missing admin secret for conversation quality findings." }, { status: 500 });
  }

  if (await selfImproveRunActive()) {
    return NextResponse.json({ error: "A self-improvement run is already active." }, { status: 409 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const findingId = parseFindingId(body.findingId);
  if (!findingId) {
    return NextResponse.json({ error: "findingId is required." }, { status: 400 });
  }

  const launchedSelfImproveRunId = `cq-${Date.now().toString(36)}-${randomUUID()}`;
  const convex = createConvexClient();
  const prepared = (await convex.mutation(convexRefs.conversationQualityPrepareFindingRun, {
    adminSecret,
    findingId,
    launchedSelfImproveRunId,
  })) as { prompt?: string; title?: string };
  const prompt = (prepared.prompt || "").trim();
  if (!prompt) {
    await markFinished({
      adminSecret,
      findingId,
      launchedSelfImproveRunId,
      success: false,
      errorMessage: "Finding has no suggested fix prompt.",
    });
    return NextResponse.json({ error: "Finding has no suggested fix prompt." }, { status: 400 });
  }
  if (prompt.length > MAX_PROMPT_CHARS) {
    await markFinished({
      adminSecret,
      findingId,
      launchedSelfImproveRunId,
      success: false,
      errorMessage: `Prompt is too long (${prompt.length} chars, max ${MAX_PROMPT_CHARS}).`,
    });
    return NextResponse.json({ error: "Suggested fix prompt is too long." }, { status: 400 });
  }

  const bunBin = process.env.BUN_BIN || "bun";
  try {
    const selfImproveScript = ["self", "improve"].join("-");
    const child = spawn(bunBin, ["run", selfImproveScript, "--", "--prompt", prompt], {
      cwd: ".",
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdoutTail = "";
    let stderrTail = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdoutTail = appendTail(stdoutTail, chunk);
    });
    child.stderr.on("data", (chunk: string) => {
      stderrTail = appendTail(stderrTail, chunk);
    });
    child.once("error", (error) => {
      void markFinished({
        adminSecret,
        findingId,
        launchedSelfImproveRunId,
        success: false,
        errorMessage: error.message,
      });
    });
    child.once("close", (code) => {
      const detail = [stderrTail, stdoutTail]
        .map((part) => part.trim())
        .filter(Boolean)
        .join(" | ")
        .slice(0, 900);
      void markFinished({
        adminSecret,
        findingId,
        launchedSelfImproveRunId,
        success: code === 0,
        ...(code === 0 ? {} : { errorMessage: detail || `self-improvement exited with code ${code ?? "unknown"}` }),
      });
    });

    return NextResponse.json({
      ok: true,
      launchedSelfImproveRunId,
      title: prepared.title || null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await markFinished({
      adminSecret,
      findingId,
      launchedSelfImproveRunId,
      success: false,
      errorMessage: message,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
