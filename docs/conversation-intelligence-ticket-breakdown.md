# Conversation Intelligence Ticket Breakdown

Date: 2026-04-24  
Owner: Core autopilot stack (`convex/*`, `src/worker/*`)

## Phase 1 (Schema + Plumbing) - Started

### CI-101: Add conversation intelligence schema
- Status: Completed
- Files:
  - `convex/schema.ts`
- Scope:
  - Add `conversationSignals`.
  - Add `threadConversationState`.
  - Add `threadTopicLanes`.
- Acceptance criteria:
  - Convex schema includes required fields and indexes for thread-level signal/state reads.
  - Index names follow Convex naming conventions for index fields.

### CI-102: Build ingestion module (shadow mode)
- Status: Completed
- Files:
  - `convex/conversationIntelligence.ts`
  - `convex/lib/conversationIntelligence.ts`
- Scope:
  - Add `internalMutation conversationIntelligence.ingestMessageSignals`.
  - Add check-in detection (English + Naija variants).
  - Add idempotency guard by `messageId`.
  - Upsert baseline lane (`general`) and thread conversation state.
- Acceptance criteria:
  - Ingestion does not alter reply behavior.
  - Duplicate invocations for one message do not duplicate signals.
  - Mutual check-in timestamp updates only when opposite-direction check-in appears in 7-day window.

### CI-103: Wire inbound/outbound plumbing
- Status: Completed
- Files:
  - `convex/inbound.ts` (`ingest`)
  - `convex/outbox.ts` (`markSent`)
- Scope:
  - Schedule conversation signal ingestion after new inbound/outbound message inserts.
  - Keep sidecar scheduling non-blocking to avoid send/ingest regressions.
- Acceptance criteria:
  - New live inbound/outbound messages enqueue signal ingestion.
  - Existing delivery and draft scheduling behavior remains intact.

### CI-104: Expose state in thread read API
- Status: Completed
- Files:
  - `convex/threads.ts` (`get`)
- Scope:
  - Return `conversationState`.
  - Return top `topicLanes` (`active`/`cooling`) for UI/workbench use.
- Acceptance criteria:
  - Existing thread payload still returns previous fields.
  - New fields are nullable/safe for clients that have no conversation state yet.

## Phase 2 (Check-in Memory Quality)

### CI-201: Improve classifier precision + false-positive control
- Status: Completed (initial pass)
- Files:
  - `convex/lib/conversationIntelligence.ts`
  - `convex/conversationIntelligence.ts`
- Scope:
  - Add stricter response disambiguation and mirrored-prompt matching.
  - Add confidence thresholds and low-confidence fallback behavior.
- Acceptance criteria:
  - Reduced false positives on generic greetings and non-wellbeing “how far” usage.
  - Confidence metadata is attached to detected check-in signals for downstream weighting.

### CI-202: Add observability metrics for check-in detection
- Status: Completed
- Files:
  - `convex/conversationIntelligence.ts`
  - `convex/threads.ts`
- Scope:
  - Add per-thread counters/diagnostics for detected prompts, responses, and mutual matches.
- Acceptance criteria:
  - Can audit why `lastMutualCheckInAt` changed for a thread.
  - Current progress: per-thread check-in diagnostics are now returned from thread/read APIs, and state transitions emit `conversation.checkin.mutual_updated`, `conversation.next_move.updated`, and `conversation.topic_dying.detected` events.

## Phase 3 (Parallel Topic Lanes)

### CI-301: Replace placeholder lane assignment with real lane resolution
- Status: Completed (rule-based lane resolution + lane continuity)
- Files:
  - `convex/lib/conversationIntelligence.ts`
  - `convex/conversationIntelligence.ts`
  - `convex/contextTools.ts` (if embedding lookup reuse is needed)
- Scope:
  - Move from single `general` lane to multi-lane resolution (`topic_start`, `topic_pivot`, `topic_close`).
  - Add lane transitions and decay scoring.
- Acceptance criteria:
  - One thread can maintain multiple lanes with deterministic current-lane selection.
  - Current progress: lane resolution now combines lexical topic inference with active/cooling lane continuity hints (`resolveTopicFromText`) so short follow-ups stay in the correct lane instead of falling back to `general`; pivot/close signal mapping, lane cooling, and active-lane limit enforcement remain live, while embedding-backed scoring is still an optional follow-up.

## Phase 4 (Reply Steering + Anti-dwelling + Lead Pivot)

### CI-401: Inject reply guidance into worker context
- Status: In progress (core wiring done)
- Files:
  - `src/worker/index.ts`
  - `src/worker/ai.ts`
- Scope:
  - Feed lane state + check-in recency + anti-dwelling signals into response workbench.
- Acceptance criteria:
  - Reply generation consumes lane/check-in metadata with no regressions to hard-stop/pause behavior.
  - Current progress: worker now fetches `conversationIntelligence:getReplyGuidance` and passes guidance into AI prompt/workbench.

### CI-402: Anti-dwelling enforcement
- Status: In progress (soft enforcement active)
- Files:
  - `src/worker/ai.ts`
  - `convex/conversationIntelligence.ts`
- Scope:
  - Endgame close guard: one concise close line + cooldown.
  - Topic dwell guard: turn budget and repetition suppression.
- Acceptance criteria:
  - Reduced repeated close-outs and fewer rehash loops in long threads.
  - Current progress: guidance-driven `close` and `lead` mode switching is live, and guidance outcomes now persist immediate cooldown anchors via `conversationIntelligence:recordReplyGuidance` (`lastCloseAt`, `lastPivotAt`, `lastLeadQuestionAt`) instead of waiting on outbound ingestion.

### CI-403: Controlled lead pivot mode
- Status: Completed
- Files:
  - `src/worker/ai.ts`
  - `convex/conversationIntelligence.ts`
- Scope:
  - Add `lead_pivot` gate for safe out-of-topic leadership prompts.
- Acceptance criteria:
  - Pivoting triggers only in warm/neutral, low-risk contexts and never in hard-stop/pause/conflict paths.
  - Current progress: `getReplyGuidance` now enforces stricter lead-pivot safety gates (explicit-ask suppression, unanswered-outbound pressure limit, and lane-exhaustion requirement) via `evaluateLeadPivotSafety`, retains cooldown/close/conflict/pause protections, and keeps theme routing for eligible pivots.

## Phase 5 (Outreach + Rollout)

### CI-501: Outreach prioritization by mutual check-in recency
- Status: Completed
- Files:
  - `convex/outreach.ts`
  - `src/worker/outreach-hydration.ts`
- Scope:
  - Prioritize stale mutual check-ins over raw activity timestamps.
- Acceptance criteria:
  - Outreach ordering favors contacts with old/no mutual check-ins.
  - Current progress: outreach candidate ranking now prioritizes overdue/missing mutual check-ins before activity recency, and proactive outreach prompt/fallback guidance avoids repetitive generic check-ins when mutual check-ins are still fresh.

### CI-502: Feature-flag controls and gradual rollout
- Status: Completed
- Files:
  - `convex/lib/config.ts`
  - `convex/settings.ts`
  - `src/components/live-settings.tsx`
- Scope:
  - Add runtime toggles for conversation intelligence, anti-dwelling, and lead pivot.
- Acceptance criteria:
  - Can independently enable/disable each behavior without deployment.
  - Current progress: new keys are in config defaults/parsing, persisted through `settings:save`, and editable from the Settings dashboard.
