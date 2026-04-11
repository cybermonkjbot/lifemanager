import assert from "node:assert/strict";
import test from "node:test";
import { compactSafeText, extractKeywords, isWithinHourWindow, relationshipLabel, stableHash } from "./statusBuilder";

test("stableHash is deterministic", () => {
  const seed = "trend|social|42|123";
  assert.equal(stableHash(seed), stableHash(seed));
});

test("isWithinHourWindow handles overnight windows", () => {
  assert.equal(isWithinHourWindow(23, 22, 6), true);
  assert.equal(isWithinHourWindow(4, 22, 6), true);
  assert.equal(isWithinHourWindow(12, 22, 6), false);
});

test("relationshipLabel maps known relationship groups", () => {
  assert.equal(relationshipLabel("business"), "business");
  assert.equal(relationshipLabel("relationship"), "romance");
  assert.equal(relationshipLabel("friendship"), "social");
  assert.equal(relationshipLabel(undefined), "mixed");
});

test("extractKeywords keeps meaningful tokens and removes common stopwords", () => {
  const keywords = extractKeywords("The market gist is crazy and business updates are dropping daily.");
  assert.deepEqual(keywords.includes("market"), true);
  assert.deepEqual(keywords.includes("business"), true);
  assert.deepEqual(keywords.includes("the"), false);
  assert.deepEqual(keywords.includes("and"), false);
});

test("compactSafeText truncates by Unicode code points and keeps emoji intact", () => {
  assert.equal(compactSafeText("A🙂B", 2), "A🙂");
});

test("compactSafeText removes lone surrogates and control characters", () => {
  const withInvalids = `ok${String.fromCharCode(0xd83d)}${String.fromCharCode(0x001b)}done`;
  assert.equal(compactSafeText(withInvalids, 20), "okdone");
});
