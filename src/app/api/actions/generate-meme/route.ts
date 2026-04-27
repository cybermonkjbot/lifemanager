import { createHash } from "node:crypto";
import { createConvexClient } from "@/lib/convex-server";
import { convexRefs } from "@/lib/convex-refs";
import { requireInstanceApiAccess } from "@/lib/instance-guard";
import { getManagedAiRuntimeOverrides } from "@/lib/managed-secrets-server";
import { generateMemeImageWithAzure } from "@/worker/ai";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
const MAX_MEME_PROMPT_CHARS = 8000;

type ThreadContext = {
  thread?: { title?: string; jid?: string } | null;
  messages?: Array<{ direction: "inbound" | "outbound"; text: string }>;
  memory?: { styleNotes?: string[] } | null;
};

function compactText(value: string, maxChars: number) {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars - 3)}...`;
}

function normalizeLabel(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().slice(0, 120);
}

function buildContextSnippet(args: {
  prompt: string;
  threadTitle?: string;
  recentHistoryLines: string[];
  styleHints: string[];
}) {
  const fragments = [
    `Manual prompt: ${args.prompt.trim()}`,
    args.threadTitle ? `Thread: ${args.threadTitle.trim()}` : "",
    args.recentHistoryLines.length ? `History: ${args.recentHistoryLines.slice(-4).join(" | ")}` : "",
    args.styleHints.length ? `Style hints: ${args.styleHints.slice(0, 4).join(" | ")}` : "",
  ].filter(Boolean);

  return fragments.join("\n").slice(0, 380);
}

function resolveGenerationFailureStatus(errorMessage: string) {
  if (!errorMessage) {
    return 502;
  }
  if (/endpoint\/key missing/i.test(errorMessage)) {
    return 503;
  }
  if (/timeout|timed out|network|econnreset|socket hang up/i.test(errorMessage)) {
    return 503;
  }
  const statusMatch = errorMessage.match(/\((\d{3})\)/);
  const upstreamStatus = statusMatch ? Number(statusMatch[1]) : NaN;
  if (!Number.isFinite(upstreamStatus)) {
    return 502;
  }
  if (upstreamStatus === 400) {
    return 400;
  }
  if (upstreamStatus === 401 || upstreamStatus === 403) {
    return 502;
  }
  if (upstreamStatus === 404) {
    return 502;
  }
  if (upstreamStatus === 408 || upstreamStatus === 429) {
    return 503;
  }
  if (upstreamStatus >= 500) {
    return 503;
  }
  return 502;
}

export async function POST(request: Request) {
  const unauthorized = await requireInstanceApiAccess(request);
  if (unauthorized) {
    return unauthorized;
  }

  let payload: {
    prompt?: unknown;
    label?: unknown;
    threadId?: unknown;
  };

  try {
    payload = (await request.json()) as {
      prompt?: unknown;
      label?: unknown;
      threadId?: unknown;
    };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const prompt = typeof payload.prompt === "string" ? payload.prompt.trim() : "";
  const label = normalizeLabel(payload.label);
  const threadId = typeof payload.threadId === "string" && payload.threadId.trim() ? payload.threadId.trim() : undefined;

  if (!prompt) {
    return NextResponse.json({ error: "Prompt is required." }, { status: 400 });
  }

  if (prompt.length > MAX_MEME_PROMPT_CHARS) {
    return NextResponse.json(
      { error: `Prompt is too long. Keep it under ${MAX_MEME_PROMPT_CHARS} characters.` },
      { status: 400 },
    );
  }

  try {
    const convex = createConvexClient();

    await convex
      .mutation(convexRefs.systemRecordEvent, {
        source: "dashboard",
        eventType: "media.meme.manual.requested",
        detail: `Manual meme generation requested: ${compactText(prompt, 180)}`,
        ...(threadId ? { threadId } : {}),
      })
      .catch(() => undefined);

    let threadTitle: string | undefined;
    let recentHistoryLines: string[] = [];
    let styleHints: string[] = [];

    if (threadId) {
      const threadContext = (await convex.query(convexRefs.threadGet, { threadId }).catch(() => null)) as ThreadContext | null;
      if (!threadContext) {
        return NextResponse.json({ error: "Thread not found for the supplied threadId." }, { status: 404 });
      }
      threadTitle = threadContext.thread?.title || threadContext.thread?.jid || undefined;
      recentHistoryLines = (threadContext.messages || [])
        .slice(-12)
        .map((message) => `${message.direction === "inbound" ? "Them" : "Me"}: ${message.text}`)
        .filter((line) => line.trim().length > 0);
      styleHints = (threadContext.memory?.styleNotes || []).slice(0, 6);
    }

    const generation = await generateMemeImageWithAzure({
      inboundText: prompt,
      recentHistoryLines,
      styleHints,
      threadTitle,
      runtime: await getManagedAiRuntimeOverrides(),
    });

    if (!generation.imageBytes || generation.error) {
      const errorMessage = generation.error || "Meme generation failed. No image payload was returned.";
      await convex
        .mutation(convexRefs.systemRecordEvent, {
          source: "dashboard",
          eventType: "media.meme.manual.error",
          detail: `Manual meme generation failed: ${compactText(errorMessage, 220)}`,
          ...(threadId ? { threadId } : {}),
        })
        .catch(() => undefined);
      return NextResponse.json({ error: errorMessage }, { status: resolveGenerationFailureStatus(errorMessage) });
    }

    const contentHash = createHash("sha256").update(generation.imageBytes).digest("hex");
    const uploadUrl = (await convex.mutation(convexRefs.mediaGenerateUploadUrl, {})) as string;
    const uploadResponse = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        "Content-Type": generation.mimeType || "image/png",
      },
      body: new Uint8Array(generation.imageBytes),
    });

    if (!uploadResponse.ok) {
      throw new Error(`Generated meme upload failed (${uploadResponse.status}).`);
    }

    const uploadPayload = (await uploadResponse.json()) as { storageId?: string };
    if (!uploadPayload.storageId) {
      throw new Error("Generated meme upload response missing storageId.");
    }

    const nowIso = new Date().toISOString().slice(0, 10);
    const fallbackLabel = threadTitle ? `Manual meme ${nowIso} ${threadTitle.slice(0, 24)}` : `Manual meme ${nowIso}`;
    const generationContextSnippet = buildContextSnippet({
      prompt,
      threadTitle,
      recentHistoryLines,
      styleHints,
    });

    const assetId = (await convex.mutation(convexRefs.mediaRegisterAssetIfMissing, {
      kind: "meme",
      label: label || fallbackLabel,
      tags: ["generated", "manual", "meme"],
      fileId: uploadPayload.storageId,
      mimeType: generation.mimeType || "image/png",
      contentHash,
      source: "generated",
      enabled: true,
      ...(threadId ? { threadId } : {}),
      generationPromptHash: generation.promptHash,
      generationContextSnippet,
    })) as string;

    const download = (await convex
      .query(convexRefs.mediaGetAssetDownloadUrl, { assetId })
      .catch(() => null)) as { url?: string | null; label?: string; mimeType?: string } | null;

    await convex
      .mutation(convexRefs.systemRecordEvent, {
        source: "dashboard",
        eventType: "media.meme.manual.generated",
        detail: `Manual meme generated: asset=${assetId} model=${generation.model}`,
        ...(threadId ? { threadId } : {}),
      })
      .catch(() => undefined);

    return NextResponse.json({
      assetId,
      label: download?.label || label || fallbackLabel,
      mimeType: download?.mimeType || generation.mimeType || "image/png",
      url: download?.url || null,
      model: generation.model,
      latencyMs: generation.latencyMs,
      createdAt: Date.now(),
    });
  } catch (error) {
    const message = error instanceof Error && error.message ? error.message : "Failed to generate meme.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
