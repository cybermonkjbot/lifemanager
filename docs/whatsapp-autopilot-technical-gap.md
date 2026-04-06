# WhatsApp Autopilot Technical Gap Document

Date: 2026-04-06
Scope: Personal-account WhatsApp automation stack using Baileys + Next.js + Convex + worker runtime.

## 1) Executive Summary
The core loop is implemented in code today: connect WhatsApp, auto-start worker, ingest inbound DMs, generate AI reply, and send when autonomy is enabled.

What is not yet "official-grade" is operational robustness, safety depth, observability, and test coverage. The architecture is functional, but not yet hardened to production quality standards.

## 2) Current Capability Matrix (Code Audit)

### Connection and Session
- Implemented: QR + pairing-code setup flow with retry behavior.
- Implemented: Worker auto-start after successful connection.
- Implemented: Stop Session and Reset Credentials both attempt to stop worker.
- Implemented: Credential invalidation when device is logged out/revoked.
- Implemented: Runtime listener status surfaced to setup UI.

### Message Processing
- Implemented: Worker subscribes to inbound WhatsApp messages.
- Implemented: Inbound messages are ingested into Convex and thread memory updates are scheduled.
- Implemented: AI draft generation (Azure primary, Codex fallback, heuristic fallback).
- Implemented: Outbox claim/send/fail lifecycle with lease recovery cron.
- Implemented: Autonomy switch controls whether drafts are auto-approved/sent.

### Personality and Tone
- Implemented: Global personality profiles (girlfriend, relationship, friendship, casual).
- Implemented: Per-thread personality assignment.
- Implemented: Per-thread personality intensity.
- Implemented: Optional per-thread custom personality note.
- Implemented: Profile editing UI in Conversations.

## 3) What Is Missing to Make It Official-Grade

### P0 (Critical Reliability / Trust)
1. No automated end-to-end tests for connect -> ingest -> generate -> send.
2. No inbound idempotency check on `whatsappMessageId` in `inbound.ingest`; duplicate delivery/events can produce duplicate replies.
3. Setup manager state is process-memory singleton in API runtime; restarts can interrupt setup state transitions.
4. Worker lock is local PID-file based; not a distributed lock strategy for multi-host deployments.
5. Guardrails are minimal keyword-based checks; insufficient for high-risk social and sensitive contexts.

### P1 (Operational Hardening)
1. No alerting/SLO framework (only event logs). No automatic paging/escalation on repeated failures.
2. No explicit per-contact or global rate limiting / quiet hours / max sends per window.
3. No deterministic replay-safe send protection beyond current outbox lifecycle (needs stronger anti-duplicate policy across crashes/retries).
4. No formal runbooks for reconnect storms, revoked sessions, stuck outbox loops, and model outage fallback behavior.
5. Personality profile governance is basic (edit existing); no lifecycle controls (versioning/rollback/audit metadata).

### P2 (Product Quality)
1. No persona recommendation layer (manual selection only).
2. No contact-class policy engine (e.g., romantic vs friend vs business behavior constraints).
3. No quality scoring pipeline for generated outputs (tone fit, risk score, intent fit).
4. Limited analytics for model performance by persona or thread class.

## 4) Target Definition of "Official"
The system should be considered official-grade when all are true:
- 99.9% successful send pipeline over 30 days (excluding upstream WhatsApp outages).
- Zero duplicate sends from replay/retry scenarios in validated chaos tests.
- Full incident visibility: metrics, dashboards, and alert thresholds with runbooks.
- Verified safety controls for sensitive topics and relationship-context messaging.
- E2E test suite and staging verification gating release.

## 5) Delivery Roadmap

### Phase 1: Reliability Baseline (P0)
- Add inbound idempotency guard using `whatsappMessageId` uniqueness semantics per thread/message.
- Add E2E smoke tests for:
  - setup success + auto-start
  - inbound ingestion -> draft -> send
  - reconnect + retry + outbox lease recovery
  - revoked session credential invalidation
- Persist setup orchestration state outside process memory where required for restart-safe flows.

### Phase 2: Operational Hardening (P1)
- Add telemetry package: success rates, retries, queue depth, send latency, model fallback rate.
- Add alerting thresholds and incident runbooks.
- Add policy controls: quiet hours, max-send windows, per-contact throttle tiers.
- Strengthen anti-duplicate strategy with explicit idempotency assertions in send path.

### Phase 3: Personality + Safety Excellence (P1/P2)
- Add personality profile versioning and rollback.
- Add relationship-aware safety rails and escalation to manual review.
- Add scoring + audit trail for generated reply quality and risk.
- Add profile recommendation suggestions from thread metadata/history.

## 6) Immediate Next 5 Engineering Tickets
1. `P0` Add inbound dedupe on `whatsappMessageId` before insert in `convex/inbound.ts`.
2. `P0` Add E2E integration harness for worker pipeline happy path + revoke path.
3. `P1` Add metrics and dashboard endpoints for outbox + provider fallback + reconnect frequency.
4. `P1` Add per-thread send throttle + quiet-hour policy in approval/send path.
5. `P1` Add profile version history table and rollback mutation for personality profiles.

## 7) Current State Verdict
Your dream is partially realized today:
- Yes: autonomous DM handling, personality-by-conversation, and worker auto-start are implemented.
- No: it is not yet at official-grade robustness/compliance/operational maturity.

This gap is fixable with a focused 2-3 phase hardening plan.
