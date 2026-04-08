import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPdfAwareInboundText,
  buildPdfReplyPolicyInstruction,
  classifyPdfLength,
  enforcePdfReplyShape,
  isPdfInboundDocument,
} from "./pdf";

test("isPdfInboundDocument detects PDF by mime type", () => {
  assert.equal(
    isPdfInboundDocument({
      kind: "document",
      text: "[Document] quote.pdf",
      mimeType: "application/pdf",
      fileName: "quote.pdf",
    }),
    true,
  );
});

test("isPdfInboundDocument detects PDF by filename extension", () => {
  assert.equal(
    isPdfInboundDocument({
      kind: "document",
      text: "[Document] PROPOSAL.PDF",
      fileName: "PROPOSAL.PDF",
    }),
    true,
  );
});

test("isPdfInboundDocument ignores non-pdf documents and non-document messages", () => {
  assert.equal(
    isPdfInboundDocument({
      kind: "document",
      text: "[Document] notes.docx",
      fileName: "notes.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    }),
    false,
  );
  assert.equal(
    isPdfInboundDocument({
      kind: "text",
      text: "hello",
    }),
    false,
  );
});

test("classifyPdfLength marks short and long texts", () => {
  const short = classifyPdfLength("one two three four", 10);
  assert.equal(short.wordCount, 4);
  assert.equal(short.isShort, true);

  const long = classifyPdfLength(new Array(60).fill("word").join(" "), 20);
  assert.equal(long.wordCount, 60);
  assert.equal(long.isShort, false);
});

test("buildPdfReplyPolicyInstruction asks a question for short PDF content", () => {
  const instruction = buildPdfReplyPolicyInstruction({
    status: "success",
    text: "Agenda: budget and rollout plan",
    excerpt: "Agenda: budget and rollout plan",
    wordCount: 6,
    isShort: true,
    pageCount: 1,
  });
  assert.match(instruction, /relevant question/i);
});

test("buildPdfReplyPolicyInstruction acknowledges long PDFs", () => {
  const instruction = buildPdfReplyPolicyInstruction({
    status: "success",
    text: "Long text",
    excerpt: "Long text",
    wordCount: 300,
    isShort: false,
    pageCount: 10,
  });
  assert.match(instruction, /acknowledgement/i);
  assert.match(instruction, /do not ask/i);
});

test("buildPdfAwareInboundText includes extracted PDF context", () => {
  const inboundText = buildPdfAwareInboundText({
    fallbackInboundText: "[Document] brief.pdf",
    caption: "Please review",
    pdfContext: {
      status: "success",
      text: "This is a short brief about timeline and pricing.",
      excerpt: "This is a short brief about timeline and pricing.",
      wordCount: 9,
      isShort: true,
      pageCount: 1,
      fileName: "brief.pdf",
    },
  });
  assert.match(inboundText, /PDF extraction succeeded/i);
  assert.match(inboundText, /timeline and pricing/i);
});

test("enforcePdfReplyShape keeps question for short pdfs and falls back when missing question", () => {
  const shortPdfContext = {
    status: "success" as const,
    text: "Budget timeline and rollout details",
    excerpt: "Budget timeline and rollout details",
    wordCount: 5,
    isShort: true,
    pageCount: 1,
  };

  const alreadyQuestion = enforcePdfReplyShape("Should I prioritize the budget section first?", shortPdfContext);
  assert.equal(alreadyQuestion, "Should I prioritize the budget section first?");

  const missingQuestion = enforcePdfReplyShape("I'll check it.", shortPdfContext);
  assert.match(missingQuestion, /\?/);
});

test("enforcePdfReplyShape returns acknowledgement for long pdfs", () => {
  const longPdfContext = {
    status: "success" as const,
    text: "Long",
    excerpt: "Extensive agreement terms",
    wordCount: 260,
    isShort: false,
    pageCount: 12,
  };
  const shaped = enforcePdfReplyShape("Can you send another copy?", longPdfContext);
  assert.match(shaped, /check it out/i);
  assert.doesNotMatch(shaped, /\?/);
});
