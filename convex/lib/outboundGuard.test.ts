import assert from "node:assert/strict";
import test from "node:test";
import {
  countUnansweredOutboundStreak,
  latestInboundMessageAt,
  MAX_LONG_SILENCE_REOPEN_WEEKS,
  MAX_UNANSWERED_OUTBOUND_STREAK,
  MIN_LONG_SILENCE_REOPEN_WEEKS,
  resolveGhostingSeverity,
  resolveLongSilenceReopenMs,
  resolveLongSilenceReopenWeeks,
  shouldAllowLongSilenceConversationStarter,
} from "./outboundGuard";

test("countUnansweredOutboundStreak counts outbound messages until first inbound", () => {
  const streak = countUnansweredOutboundStreak([
    { direction: "outbound" },
    { direction: "outbound" },
    { direction: "inbound" },
    { direction: "outbound" },
  ]);

  assert.equal(streak, 2);
  assert.equal(MAX_UNANSWERED_OUTBOUND_STREAK, 2);
});

test("countUnansweredOutboundStreak returns zero when latest message is inbound", () => {
  const streak = countUnansweredOutboundStreak([
    { direction: "inbound" },
    { direction: "outbound" },
    { direction: "outbound" },
  ]);

  assert.equal(streak, 0);
});

test("countUnansweredOutboundStreak handles outbound-only windows", () => {
  const streak = countUnansweredOutboundStreak([
    { direction: "outbound" },
    { direction: "outbound" },
    { direction: "outbound" },
  ]);

  assert.equal(streak, 3);
});

test("latestInboundMessageAt returns newest inbound timestamp", () => {
  const at = latestInboundMessageAt([
    { direction: "outbound", messageAt: 7_000 },
    { direction: "outbound", messageAt: 6_000 },
    { direction: "inbound", messageAt: 5_000 },
    { direction: "inbound", messageAt: 1_000 },
  ]);

  assert.equal(at, 5_000);
});

test("shouldAllowLongSilenceConversationStarter allows outreach starter after long silence", () => {
  const unlockMs = resolveLongSilenceReopenMs(2);
  const nowMs = unlockMs + 10_000_000;
  const allowed = shouldAllowLongSilenceConversationStarter({
    unansweredStreak: 2,
    latestInboundAt: nowMs - unlockMs - 1_000,
    nowMs,
    isConversationStarter: true,
  });

  assert.equal(allowed, true);
});

test("shouldAllowLongSilenceConversationStarter blocks non-starters and short silence", () => {
  const unlockMs = resolveLongSilenceReopenMs(2);
  const nowMs = unlockMs + 10_000_000;
  const nonStarter = shouldAllowLongSilenceConversationStarter({
    unansweredStreak: 2,
    latestInboundAt: nowMs - unlockMs - 1_000,
    nowMs,
    isConversationStarter: false,
  });
  const shortSilence = shouldAllowLongSilenceConversationStarter({
    unansweredStreak: 2,
    latestInboundAt: nowMs - unlockMs + 60_000,
    nowMs,
    isConversationStarter: true,
  });

  assert.equal(nonStarter, false);
  assert.equal(shortSilence, false);
});

test("resolveLongSilenceReopenWeeks scales from 1 to 7 weeks", () => {
  assert.equal(resolveLongSilenceReopenWeeks(2), MIN_LONG_SILENCE_REOPEN_WEEKS);
  assert.equal(resolveLongSilenceReopenWeeks(3), 2);
  assert.equal(resolveLongSilenceReopenWeeks(8), MAX_LONG_SILENCE_REOPEN_WEEKS);
  assert.equal(resolveLongSilenceReopenWeeks(99), MAX_LONG_SILENCE_REOPEN_WEEKS);
});

test("resolveGhostingSeverity reflects unanswered streak and silence age", () => {
  const mild = resolveGhostingSeverity({
    unansweredStreak: 2,
    elapsedSilenceMs: 2 * 7 * 24 * 60 * 60 * 1000,
  });
  const moderate = resolveGhostingSeverity({
    unansweredStreak: 3,
    elapsedSilenceMs: 3 * 7 * 24 * 60 * 60 * 1000,
  });
  const severeBySilence = resolveGhostingSeverity({
    unansweredStreak: 2,
    elapsedSilenceMs: 11 * 7 * 24 * 60 * 60 * 1000,
  });

  assert.equal(mild, "mild");
  assert.equal(moderate, "moderate");
  assert.equal(severeBySilence, "severe");
});
