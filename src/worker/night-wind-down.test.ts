import assert from "node:assert/strict";
import test from "node:test";
import { buildNightWindDownFallback, enforceNightWindDownStyle } from "./night-wind-down";

test("buildNightWindDownFallback includes explicit resume time when available", () => {
  const fallback = buildNightWindDownFallback("7:00 AM");
  assert.equal(
    fallback,
    "I'm winding down for tonight, but this matters to me. I'll send a proper reply after 7:00 AM.",
  );
});

test("enforceNightWindDownStyle rewrites robotic protocol leakage", () => {
  const result = enforceNightWindDownStyle({
    text: "Wind down protocol says I'll respond tomorrow.",
    resumeLabel: "7:00 AM",
  });

  assert.equal(
    result.text,
    "I'm winding down for tonight, but this matters to me. I'll send a proper reply after 7:00 AM.",
  );
  assert.ok(result.violations.includes("robotic_or_internal_cue"));
});

test("enforceNightWindDownStyle rewrites awkward morning phrase", () => {
  const result = enforceNightWindDownStyle({
    text: "I'll respond properly in the morning",
  });

  assert.equal(result.text, "I want to give this a proper reply tomorrow morning.");
  assert.ok(result.violations.includes("awkward_morning_phrase"));
});

test("enforceNightWindDownStyle removes follow-up questions", () => {
  const result = enforceNightWindDownStyle({
    text: "I am winding down for tonight, can we continue tomorrow?",
  });

  assert.equal(result.text, "I am winding down for tonight, can we continue tomorrow.");
  assert.ok(result.violations.includes("question_removed"));
});
