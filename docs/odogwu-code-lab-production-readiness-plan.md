# ODOGWU Code Lab Production Readiness Plan

## Goal

Code Lab should behave like a real IDE for tenant-owned ODOGWU extensions. Nothing in the editor surface should be decorative or demo-only. The editor should let an owner write, test, publish, inspect, and operate production account automation.

## Current Baseline

- Multi-file ODOGWU projects with `main.odo`.
- Imports, exports, webhooks, functions, heuristics, lexicons, prompt overlays.
- Convex-backed project, file, version, test, and run storage.
- On-demand generated canvas.
- Webhook route execution for published handlers.
- Managed secret URL support for `http.*` calls using `http.post(secret: "secret.key")`.
- Local editor diagnostics, hover docs, syntax highlighting, autocomplete, and keyboard shortcuts.

## Production Interface Principles

- Editor surfaces show state, not teaching copy.
- Language reference lives in ODOGWU Docs.
- Starter code must be realistic, tenant-safe, and deployable after secrets/configuration.
- File actions should be explicit, reversible, and versioned.
- Tests and publish should produce durable logs.
- Runtime effects should be observable without exposing secrets.

## Priority 1: File Workspace

- Replace `window.prompt` create/rename flows with command palette dialogs.
- Add path validation before file creation/rename.
- Block deleting `main.odo`.
- Add dirty indicators per file.
- Add file-level context menu: rename, duplicate, delete, copy path.
- Add project search across files.
- Add go-to-definition for imports and exported symbols.

## Priority 2: Terminal And Output

- Add a docked terminal/output panel under the editor.
- Stream test output, compile output, publish output, and webhook run output there.
- Keep inspector focused on Problems, Outline, Endpoints, Canvas, Snapshots, Runs.
- Add clear/copy/export controls for output.

## Priority 3: Tests

- Support multi-file test files, for example `tests/payment_webhook.odo`.
- Add fake events for webhook, message, follow-up, schedule, and worker hooks.
- Show test tree with pass/fail status.
- Persist test traces by project version.
- Block publishing when current files do not match the latest passing test hash.

## Priority 4: Publish And Runtime

- Publish should produce an immutable bundle manifest.
- Worker should subscribe to active project bundles.
- Webhook ingress should validate tenant session or configured secret.
- `http.*` should support managed secret URL references, headers, body mapping, timeout, retry policy, and telemetry.
- `messages.send` should respect tenant send/autopilot policy.
- Account mutations should record system events and tool runs.

## Priority 5: Source Control

- Add snapshot diff by file.
- Add restore file and restore project.
- Add publish tags.
- Add changelog text on publish.
- Add compare working tree to active published version.

## Priority 6: Canvas

- Generate canvas on demand only.
- Keep canvas based on current compiled graph.
- Allow canvas nodes to jump to source.
- Add run trace overlay after tests or webhook executions.
- Add export as Mermaid and image when a renderer is available.

## Priority 7: Language And Docs

- Keep syntax examples in docs, not in the editor inspector.
- Document comments, imports, exports, SDK modules, tests, managed secrets, webhooks, and worker hooks.
- Add a language reference generated from the SDK registry.
- Add cookbook projects: paid consultation, missed follow-up recovery, quiet-hours review, high-priority contact routing, inbound CRM webhook.

## Done Definition

Code Lab is production-ready when an owner can:

1. Create a project without touching documentation.
2. Write multiple files with validated imports.
3. Use managed secrets for outbound APIs.
4. Test with fake events.
5. Publish only after passing tests.
6. Receive webhooks from external platforms.
7. See run logs and tool telemetry.
8. Restore or compare prior versions.
9. Extend worker behavior without raw shell/filesystem access.
10. Understand the language from Docs, not editor clutter.
