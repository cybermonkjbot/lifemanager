import { createConvexClient } from "@/lib/convex-server";
import { convexRefs } from "@/lib/convex-refs";
import { resolveManagedSecretValue } from "@/lib/managed-secrets-server";
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

async function readPayload(request: Request) {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return await request.json().catch(() => ({}));
  }
  const text = await request.text();
  try {
    return JSON.parse(text);
  } catch {
    return { text };
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
        : call.module === "account"
          ? "Account behavior mutation recorded for worker handling."
          : call.module === "worker"
            ? "Worker extension hook recorded for local worker handling."
            : "SDK operation recorded.",
  };
}

export async function POST(request: Request, { params }: { params: Promise<{ projectSlug: string; handlerName: string }> }) {
  const { projectSlug, handlerName } = await params;
  const payload = await readPayload(request);
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
