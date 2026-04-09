import assert from "node:assert/strict";
import test from "node:test";
import { evaluateFollowupPromotionEligibility } from "./followups";

test("evaluateFollowupPromotionEligibility filters inbound request followups", () => {
  const result = evaluateFollowupPromotionEligibility({
    followUp: {
      kind: "request",
      direction: "inbound",
      confidence: 0.93,
      dueAt: Date.now(),
      reason: "They requested a follow-up tomorrow.",
    },
    thread: {
      isArchived: false,
      isIgnored: false,
      threadKind: "direct",
    },
    now: Date.now(),
  });

  assert.equal(result.allow, false);
  assert.equal(result.reasonCode, "inbound_request_kind");
});

test("evaluateFollowupPromotionEligibility filters ignored/group/archived threads", () => {
  const archived = evaluateFollowupPromotionEligibility({
    followUp: {
      kind: "promise",
      direction: "outbound",
      confidence: 0.9,
      dueAt: Date.now(),
      reason: "You promised to follow up tomorrow.",
    },
    thread: {
      isArchived: true,
      isIgnored: false,
      threadKind: "direct",
    },
    now: Date.now(),
  });
  assert.equal(archived.allow, false);
  assert.equal(archived.reasonCode, "archived_thread");

  const group = evaluateFollowupPromotionEligibility({
    followUp: {
      kind: "promise",
      direction: "outbound",
      confidence: 0.9,
      dueAt: Date.now(),
      reason: "You promised to follow up tomorrow.",
    },
    thread: {
      isArchived: false,
      isIgnored: false,
      threadKind: "group",
    },
    now: Date.now(),
  });
  assert.equal(group.allow, false);
  assert.equal(group.reasonCode, "non_direct_thread");
});

test("evaluateFollowupPromotionEligibility allows direct high-confidence promise followups", () => {
  const result = evaluateFollowupPromotionEligibility({
    followUp: {
      kind: "promise",
      direction: "outbound",
      confidence: 0.91,
      dueAt: Date.now() - 60_000,
      reason: "You promised to follow up today.",
    },
    thread: {
      isArchived: false,
      isIgnored: false,
      threadKind: "direct",
    },
    now: Date.now(),
  });

  assert.equal(result.allow, true);
});

test("evaluateFollowupPromotionEligibility filters stale or low-confidence followups", () => {
  const lowConfidence = evaluateFollowupPromotionEligibility({
    followUp: {
      kind: "promise",
      direction: "outbound",
      confidence: 0.74,
      dueAt: Date.now(),
      reason: "You promised to follow up tomorrow.",
    },
    thread: {
      isArchived: false,
      isIgnored: false,
      threadKind: "direct",
    },
    now: Date.now(),
  });
  assert.equal(lowConfidence.allow, false);
  assert.equal(lowConfidence.reasonCode, "low_confidence");

  const stale = evaluateFollowupPromotionEligibility({
    followUp: {
      kind: "promise",
      direction: "outbound",
      confidence: 0.91,
      dueAt: Date.now() - 30 * 24 * 60 * 60 * 1000,
      reason: "You promised to follow up next week.",
    },
    thread: {
      isArchived: false,
      isIgnored: false,
      threadKind: "direct",
    },
    now: Date.now(),
  });
  assert.equal(stale.allow, false);
  assert.equal(stale.reasonCode, "stale_due");
});
