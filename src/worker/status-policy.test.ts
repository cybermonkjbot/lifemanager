import assert from "node:assert/strict";
import test from "node:test";
import {
  buildStatusInterestSearchQueries,
  STATUS_OUTREACH_MIN_GAP_MS,
  evaluateStatusOutreachLimit,
  extractStatusInterests,
  forceDeclarativeStatusText,
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

test("forceDeclarativeStatusText rewrites question-style statuses", () => {
  const rewritten = forceDeclarativeStatusText("Quick check: what's one win from your day?");
  assert.equal(/\?/.test(rewritten), false);
  assert.equal(/\b(what|why|when|where|who|how|which)\b/i.test(rewritten), false);
});

test("forceDeclarativeStatusText rewrites question-style statuses without question marks", () => {
  const rewritten = forceDeclarativeStatusText("How far today");
  assert.equal(/\?/.test(rewritten), false);
  assert.equal(/\b(what|why|when|where|who|how|which)\b/i.test(rewritten), false);
  assert.notEqual(rewritten, "How far today");
});

test("forceDeclarativeStatusText keeps declarative statuses unchanged", () => {
  const value = forceDeclarativeStatusText("Small wins are stacking up nicely.");
  assert.equal(value, "Small wins are stacking up nicely.");
});

test("isLikelyMarketingStatus flags status promotions with CTA", () => {
  const result = isLikelyMarketingStatus("Weekend offer: 20% off all cakes. DM to order now.");
  assert.equal(result, true);
});

test("isLikelyMarketingStatus ignores normal personal updates", () => {
  const result = isLikelyMarketingStatus("Gym done. Back home and cooking jollof now.");
  assert.equal(result, false);
});

test("extractStatusInterests picks concrete topics and drops generic filler", () => {
  const interests = extractStatusInterests("daily life, ai, bitcoin, motivation, social trends");
  assert.deepEqual(interests, ["ai", "bitcoin"]);
});

test("buildStatusInterestSearchQueries returns bounded interest-focused queries", () => {
  const plan = buildStatusInterestSearchQueries({
    trendTheme: "ai, bitcoin, football",
    demographicHint: "social",
    nowMs: new Date("2026-02-05T10:00:00.000Z").getTime(),
    maxQueries: 3,
  });

  assert.deepEqual(plan.interests, ["ai", "bitcoin", "football"]);
  assert.equal(plan.queries.length, 3);
  assert.match(plan.queries[0] || "", /2026/i);
  assert.match(plan.queries[0] || "", /ai/i);
});

test("buildStatusInterestSearchQueries falls back when theme is empty", () => {
  const plan = buildStatusInterestSearchQueries({
    trendTheme: "daily life, motivation, fun",
    demographicHint: "mixed",
    nowMs: new Date("2026-03-01T08:00:00.000Z").getTime(),
    maxQueries: 2,
  });

  assert.deepEqual(plan.interests, []);
  assert.equal(plan.queries.length, 2);
  assert.match(plan.queries[0] || "", /social and pop-culture trends/i);
});
