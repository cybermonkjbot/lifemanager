import assert from "node:assert/strict";
import test from "node:test";
import { compactSafeText, extractKeywords, isWithinHourWindow, relationshipLabel, stableHash, stableUnitRandom } from "./statusBuilder";

test("stableHash is deterministic", () => {
  const seed = "trend|social|42|123";
  assert.equal(stableHash(seed), stableHash(seed));
});

test("stableUnitRandom stays deterministic and bounded", () => {
  const seed = "status-format|trend|social|80|493318";
  const first = stableUnitRandom(seed);
  const second = stableUnitRandom(seed);
  assert.equal(first, second);
  assert.equal(first >= 0 && first < 1, true);
});

test("stableUnitRandom avoids linear drift for sequential cadence buckets", () => {
  const values = Array.from({ length: 9 }, (_, index) => stableUnitRandom(`status-format|trend|social|80|${493318 + index}`));
  const monotonicAscending = values.every((value, index) => index === 0 || value >= values[index - 1]);
  const monotonicDescending = values.every((value, index) => index === 0 || value <= values[index - 1]);
  assert.equal(monotonicAscending || monotonicDescending, false);
  assert.equal(new Set(values.map((value) => value.toFixed(6))).size >= 7, true);
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
