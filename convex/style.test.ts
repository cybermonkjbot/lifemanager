import assert from "node:assert/strict";
import test from "node:test";
import { extractReusablePhrases, normalizeCommonPhraseList } from "./style";

test("normalizeCommonPhraseList strict mode removes noisy glue fragments", () => {
  const cleaned = normalizeCommonPhraseList(
    [
      "honestly some people",
      "some people are",
      "people are living",
      "yard the confidence",
      "talking too neatly",
      "point the groove",
      "plausible deniability move",
    ],
    40,
    { strict: true },
  );

  assert.deepEqual(cleaned, ["plausible deniability move"]);
});

test("normalizeCommonPhraseList removes phrases contained by longer phrases", () => {
  const cleaned = normalizeCommonPhraseList(
    ["alpha bravo charlie delta", "bravo charlie delta", "alpha bravo charlie"],
    40,
    { strict: true },
  );

  assert.deepEqual(cleaned, ["alpha bravo charlie delta"]);
});

test("normalizeCommonPhraseList strict mode drops legacy sliding-window noise", () => {
  const cleaned = normalizeCommonPhraseList(
    [
      "honestly some people",
      "some people are",
      "people are living",
      "living groove yard",
      "groove yard the",
      "yard the confidence",
      "the confidence was",
      "groove yard",
      "people are",
    ],
    40,
    { strict: true },
  );

  assert.deepEqual(cleaned, []);
});

test("extractReusablePhrases keeps meaningful phrase candidates", () => {
  const phrases = extractReusablePhrases(
    "yakubu pro max energy today and yakubu pro max energy tomorrow with better rhythm",
  );

  assert.equal(phrases.includes("yakubu pro max"), true);
  assert.equal(phrases.includes("pro max energy"), true);
});
