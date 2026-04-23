import assert from "node:assert/strict";
import test from "node:test";
import { computeNextThreadRelationshipState, resolvePriorityTier } from "./relationshipState";

test("resolvePriorityTier honors thread personality settings", () => {
  assert.equal(resolvePriorityTier("girlfriend"), "romantic");
  assert.equal(resolvePriorityTier("relationship"), "romantic");
  assert.equal(resolvePriorityTier("professional"), "professional");
  assert.equal(resolvePriorityTier("casual"), "general");
});

test("computeNextThreadRelationshipState blends trust and keeps settings-driven tier", () => {
  const now = Date.now();
  const next = computeNextThreadRelationshipState({
    previous: {
      _id: "id" as never,
      _creationTime: now - 5000,
      threadId: "th" as never,
      profileSlug: "relationship",
      priorityTier: "romantic",
      trustScore: 0.8,
      warmthTrend: 1,
      conflictFlag: false,
      responsivenessMismatch: false,
      repairNeeded: false,
      lastReason: "ok",
      lastInboundAt: now - 10000,
      updatedAt: now - 5000,
      createdAt: now - 5000,
    },
    profileSlug: "relationship",
    trustScore: 0.4,
    warmthTrend: -1,
    conflictFlag: true,
    responsivenessMismatch: true,
    repairNeeded: true,
    reason: "romantic_conflict_repair",
    inboundAt: now,
    now,
  });

  assert.equal(next.priorityTier, "romantic");
  assert.ok(next.trustScore < 0.8 && next.trustScore > 0.4);
  assert.equal(next.conflictFlag, true);
  assert.equal(next.lastReason, "romantic_conflict_repair");
});
