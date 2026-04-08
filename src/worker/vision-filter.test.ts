import assert from "node:assert/strict";
import test from "node:test";
import { decideInboundVisionAnalysis, readVisionFilterModeFromEnv, readVisionFilterUncaptionedCooldownMsFromEnv } from "./vision-filter";

test("readVisionFilterModeFromEnv defaults to smart and accepts valid modes", () => {
  assert.equal(readVisionFilterModeFromEnv({}), "smart");
  assert.equal(readVisionFilterModeFromEnv({ SLM_VISION_FILTER_MODE: "all" }), "all");
  assert.equal(readVisionFilterModeFromEnv({ SLM_VISION_FILTER_MODE: "none" }), "none");
  assert.equal(readVisionFilterModeFromEnv({ SLM_VISION_FILTER_MODE: "SMART" }), "smart");
  assert.equal(readVisionFilterModeFromEnv({ SLM_VISION_FILTER_MODE: "weird" }), "smart");
});

test("readVisionFilterUncaptionedCooldownMsFromEnv clamps to valid range", () => {
  assert.equal(readVisionFilterUncaptionedCooldownMsFromEnv({}), 90 * 60 * 1000);
  assert.equal(readVisionFilterUncaptionedCooldownMsFromEnv({ SLM_VISION_FILTER_UNCAPTIONED_COOLDOWN_MS: "30000" }), 60_000);
  assert.equal(
    readVisionFilterUncaptionedCooldownMsFromEnv({ SLM_VISION_FILTER_UNCAPTIONED_COOLDOWN_MS: String(30 * 60 * 60 * 1000) }),
    24 * 60 * 60 * 1000,
  );
});

test("decideInboundVisionAnalysis allows non-image messages", () => {
  const decision = decideInboundVisionAnalysis({
    parsed: { kind: "sticker", text: "[Sticker]" },
    mode: "smart",
    nowMs: Date.now(),
    uncaptionedCooldownMs: 1_000,
  });
  assert.equal(decision.allow, true);
  assert.equal(decision.reason, "non_image_kind");
});

test("decideInboundVisionAnalysis blocks all image uploads in none mode", () => {
  const decision = decideInboundVisionAnalysis({
    parsed: { kind: "image", text: "[Image]", caption: "check this" },
    mode: "none",
    nowMs: Date.now(),
    uncaptionedCooldownMs: 1_000,
  });
  assert.equal(decision.allow, false);
  assert.equal(decision.reason, "mode_none");
});

test("decideInboundVisionAnalysis allows all image uploads in all mode", () => {
  const decision = decideInboundVisionAnalysis({
    parsed: { kind: "image", text: "[Image]" },
    mode: "all",
    nowMs: Date.now(),
    uncaptionedCooldownMs: 1_000,
  });
  assert.equal(decision.allow, true);
  assert.equal(decision.reason, "mode_all");
});

test("decideInboundVisionAnalysis allows high-signal captions", () => {
  const decision = decideInboundVisionAnalysis({
    parsed: { kind: "image", text: "[Image] what do you think?", caption: "what do you think about this screenshot?" },
    mode: "smart",
    nowMs: Date.now(),
    uncaptionedCooldownMs: 1_000,
  });
  assert.equal(decision.allow, true);
  assert.equal(decision.reason, "caption_signal");
});

test("decideInboundVisionAnalysis blocks low-signal captions", () => {
  const decision = decideInboundVisionAnalysis({
    parsed: { kind: "image", text: "[Image] lol", caption: "lol" },
    mode: "smart",
    nowMs: Date.now(),
    uncaptionedCooldownMs: 1_000,
  });
  assert.equal(decision.allow, false);
  assert.equal(decision.reason, "caption_low_signal");
});

test("decideInboundVisionAnalysis samples uncaptioned images periodically", () => {
  const nowMs = Date.now();
  const allowed = decideInboundVisionAnalysis({
    parsed: { kind: "image", text: "[Image]" },
    mode: "smart",
    nowMs,
    lastAllowedAtMs: nowMs - 20_000,
    uncaptionedCooldownMs: 10_000,
  });
  assert.equal(allowed.allow, true);
  assert.equal(allowed.reason, "uncaptioned_periodic_sample");

  const blocked = decideInboundVisionAnalysis({
    parsed: { kind: "image", text: "[Image]" },
    mode: "smart",
    nowMs,
    lastAllowedAtMs: nowMs - 2_000,
    uncaptionedCooldownMs: 10_000,
  });
  assert.equal(blocked.allow, false);
  assert.equal(blocked.reason, "uncaptioned_throttled");
});
