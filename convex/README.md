# Convex Backend

This directory contains the Odogwu HQ backend: schema, queries, mutations, actions, and crons.

## Modules

- `queue.ts`: Action queue aggregation for dashboard home.
- `threads.ts`: Thread list/detail + generation context.
- `inbound.ts`: Inbound WhatsApp ingest pipeline.
- `draft.ts`: Draft creation, approval, snooze, guardrail hold.
- `outbox.ts`: Worker claim/send lifecycle and idempotent transitions.
- `followups.ts`: Follow-up list and confirmation.
- `todos.ts`: TODO list and candidate promotion.
- `style.ts`: Style profile read/update.
- `memory.ts`: Thread summarization updates.
- `system.ts`: Health, events, provider-run traces, autonomy controls.
- `crons.ts`: Scheduled jobs for follow-up promotion, memory refresh, retention.

## Dev

Run:

```bash
bun run dev:convex
```

Then open Convex dashboard logs as needed.
