import assert from "node:assert/strict";
import test from "node:test";
import { compileCodeProgram, runCodeTests } from "./index";

const sample = `program QuietHoursGuard version "1.0"

use chat
use ai
use followups
use memory

on message.received as msg
when msg.thread.kind == "direct"
  and time.now between "22:30" and "07:00"
do
  ai.set_mode("review_first")
  followups.create(
    title: "Reply after quiet hours",
    thread: msg.thread,
    due: time.tomorrow_at("08:30")
  )
end

test "does not auto-reply at night"
given message.received {
  text: "You up?",
  thread.kind: "direct",
  at: "2026-04-28T23:10:00+01:00"
}
expect ai.mode == "review_first"
expect followups.created_count == 1`;

test("compileCodeProgram compiles the sample DSL into a safe plan", () => {
  const result = compileCodeProgram(sample);
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.plan?.name, "QuietHoursGuard");
  assert.equal(result.plan?.handlers[0]?.operations[0]?.module, "ai");
  assert.equal(result.plan?.handlers[0]?.operations[1]?.module, "followups");
});

test("runCodeTests executes fake events without evaluating raw code", () => {
  const result = runCodeTests(sample);
  assert.equal(result.passed, true, JSON.stringify(result, null, 2));
  assert.equal(result.tests[0]?.operations.length, 2);
});

test("compileCodeProgram rejects unknown SDK modules and operations", () => {
  const result = compileCodeProgram(`program BadRule version "1.0"
use fs
on message.received as msg
do
  fs.read("/etc/passwd")
end
test "x"
given message.received {
  text: "hi"
}
expect ai.mode == "review_first"`);

  assert.equal(result.plan, null);
  assert.ok(result.diagnostics.some((item) => item.message.includes("Unknown SDK module")));
});

test("compileCodeProgram rejects unimported approved SDK calls", () => {
  const result = compileCodeProgram(`program MissingUse version "1.0"
use ai
on message.received as msg
do
  followups.create(title: "x", thread: msg.thread, due: "tomorrow")
end
test "x"
given message.received {
  text: "hi"
}
expect followups.created_count == 1`);

  assert.equal(result.plan, null);
  assert.ok(result.diagnostics.some((item) => item.message.includes("use followups")));
});
