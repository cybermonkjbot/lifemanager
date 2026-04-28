import assert from "node:assert/strict";
import test from "node:test";
import { compileCodeProgram } from "../code-runtime";
import { executeCompiledCodeProgram } from "./code-executor";

test("executeCompiledCodeProgram runs matching compiled operations only", async () => {
  const source = `program QuietHoursGuard version "1.0"
use ai
on message.received as msg
when msg.thread.kind == "direct"
  and time.now between "22:30" and "07:00"
do
  ai.set_mode("review_first")
end
test "night"
given message.received {
  thread.kind: "direct",
  at: "2026-04-28T23:10:00+01:00"
}
expect ai.mode == "review_first"`;
  const compiled = compileCodeProgram(source);
  assert.ok(compiled.plan);

  const result = await executeCompiledCodeProgram(compiled.plan, {
    name: "message.received",
    payload: { thread: { kind: "direct" }, at: "2026-04-28T23:10:00+01:00" },
  });

  assert.equal(result.status, "success");
  assert.equal(result.steps[0]?.toolName, "ai.set_mode");
});
