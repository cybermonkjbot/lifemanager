import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_CALL_AUTO_DECLINE_FALLBACK_VARIANTS,
  resolveCallFallbackVariants,
  selectCallFallbackVariant,
  shouldSkipStaleCallOffer,
  shouldSuppressCallFallbackAfterOffer,
} from "./call-fallback";

test("shouldSuppressCallFallbackAfterOffer blocks fallback when call was accepted", () => {
  assert.equal(shouldSuppressCallFallbackAfterOffer(null), false);
  assert.equal(
    shouldSuppressCallFallbackAfterOffer({
      lastStatus: "accept",
    }),
    true,
  );
  assert.equal(
    shouldSuppressCallFallbackAfterOffer({
      lastStatus: "reject",
      acceptedAt: 1_000,
    }),
    true,
  );
  assert.equal(
    shouldSuppressCallFallbackAfterOffer({
      lastStatus: "reject",
    }),
    false,
  );
});

test("resolveCallFallbackVariants returns defaults when no overrides are set", () => {
  const resolved = resolveCallFallbackVariants();
  assert.deepEqual(resolved, DEFAULT_CALL_AUTO_DECLINE_FALLBACK_VARIANTS);
});

test("resolveCallFallbackVariants uses multiline or || separated env override variants", () => {
  const resolved = resolveCallFallbackVariants({
    overrideVariants: "First line\nSecond line||Third line||Second line",
  });
  assert.deepEqual(resolved, ["First line", "Second line", "Third line"]);
});

test("resolveCallFallbackVariants falls back to single override text when provided", () => {
  const resolved = resolveCallFallbackVariants({
    overrideText: "Custom fallback message",
  });
  assert.deepEqual(resolved, ["Custom fallback message"]);
});

test("selectCallFallbackVariant is deterministic and only returns configured variants", () => {
  const variants = ["one", "two", "three"];
  const first = selectCallFallbackVariant({
    variants,
    seed: "threadA|day1",
  });
  const second = selectCallFallbackVariant({
    variants,
    seed: "threadA|day1",
  });
  assert.equal(first, second);
  assert.equal(variants.includes(first), true);
});

test("shouldSkipStaleCallOffer blocks outdated missed-call handling", () => {
  assert.equal(
    shouldSkipStaleCallOffer({
      offerAtMs: 1_000,
      nowMs: 100_000,
      recencyWindowMs: 30_000,
    }),
    true,
  );
  assert.equal(
    shouldSkipStaleCallOffer({
      offerAtMs: 80_000,
      nowMs: 100_000,
      recencyWindowMs: 30_000,
    }),
    false,
  );
});
