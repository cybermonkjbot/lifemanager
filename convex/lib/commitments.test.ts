import assert from "node:assert/strict";
import test from "node:test";
import { detectFutureCommitment, judgeActualFollowupCandidate } from "./commitments";

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

test("detectFutureCommitment infers shared plan from time-specific scheduling language", () => {
  const detection = detectFutureCommitment({
    text: "Tomorrow evening still good?",
    direction: "outbound",
    now: Date.parse("2026-04-07T10:00:00.000Z"),
  });

  assert.equal(detection.outcome, "actionable");
  if (detection.outcome !== "actionable") {
    return;
  }
  assert.equal(detection.candidate.kind, "plan");
  assert.equal(detection.candidate.direction, "outbound");
  assert.ok(detection.candidate.confidence >= 0.72);
});

test("detectFutureCommitment ignores time-specific statements without conversational context", () => {
  const detection = detectFutureCommitment({
    text: "Tomorrow is packed for me.",
    direction: "outbound",
    now: Date.parse("2026-04-07T10:00:00.000Z"),
  });

  assert.equal(detection.outcome, "none");
});

test("judgeActualFollowupCandidate rejects weak confidence candidates", () => {
  const judged = judgeActualFollowupCandidate({
    text: "I'll send the proposal tomorrow.",
    now: Date.parse("2026-04-07T10:00:00.000Z"),
    candidate: {
      kind: "promise",
      direction: "outbound",
      reason: "You promised to follow up tomorrow.",
      dueAt: Date.parse("2026-04-08T10:00:00.000Z"),
      confidence: 0.75,
      normalizedKey: "send proposal",
      sourceSnippet: "I'll send the proposal tomorrow.",
    },
  });

  assert.equal(judged.decision, "reject");
  assert.equal(judged.reasonCode, "low_confidence");
});

test("judgeActualFollowupCandidate rejects acknowledgement-only followups", () => {
  const judged = judgeActualFollowupCandidate({
    text: "alright.",
    now: Date.parse("2026-04-07T10:00:00.000Z"),
    candidate: {
      kind: "promise",
      direction: "outbound",
      reason: "You promised to follow up tomorrow.",
      dueAt: Date.parse("2026-04-08T10:00:00.000Z"),
      confidence: 0.9,
      normalizedKey: "send proposal",
      sourceSnippet: "alright.",
    },
  });

  assert.equal(judged.decision, "reject");
  assert.equal(judged.reasonCode, "ack_only");
});

test("judgeActualFollowupCandidate accepts clear plan commitments with confidence scaling", () => {
  const judged = judgeActualFollowupCandidate({
    text: "Let's sync tomorrow evening and I will send the notes.",
    now: Date.parse("2026-04-07T10:00:00.000Z"),
    candidate: {
      kind: "plan",
      direction: "outbound",
      reason: "You planned to follow up tomorrow.",
      dueAt: Date.parse("2026-04-08T18:00:00.000Z"),
      confidence: 0.9,
      normalizedKey: "sync send notes",
      sourceSnippet: "Let's sync tomorrow evening and I will send the notes.",
    },
  });

  assert.equal(judged.decision, "accept");
  assert.equal(judged.reasonCode, "accepted_plan_commitment");
  assert.ok(judged.confidenceScale < 1);
});
