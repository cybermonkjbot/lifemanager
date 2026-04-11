import assert from "node:assert/strict";
import test from "node:test";
import {
  countQueuedMorningDraftsToday,
  hasConversationStarterCollision,
  hasPendingOrClaimedOutbox,
  hasReachedMorningDraftLimit,
  isMorningHoldoutThread,
  mergeUniqueThreadIds,
} from "./romanceProtocol";
import { GOOD_MORNING_OUTREACH_REASON_PREFIX, PROACTIVE_OUTREACH_REASON_PREFIX } from "./lib/outreachModes";
import {
  isIgnoredMorningPauseActive,
  isSuccessfulLeadPlanCooldownActive,
  isWithinHourWindow,
  resolvePlanSuggestionCooldownMs,
  resolveIgnoredMorningPauseMs,
  shouldSendIgnoredMorningBoundaryReopen,
  selectAdaptiveRomanceMorningMode,
  selectRomanceMorningMode,
} from "../shared/romance-morning";

test("mergeUniqueThreadIds returns union with de-dupe and trim", () => {
  const merged = mergeUniqueThreadIds([
    ["thread-a", " thread-b ", ""],
    ["thread-b", "thread-c"],
    ["thread-a"],
  ]);
  assert.deepEqual(merged, ["thread-a", "thread-b", "thread-c"]);
});

test("isWithinHourWindow enforces morning boundary [start, end)", () => {
  assert.equal(isWithinHourWindow(6, 6, 10), true);
  assert.equal(isWithinHourWindow(9, 6, 10), true);
  assert.equal(isWithinHourWindow(10, 6, 10), false);
  assert.equal(isWithinHourWindow(5, 6, 10), false);
});

test("selectRomanceMorningMode is deterministic with approximately 70% lead ratio", () => {
  const first = selectRomanceMorningMode({
    seed: "thread-42|2026-04-11",
    leadRatio: 0.7,
  });
  const second = selectRomanceMorningMode({
    seed: "thread-42|2026-04-11",
    leadRatio: 0.7,
  });
  assert.equal(first, second);

  let leadCount = 0;
  for (let index = 0; index < 1000; index += 1) {
    const mode = selectRomanceMorningMode({
      seed: `thread-${index}`,
      leadRatio: 0.7,
    });
    if (mode === "lead") {
      leadCount += 1;
    }
  }
  assert.ok(leadCount > 620 && leadCount < 780);
});

test("skip helpers cover queued-today limit, pending outbox, and collision cooldown", () => {
  const now = Date.now();
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const dayStartMs = dayStart.getTime();

  const drafts = [
    {
      reason: `${GOOD_MORNING_OUTREACH_REASON_PREFIX} (AI pending): mode=lead`,
      createdAt: dayStartMs + 30 * 60 * 1000,
    },
    {
      reason: `${PROACTIVE_OUTREACH_REASON_PREFIX} (AI pending): quick check-in`,
      createdAt: now - 2 * 60 * 60 * 1000,
    },
  ];

  assert.equal(countQueuedMorningDraftsToday(drafts, dayStartMs), 1);
  assert.equal(hasReachedMorningDraftLimit(drafts, dayStartMs, 1), true);
  assert.equal(hasReachedMorningDraftLimit(drafts, dayStartMs, 2), false);

  assert.equal(
    hasPendingOrClaimedOutbox([
      { status: "pending" },
      { status: "sent" },
    ]),
    true,
  );
  assert.equal(
    hasPendingOrClaimedOutbox([
      { status: "sent" },
      { status: "failed" },
    ]),
    false,
  );

  const collision = hasConversationStarterCollision(drafts, now, 3 * 60 * 60 * 1000);
  assert.equal(collision, true);
});

test("isMorningHoldoutThread is deterministic and near 10 percent", () => {
  const sampleA = isMorningHoldoutThread({
    threadId: "thread-17",
    dayBucket: "2026-04-11",
  });
  const sampleB = isMorningHoldoutThread({
    threadId: "thread-17",
    dayBucket: "2026-04-11",
  });
  assert.equal(sampleA, sampleB);

  let holdoutCount = 0;
  for (let index = 0; index < 1000; index += 1) {
    if (
      isMorningHoldoutThread({
        threadId: `thread-${index}`,
        dayBucket: "2026-04-11",
      })
    ) {
      holdoutCount += 1;
    }
  }
  assert.ok(holdoutCount > 60 && holdoutCount < 140);
});

test("successful lead-plan completion enforces 1-2 day warm cooldown", () => {
  const threadId = "thread-cooldown";
  const now = Date.now();
  const cooldownMs = resolvePlanSuggestionCooldownMs({ threadId });

  const withinCooldown = isSuccessfulLeadPlanCooldownActive({
    threadId,
    now,
    lastMode: "lead",
    lastSentAt: now - Math.min(cooldownMs - 1, 12 * 60 * 60 * 1000),
    lastInboundAfterSendAt: now - Math.min(cooldownMs - 1, 6 * 60 * 60 * 1000),
  });
  assert.equal(withinCooldown, true);

  const outsideCooldown = isSuccessfulLeadPlanCooldownActive({
    threadId,
    now,
    lastMode: "lead",
    lastSentAt: now - cooldownMs - 1,
    lastInboundAfterSendAt: now - cooldownMs + 30_000,
  });
  assert.equal(outsideCooldown, false);
});

test("selectAdaptiveRomanceMorningMode downgrades lead to warm during cooldown", () => {
  const now = Date.now();
  const mode = selectAdaptiveRomanceMorningMode({
    threadId: "thread-force-warm",
    seed: "thread-force-warm|seed",
    leadRatio: 1,
    now,
    lastMode: "lead",
    noReplyStreak: 0,
    lastSentAt: now - 2 * 60 * 60 * 1000,
    lastInboundAfterSendAt: now - 60 * 60 * 1000,
  });
  assert.equal(mode, "warm");
});

test("ignored-morning pause is active for 3 days without inbound reply", () => {
  const now = Date.now();
  const pauseMs = resolveIgnoredMorningPauseMs(3);

  assert.equal(
    isIgnoredMorningPauseActive({
      now,
      noReplyStreak: 1,
      lastSentAt: now - 2 * 24 * 60 * 60 * 1000,
      lastInboundAfterSendAt: undefined,
    }),
    true,
  );

  assert.equal(
    isIgnoredMorningPauseActive({
      now,
      noReplyStreak: 1,
      lastSentAt: now - 2 * 24 * 60 * 60 * 1000,
      lastInboundAfterSendAt: now - 24 * 60 * 60 * 1000,
    }),
    false,
  );

  assert.equal(
    shouldSendIgnoredMorningBoundaryReopen({
      now,
      noReplyStreak: 1,
      lastSentAt: now - pauseMs - 10_000,
      lastInboundAfterSendAt: undefined,
    }),
    true,
  );
});
