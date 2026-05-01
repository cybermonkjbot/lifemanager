import { requireInstanceApiAccess } from "@/lib/instance-guard";
import { getManagedAiRuntimeOverrides } from "@/lib/managed-secrets-server";
import { rateLimitJsonResponse } from "@/lib/rate-limit";
import { compileCodeProject, type CodeProjectFile } from "@/code-runtime";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const MAX_FILES = 80;
const MAX_FILE_CHARS = 6000;
const MAX_AI_INPUT_CHARS = 18000;

type AiRuntime = Awaited<ReturnType<typeof getManagedAiRuntimeOverrides>>;

function pickConfigValue(...values: Array<string | undefined>) {
  for (const value of values) {
    if (value && value.trim()) return value.trim();
  }
  return "";
}

function inferApiStyle(endpoint: string, configured?: string) {
  if (configured === "responses" || configured === "chat_completions") return configured;
  if (/\/openai\/v1\/?$/i.test(endpoint) || /\/responses(?:\?|$)/i.test(endpoint)) return "responses";
  return "chat_completions";
}

function buildResponsesEndpoint(endpoint: string) {
  try {
    const parsed = new URL(endpoint);
    if (/\/responses\/?$/i.test(parsed.pathname)) return parsed.toString();
    if (/\/openai\/v1\/?$/i.test(parsed.pathname)) {
      parsed.pathname = `${parsed.pathname.replace(/\/+$/, "")}/responses`;
      return parsed.toString();
    }
  } catch {
    // Keep the configured endpoint.
  }
  return endpoint;
}

function buildChatCompletionsEndpoint(endpoint: string) {
  try {
    const parsed = new URL(endpoint);
    if (/\/chat\/completions\/?$/i.test(parsed.pathname)) return parsed.toString();
    if (/\/openai\/v1\/?$/i.test(parsed.pathname)) {
      parsed.pathname = `${parsed.pathname.replace(/\/+$/, "")}/chat/completions`;
      return parsed.toString();
    }
  } catch {
    // Keep the configured endpoint.
  }
  return endpoint;
}

function compactText(value: string, maxChars: number) {
  return value.length <= maxChars ? value : `${value.slice(0, Math.max(0, maxChars - 3))}...`;
}

function extractResponseText(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const record = payload as Record<string, unknown>;
  if (typeof record.output_text === "string") return record.output_text.trim();
  const output = Array.isArray(record.output) ? record.output : [];
  const chunks: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = Array.isArray((item as Record<string, unknown>).content) ? ((item as Record<string, unknown>).content as unknown[]) : [];
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      const partRecord = part as Record<string, unknown>;
      if (typeof partRecord.text === "string") chunks.push(partRecord.text);
    }
  }
  return chunks.join("\n").trim();
}

function extractChatText(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const choices = Array.isArray((payload as Record<string, unknown>).choices)
    ? ((payload as Record<string, unknown>).choices as unknown[])
    : [];
  const first = choices[0];
  if (!first || typeof first !== "object") return "";
  const message = (first as Record<string, unknown>).message;
  if (!message || typeof message !== "object") return "";
  const content = (message as Record<string, unknown>).content;
  return typeof content === "string" ? content.trim() : "";
}

function parseJsonObject(raw: string) {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("AI response did not contain JSON.");
  return JSON.parse(trimmed.slice(start, end + 1)) as unknown;
}

function sanitizeMermaid(value: unknown) {
  if (typeof value !== "string") return "";
  const cleaned = value.trim().replace(/^```(?:mermaid)?\s*/i, "").replace(/\s*```$/i, "").trim();
  if (!/^(flowchart|graph|sequenceDiagram|stateDiagram-v2)\b/i.test(cleaned)) return "";
  return cleaned
    .split("\n")
    .map((line) => line.replace(/[^\S\r\n]+$/g, ""))
    .filter((line) => line.trim().length > 0)
    .slice(0, 120)
    .join("\n");
}

function normalizeStringArray(value: unknown, fallback: string[]) {
  if (!Array.isArray(value)) return fallback;
  return value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean).slice(0, 6);
}

function normalizeAiCanvas(raw: string, fallback: { title: string; summary: string[] }) {
  const parsed = parseJsonObject(raw);
  if (!parsed || typeof parsed !== "object") throw new Error("AI canvas response was not an object.");
  const record = parsed as Record<string, unknown>;
  const mermaid = sanitizeMermaid(record.mermaid);
  if (!mermaid) throw new Error("AI canvas response did not include valid Mermaid.");
  return {
    title: typeof record.title === "string" && record.title.trim() ? record.title.trim().slice(0, 100) : fallback.title,
    summary: normalizeStringArray(record.summary, fallback.summary),
    mermaid,
  };
}

async function generateMermaidWithAi(args: {
  runtime: AiRuntime;
  prompt: string;
}) {
  const endpoint = pickConfigValue(args.runtime.endpoint);
  const apiKey = pickConfigValue(args.runtime.apiKey);
  const model = pickConfigValue(args.runtime.model) || "gpt-5.4";
  if (!endpoint || !apiKey) throw new Error("AI endpoint/key is not configured.");

  const apiStyle = inferApiStyle(endpoint, args.runtime.apiStyle);
  if (apiStyle === "responses") {
    const response = await fetch(buildResponsesEndpoint(endpoint), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": apiKey,
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        instructions:
          "You generate concise Mermaid diagrams for ODOGWU Code Lab. Return JSON only. Never wrap output in markdown fences.",
        input: args.prompt,
        temperature: 0.2,
        max_output_tokens: 1200,
      }),
    });
    if (!response.ok) throw new Error(`AI canvas generation failed (${response.status}).`);
    return extractResponseText(await response.json());
  }

  const response = await fetch(buildChatCompletionsEndpoint(endpoint), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": apiKey,
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content:
            "You generate concise Mermaid diagrams for ODOGWU Code Lab. Return JSON only. Never wrap output in markdown fences.",
        },
        { role: "user", content: args.prompt },
      ],
      temperature: 0.2,
      max_tokens: 1200,
    }),
  });
  if (!response.ok) throw new Error(`AI canvas generation failed (${response.status}).`);
  return extractChatText(await response.json());
}

function buildCanvasPrompt(args: {
  projectName: string;
  webhookBase: string;
  files: CodeProjectFile[];
}) {
  const bundle = compileCodeProject(args.files);
  const compact = {
    projectName: args.projectName,
    webhookBase: args.webhookBase,
    files: args.files.slice(0, MAX_FILES).map((file) => ({
      path: file.path,
      excerpt: compactText(file.content, MAX_FILE_CHARS),
    })),
    manifest: {
      handlers: bundle.manifest.handlers,
      webhooks: bundle.manifest.webhooks,
      functions: bundle.manifest.functions,
      behaviorExtensions: bundle.manifest.behaviorExtensions.map((item) => ({
        kind: item.kind,
        name: item.name,
        filePath: item.filePath,
        patterns: item.patterns.slice(0, 4),
        targets: item.targets.slice(0, 4),
      })),
      outboundHttp: bundle.manifest.outboundHttp,
      messageSends: bundle.manifest.messageSends,
      platformActions: bundle.manifest.platformActions.map((item) => ({
        call: item.call,
        operation: item.operation,
        sourceProvider: item.sourceProvider,
        targetProviders: item.targetProviders,
        filePath: item.filePath,
        line: item.line,
      })),
      platformRoutes: bundle.manifest.platformRoutes.slice(0, 40),
      workerHooks: bundle.manifest.workerHooks,
      accountMutations: bundle.manifest.accountMutations,
      diagnostics: bundle.diagnostics,
    },
  };
  return compactText(
    `Create a useful architecture canvas for this ODOGWU project.

Return JSON exactly like:
{"title":"...","summary":["...","..."],"mermaid":"flowchart LR\\n  A[\\"...\\"] --> B[\\"...\\"]"}

Diagram requirements:
- Use Mermaid flowchart syntax.
- Show files, exported handlers, triggers, webhooks, behavior overlays, platform routes, and runtime effects when present.
- Prefer semantic groupings over listing every repeated node.
- For all-platform routing, show the platform mesh clearly without drawing an unreadable hairball.
- Keep labels short and human-readable.
- Do not invent capabilities absent from the manifest.

Project manifest:
${JSON.stringify(compact, null, 2)}`,
    MAX_AI_INPUT_CHARS,
  );
}

export async function POST(request: Request) {
  const unauthorized = await requireInstanceApiAccess(request);
  if (unauthorized) return unauthorized;

  const limited = await rateLimitJsonResponse(request, {
    scope: "code.canvas",
    identity: request.headers.get("cookie") || "",
    limit: 30,
    windowMs: 60 * 60 * 1000,
    penaltyMs: 10 * 60 * 1000,
  });
  if (limited) return limited;

  let payload: { files?: unknown; projectName?: unknown; webhookBase?: unknown };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const files = Array.isArray(payload.files)
    ? payload.files
        .map((file): CodeProjectFile | null => {
          if (!file || typeof file !== "object") return null;
          const record = file as Record<string, unknown>;
          if (typeof record.path !== "string" || typeof record.content !== "string") return null;
          return { path: record.path, content: record.content, language: "odogwu" };
        })
        .filter((file): file is CodeProjectFile => Boolean(file))
        .slice(0, MAX_FILES)
    : [];
  if (files.length === 0) return NextResponse.json({ error: "At least one ODOGWU file is required." }, { status: 400 });

  const projectName = typeof payload.projectName === "string" && payload.projectName.trim() ? payload.projectName.trim() : "Code Project";
  const webhookBase = typeof payload.webhookBase === "string" && payload.webhookBase.trim() ? payload.webhookBase.trim() : "/api/code/webhooks/{projectSlug}";
  const fallback = {
    title: `${projectName} AI canvas`,
    summary: [`${files.length} file(s) analyzed for the Code Lab canvas.`],
  };

  try {
    const runtimeConfig = await getManagedAiRuntimeOverrides();
    const raw = await generateMermaidWithAi({
      runtime: runtimeConfig,
      prompt: buildCanvasPrompt({ projectName, webhookBase, files }),
    });
    const canvas = normalizeAiCanvas(raw, fallback);
    return NextResponse.json({ ...canvas, generatedByAi: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "AI canvas generation failed." },
      { status: 503 },
    );
  }
}
