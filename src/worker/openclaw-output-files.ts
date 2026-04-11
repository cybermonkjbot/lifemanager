import { basename } from "node:path";

export type OpenClawReplyFile = {
  source: "path" | "url" | "base64";
  value: string;
  fileName?: string;
  mimeType?: string;
  caption?: string;
};

const FILE_PATH_KEYS = ["path", "filePath", "filepath", "localPath", "absolutePath"] as const;
const FILE_URL_KEYS = ["mediaUrl", "fileUrl", "downloadUrl", "attachmentUrl", "url"] as const;
const FILE_BASE64_KEYS = ["base64", "b64", "b64Data", "data", "contentBase64"] as const;
const FILE_NAME_KEYS = ["fileName", "filename", "name", "title", "label"] as const;
const FILE_MIME_KEYS = ["mimeType", "mimetype", "contentType"] as const;
const FILE_CAPTION_KEYS = ["caption", "description", "text", "message"] as const;
const FILE_TEXT_KEYS = ["text", "message", "reply", "output", "result", "content"] as const;
const POSSIBLE_CONTAINER_KEYS = [
  "payloads",
  "files",
  "attachments",
  "media",
  "artifacts",
  "outputs",
  "items",
  "data",
  "result",
  "payload",
] as const;

function readString(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function readOptionalString(value: unknown) {
  const trimmed = readString(value);
  return trimmed || undefined;
}

function readByKeys(record: Record<string, unknown>, keys: readonly string[]) {
  for (const key of keys) {
    const value = readOptionalString(record[key]);
    if (value) {
      return value;
    }
  }
  return undefined;
}

function normalizeMimeType(value: string | undefined) {
  const mimeType = (value || "").trim().toLowerCase();
  if (!mimeType.includes("/")) {
    return undefined;
  }
  return mimeType.split(";")[0]?.trim() || undefined;
}

function splitDataUri(value: string): { mimeType?: string; base64: string } | null {
  const match = value.match(/^data:([^;,\s]+)?;base64,(.+)$/i);
  if (!match) {
    return null;
  }
  const mimeType = normalizeMimeType(match[1] || "");
  const base64 = (match[2] || "").trim();
  if (!base64) {
    return null;
  }
  return {
    mimeType,
    base64,
  };
}

function looksLikeBase64(value: string) {
  const compact = value.replace(/\s+/g, "");
  if (compact.length < 8 || compact.length % 4 !== 0) {
    return false;
  }
  return /^[A-Za-z0-9+/]+=*$/.test(compact);
}

function looksLikeFileUrl(value: string, key: string, hasNameOrMime: boolean) {
  if (!/^https?:\/\//i.test(value) && !/^file:\/\//i.test(value)) {
    return false;
  }
  if (key !== "url") {
    return true;
  }
  if (hasNameOrMime) {
    return true;
  }
  return /\.[a-z0-9]{1,10}(?:[?#]|$)/i.test(value);
}

function normalizePathValue(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  if (trimmed.startsWith("file://")) {
    try {
      return decodeURIComponent(new URL(trimmed).pathname);
    } catch {
      return trimmed;
    }
  }
  return trimmed;
}

function sanitizeFileName(value: string | undefined) {
  const trimmed = (value || "").trim().replace(/[/\\]+/g, "_");
  if (!trimmed) {
    return undefined;
  }
  return trimmed.slice(0, 160);
}

function inferNameFromPathLike(value: string) {
  const base = basename(value.split(/[?#]/)[0] || "");
  const cleaned = sanitizeFileName(base);
  return cleaned;
}

function stripMarkdownLinkTarget(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) {
    return "";
  }
  if (trimmed.startsWith("<") && trimmed.endsWith(">")) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function extractMarkdownLinkedFiles(text: string): OpenClawReplyFile[] {
  const files: OpenClawReplyFile[] = [];
  const pattern = /\[([^\]]+)\]\(([^)]+)\)/g;
  let match: RegExpExecArray | null = null;
  while ((match = pattern.exec(text)) !== null) {
    const label = sanitizeFileName((match[1] || "").trim());
    const targetRaw = stripMarkdownLinkTarget(match[2] || "");
    if (!targetRaw) {
      continue;
    }
    if (targetRaw.startsWith("/") || targetRaw.startsWith("./") || targetRaw.startsWith("../") || targetRaw.startsWith("file://")) {
      const normalizedPath = normalizePathValue(targetRaw);
      if (!normalizedPath) {
        continue;
      }
      files.push({
        source: "path",
        value: normalizedPath,
        fileName: label || inferNameFromPathLike(normalizedPath),
      });
      continue;
    }
    if (/^https?:\/\//i.test(targetRaw) && /\.[a-z0-9]{1,10}(?:[?#]|$)/i.test(targetRaw)) {
      files.push({
        source: "url",
        value: targetRaw,
        fileName: label || inferNameFromPathLike(targetRaw),
      });
    }
  }
  return files;
}

function trimTrailingPathPunctuation(value: string) {
  return value.replace(/[.,;:!?]+$/g, "");
}

function looksLikeLocalFilePath(value: string) {
  const normalized = normalizePathValue(value);
  if (!normalized) {
    return false;
  }
  if (/^https?:\/\//i.test(normalized)) {
    return false;
  }
  if (
    normalized.startsWith("/") ||
    normalized.startsWith("./") ||
    normalized.startsWith("../") ||
    normalized.startsWith("file://")
  ) {
    return /\.[a-z0-9]{1,10}(?:[?#]|$)/i.test(normalized);
  }
  return false;
}

function extractTextPathFiles(text: string): OpenClawReplyFile[] {
  const files: OpenClawReplyFile[] = [];
  const pushPath = (rawValue: string) => {
    const trimmed = trimTrailingPathPunctuation(rawValue.trim());
    if (!looksLikeLocalFilePath(trimmed)) {
      return;
    }
    const normalizedPath = normalizePathValue(trimmed);
    if (!normalizedPath) {
      return;
    }
    files.push({
      source: "path",
      value: normalizedPath,
      fileName: inferNameFromPathLike(normalizedPath),
    });
  };

  const normalizedText = text.replace(/\\([()[\]])/g, "$1");
  const backtickPattern = /`([^`\n]+)`/g;
  let backtickMatch: RegExpExecArray | null = null;
  while ((backtickMatch = backtickPattern.exec(normalizedText)) !== null) {
    pushPath(backtickMatch[1] || "");
  }

  const quotePattern = /["']((?:\/|\.\/|\.\.\/|file:\/\/)[^"'\n]+)["']/g;
  let quoteMatch: RegExpExecArray | null = null;
  while ((quoteMatch = quotePattern.exec(normalizedText)) !== null) {
    pushPath(quoteMatch[1] || "");
  }

  const barePathPattern = /(?:^|[\s(])((?:\/|\.\/|\.\.\/|file:\/\/)[^\s)<>\]}|,;:!?]+(?:\.[a-z0-9]{1,10})(?:[?#][^\s)<>\]}|,;:!?]+)?)/gi;
  let barePathMatch: RegExpExecArray | null = null;
  while ((barePathMatch = barePathPattern.exec(normalizedText)) !== null) {
    pushPath(barePathMatch[1] || "");
  }

  return files;
}

function normalizeCandidate(candidate: OpenClawReplyFile): OpenClawReplyFile | null {
  const source = candidate.source;
  const rawValue = (candidate.value || "").trim();
  if (!rawValue) {
    return null;
  }

  const fileName = sanitizeFileName(candidate.fileName);
  const caption = readOptionalString(candidate.caption);
  const mimeType = normalizeMimeType(candidate.mimeType);

  if (source === "path") {
    const pathValue = normalizePathValue(rawValue);
    if (!pathValue) {
      return null;
    }
    return {
      source,
      value: pathValue,
      fileName: fileName || inferNameFromPathLike(pathValue),
      mimeType,
      caption,
    };
  }

  if (source === "url") {
    if (!/^https?:\/\//i.test(rawValue) && !/^file:\/\//i.test(rawValue)) {
      return null;
    }
    return {
      source,
      value: rawValue,
      fileName: fileName || inferNameFromPathLike(rawValue),
      mimeType,
      caption,
    };
  }

  const fromDataUri = splitDataUri(rawValue);
  const base64Value = fromDataUri ? fromDataUri.base64 : rawValue.replace(/\s+/g, "");
  if (!looksLikeBase64(base64Value)) {
    return null;
  }
  return {
    source,
    value: base64Value,
    fileName,
    mimeType: fromDataUri?.mimeType || mimeType,
    caption,
  };
}

function extractFromRecord(
  record: Record<string, unknown>,
  push: (candidate: OpenClawReplyFile) => void,
  visit: (value: unknown) => void,
) {
  const fileName = readByKeys(record, FILE_NAME_KEYS);
  const mimeType = readByKeys(record, FILE_MIME_KEYS);
  const caption = readByKeys(record, FILE_CAPTION_KEYS);
  const hasNameOrMime = Boolean(fileName || mimeType);

  for (const key of FILE_PATH_KEYS) {
    const value = readOptionalString(record[key]);
    if (!value) {
      continue;
    }
    push({
      source: "path",
      value,
      fileName,
      mimeType,
      caption,
    });
  }

  for (const key of FILE_URL_KEYS) {
    const value = readOptionalString(record[key]);
    if (!value || !looksLikeFileUrl(value, key, hasNameOrMime)) {
      continue;
    }
    push({
      source: "url",
      value,
      fileName,
      mimeType,
      caption,
    });
  }

  for (const key of FILE_BASE64_KEYS) {
    const value = readOptionalString(record[key]);
    if (!value) {
      continue;
    }
    push({
      source: "base64",
      value,
      fileName,
      mimeType,
      caption,
    });
  }

  for (const key of FILE_TEXT_KEYS) {
    const text = readOptionalString(record[key]);
    if (!text) {
      continue;
    }
    for (const markdownFile of extractMarkdownLinkedFiles(text)) {
      push({
        ...markdownFile,
        fileName: markdownFile.fileName || fileName,
        mimeType: markdownFile.mimeType || mimeType,
        caption: markdownFile.caption || caption,
      });
    }
    for (const textFile of extractTextPathFiles(text)) {
      push({
        ...textFile,
        fileName: textFile.fileName || fileName,
        mimeType: textFile.mimeType || mimeType,
        caption: textFile.caption || caption,
      });
    }
  }

  for (const key of POSSIBLE_CONTAINER_KEYS) {
    const value = record[key];
    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item);
      }
      continue;
    }
    if (value && typeof value === "object") {
      visit(value);
    }
  }
}

export function extractOpenClawReplyFiles(args: {
  payload: unknown;
  replyText?: string;
  maxItems?: number;
}): OpenClawReplyFile[] {
  const files: OpenClawReplyFile[] = [];
  const seen = new Set<string>();
  const visited = new WeakSet<object>();
  const maxItems = Number.isFinite(args.maxItems) ? Math.max(1, Math.round(args.maxItems as number)) : 6;

  const push = (candidate: OpenClawReplyFile) => {
    const normalized = normalizeCandidate(candidate);
    if (!normalized) {
      return;
    }
    const key = `${normalized.source}|${normalized.value}|${normalized.fileName || ""}|${normalized.mimeType || ""}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    files.push(normalized);
  };

  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") {
      return;
    }
    const asObject = value as object;
    if (visited.has(asObject)) {
      return;
    }
    visited.add(asObject);
    extractFromRecord(value as Record<string, unknown>, push, visit);
  };

  visit(args.payload);
  for (const markdownFile of extractMarkdownLinkedFiles(args.replyText || "")) {
    push(markdownFile);
  }
  for (const textFile of extractTextPathFiles(args.replyText || "")) {
    push(textFile);
  }

  return files.slice(0, maxItems);
}
