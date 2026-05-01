import { createHmac, timingSafeEqual } from "node:crypto";
import { createConvexClient } from "@/lib/convex-server";
import { convexRefs } from "@/lib/convex-refs";
import { resolveManagedSecretValue } from "@/lib/managed-secrets-server";
import { rateLimitJsonResponse } from "@/lib/rate-limit";
import type { CodeProjectBundle, ProjectSdkCall } from "@/code-runtime";

export const runtime = "nodejs";

type RunStep = {
  stepId: string;
  toolName: string;
  status: "success" | "error" | "skipped";
  latencyMs: number;
  outputSummary?: string;
  errorMessage?: string;
};

const MAX_WEBHOOK_BODY_BYTES = 256 * 1024;

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function resolveWebhookSecret() {
  return (await resolveManagedSecretValue("code.webhookSecret").catch(() => "")) || process.env.SLM_CODE_WEBHOOK_SECRET || "";
}

function hasValidWebhookSecret(rawBody: string, request: Request, secret: string) {
  const bearer = request.headers.get("authorization") || "";
  const directSecret = request.headers.get("x-webhook-secret") || "";
  if (bearer.toLowerCase().startsWith("bearer ") && safeEqual(bearer.slice("bearer ".length).trim(), secret)) {
    return true;
  }
  if (directSecret && safeEqual(directSecret, secret)) {
    return true;
  }

  const signature = request.headers.get("x-odogwu-signature") || "";
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  return safeEqual(signature.replace(/^sha256=/i, ""), expected);
}

async function readPayload(request: Request, rawBody: string) {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return JSON.parse(rawBody);
  }
  try {
    return JSON.parse(rawBody);
  } catch {
    return { text: rawBody };
  }
}

async function runHttpCall(call: ProjectSdkCall, payload: unknown): Promise<RunStep> {
  const startedAt = Date.now();
  const url = call.literalUrl || (call.secretUrlKey ? await resolveManagedSecretValue(call.secretUrlKey) : "");
  if (!url) {
    return {
      stepId: `http:${call.filePath}:${call.line}`,
      toolName: call.call,
      status: "error",
      latencyMs: 0,
      outputSummary: call.secretUrlKey ? `Missing managed secret ${call.secretUrlKey}` : "Missing URL.",
      errorMessage: call.secretUrlKey ? `Managed secret ${call.secretUrlKey} is not configured.` : "HTTP calls require a literal URL or managed secret URL.",
    };
  }
  let host = "unknown";
  try {
    const parsed = new URL(url);
    host = parsed.host;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const method = call.operation === "get" ? "GET" : call.operation === "post" ? "POST" : "POST";
    const response = await fetch(parsed, {
      method,
      headers: { "content-type": "application/json", "user-agent": "ODOGWU-Code-Lab/1.0" },
      body: method === "GET" ? undefined : JSON.stringify({ payload }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return {
      stepId: `http:${call.filePath}:${call.line}`,
      toolName: call.call,
      status: response.ok ? "success" : "error",
      latencyMs: Date.now() - startedAt,
      outputSummary: `${method} ${host} -> ${response.status}`,
      errorMessage: response.ok ? undefined : `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      stepId: `http:${call.filePath}:${call.line}`,
      toolName: call.call,
      status: "error",
      latencyMs: Date.now() - startedAt,
      outputSummary: `Request to ${host}`,
      errorMessage: error instanceof Error ? error.message : "HTTP request failed.",
    };
  }
}

function plannedStep(call: ProjectSdkCall): RunStep {
  return {
    stepId: `${call.module}:${call.filePath}:${call.line}`,
    toolName: call.call,
    status: "success",
    latencyMs: 0,
    outputSummary:
      call.module === "messages"
        ? "Message operation recorded for account-scoped worker handling."
        : call.module === "platform"
          ? "Cross-platform operation recorded for account-scoped worker handling."
        : call.module === "account"
          ? "Account behavior mutation recorded for worker handling."
          : call.module === "worker"
            ? "Worker extension hook recorded for local worker handling."
            : "SDK operation recorded.",
  };
}

export async function POST(request: Request, { params }: { params: Promise<{ projectSlug: string; handlerName: string }> }) {
  const { projectSlug, handlerName } = await params;
  const limited = await rateLimitJsonResponse(request, {
    scope: "code.webhook",
    identity: `${projectSlug}:${handlerName}`,
    limit: 60,
    windowMs: 60 * 1000,
    penaltyMs: 60 * 1000,
  });
  if (limited) {
    return limited;
  }

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_WEBHOOK_BODY_BYTES) {
    return Response.json({ ok: false, error: "Webhook body is too large." }, { status: 413 });
  }

  const secret = await resolveWebhookSecret();
  if (!secret) {
    return Response.json({ ok: false, error: "Code webhook secret is not configured." }, { status: 503 });
  }

  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > MAX_WEBHOOK_BODY_BYTES) {
    return Response.json({ ok: false, error: "Webhook body is too large." }, { status: 413 });
  }
  if (!hasValidWebhookSecret(rawBody, request, secret)) {
    return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  const payload = await readPayload(request, rawBody).catch(() => ({}));
  const convex = createConvexClient();
  const published = (await convex.query(convexRefs.codeGetPublishedWebhookProject, {
    projectSlug,
    handlerName,
  })) as
    | {
        project: { _id: string; name: string };
        version: { _id: string };
        webhook: { name: string; filePath: string };
        bundleJson: string;
      }
    | null;

  if (!published) {
    return Response.json({ ok: false, error: "Webhook handler not found or project is not published." }, { status: 404 });
  }

  const bundle = JSON.parse(published.bundleJson) as CodeProjectBundle;
  const handlerCalls = bundle.manifest.sdkCalls.filter((call) => call.filePath === published.webhook.filePath);
  const steps: RunStep[] = [];
  for (const call of handlerCalls.slice(0, 50)) {
    if (call.module === "http") steps.push(await runHttpCall(call, payload));
    else steps.push(plannedStep(call));
  }
  const status = steps.some((step) => step.status === "error") ? "error" : "success";
  await convex.mutation(convexRefs.codeRecordProjectRun, {
    projectId: published.project._id,
    projectVersionId: published.version._id,
    handlerName,
    eventName: "webhook.received",
    status,
    errorMessage: status === "error" ? "One or more webhook SDK steps failed." : undefined,
    steps,
  });

  return Response.json({
    ok: status === "success",
    project: published.project.name,
    handler: handlerName,
    steps: steps.map((step) => ({
      toolName: step.toolName,
      status: step.status,
      outputSummary: step.outputSummary,
      errorMessage: step.errorMessage,
    })),
  });
}
