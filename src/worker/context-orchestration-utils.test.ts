import assert from "node:assert/strict";
import test from "node:test";
import {
  buildHistorySearchRewriteQuery,
  isHistoryContextWeak,
  mergeHistorySearchOverrides,
  type HistorySearchOverrideLike,
} from "./context-orchestration-utils";

test("buildHistorySearchRewriteQuery merges inbound focus terms with recent history hints", () => {
  const rewritten = buildHistorySearchRewriteQuery({
    inboundText: "Can you send the venue and flight details for tomorrow",
    historyLines: [
      "Them: I will fly to lagos tomorrow morning",
      "Me: Noted. What venue should I lock in?",
      "Them: The meeting venue is VI, please share flight details too",
    ],
  });

  assert.ok(rewritten);
  assert.match(rewritten || "", /\bvenue\b/);
  assert.match(rewritten || "", /\bflight\b/);
});

test("buildHistorySearchRewriteQuery returns undefined for low-signal input", () => {
  const rewritten = buildHistorySearchRewriteQuery({
    inboundText: "ok",
    historyLines: ["Them: ok"],
  });
  assert.equal(rewritten, undefined);
});

test("mergeHistorySearchOverrides de-duplicates lines and keeps strongest metrics", () => {
  const base: HistorySearchOverrideLike = {
    lines: ["Them: share the venue", "Me: okay I will send it"],
    candidateCount: 6,
    semanticRerankCount: 3,
    confidence: 0.42,
    retrievalStage: "semantic_fallback",
  };
  const incoming: HistorySearchOverrideLike = {
    lines: ["Them: share the venue", "Them: send flight details too"],
    candidateCount: 10,
    semanticRerankCount: 5,
    confidence: 0.61,
    retrievalStage: "semantic",
  };

  const merged = mergeHistorySearchOverrides({
    base,
    incoming,
    limit: 6,
  });

  assert.ok(merged);
  assert.deepEqual(merged?.lines, [
    "Them: share the venue",
    "Them: send flight details too",
    "Me: okay I will send it",
  ]);
  assert.equal(merged?.candidateCount, 10);
  assert.equal(merged?.semanticRerankCount, 5);
  assert.equal(merged?.confidence, 0.61);
  assert.equal(merged?.retrievalStage, "semantic");
});

test("isHistoryContextWeak checks both support depth and confidence", () => {
  const weakCoverage = isHistoryContextWeak({
    override: {
      lines: ["Them: one line only"],
      candidateCount: 4,
      semanticRerankCount: 2,
      confidence: 0.92,
      retrievalStage: "semantic",
    },
    lowConfidenceThreshold: 0.45,
    minStrongLines: 2,
  });
  assert.equal(weakCoverage, true);

  const weakConfidence = isHistoryContextWeak({
    override: {
      lines: ["Them: one", "Them: two"],
      candidateCount: 4,
      semanticRerankCount: 2,
      confidence: 0.22,
      retrievalStage: "semantic",
    },
    lowConfidenceThreshold: 0.45,
    minStrongLines: 2,
  });
  assert.equal(weakConfidence, true);

  const healthy = isHistoryContextWeak({
    override: {
      lines: ["Them: one", "Them: two", "Them: three"],
      candidateCount: 4,
      semanticRerankCount: 2,
      confidence: 0.62,
      retrievalStage: "semantic",
    },
    lowConfidenceThreshold: 0.45,
    minStrongLines: 2,
  });
  assert.equal(healthy, false);
});
