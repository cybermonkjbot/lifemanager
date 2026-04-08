import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateMemeTimingGate,
  evaluateProfessionalMemeGuard,
  resolveMemeAssetWithFallback,
} from "./meme-policy";

test("evaluateProfessionalMemeGuard blocks auto mode when conversation looks professional", () => {
  const result = evaluateProfessionalMemeGuard({
    memePolicyMode: "auto",
    historyMessages: [
      { text: "Please send the revised invoice before the client meeting.", direction: "inbound", messageType: "text" },
      { text: "I will update the proposal and timeline.", direction: "outbound", messageType: "text" },
    ],
    latestInboundText: "Need approval on this contract today.",
  });
  assert.equal(result.blocked, true);
  assert.equal(result.reason, "auto_professional_detected");
});

test("evaluateProfessionalMemeGuard respects manual always_allow override", () => {
  const result = evaluateProfessionalMemeGuard({
    memePolicyMode: "always_allow",
    historyMessages: [{ text: "Invoice ready for client review.", direction: "inbound", messageType: "text" }],
    latestInboundText: "Please share payment terms.",
  });
  assert.equal(result.blocked, false);
  assert.equal(result.reason, "manual_always_allow");
});

test("evaluateMemeTimingGate enforces cooldown and probability", () => {
  const blockedByCooldown = evaluateMemeTimingGate({
    nowMs: 2_000,
    lastMemeSentAtMs: 1_500,
    cooldownMs: 1_000,
    probability: 1,
    randomValue: 0.2,
  });
  assert.equal(blockedByCooldown.pass, false);
  assert.equal(blockedByCooldown.inCooldown, true);

  const blockedByProbability = evaluateMemeTimingGate({
    nowMs: 2_000,
    lastMemeSentAtMs: 0,
    cooldownMs: 1_000,
    probability: 0.2,
    randomValue: 0.9,
  });
  assert.equal(blockedByProbability.pass, false);
  assert.equal(blockedByProbability.probabilityPass, false);
});

test("resolveMemeAssetWithFallback follows cache -> generate -> fallback order", async () => {
  const fromCache = await resolveMemeAssetWithFallback({
    pickGeneratedCached: async () => "cached-id",
    generateFresh: async () => "fresh-id",
    pickUploadedFallback: async () => "fallback-id",
  });
  assert.equal(fromCache.assetId, "cached-id");
  assert.equal(fromCache.source, "generated_cache");

  const fromGenerated = await resolveMemeAssetWithFallback({
    pickGeneratedCached: async () => undefined,
    generateFresh: async () => "fresh-id",
    pickUploadedFallback: async () => "fallback-id",
  });
  assert.equal(fromGenerated.assetId, "fresh-id");
  assert.equal(fromGenerated.source, "generated_fresh");

  const fromFallback = await resolveMemeAssetWithFallback({
    pickGeneratedCached: async () => undefined,
    generateFresh: async () => undefined,
    pickUploadedFallback: async () => "fallback-id",
  });
  assert.equal(fromFallback.assetId, "fallback-id");
  assert.equal(fromFallback.source, "uploaded_fallback");
});

