import assert from "node:assert/strict";
import test from "node:test";
import { detectTodoCandidate } from "./heuristics";

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
