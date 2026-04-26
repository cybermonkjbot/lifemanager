import assert from "node:assert/strict";
import test from "node:test";
import { detectTodoCandidate, judgeActualTodoCandidate } from "./heuristics";

const NOW = Date.parse("2026-04-07T10:00:00.000Z");

test("detectTodoCandidate flags outbound commitment with due hint", () => {
  const detection = detectTodoCandidate({
    text: "I'll send the deck tomorrow morning.",
    direction: "outbound",
    now: NOW,
  });

  assert.ok(detection);
  assert.equal(detection?.title, "I'll send the deck tomorrow morning.");
  assert.ok((detection?.suggestedDueAt || 0) > NOW);
});

test("detectTodoCandidate ignores inbound requests that were not accepted yet", () => {
  const detection = detectTodoCandidate({
    text: "Can you send me the deck tomorrow?",
    direction: "inbound",
    now: NOW,
  });

  assert.equal(detection, null);
});

test("detectTodoCandidate ignores outbound scheduling questions without commitment intent", () => {
  const detection = detectTodoCandidate({
    text: "Tomorrow evening still good?",
    direction: "outbound",
    now: NOW,
  });

  assert.equal(detection, null);
});

test("detectTodoCandidate supports explicit acceptance with request context", () => {
  const detection = detectTodoCandidate({
    text: "Sure.",
    direction: "outbound",
    contextText: "Can you send me the signed contract next week?",
    now: NOW,
  });

  assert.ok(detection);
  assert.equal(detection?.title, "send me the signed contract next week");
  assert.ok((detection?.suggestedDueAt || 0) > NOW);
});

test("judgeActualTodoCandidate rejects generic acknowledgement titles", () => {
  const judged = judgeActualTodoCandidate({
    sourceText: "Sure.",
    contextText: "Can you send me the signed contract next week?",
    candidate: {
      title: "follow up",
      suggestedDueAt: NOW + 24 * 60 * 60 * 1000,
    },
  });

  assert.equal(judged.decision, "reject");
  assert.equal(judged.reasonCode, "generic_title");
});

test("judgeActualTodoCandidate rejects titles without action verbs", () => {
  const judged = judgeActualTodoCandidate({
    sourceText: "I'll sort it tomorrow.",
    contextText: "Need the signed contract next week.",
    candidate: {
      title: "tomorrow vibes",
    },
  });

  assert.equal(judged.decision, "reject");
  assert.equal(judged.reasonCode, "missing_action_verb");
});

test("judgeActualTodoCandidate accepts actionable todo titles", () => {
  const judged = judgeActualTodoCandidate({
    sourceText: "I'll send the signed contract tomorrow morning.",
    contextText: "Can you send me the signed contract next week?",
    candidate: {
      title: "send signed contract tomorrow morning",
      suggestedDueAt: NOW + 24 * 60 * 60 * 1000,
    },
  });

  assert.equal(judged.decision, "accept");
  assert.equal(judged.reasonCode, "accepted_actionable_todo");
  assert.equal(judged.title, "send signed contract tomorrow morning");
});
