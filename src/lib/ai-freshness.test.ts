import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAiFreshnessFingerprint,
  clearAiFreshnessCacheForTests,
  getAiFreshnessCachedValue,
  setAiFreshnessCachedValue,
} from "./ai-freshness";

test("buildAiFreshnessFingerprint normalizes semantically equivalent payloads", () => {
  const one = buildAiFreshnessFingerprint({
    scope: "test_ai",
    inboundText: "  Hello   There ",
    threadId: "thread-1",
    historyLines: ["Them: hi", "Me: yo"],
    styleHints: [" Playful  "],
    contactFacts: [{ factType: "profile", factValue: "Likes brunch", confidence: 0.91 }],
    model: "gpt-5",
    temperature: 0.7,
    maxOutputTokens: 300,
  });
  const two = buildAiFreshnessFingerprint({
    scope: "test_ai",
    inboundText: "hello there",
    threadId: "thread-1",
    historyLines: ["Them: hi", "Me: yo"],
    styleHints: ["playful"],
    contactFacts: [{ factType: "profile", factValue: "likes brunch", confidence: 0.9101 }],
    model: "GPT-5",
    temperature: 0.7004,
    maxOutputTokens: 300.2,
  });

  assert.equal(one, two);
});

test("freshness cache returns value before expiry and clears on expiry", () => {
  clearAiFreshnessCacheForTests();
  const key = buildAiFreshnessFingerprint({
    scope: "gateway",
    inboundText: "where are we now",
  });

  const now = 100_000;
  setAiFreshnessCachedValue(key, { value: "ok" }, now);

  const cached = getAiFreshnessCachedValue<{ value: string }>(key, now + 1_000);
  assert.ok(cached);
  assert.equal(cached?.value.value, "ok");
  assert.equal(cached?.ageMs, 1_000);

  const expired = getAiFreshnessCachedValue<{ value: string }>(key, now + 31 * 60 * 1000);
  assert.equal(expired, null);
});
