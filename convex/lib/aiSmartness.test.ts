import assert from "node:assert/strict";
import test from "node:test";
import {
  TUNING_DAILY_DELTA_CAP,
  clampDailyDelta,
  clampFactStaleThresholdDaysModerate,
  clampRetrievalLowConfidenceThresholdModerate,
  clampWeightMultiplierModerate,
} from "./aiSmartness";

test("clampDailyDelta enforces 10 percent per-day parameter movement cap", () => {
  const previous = 1;
  const increased = clampDailyDelta(1.4, previous, TUNING_DAILY_DELTA_CAP);
  const decreased = clampDailyDelta(0.4, previous, TUNING_DAILY_DELTA_CAP);

  assert.equal(increased, 1.1);
  assert.equal(decreased, 0.9);
});

test("moderate tuning clamps enforce retrieval threshold bounds", () => {
  assert.equal(clampRetrievalLowConfidenceThresholdModerate(0.2), 0.35);
  assert.equal(clampRetrievalLowConfidenceThresholdModerate(0.5), 0.5);
  assert.equal(clampRetrievalLowConfidenceThresholdModerate(0.9), 0.65);
});

test("moderate tuning clamps enforce fact staleness day bounds", () => {
  assert.equal(clampFactStaleThresholdDaysModerate(3), 7);
  assert.equal(clampFactStaleThresholdDaysModerate(18), 18);
  assert.equal(clampFactStaleThresholdDaysModerate(60), 30);
});

test("moderate tuning clamps enforce weight multiplier bounds", () => {
  assert.equal(clampWeightMultiplierModerate(0.2), 0.5);
  assert.equal(clampWeightMultiplierModerate(1.25), 1.25);
  assert.equal(clampWeightMultiplierModerate(4), 2);
});
