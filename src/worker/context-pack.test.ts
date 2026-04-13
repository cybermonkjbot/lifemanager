import assert from "node:assert/strict";
import test from "node:test";
import { buildContextPack, normalizeContextPack, shouldTriggerFactExtractionSecondPass } from "./context-pack";

test("normalizeContextPack truncates bounded fields and remains serializable", () => {
  const raw = buildContextPack({
    intent: "reply:".repeat(30),
    inboundOrSeedText: "seed ".repeat(400),
    selectedHistoryLines: Array.from({ length: 20 }).map((_, index) => `Them: ${"hello ".repeat(80)}${index}`),
    selectedContactFacts: Array.from({ length: 12 }).map((_, index) => ({
      factType: "profile" as const,
      factValue: `Fact ${index} ${"x".repeat(280)}`,
      confidence: 2,
      updatedAt: Date.now(),
    })),
    styleHints: Array.from({ length: 30 }).map((_, index) => `hint-${index}-${"y".repeat(90)}`),
    retrievalDiagnostics: {
      plannerSource: "hybrid",
      plannerConfidence: 5,
      historySearchConfidence: -1,
      secondPassReason: "z".repeat(600),
      adaptiveHistoryDepthDelta: 99,
      adaptiveFactRefreshBias: "high",
      adaptiveSampleSize: 99999,
    },
  });

  const normalized = normalizeContextPack(raw);
  assert.ok(normalized);
  assert.ok((normalized?.intent.length || 0) <= 84);
  assert.ok((normalized?.inboundOrSeedText.length || 0) <= 720);
  assert.ok((normalized?.selectedHistoryLines.length || 0) <= 12);
  assert.ok((normalized?.selectedContactFacts.length || 0) <= 8);
  assert.ok((normalized?.styleHints.length || 0) <= 16);
  assert.ok((normalized?.retrievalDiagnostics.secondPassReason?.length || 0) <= 180);
  assert.doesNotThrow(() => JSON.stringify(normalized));
});

test("shouldTriggerFactExtractionSecondPass triggers for weak, stale, or low-confidence first pass", () => {
  const now = Date.now();
  const weakCoverage = shouldTriggerFactExtractionSecondPass({
    facts: [],
    factsLimit: 8,
    historySearchConfidence: 0.82,
    nowMs: now,
  });
  assert.equal(weakCoverage.trigger, true);
  assert.equal(weakCoverage.reason, "coverage_weak");

  const staleFacts = shouldTriggerFactExtractionSecondPass({
    facts: [
      { updatedAt: now - 40 * 24 * 60 * 60 * 1000 },
      { updatedAt: now - 32 * 24 * 60 * 60 * 1000 },
    ],
    factsLimit: 8,
    historySearchConfidence: 0.74,
    nowMs: now,
  });
  assert.equal(staleFacts.trigger, true);
  assert.equal(staleFacts.reason, "facts_stale");

  const lowConfidence = shouldTriggerFactExtractionSecondPass({
    facts: [{ updatedAt: now }, { updatedAt: now - 1_000 }],
    factsLimit: 8,
    historySearchConfidence: 0.2,
    nowMs: now,
  });
  assert.equal(lowConfidence.trigger, true);
  assert.equal(lowConfidence.reason, "low_retrieval_confidence");

  const healthy = shouldTriggerFactExtractionSecondPass({
    facts: [{ updatedAt: now }, { updatedAt: now - 1_000 }],
    factsLimit: 8,
    historySearchConfidence: 0.9,
    nowMs: now,
  });
  assert.equal(healthy.trigger, false);
});
