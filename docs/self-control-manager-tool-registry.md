# Self-Control Manager Tool Registry

This document defines the in-system tools available to the WhatsApp self-chat manager planner.

## Tools

| Tool | Purpose | Args shape | Notes |
|---|---|---|---|
| `runtime_command` | Control app/worker runtime state from self chat. | `{ "command": "pause worker\|resume worker\|restart worker\|status worker\|..." }` | Parsed via existing runtime command grammar. |
| `openclaw_forward` | Delegate unstructured tasks to OpenClaw. | `{ "input": "task for OpenClaw" }` | Runs async; user gets queued + completion reply. |
| `openclaw_status` | Check OpenClaw CLI readiness. | `{}` | Fast probe command. |
| `codex_improve_run` | Launch local repository self-improvement run. | `{ "prompt": "repo improvement task" }` | Reuses existing self-improve background runner. |
| `codex_improve_status` | Read current self-improvement status. | `{}` | Uses existing status function. |
| `codex_improve_latest` | Read latest self-improvement report summary. | `{}` | Uses latest report path. |
| `settings_get` | Read active runtime/settings snapshot. | `{}` | Returns compact manager-facing summary in chat. |
| `threads_list_contacts` | List recent direct-thread contacts for planning. | `{ "limit": 20, "provider": "all\|whatsapp\|instagram" }` | Source query: `threads:listContacts`. |
| `outreach_run` | Trigger immediate outreach batch. | `{}` | Source mutation: `outreach:runManual`. |
| `agenda_create_range` | Create agenda todos across a date range. | `{ "agenda": "title", "startDate": "YYYY-MM-DD", "endDate": "YYYY-MM-DD", "time": "HH:MM" }` | Source mutation: `todos:createAgendaRange`. |

## Telemetry Events

The manager emits step-level events to `systemEvents` through `systemRecordEvent`:

- `self_control.manager.plan.ready`
  - Includes planner source, confidence, step count, and summary.
- `self_control.manager.step.started`
  - Includes step index, tool, known/unknown tool marker, and reason.
- `self_control.manager.step.executed`
  - Includes success boolean and `latency_ms`.
- `self_control.manager.step.failed`
  - Includes `latency_ms` and error text.
- `self_control.manager.executed`
  - Final aggregate result sent to user, including `step_failures`.

This telemetry is intended for orchestration quality monitoring and tuning.
