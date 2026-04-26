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

test("buildAiFreshnessFingerprint changes when style-affecting inputs change", () => {
  const base = {
    scope: "test_ai" as const,
    inboundText: "I miss you",
    threadId: "thread-1",
    styleProfile: { mimicryLevel: 0.7, learnedEmojiAllowlist: ["😌"] },
    personality: { profileSlug: "girlfriend", intensity: 0.8, threadPromptProfile: "warm and short" },
    activePersonaPackIdsByProfile: { girlfriend: "josh_witty_shortcuts.v1" },
    qualityGateMode: "auto_rewrite_once",
    qualityGateThreshold: 0.76,
  };

  const same = buildAiFreshnessFingerprint(base);
  const differentPersona = buildAiFreshnessFingerprint({
    ...base,
    personality: { ...base.personality, threadPromptProfile: "more formal" },
  });
  const differentPack = buildAiFreshnessFingerprint({
    ...base,
    activePersonaPackIdsByProfile: { girlfriend: "other_pack.v1" },
  });
  const differentStyle = buildAiFreshnessFingerprint({
    ...base,
    styleProfile: { mimicryLevel: 0.3, learnedEmojiAllowlist: [] },
  });

  assert.notEqual(same, differentPersona);
  assert.notEqual(same, differentPack);
  assert.notEqual(same, differentStyle);
});
