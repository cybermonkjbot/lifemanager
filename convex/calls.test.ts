import assert from "node:assert/strict";
import test from "node:test";
import { computeCallDurationMs, isCallSessionQualifiedForReplyBarrier } from "./calls";

test("computeCallDurationMs returns elapsed milliseconds when accept and end exist", () => {
  assert.equal(
    computeCallDurationMs({
      acceptedAt: 1_000,
      endedAt: 121_000,
    }),
    120_000,
  );
});

test("computeCallDurationMs returns undefined for invalid ranges", () => {
  assert.equal(
    computeCallDurationMs({
      acceptedAt: 10_000,
      endedAt: 9_000,
    }),
    undefined,
  );
  assert.equal(
    computeCallDurationMs({
      acceptedAt: 10_000,
      endedAt: undefined,
    }),
    undefined,
  );
});

test("isCallSessionQualifiedForReplyBarrier requires direct call, both sides, and minimum duration", () => {
  const qualified = isCallSessionQualifiedForReplyBarrier({
    threadKind: "direct",
    acceptedAt: 10_000,
    endedAt: 190_000,
    sawSelfEvent: true,
    sawPeerEvent: true,
    minDurationMs: 120_000,
  });
  assert.equal(qualified, true);

  const shortCall = isCallSessionQualifiedForReplyBarrier({
    threadKind: "direct",
    acceptedAt: 10_000,
    endedAt: 70_000,
    sawSelfEvent: true,
    sawPeerEvent: true,
    minDurationMs: 120_000,
  });
  assert.equal(shortCall, false);

  const oneSided = isCallSessionQualifiedForReplyBarrier({
    threadKind: "direct",
    acceptedAt: 10_000,
    endedAt: 190_000,
    sawSelfEvent: true,
    sawPeerEvent: false,
    minDurationMs: 120_000,
  });
  assert.equal(oneSided, false);

  const groupCall = isCallSessionQualifiedForReplyBarrier({
    threadKind: "group",
    acceptedAt: 10_000,
    endedAt: 190_000,
    sawSelfEvent: true,
    sawPeerEvent: true,
    minDurationMs: 120_000,
  });
  assert.equal(groupCall, false);
});
