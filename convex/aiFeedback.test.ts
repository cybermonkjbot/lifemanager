import assert from "node:assert/strict";
import test from "node:test";
import { summarizeAdaptiveHintsFromSignals, summarizeOutcomeFromSignals } from "./aiFeedback";

const NOW = 1_700_000_000_000;

test("summarizeAdaptiveHintsFromSignals increases depth and fact refresh for negative thread feedback", () => {
  const summary = summarizeAdaptiveHintsFromSignals([
    { signalType: "suppressed_stale", score: -1, createdAt: NOW - 4 },
    { signalType: "suppressed_manual_intervention", score: -1, createdAt: NOW - 3 },
    { signalType: "manual_rewrite", score: -0.7, createdAt: NOW - 2 },
    { signalType: "no_reply_horizon", score: 0, createdAt: NOW - 1 },
  ]);

  assert.ok(summary.historyDepthDelta >= 1);
  assert.equal(summary.factRefreshBias, "high");
  assert.equal(summary.preferFactRefresh, true);
  assert.equal(summary.negativeCount, 3);
});

test("summarizeAdaptiveHintsFromSignals relaxes tuning when recent positive engagement dominates", () => {
  const summary = summarizeAdaptiveHintsFromSignals([
    { signalType: "engaged_reply", score: 1, createdAt: NOW - 4 },
    { signalType: "engaged_reply", score: 1, createdAt: NOW - 3 },
    { signalType: "engaged_reply", score: 1, createdAt: NOW - 2 },
    { signalType: "no_reply_horizon", score: 0, createdAt: NOW - 1 },
  ]);

  assert.ok(summary.historyDepthDelta <= 0);
  assert.equal(summary.factRefreshBias, "low");
  assert.equal(summary.preferFactRefresh, false);
  assert.equal(summary.positiveCount, 3);
});

test("summarizeOutcomeFromSignals aggregates mixed positive and friction signals", () => {
  const summary = summarizeOutcomeFromSignals([
    { signalType: "engaged_reply", score: 1, createdAt: NOW - 5 },
    { signalType: "engaged_reply", score: 1, createdAt: NOW - 4 },
    { signalType: "manual_rewrite", score: -0.7, createdAt: NOW - 3 },
    { signalType: "suppressed_manual_intervention", score: -1, createdAt: NOW - 2 },
    { signalType: "no_reply_horizon", score: 0, createdAt: NOW - 1 },
  ]);

  assert.equal(summary.signalCounts.engagedReply, 2);
  assert.equal(summary.signalCounts.manualRewrite, 1);
  assert.equal(summary.signalCounts.suppressedManual, 1);
  assert.equal(summary.signalCounts.noReplyHorizon, 1);
  assert.equal(summary.signalCounts.totalSignals, 5);
  assert.equal(summary.label, "mixed");
  assert.ok(summary.engagementScore > 0);
  assert.ok(summary.frictionScore > 0);
});
