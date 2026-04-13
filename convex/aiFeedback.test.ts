import assert from "node:assert/strict";
import test from "node:test";
import { summarizeAdaptiveHintsFromSignals } from "./aiFeedback";

test("summarizeAdaptiveHintsFromSignals increases depth and fact refresh for negative thread feedback", () => {
  const summary = summarizeAdaptiveHintsFromSignals([
    { signalType: "suppressed_stale", score: -1 },
    { signalType: "suppressed_manual_intervention", score: -1 },
    { signalType: "manual_rewrite", score: -0.7 },
    { signalType: "no_reply_horizon", score: 0 },
  ]);

  assert.ok(summary.historyDepthDelta >= 1);
  assert.equal(summary.factRefreshBias, "high");
  assert.equal(summary.preferFactRefresh, true);
  assert.equal(summary.negativeCount, 3);
});

test("summarizeAdaptiveHintsFromSignals relaxes tuning when recent positive engagement dominates", () => {
  const summary = summarizeAdaptiveHintsFromSignals([
    { signalType: "engaged_reply", score: 1 },
    { signalType: "engaged_reply", score: 1 },
    { signalType: "engaged_reply", score: 1 },
    { signalType: "no_reply_horizon", score: 0 },
  ]);

  assert.ok(summary.historyDepthDelta <= 0);
  assert.equal(summary.factRefreshBias, "low");
  assert.equal(summary.preferFactRefresh, false);
  assert.equal(summary.positiveCount, 3);
});
