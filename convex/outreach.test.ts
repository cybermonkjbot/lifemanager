import assert from "node:assert/strict";
import test from "node:test";
import type { Id } from "./_generated/dataModel";
import {
  compareOutreachPriority,
  hasRecentComplimentDraft,
  shouldPauseOutreachForQuietHours,
  shouldQueueRandomCompliment,
} from "./outreach";

test("shouldPauseOutreachForQuietHours respects quiet-hours toggle", () => {
  const paused = shouldPauseOutreachForQuietHours({
    quietHoursEnabled: true,
    nowHour: 1,
    quietHoursStartHour: 23,
    quietHoursEndHour: 7,
  });
  assert.equal(paused, true);

  const notPausedWhenDisabled = shouldPauseOutreachForQuietHours({
    quietHoursEnabled: false,
    nowHour: 1,
    quietHoursStartHour: 23,
    quietHoursEndHour: 7,
  });
  assert.equal(notPausedWhenDisabled, false);
});

test("shouldPauseOutreachForQuietHours handles daytime windows", () => {
  const paused = shouldPauseOutreachForQuietHours({
    quietHoursEnabled: true,
    nowHour: 13,
    quietHoursStartHour: 9,
    quietHoursEndHour: 17,
  });
  assert.equal(paused, true);

  const notPaused = shouldPauseOutreachForQuietHours({
    quietHoursEnabled: true,
    nowHour: 18,
    quietHoursStartHour: 9,
    quietHoursEndHour: 17,
  });
  assert.equal(notPaused, false);
});

test("hasRecentComplimentDraft checks prefix and cooldown", () => {
  const now = 10 * 24 * 60 * 60 * 1000;
  const recent = hasRecentComplimentDraft({
    now,
    drafts: [
      {
        reason: "Random appreciation outreach (AI pending): beautiful soul",
        createdAt: now - 2 * 24 * 60 * 60 * 1000,
      },
    ],
  });
  const stale = hasRecentComplimentDraft({
    now,
    drafts: [
      {
        reason: "Random appreciation outreach (AI pending): beautiful soul",
        createdAt: now - 7 * 24 * 60 * 60 * 1000,
      },
    ],
  });
  const wrongPrefix = hasRecentComplimentDraft({
    now,
    drafts: [
      {
        reason: "Proactive check-in outreach (AI pending): hey there",
        createdAt: now - 2 * 24 * 60 * 60 * 1000,
      },
    ],
  });

  assert.equal(recent, true);
  assert.equal(stale, false);
  assert.equal(wrongPrefix, false);
});

test("shouldQueueRandomCompliment is deterministic and respects cooldown gate", () => {
  const threadId = "threads_abc123" as Id<"threads">;
  const first = shouldQueueRandomCompliment({
    threadId,
    cadenceBucket: 456,
    hasRecentCompliment: false,
  });
  const second = shouldQueueRandomCompliment({
    threadId,
    cadenceBucket: 456,
    hasRecentCompliment: false,
  });
  const blocked = shouldQueueRandomCompliment({
    threadId,
    cadenceBucket: 456,
    hasRecentCompliment: true,
  });

  assert.equal(first, second);
  assert.equal(blocked, false);
});

test("compareOutreachPriority prioritizes threads with due or missing mutual check-ins", () => {
  const dueMissing = {
    jid: "a@s.whatsapp.net",
    lastActivityAt: 200,
    lastMutualCheckInAt: undefined,
    mutualCheckInDue: true,
  };
  const notDueRecent = {
    jid: "b@s.whatsapp.net",
    lastActivityAt: 10,
    lastMutualCheckInAt: 900,
    mutualCheckInDue: false,
  };
  const result = compareOutreachPriority({
    left: dueMissing,
    right: notDueRecent,
  });
  assert.equal(result < 0, true);
});

test("compareOutreachPriority breaks ties by older mutual check-in then older activity", () => {
  const olderMutual = {
    jid: "a@s.whatsapp.net",
    lastActivityAt: 900,
    lastMutualCheckInAt: 100,
    mutualCheckInDue: true,
  };
  const newerMutual = {
    jid: "b@s.whatsapp.net",
    lastActivityAt: 100,
    lastMutualCheckInAt: 300,
    mutualCheckInDue: true,
  };
  assert.equal(compareOutreachPriority({ left: olderMutual, right: newerMutual }) < 0, true);

  const equalMutualOlderActivity = {
    jid: "c@s.whatsapp.net",
    lastActivityAt: 50,
    lastMutualCheckInAt: 300,
    mutualCheckInDue: true,
  };
  assert.equal(compareOutreachPriority({ left: equalMutualOlderActivity, right: newerMutual }) < 0, true);
});
