import assert from "node:assert/strict";
import test from "node:test";
import {
  EMOJI_COOLDOWN_MS,
  applyEmojiCooldownPolicy,
  containsAnyEmoji,
  findRecentOutboundEmojiTimestamp,
  stripEmojiCharacters,
} from "./emoji-policy";

test("containsAnyEmoji detects pictographic and flag emoji", () => {
  assert.equal(containsAnyEmoji("Looks good"), false);
  assert.equal(containsAnyEmoji("Looks good 😀"), true);
  assert.equal(containsAnyEmoji("Nigeria 🇳🇬"), true);
});

test("stripEmojiCharacters removes emoji and compacts spacing", () => {
  const output = stripEmojiCharacters("Nice work 😀  keep going 🚀");
  assert.equal(output, "Nice work keep going");
});

test("findRecentOutboundEmojiTimestamp returns latest outbound emoji inside cooldown", () => {
  const nowMs = 1_000_000;
  const recent = findRecentOutboundEmojiTimestamp({
    nowMs,
    messages: [
      { direction: "outbound", text: "first 😀", messageAt: nowMs - 20_000 },
      { direction: "inbound", text: "reply 😄", messageAt: nowMs - 10_000 },
      { direction: "outbound", text: "second 🚀", messageAt: nowMs - 5_000 },
    ],
  });
  assert.equal(recent, nowMs - 5_000);
});

test("applyEmojiCooldownPolicy strips emoji when cooldown is active", () => {
  const nowMs = 2_000_000;
  const result = applyEmojiCooldownPolicy({
    nowMs,
    text: "All set 🙌",
    recentMessages: [{ direction: "outbound", text: "Earlier ✅", messageAt: nowMs - 1_000 }],
  });

  assert.equal(result.cooldownActive, true);
  assert.equal(result.emojiSuppressed, true);
  assert.equal(result.text, "All set");
  assert.equal(result.shouldRecordEmojiSend, false);
});

test("applyEmojiCooldownPolicy strips emoji even when cooldown window has passed", () => {
  const nowMs = 3_000_000;
  const result = applyEmojiCooldownPolicy({
    nowMs,
    text: "Great news 🎉",
    recentMessages: [{ direction: "outbound", text: "Old emoji 😄", messageAt: nowMs - EMOJI_COOLDOWN_MS - 5_000 }],
  });

  assert.equal(result.cooldownActive, false);
  assert.equal(result.emojiSuppressed, true);
  assert.equal(result.text, "Great news");
  assert.equal(result.shouldRecordEmojiSend, false);
});

test("applyEmojiCooldownPolicy can allow emoji text when explicitly enabled and cooldown is inactive", () => {
  const nowMs = 3_000_000;
  const result = applyEmojiCooldownPolicy({
    nowMs,
    text: "Great news 🎉",
    recentMessages: [{ direction: "outbound", text: "Old emoji 😄", messageAt: nowMs - EMOJI_COOLDOWN_MS - 5_000 }],
    allowEmojiInText: true,
  });

  assert.equal(result.cooldownActive, false);
  assert.equal(result.emojiSuppressed, false);
  assert.equal(result.text, "Great news 🎉");
  assert.equal(result.shouldRecordEmojiSend, true);
});

test("applyEmojiCooldownPolicy allows whitelisted emoji up to max messages in window", () => {
  const nowMs = 5_000_000;
  const result = applyEmojiCooldownPolicy({
    nowMs,
    text: "No worries 🌚",
    allowEmojiInText: true,
    allowedEmojiInText: ["🌚", "😒"],
    maxAllowedEmojiMessagesInWindow: 2,
    allowedEmojiWindowMs: 6 * 60 * 60 * 1000,
    recentMessages: [{ direction: "outbound", text: "Hmm 😒", messageAt: nowMs - 3_000 }],
  });

  assert.equal(result.emojiSuppressed, false);
  assert.equal(result.text, "No worries 🌚");
});

test("applyEmojiCooldownPolicy strips whitelisted emoji once max messages in window is reached", () => {
  const nowMs = 6_000_000;
  const result = applyEmojiCooldownPolicy({
    nowMs,
    text: "No worries 🌚",
    allowEmojiInText: true,
    allowedEmojiInText: ["🌚", "😒"],
    maxAllowedEmojiMessagesInWindow: 2,
    allowedEmojiWindowMs: 6 * 60 * 60 * 1000,
    recentMessages: [
      { direction: "outbound", text: "Hmm 😒", messageAt: nowMs - 7_000 },
      { direction: "outbound", text: "Okay 🌚", messageAt: nowMs - 2_000 },
    ],
  });

  assert.equal(result.emojiSuppressed, true);
  assert.equal(result.text, "No worries");
});

test("applyEmojiCooldownPolicy strips non-whitelisted emoji even when emoji text is enabled", () => {
  const nowMs = 7_000_000;
  const result = applyEmojiCooldownPolicy({
    nowMs,
    text: "Great news 🎉",
    allowEmojiInText: true,
    allowedEmojiInText: ["🌚", "😒"],
    maxAllowedEmojiMessagesInWindow: 2,
    allowedEmojiWindowMs: 6 * 60 * 60 * 1000,
  });

  assert.equal(result.emojiSuppressed, true);
  assert.equal(result.text, "Great news");
});

test("applyEmojiCooldownPolicy falls back when text becomes empty after stripping", () => {
  const nowMs = 4_000_000;
  const result = applyEmojiCooldownPolicy({
    nowMs,
    text: "😀😀",
    fallbackText: "Sounds good.",
    lastEmojiSentAtMs: nowMs - 2_000,
  });
  assert.equal(result.text, "Sounds good.");
  assert.equal(result.emojiSuppressed, true);
});
