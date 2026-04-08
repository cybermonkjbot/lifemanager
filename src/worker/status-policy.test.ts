import assert from "node:assert/strict";
import test from "node:test";
import {
  STATUS_OUTREACH_MIN_GAP_MS,
  evaluateStatusOutreachLimit,
  isLikelyMarketingStatus,
  pickLaughReactionEmoji,
  shouldUseLaughReactionOnly,
} from "./status-policy";

test("evaluateStatusOutreachLimit blocks after two outbound messages in rolling day", () => {
  const now = Date.now();
  const result = evaluateStatusOutreachLimit({
    nowMs: now,
    messages: [
      { direction: "outbound", messageAt: now - 2 * 60 * 60 * 1000 },
      { direction: "inbound", messageAt: now - 90 * 60 * 1000 },
      { direction: "outbound", messageAt: now - 10 * 60 * 1000 },
    ],
  });

  assert.equal(result.allowed, false);
  assert.equal(result.reason, "daily_limit");
  assert.equal(result.outboundInWindow, 2);
});

test("evaluateStatusOutreachLimit blocks messages that are too close together", () => {
  const now = Date.now();
  const result = evaluateStatusOutreachLimit({
    nowMs: now,
    messages: [{ direction: "outbound", messageAt: now - 20 * 60 * 1000 }],
  });

  assert.equal(result.allowed, false);
  assert.equal(result.reason, "too_soon");
  assert.ok((result.waitMs || 0) > 0);
  assert.ok((result.waitMs || 0) <= STATUS_OUTREACH_MIN_GAP_MS);
});

test("evaluateStatusOutreachLimit allows when below cap and outside min gap", () => {
  const now = Date.now();
  const result = evaluateStatusOutreachLimit({
    nowMs: now,
    messages: [{ direction: "outbound", messageAt: now - STATUS_OUTREACH_MIN_GAP_MS - 5_000 }],
  });

  assert.equal(result.allowed, true);
  assert.equal(result.outboundInWindow, 1);
});

test("pickLaughReactionEmoji prefers laugh emoji present in text", () => {
  const emoji = pickLaughReactionEmoji("that was wild 🤣", ["😄", "😂"]);
  assert.equal(emoji, "🤣");
});

test("shouldUseLaughReactionOnly avoids question-like statuses", () => {
  const result = shouldUseLaughReactionOnly({
    text: "lol this was funny, what do you think?",
    hasFunnySignal: true,
    hasInterestSignal: false,
    messageAt: 1_234_567_890,
  });

  assert.equal(result, false);
});

test("shouldUseLaughReactionOnly is stable for same input", () => {
  const args = {
    text: "this meme is too funny 😂",
    hasFunnySignal: true,
    hasInterestSignal: false,
    messageAt: 1_700_000_000_000,
  };

  const first = shouldUseLaughReactionOnly(args);
  const second = shouldUseLaughReactionOnly(args);
  assert.equal(first, second);
});

test("isLikelyMarketingStatus flags status promotions with CTA", () => {
  const result = isLikelyMarketingStatus("Weekend offer: 20% off all cakes. DM to order now.");
  assert.equal(result, true);
});

test("isLikelyMarketingStatus ignores normal personal updates", () => {
  const result = isLikelyMarketingStatus("Gym done. Back home and cooking jollof now.");
  assert.equal(result, false);
});
