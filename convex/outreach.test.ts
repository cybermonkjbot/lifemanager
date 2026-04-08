import assert from "node:assert/strict";
import test from "node:test";
import { shouldPauseOutreachForQuietHours } from "./outreach";

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
