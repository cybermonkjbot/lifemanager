import assert from "node:assert/strict";
import test from "node:test";
import { shouldSuppressCallFallbackAfterOffer } from "./call-fallback";

test("shouldSuppressCallFallbackAfterOffer suppresses when call was accepted", () => {
  assert.equal(
    shouldSuppressCallFallbackAfterOffer({
      lastStatus: "accept",
    }),
    true,
  );
});

test("shouldSuppressCallFallbackAfterOffer suppresses when accept timestamp exists", () => {
  assert.equal(
    shouldSuppressCallFallbackAfterOffer({
      lastStatus: "terminate",
      acceptedAt: Date.now(),
    }),
    true,
  );
});

test("shouldSuppressCallFallbackAfterOffer keeps fallback for unanswered sessions", () => {
  assert.equal(
    shouldSuppressCallFallbackAfterOffer({
      lastStatus: "offer",
    }),
    false,
  );
  assert.equal(
    shouldSuppressCallFallbackAfterOffer({
      lastStatus: "reject",
    }),
    false,
  );
  assert.equal(shouldSuppressCallFallbackAfterOffer(null), false);
});
