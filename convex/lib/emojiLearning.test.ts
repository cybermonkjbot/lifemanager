import assert from "node:assert/strict";
import test from "node:test";
import {
  applyEmojiUsageSignal,
  createEmptyLearnedEmojiProfile,
  extractEmojiTokens,
  parseLearnedEmojiProfile,
} from "./emojiLearning";

test("extractEmojiTokens pulls emoji clusters from text", () => {
  const tokens = extractEmojiTokens("All good 😂🔥 no wahala 🌚");
  assert.deepEqual(tokens, ["😂", "🔥", "🌚"]);
});

test("parseLearnedEmojiProfile falls back safely for malformed JSON", () => {
  const parsed = parseLearnedEmojiProfile("{not-json");
  assert.equal(parsed.version, 1);
  assert.equal(parsed.topEmojis.length, 0);
  assert.equal(parsed.categoryHints.length, 0);
});

test("applyEmojiUsageSignal increments stats and derives top emojis", () => {
  const base = createEmptyLearnedEmojiProfile(1000);
  const next = applyEmojiUsageSignal(base, {
    texts: ["This is funny 😂😂 and fire 🔥"],
    messageAt: 2000,
  });

  assert.equal(next.totalEmojiMessages, 1);
  assert.equal(next.totalEmojiObservations, 3);
  assert.equal(next.topEmojis[0], "😂");
  assert.ok(next.categoryHints.some((hint) => /Humor/i.test(hint)));
});

test("applyEmojiUsageSignal tracks reaction emoji too", () => {
  const base = createEmptyLearnedEmojiProfile(1000);
  const next = applyEmojiUsageSignal(base, {
    texts: ["Noted."],
    reactionEmoji: "🙏",
    messageAt: 3000,
  });

  assert.equal(next.totalEmojiMessages, 1);
  assert.equal(next.totalEmojiObservations, 1);
  assert.equal(next.topEmojis[0], "🙏");
  assert.ok(next.categoryHints.some((hint) => /Gratitude/i.test(hint)));
});
