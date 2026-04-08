import { PDFParse } from "pdf-parse";
import type { ParsedInboundMessage } from "./whatsapp";

const DEFAULT_PDF_EXCERPT_CHAR_LIMIT = 1_800;
const DEFAULT_PDF_PARSE_TIMEOUT_MS = 20_000;
export const PDF_SHORT_WORD_THRESHOLD = 140;
const PDF_ACK_FALLBACK_TEXT = "I'll check it out and get back to you.";
const PDF_TOPIC_STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "that",
  "this",
  "your",
  "about",
  "into",
  "have",
  "has",
  "are",
  "was",
  "were",
  "been",
  "will",
  "can",
  "should",
  "would",
  "could",
  "you",
  "our",
  "their",
  "they",
  "them",
  "what",
  "when",
  "where",
  "which",
  "please",
  "thanks",
  "thank",
  "document",
  "pdf",
]);

type PdfContextBase = {
  fileName?: string;
  mimeType?: string;
  excerpt: string;
  wordCount: number;
  pageCount?: number;
};

export type PdfTextContext =
  | (PdfContextBase & {
      status: "success";
      text: string;
      isShort: boolean;
    })
  | (PdfContextBase & {
      status: "empty";
      text: "";
      isShort: false;
    })
  | (PdfContextBase & {
      status: "error";
      text: "";
      isShort: false;
      error: string;
    });

function normalizeWhitespace(input: string) {
  return input.replace(/\s+/g, " ").trim();
}

function getWordCount(text: string) {
  const normalized = normalizeWhitespace(text);
  if (!normalized) {
    return 0;
  }
  return normalized.split(" ").length;
}

function hasPdfMimeType(mimeType: string | undefined) {
  return (mimeType || "").trim().toLowerCase().includes("pdf");
}

function hasPdfFileExtension(fileName: string | undefined) {
  return (fileName || "").trim().toLowerCase().endsWith(".pdf");
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(label)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

export function isPdfInboundDocument(
  parsed: ParsedInboundMessage,
): parsed is Extract<ParsedInboundMessage, { kind: "document" }> {
  return parsed.kind === "document" && (hasPdfMimeType(parsed.mimeType) || hasPdfFileExtension(parsed.fileName));
}

export function classifyPdfLength(text: string, threshold = PDF_SHORT_WORD_THRESHOLD) {
  const wordCount = getWordCount(text);
  return {
    wordCount,
    isShort: wordCount > 0 && wordCount <= Math.max(20, threshold),
  };
}

export async function extractPdfTextContext(args: {
  pdfBytes: Buffer;
  fileName?: string;
  mimeType?: string;
  excerptCharLimit?: number;
  parseTimeoutMs?: number;
}): Promise<PdfTextContext> {
  const excerptLimit = Math.max(400, Math.min(args.excerptCharLimit ?? DEFAULT_PDF_EXCERPT_CHAR_LIMIT, 6_000));
  const timeoutMs = Math.max(2_000, Math.min(args.parseTimeoutMs ?? DEFAULT_PDF_PARSE_TIMEOUT_MS, 90_000));

  let parser: PDFParse | null = null;
  try {
    parser = new PDFParse({
      data: new Uint8Array(args.pdfBytes),
    });
    const textResult = await withTimeout(
      parser.getText(),
      timeoutMs,
      `PDF text extraction timed out after ${timeoutMs}ms.`,
    );
    const normalizedText = normalizeWhitespace(textResult.text || "");
    const excerpt = normalizedText.slice(0, excerptLimit);
    const classification = classifyPdfLength(normalizedText);
    if (!normalizedText) {
      return {
        status: "empty",
        text: "",
        excerpt: "",
        wordCount: 0,
        isShort: false,
        pageCount: textResult.total,
        fileName: args.fileName,
        mimeType: args.mimeType,
      };
    }
    return {
      status: "success",
      text: normalizedText,
      excerpt,
      wordCount: classification.wordCount,
      isShort: classification.isShort,
      pageCount: textResult.total,
      fileName: args.fileName,
      mimeType: args.mimeType,
    };
  } catch (error) {
    return {
      status: "error",
      error: error instanceof Error ? error.message : String(error),
      text: "",
      excerpt: "",
      wordCount: 0,
      isShort: false,
      fileName: args.fileName,
      mimeType: args.mimeType,
    };
  } finally {
    if (parser) {
      await parser.destroy().catch(() => undefined);
    }
  }
}

export function buildPdfAwareInboundText(args: {
  fallbackInboundText: string;
  pdfContext: PdfTextContext;
  caption?: string;
}) {
  const lines = [
    `Latest inbound message: ${args.fallbackInboundText || "[Document]"}`,
    args.caption ? `Document caption: ${args.caption}` : "",
  ];

  if (args.pdfContext.status === "success") {
    const truncated = args.pdfContext.text.length > args.pdfContext.excerpt.length;
    lines.push(
      [
        "PDF extraction succeeded.",
        `Word count: ${args.pdfContext.wordCount}.`,
        args.pdfContext.pageCount ? `Pages: ${args.pdfContext.pageCount}.` : "",
        truncated ? `Excerpt (truncated): ${args.pdfContext.excerpt}` : `Extracted text: ${args.pdfContext.excerpt}`,
      ]
        .filter(Boolean)
        .join(" "),
    );
  } else if (args.pdfContext.status === "empty") {
    lines.push("PDF extraction succeeded but no readable text was found.");
  } else {
    lines.push(`PDF extraction failed: ${args.pdfContext.error}`);
  }

  return lines.filter(Boolean).join("\n\n");
}

export function buildPdfReplyPolicyInstruction(pdfContext: PdfTextContext) {
  if (pdfContext.status === "success" && pdfContext.isShort) {
    return [
      "The latest inbound is a short PDF.",
      "Reply with exactly one short sentence that is a relevant question about the PDF content.",
      "Mention a concrete term from the PDF text when possible.",
      "Do not include greetings, sign-offs, summaries, or extra sentences.",
    ].join(" ");
  }
  return [
    "The latest inbound is a PDF.",
    "Reply with one short acknowledgement that you will review it (for example: I'll check it out).",
    "Do not ask a follow-up question.",
    "Do not summarize the document.",
  ].join(" ");
}

function extractPrimaryTopic(excerpt: string) {
  const matches = excerpt.toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) || [];
  const token = matches.find((word) => !PDF_TOPIC_STOPWORDS.has(word));
  return token || "";
}

function firstSentence(text: string) {
  const normalized = normalizeWhitespace(text);
  if (!normalized) {
    return "";
  }
  const parts = normalized.split(/(?<=[.?!])\s+/);
  return (parts[0] || normalized).trim();
}

function buildFallbackPdfQuestion(excerpt: string) {
  const topic = extractPrimaryTopic(excerpt);
  if (topic) {
    return `Quick one: should I focus on ${topic} first?`;
  }
  return "Quick one: what should I focus on first in the PDF?";
}

export function enforcePdfReplyShape(replyText: string, pdfContext: PdfTextContext) {
  const sentence = firstSentence(replyText);
  if (pdfContext.status === "success" && pdfContext.isShort) {
    if (sentence && /\?/.test(sentence)) {
      return sentence;
    }
    return buildFallbackPdfQuestion(pdfContext.excerpt);
  }

  const acknowledgesReviewIntent =
    /\b(check|review|read|look(?:ing)?\s+(?:into|over)|go through|take a look|circle back)\b/i.test(sentence) &&
    !/\?/.test(sentence);
  if (acknowledgesReviewIntent) {
    return sentence;
  }
  return PDF_ACK_FALLBACK_TEXT;
}

export function describePdfContextForLog(pdfContext: PdfTextContext) {
  if (pdfContext.status === "success") {
    return `status=success words=${pdfContext.wordCount} pages=${pdfContext.pageCount || "unknown"} short=${pdfContext.isShort}`;
  }
  if (pdfContext.status === "empty") {
    return `status=empty pages=${pdfContext.pageCount || "unknown"}`;
  }
  return `status=error error=${pdfContext.error}`;
}
