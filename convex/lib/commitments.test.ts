import assert from "node:assert/strict";
import test from "node:test";
import { detectFutureCommitment } from "./commitments";

test("detectFutureCommitment flags outbound promise with explicit time", () => {
  const detection = detectFutureCommitment({
    text: "I'll send the proposal tomorrow morning.",
    direction: "outbound",
    now: Date.parse("2026-04-07T10:00:00.000Z"),
  });

  assert.equal(detection.outcome, "actionable");
  if (detection.outcome !== "actionable") {
    return;
  }
  assert.equal(detection.candidate.direction, "outbound");
  assert.equal(detection.candidate.kind, "promise");
  assert.ok(detection.candidate.confidence >= 0.72);
});

test("detectFutureCommitment flags inbound request with explicit future phrase", () => {
  const detection = detectFutureCommitment({
    text: "Can you send me the docs next week?",
    direction: "inbound",
    now: Date.parse("2026-04-07T10:00:00.000Z"),
  });

  assert.equal(detection.outcome, "actionable");
  if (detection.outcome !== "actionable") {
    return;
  }
  assert.equal(detection.candidate.direction, "inbound");
  assert.equal(detection.candidate.kind, "request");
});

test("detectFutureCommitment treats vague future language as non actionable", () => {
  const detection = detectFutureCommitment({
    text: "I'll send it later, don't worry.",
    direction: "outbound",
    now: Date.parse("2026-04-07T10:00:00.000Z"),
  });

  assert.equal(detection.outcome, "non_actionable");
});

test("detectFutureCommitment ignores unrelated messages", () => {
  const detection = detectFutureCommitment({
    text: "That meme was hilarious lol",
    direction: "inbound",
    now: Date.parse("2026-04-07T10:00:00.000Z"),
  });

  assert.equal(detection.outcome, "none");
});

test("detectFutureCommitment keeps outbound precision by requiring first-person intent", () => {
  const detection = detectFutureCommitment({
    text: "You should send the update tomorrow.",
    direction: "outbound",
    now: Date.parse("2026-04-07T10:00:00.000Z"),
  });

  assert.equal(detection.outcome, "none");
});
