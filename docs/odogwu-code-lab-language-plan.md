# ODOGWU HQ Programmable Life Rules

## Summary

Code Lab is a local-first programmable rules layer for ODOGWU HQ. It gives users a real editor and a small custom language for configuring life-management behavior without exposing JavaScript, shell access, network access, secrets, or filesystem access.

The language compiles into a safe JSON execution plan. Convex stores programs, versions, test results, and run logs. The local desktop worker executes only compiled plans through approved ODOGWU SDK operations.

## V1 Language Shape

```odogwu
program QuietHoursGuard version "1.0"

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
expect followups.created_count == 1
```

## Architecture

- `src/code-runtime/` owns parsing, validation, compilation, and fake-event test execution.
- `convex/code.ts` stores source, versions, test suites, and run history.
- `src/worker/code-executor.ts` accepts compiled plans only and records simulated/real execution steps.
- `/code` exposes the Code Lab editor, test runner, publish controls, SDK docs, diagnostics, and recent run history.

## Safety Model

- No arbitrary JavaScript evaluation.
- No direct network, filesystem, shell, or secret access.
- Only SDK modules listed by the registry can be imported with `use`.
- Only compiled operations from the registry can execute.
- Published programs require a passing test suite.
- Runtime actions are bounded by per-program limits and recorded as telemetry.

## Approved SDK Modules

- `chat`: inspect message and thread context.
- `ai`: set review/autopilot mode overlays and reply constraints.
- `followups`: create bounded reminders.
- `memory`: read or write bounded facts.
- `settings`: inspect safe runtime settings.
- `outreach`: trigger approved outreach flows.
- `runtime`: pause, resume, or inspect runtime state.

## Acceptance Criteria

- Users can create, edit, test, and publish a program from `/code`.
- Syntax diagnostics appear before saving or publishing.
- Test results persist in Convex.
- Published programs compile to a safe plan and never execute raw source.
- Worker execution emits `codeRuns`, `codeRunSteps`, `toolRuns`, and `systemEvents` records.
