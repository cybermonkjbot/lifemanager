import assert from "node:assert/strict";
import test from "node:test";
import {
  findNewestStaleInboundMessage,
  hasRecentManualIntervention,
  isManualInterventionMessage,
  resolveClaimOutreachMode,
  resolveOutboxClaimLeaseMs,
  resolveOutboxFreshnessReferenceAt,
} from "./outbox";

test("resolveOutboxFreshnessReferenceAt prefers latest outbox/draft/source-inbound timestamp", () => {
  const referenceAt = resolveOutboxFreshnessReferenceAt({
    outboxCreatedAt: 1_000,
    draftUpdatedAt: 3_000,
    sourceMessageDirection: "inbound",
    sourceMessageAt: 2_500,
  });
  assert.equal(referenceAt, 3_000);

  const sourceInboundWins = resolveOutboxFreshnessReferenceAt({
    outboxCreatedAt: 1_000,
    draftUpdatedAt: 1_500,
    sourceMessageDirection: "inbound",
    sourceMessageAt: 4_000,
  });
  assert.equal(sourceInboundWins, 4_000);

  const outboundSourceIgnored = resolveOutboxFreshnessReferenceAt({
    outboxCreatedAt: 2_000,
    draftUpdatedAt: 2_500,
    sourceMessageDirection: "outbound",
    sourceMessageAt: 8_000,
  });
  assert.equal(outboundSourceIgnored, 2_500);
});

test("findNewestStaleInboundMessage ignores outbound/status/reaction traffic", () => {
  const stale = findNewestStaleInboundMessage({
    referenceAt: 10_000,
    graceMs: 1_000,
    recentMessages: [
      {
        direction: "outbound",
        messageAt: 15_000,
        messageType: "text",
        text: "Outbound note",
      },
      {
        direction: "inbound",
        messageAt: 16_000,
        messageType: "reaction",
        text: "👍",
      },
      {
        direction: "inbound",
        messageAt: 17_000,
        messageType: "text",
        isStatus: true,
        text: "Status update",
      },
      {
        direction: "inbound",
        messageAt: 18_000,
        messageType: "text",
        text: "Are you there?",
      },
    ],
  });

  assert.equal(stale?.messageAt, 18_000);
});

test("findNewestStaleInboundMessage respects freshness grace window", () => {
  const stale = findNewestStaleInboundMessage({
    referenceAt: 20_000,
    graceMs: 5_000,
    recentMessages: [
      {
        direction: "inbound",
        messageAt: 24_500,
        messageType: "text",
        text: "Within grace window",
      },
      {
        direction: "inbound",
        messageAt: 25_001,
        messageType: "text",
        text: "Beyond grace window",
      },
    ],
  });

  assert.equal(stale?.messageAt, 25_001);
});

test("resolveClaimOutreachMode derives mode from draft reason prefix", () => {
  assert.equal(
    resolveClaimOutreachMode("Adaptive good morning protocol (AI pending): mode=lead; variant=1"),
    "good_morning",
  );
  assert.equal(
    resolveClaimOutreachMode("Proactive check-in outreach (AI pending): hey there"),
    "proactive",
  );
  assert.equal(
    resolveClaimOutreachMode("Random appreciation outreach (AI pending): you look amazing today"),
    "compliment",
  );
  assert.equal(resolveClaimOutreachMode("Some other reason"), undefined);
});

test("resolveClaimOutreachMode prefers explicit outreachMode and falls back to reason parsing", () => {
  assert.equal(
    resolveClaimOutreachMode({
      outreachMode: "compliment",
      reason: "Proactive check-in outreach (AI pending): hey there",
    }),
    "compliment",
  );
  assert.equal(
    resolveClaimOutreachMode({
      outreachMode: undefined,
      reason: "Proactive check-in outreach (AI pending): hey there",
    }),
    "proactive",
  );
});

test("resolveOutboxClaimLeaseMs extends status posts beyond the default lease", () => {
  assert.equal(resolveOutboxClaimLeaseMs({ baseLeaseMs: 45_000 }), 45_000);
  assert.equal(resolveOutboxClaimLeaseMs({ isStatusPost: true, baseLeaseMs: 45_000 }), 10 * 60 * 1000);
  assert.equal(resolveOutboxClaimLeaseMs({ isStatusPost: true, baseLeaseMs: 12 * 60 * 1000 }), 10 * 60 * 1000);
});

test("isManualInterventionMessage detects live outbound without toolRunId", () => {
  assert.equal(
    isManualInterventionMessage({
      direction: "outbound",
      origin: "live",
      toolRunId: undefined,
      messageAt: 10_000,
    }),
    true,
  );
});

test("isManualInterventionMessage ignores automated outbound with toolRunId", () => {
  assert.equal(
    isManualInterventionMessage({
      direction: "outbound",
      origin: "live",
      toolRunId: "outbox:abc123",
      messageAt: 10_000,
    }),
    false,
  );
});

test("hasRecentManualIntervention only returns true inside cooldown window", () => {
  const nowMs = 50_000;
  const cooldownMs = 20_000;

  const active = hasRecentManualIntervention({
    nowMs,
    cooldownMs,
    recentMessages: [
      {
        direction: "outbound",
        origin: "live",
        toolRunId: undefined,
        messageAt: 33_000,
      },
    ],
  });
  assert.equal(active, true);

  const expired = hasRecentManualIntervention({
    nowMs,
    cooldownMs,
    recentMessages: [
      {
        direction: "outbound",
        origin: "live",
        toolRunId: undefined,
        messageAt: 20_000,
      },
    ],
  });
  assert.equal(expired, false);
});
