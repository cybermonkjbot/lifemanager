import assert from "node:assert/strict";
import test from "node:test";
import { assessBusinessSignal } from "./business-signals";

test("assessBusinessSignal detects order and payment intent", () => {
  const result = assessBusinessSignal("I want to order two. Send account number for payment.");
  assert.equal(result.intent, "payment");
  assert.ok(result.labels.includes("Order intent"));
  assert.ok(result.labels.includes("Payment"));
  assert.equal(result.urgent, true);
});

test("assessBusinessSignal ignores casual personal chat", () => {
  const result = assessBusinessSignal("How far, hope your day is going well?");
  assert.equal(result.intent, "none");
  assert.deepEqual(result.labels, []);
  assert.equal(result.scoreBoost, 0);
});
