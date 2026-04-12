import assert from "node:assert/strict";
import test from "node:test";
import {
  extractAliasesFromText,
  hasGoodActiveChattingWindow,
  shouldEnterGhostMode,
  shouldResetRomanceMorningNoReplyState,
} from "./inbound";
import {
  classifyThreadKind,
  directIgnoreContactKey,
  directIgnoreRuleCandidates,
  resolveThreadEligibility,
} from "./lib/threadEligibility";

test("extractAliasesFromText finds nickname patterns", () => {
  const aliases = extractAliasesFromText("Hey it's Josh, call me jay.");
  assert.deepEqual(aliases, ["Josh", "jay"]);
});

test("extractAliasesFromText ignores text without alias cues", () => {
  const aliases = extractAliasesFromText("Let's meet later today.");
  assert.deepEqual(aliases, []);
});

test("classifyThreadKind detects broadcast/system JIDs", () => {
  assert.equal(classifyThreadKind({ jid: "status@broadcast" }), "broadcast_or_system");
  assert.equal(classifyThreadKind({ jid: "ig:story:broadcast", provider: "instagram" }), "broadcast_or_system");
  assert.equal(classifyThreadKind({ jid: "12345@g.us" }), "group");
  assert.equal(classifyThreadKind({ jid: "5551999999999@s.whatsapp.net" }), "direct");
});

test("directIgnoreRuleCandidates normalizes direct WhatsApp JID aliases", () => {
  const candidates = directIgnoreRuleCandidates({
    jid: "5551234567:12@s.whatsapp.net",
  });
  assert.deepEqual(candidates, [
    "5551234567:12@s.whatsapp.net",
    "5551234567@s.whatsapp.net",
    "5551234567@lid",
  ]);
});

test("directIgnoreContactKey matches account-level contact key for direct WhatsApp aliases", () => {
  const phoneNetKey = directIgnoreContactKey({ jid: "5551234567:2@s.whatsapp.net" });
  const lidKey = directIgnoreContactKey({ jid: "5551234567@lid" });
  assert.equal(phoneNetKey, "5551234567");
  assert.equal(lidKey, "5551234567");
});

test("resolveThreadEligibility gives archived precedence", () => {
  const eligibility = resolveThreadEligibility({
    thread: {
      jid: "5551999999999@s.whatsapp.net",
      isIgnored: false,
      isArchived: true,
      threadKind: "direct",
    },
    ignoreGroupsByDefault: true,
    explicitIgnoreEnabled: true,
  });
  assert.deepEqual(eligibility, {
    allowed: false,
    reason: "archived",
  });
});

test("resolveThreadEligibility keeps group ignore dynamic", () => {
  const blocked = resolveThreadEligibility({
    thread: {
      jid: "12345@g.us",
      isIgnored: true,
      isArchived: false,
      threadKind: "group",
    },
    ignoreGroupsByDefault: true,
    explicitIgnoreEnabled: false,
  });
  assert.deepEqual(blocked, {
    allowed: false,
    reason: "group_ignored",
  });

  const allowedByExplicitGroupRule = resolveThreadEligibility({
    thread: {
      jid: "12345@g.us",
      isIgnored: true,
      isArchived: false,
      threadKind: "group",
    },
    ignoreGroupsByDefault: true,
    explicitIgnoreEnabled: false,
    groupRuleEnabled: false,
  });
  assert.deepEqual(allowedByExplicitGroupRule, {
    allowed: true,
  });

  const allowed = resolveThreadEligibility({
    thread: {
      jid: "12345@g.us",
      isIgnored: true,
      isArchived: false,
      threadKind: "group",
    },
    ignoreGroupsByDefault: false,
    explicitIgnoreEnabled: false,
  });
  assert.deepEqual(allowed, {
    allowed: true,
  });
});

test("resolveThreadEligibility blocks while temporary ghost window is active", () => {
  const blocked = resolveThreadEligibility({
    thread: {
      jid: "5551999999999@s.whatsapp.net",
      isIgnored: false,
      isArchived: false,
      threadKind: "direct",
      ghostedUntil: 10_000,
    },
    ignoreGroupsByDefault: true,
    explicitIgnoreEnabled: false,
    nowMs: 9_000,
  });
  assert.deepEqual(blocked, {
    allowed: false,
    reason: "temporary_ghost",
  });

  const allowed = resolveThreadEligibility({
    thread: {
      jid: "5551999999999@s.whatsapp.net",
      isIgnored: false,
      isArchived: false,
      threadKind: "direct",
      ghostedUntil: 10_000,
    },
    ignoreGroupsByDefault: true,
    explicitIgnoreEnabled: false,
    nowMs: 10_001,
  });
  assert.deepEqual(allowed, {
    allowed: true,
  });
});

test("hasGoodActiveChattingWindow detects balanced back-and-forth activity", () => {
  const messages = [
    { direction: "inbound" as const, messageAt: 1_000 },
    { direction: "outbound" as const, messageAt: 2_000 },
    { direction: "inbound" as const, messageAt: 3_000 },
    { direction: "outbound" as const, messageAt: 4_000 },
    { direction: "inbound" as const, messageAt: 5_000 },
    { direction: "outbound" as const, messageAt: 6_000 },
    { direction: "inbound" as const, messageAt: 7_000 },
  ];
  assert.equal(hasGoodActiveChattingWindow(messages), true);
});

test("shouldEnterGhostMode uses probability once active chatting threshold is met", () => {
  const messages = [
    { direction: "inbound" as const, messageAt: 1_000 },
    { direction: "outbound" as const, messageAt: 2_000 },
    { direction: "inbound" as const, messageAt: 3_000 },
    { direction: "outbound" as const, messageAt: 4_000 },
    { direction: "inbound" as const, messageAt: 5_000 },
    { direction: "outbound" as const, messageAt: 6_000 },
    { direction: "inbound" as const, messageAt: 7_000 },
  ];

  assert.equal(
    shouldEnterGhostMode({
      messages,
      randomValue: 0.19,
    }),
    true,
  );
  assert.equal(
    shouldEnterGhostMode({
      messages,
      randomValue: 0.21,
    }),
    false,
  );
});

test("shouldResetRomanceMorningNoReplyState only resets on inbound after last send", () => {
  assert.equal(
    shouldResetRomanceMorningNoReplyState({
      state: {
        lastSentAt: 10_000,
        lastInboundAfterSendAt: undefined,
        noReplyStreak: 2,
      },
      inboundMessageAt: 12_000,
    }),
    true,
  );

  assert.equal(
    shouldResetRomanceMorningNoReplyState({
      state: {
        lastSentAt: 10_000,
        lastInboundAfterSendAt: 12_000,
        noReplyStreak: 0,
      },
      inboundMessageAt: 11_000,
    }),
    false,
  );

  assert.equal(
    shouldResetRomanceMorningNoReplyState({
      state: null,
      inboundMessageAt: 12_000,
    }),
    false,
  );
});
