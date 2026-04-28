import assert from "node:assert/strict";
import test from "node:test";
import type { Id } from "../_generated/dataModel";
import {
  buildConversationQualityDedupeKey,
  buildConversationQualityThreadSample,
  clipConversationQualityText,
  isAutomatedOutboundMessage,
  sanitizeAnalyzerFinding,
  scoreConversationQualityCandidate,
} from "./conversationQuality";

const threadId = "threads_quality_1" as Id<"threads">;

test("isAutomatedOutboundMessage detects non-manual outbound messages", () => {
  assert.equal(isAutomatedOutboundMessage({ direction: "outbound", senderJid: "me", toolRunId: "reply:1" }), true);
  assert.equal(isAutomatedOutboundMessage({ direction: "outbound", senderJid: "me", toolRunId: undefined }), false);
  assert.equal(isAutomatedOutboundMessage({ direction: "inbound", senderJid: "contact", toolRunId: "reply:1" }), false);
});

test("scoreConversationQualityCandidate requires automated outbound and prioritizes intervention signals", () => {
  const empty = scoreConversationQualityCandidate({
    threadId,
    title: "Ada",
    lastMessageAt: 10,
    negativeFeedbackCount: 0,
    messages: [
      {
        messageId: "messages_1" as Id<"messages">,
        threadId,
        direction: "inbound",
        senderJid: "contact",
        text: "hello",
        messageAt: 1,
      },
    ],
  });
  assert.equal(empty.eligible, false);

  const scored = scoreConversationQualityCandidate({
    threadId,
    title: "Ada",
    lastMessageAt: 10,
    negativeFeedbackCount: 1,
    messages: [
      {
        messageId: "messages_1" as Id<"messages">,
        threadId,
        direction: "inbound",
        senderJid: "contact",
        text: "are you around?",
        messageAt: 1,
      },
      {
        messageId: "messages_2" as Id<"messages">,
        threadId,
        direction: "outbound",
        senderJid: "me",
        text: "yes, what is up?",
        toolRunId: "reply:1",
        messageAt: 2,
      },
      {
        messageId: "messages_3" as Id<"messages">,
        threadId,
        direction: "outbound",
        senderJid: "me",
        text: "manual correction",
        messageAt: 3,
      },
    ],
  });
  assert.equal(scored.eligible, true);
  assert.equal(scored.autoOutboundCount, 1);
  assert.equal(scored.manualInterventionCount, 1);
  assert.ok(scored.score > 20);
});

test("buildConversationQualityThreadSample bounds excerpts around automated outbounds", () => {
  const sample = buildConversationQualityThreadSample({
    threadId,
    title: "Ada",
    lastMessageAt: 10,
    negativeFeedbackCount: 0,
    messages: Array.from({ length: 40 }, (_, index) => ({
      messageId: `messages_${index}` as Id<"messages">,
      threadId,
      direction: index === 20 ? ("outbound" as const) : index % 2 === 0 ? ("inbound" as const) : ("outbound" as const),
      senderJid: index === 20 || index % 2 === 1 ? "me" : "contact",
      text: index === 20 ? "x".repeat(900) : `message ${index}`,
      toolRunId: index === 20 ? "reply:20" : undefined,
      messageAt: index,
    })),
  });
  assert.ok(sample);
  assert.equal(sample.autoOutboundCount, 1);
  assert.ok(sample.excerpts.length <= 5);
  assert.ok(sample.excerpts.some((entry) => entry.automatedOutbound));
  assert.ok(sample.excerpts.every((entry) => entry.text.length <= 520));
});

test("sanitizeAnalyzerFinding requires concrete evidence and prompt", () => {
  const invalid = sanitizeAnalyzerFinding({
    title: "Vague",
    problemStatement: "No evidence",
    evidenceSummary: "None",
    suggestedFixPrompt: "Fix it",
    evidence: [],
  });
  assert.equal(invalid, null);

  const valid = sanitizeAnalyzerFinding({
    title: "Repeated stale context",
    category: "context_recall",
    severity: "high",
    problemStatement: "The system answers from old context after the user changes topic.",
    evidenceSummary: "Two excerpts show stale context.",
    suggestedFixPrompt: "Inspect context recall and add tests.",
    evidence: [{ threadId, excerpt: "System replied about yesterday after the user asked about today." }],
  });
  assert.equal(valid?.severity, "high");
  assert.equal(valid?.evidence.length, 1);
});

test("dedupe keys normalize stable finding identity", () => {
  const first = buildConversationQualityDedupeKey({
    category: "Context Recall!",
    title: "Stale Context",
    evidenceSummary: " Replies use old details. ",
  });
  const second = buildConversationQualityDedupeKey({
    category: "context recall",
    title: "stale context",
    evidenceSummary: "replies use old details",
  });
  assert.equal(first, second);
  assert.equal(clipConversationQualityText("a".repeat(600)).length, 520);
});
