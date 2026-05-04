import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { extractPreviewUrls, isSafePreviewUrl, normalizePreviewUrl } from "./lib/urlPreview";

const refGetMessageForPreview = makeFunctionReference<"query">("urlPreviews:getMessageForPreview");
const refUpsertForMessage = makeFunctionReference<"mutation">("urlPreviews:upsertForMessage");
const MAX_FETCH_BYTES = 256 * 1024;
const FETCH_TIMEOUT_MS = 6_000;

type PreviewFetchResult = {
  status: "available" | "unavailable" | "failed";
  canonicalUrl?: string;
  domain?: string;
  title?: string;
  description?: string;
  imageUrl?: string;
  siteName?: string;
  error?: string;
};

function compact(value: string | undefined, maxChars: number) {
  const normalized = (value || "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return undefined;
  }
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxChars - 3)).trim()}...`;
}

function decodeHtmlEntities(value: string | undefined) {
  if (!value) {
    return undefined;
  }
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_match, code) => {
      const point = Number(code);
      return Number.isFinite(point) ? String.fromCodePoint(point) : "";
    })
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => {
      const point = Number.parseInt(code, 16);
      return Number.isFinite(point) ? String.fromCodePoint(point) : "";
    });
}

function attributeValue(tag: string, name: string) {
  const pattern = new RegExp(`${name}\\s*=\\s*(['"])(.*?)\\1`, "i");
  return tag.match(pattern)?.[2];
}

function metaContent(html: string, selectors: string[]) {
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const selector of selectors) {
    const [attr, expectedValue] = selector.split("=");
    for (const tag of tags) {
      const value = attributeValue(tag, attr);
      if (value?.toLowerCase() === expectedValue.toLowerCase()) {
        return decodeHtmlEntities(attributeValue(tag, "content"));
      }
    }
  }
  return undefined;
}

function titleFromHtml(html: string) {
  const match = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  return decodeHtmlEntities(match?.[1]);
}

function absolutizeUrl(raw: string | undefined, baseUrl: string) {
  if (!raw) {
    return undefined;
  }
  try {
    const url = new URL(raw, baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

async function readLimitedText(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) {
    return (await response.text()).slice(0, MAX_FETCH_BYTES);
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < MAX_FETCH_BYTES) {
    const { value, done } = await reader.read();
    if (done || !value) {
      break;
    }
    const remaining = MAX_FETCH_BYTES - total;
    chunks.push(value.byteLength > remaining ? value.slice(0, remaining) : value);
    total += Math.min(value.byteLength, remaining);
  }
  await reader.cancel().catch(() => undefined);
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(combined);
}

async function fetchWithSafeRedirects(initialUrl: string, redirectsRemaining = 3): Promise<Response> {
  if (!isSafePreviewUrl(initialUrl)) {
    throw new Error("blocked_url");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(initialUrl, {
      redirect: "manual",
      signal: controller.signal,
      headers: {
        accept: "text/html,application/xhtml+xml",
        "user-agent": "OdogwuHQ URL Preview/1.0",
      },
    });
    if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
      if (redirectsRemaining <= 0) {
        throw new Error("too_many_redirects");
      }
      const nextUrl = absolutizeUrl(response.headers.get("location") || "", initialUrl);
      if (!nextUrl || !isSafePreviewUrl(nextUrl)) {
        throw new Error("blocked_redirect");
      }
      return await fetchWithSafeRedirects(nextUrl, redirectsRemaining - 1);
    }
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchPreview(url: string): Promise<PreviewFetchResult> {
  const normalized = normalizePreviewUrl(url);
  if (!normalized || !isSafePreviewUrl(normalized)) {
    return { status: "failed", error: "URL is not eligible for preview fetching." };
  }

  try {
    const response = await fetchWithSafeRedirects(normalized);
    const finalUrl = normalizePreviewUrl(response.url || normalized) || normalized;
    const contentType = response.headers.get("content-type") || "";
    const domain = new URL(finalUrl).hostname.replace(/^www\./i, "");
    if (!response.ok) {
      return { status: "failed", canonicalUrl: finalUrl, domain, error: `HTTP ${response.status}` };
    }
    if (!/text\/html|application\/xhtml\+xml/i.test(contentType)) {
      return { status: "unavailable", canonicalUrl: finalUrl, domain, title: domain };
    }

    const html = await readLimitedText(response);
    const title = compact(
      metaContent(html, ["property=og:title", "name=twitter:title"]) || titleFromHtml(html) || domain,
      180,
    );
    const description = compact(
      metaContent(html, ["property=og:description", "name=description", "name=twitter:description"]),
      260,
    );
    const siteName = compact(metaContent(html, ["property=og:site_name"]), 80);
    const imageUrl = absolutizeUrl(
      compact(metaContent(html, ["property=og:image", "name=twitter:image"]), 500),
      finalUrl,
    );

    return {
      status: title || description || imageUrl ? "available" : "unavailable",
      canonicalUrl: finalUrl,
      domain,
      title,
      description,
      imageUrl,
      siteName,
    };
  } catch (error) {
    const domain = new URL(normalized).hostname.replace(/^www\./i, "");
    return {
      status: "failed",
      canonicalUrl: normalized,
      domain,
      error: error instanceof Error ? compact(error.message, 120) : "Preview fetch failed.",
    };
  }
}

export const getMessageForPreview = internalQuery({
  args: {
    messageId: v.id("messages"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.messageId);
  },
});

export const upsertForMessage = internalMutation({
  args: {
    messageId: v.id("messages"),
    url: v.string(),
    status: v.union(v.literal("available"), v.literal("unavailable"), v.literal("failed")),
    canonicalUrl: v.optional(v.string()),
    domain: v.optional(v.string()),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    siteName: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.messageId);
    if (!message) {
      return null;
    }
    const normalizedUrl = normalizePreviewUrl(args.url);
    if (!normalizedUrl) {
      return null;
    }

    const now = Date.now();
    const existing = await ctx.db
      .query("messageUrlPreviews")
      .withIndex("by_messageId_and_normalizedUrl", (q) =>
        q.eq("messageId", args.messageId).eq("normalizedUrl", normalizedUrl),
      )
      .first();
    const patch = {
      tenantId: message.tenantId,
      provider: message.provider,
      threadId: message.threadId,
      messageId: args.messageId,
      sourceUrl: args.url,
      normalizedUrl,
      status: args.status,
      canonicalUrl: compact(args.canonicalUrl, 500),
      domain: compact(args.domain, 120),
      title: compact(args.title, 180),
      description: compact(args.description, 260),
      imageUrl: compact(args.imageUrl, 500),
      siteName: compact(args.siteName, 80),
      error: compact(args.error, 160),
      fetchedAt: now,
      updatedAt: now,
    };

    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return existing._id;
    }

    return await ctx.db.insert("messageUrlPreviews", {
      ...patch,
      createdAt: now,
    });
  },
});

export const fetchForMessage = internalAction({
  args: {
    messageId: v.id("messages"),
  },
  handler: async (ctx, args) => {
    const message = (await ctx.runQuery(refGetMessageForPreview, {
      messageId: args.messageId,
    })) as Doc<"messages"> | null;
    if (!message || (message.messageType || "text") !== "text" || message.isStatus) {
      return { fetched: 0 };
    }

    const urls = extractPreviewUrls(message.text);
    let fetched = 0;
    for (const url of urls) {
      const preview = await fetchPreview(url);
      await ctx.runMutation(refUpsertForMessage, {
        messageId: args.messageId,
        url,
        ...preview,
      });
      fetched += 1;
    }
    return { fetched };
  },
});
