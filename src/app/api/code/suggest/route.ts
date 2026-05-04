import { requireInstanceApiAccess } from "@/lib/instance-guard";
import { getManagedAiRuntimeOverrides } from "@/lib/managed-secrets-server";
import { rateLimitJsonResponse } from "@/lib/rate-limit";
import { compileCodeProject, type CodeProjectFile } from "@/code-runtime";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const MAX_FILE_CHARS = 9000;
const MAX_CONTEXT_CHARS = 2200;
const MAX_SUGGESTION_CHARS = 900;

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
    // Keep configured endpoint.
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
    // Keep configured endpoint.
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
      const text = (part as Record<string, unknown>).text;
      if (typeof text === "string") chunks.push(text);
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

function cleanSuggestion(raw: string) {
  return raw
    .trim()
    .replace(/^```(?:odo|odogwu)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim()
    .slice(0, MAX_SUGGESTION_CHARS);
}

async function generateSuggestion(args: {
  runtime: AiRuntime;
  prompt: string;
}) {
  const endpoint = pickConfigValue(args.runtime.endpoint);
  const apiKey = pickConfigValue(args.runtime.apiKey);
  const model = pickConfigValue(args.runtime.model) || "gpt-5.4";
  if (!endpoint || !apiKey) throw new Error("AI features are not available yet. Add AI settings, then try again.");

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
          "You are ODOGWU Code Lab autocomplete. Return only the next ODOGWU code snippet. No markdown, no explanation.",
        input: args.prompt,
        temperature: 0,
        max_output_tokens: 180,
      }),
    });
    if (!response.ok) throw new Error(`AI suggestion failed (${response.status}).`);
    return cleanSuggestion(extractResponseText(await response.json()));
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
          content: "You are ODOGWU Code Lab autocomplete. Return only the next ODOGWU code snippet. No markdown, no explanation.",
        },
        { role: "user", content: args.prompt },
      ],
      temperature: 0,
      max_tokens: 180,
    }),
  });
  if (!response.ok) throw new Error(`AI suggestion failed (${response.status}).`);
  return cleanSuggestion(extractChatText(await response.json()));
}

function buildSuggestionPrompt(args: {
  activePath: string;
  activeContent: string;
  cursorOffset: number;
  files: CodeProjectFile[];
}) {
  const before = args.activeContent.slice(Math.max(0, args.cursorOffset - MAX_CONTEXT_CHARS), args.cursorOffset);
  const after = args.activeContent.slice(args.cursorOffset, args.cursorOffset + 700);
  const bundle = compileCodeProject(args.files);
  const diagnostics = bundle.diagnostics
    .filter((item) => item.filePath === args.activePath)
    .slice(0, 8)
    .map((item) => `${item.line}:${item.column} ${item.message}`);
  return `Complete the ODOGWU code at the cursor.

Rules:
- Return the smallest useful snippet, usually 1-8 lines.
- Prefer valid SDK calls and required arguments.
- Do not repeat code already before the cursor.
- If inside a call, complete just the missing arguments.
- If nothing helpful is obvious, return an empty string.

Active file: ${args.activePath}
Other files: ${args.files.map((file) => file.path).join(", ")}
Diagnostics near this file:
${diagnostics.join("\n") || "none"}

Before cursor:
${compactText(before, MAX_CONTEXT_CHARS)}

After cursor:
${compactText(after, 700)}`;
}

export async function POST(request: Request) {
  const unauthorized = await requireInstanceApiAccess(request);
  if (unauthorized) return unauthorized;

  const limited = await rateLimitJsonResponse(request, {
    scope: "code.suggest",
    identity: request.headers.get("cookie") || "",
    limit: 80,
    windowMs: 60 * 60 * 1000,
    penaltyMs: 10 * 60 * 1000,
  });
  if (limited) return limited;

  let payload: { files?: unknown; activePath?: unknown; cursorOffset?: unknown };
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
          return { path: record.path, content: compactText(record.content, MAX_FILE_CHARS), language: "odogwu" };
        })
        .filter((file): file is CodeProjectFile => Boolean(file))
        .slice(0, 60)
    : [];
  const activePath = typeof payload.activePath === "string" ? payload.activePath : "main.odo";
  const activeFile = files.find((file) => file.path === activePath) || files[0];
  if (!activeFile) return NextResponse.json({ error: "Active ODOGWU file is required." }, { status: 400 });
  const cursorOffsetRaw = Number(payload.cursorOffset);
  const cursorOffset = Number.isFinite(cursorOffsetRaw)
    ? Math.max(0, Math.min(activeFile.content.length, Math.round(cursorOffsetRaw)))
    : activeFile.content.length;

  try {
    const runtimeConfig = await getManagedAiRuntimeOverrides();
    const suggestion = await generateSuggestion({
      runtime: runtimeConfig,
      prompt: buildSuggestionPrompt({
        activePath,
        activeContent: activeFile.content,
        cursorOffset,
        files,
      }),
    });
    return NextResponse.json({ suggestion });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "AI suggestion failed." },
      { status: 503 },
    );
  }
}
