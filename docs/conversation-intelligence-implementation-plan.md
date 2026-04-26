# Conversation Intelligence Implementation Plan

Date: 2026-04-24  
Scope: Add culturally-aware check-ins, parallel-topic awareness, and topic-transition behavior to the current WhatsApp autopilot stack.

## 1) Goal

Build a conversation layer that can:

1. Remember the last real “how are you / checking in” exchange per contact (not just last message time).
2. Track parallel topics inside one thread, so replies stay on the right lane.
3. Detect when a topic is dying and naturally pivot or close without sounding robotic.
4. Enforce anti-dwelling (anti-dweling) so we do not overstay on any topic or on conversations that are ending.
5. When vibe permits, intentionally lead the chat into a new topic with a concise pivot question that pulls the respondent forward.

## 2) Current Baseline (Codebase Audit)

### Message + Reply Lifecycle
- Inbound ingestion and scheduling lives in `convex/inbound.ts` (`ingest`), including draft generation scheduling and follow-up detection.
- Outbound send completion is finalized in `convex/outbox.ts` (`markSent`), where outbound messages are inserted into `messages`.
- Worker orchestration and prompt wiring live in `src/worker/index.ts` (reply pipeline + outreach hydration).

### Context Retrieval + Memory
- Thread messages/memory/timeline are read through `convex/threads.ts` (`get`).
- History retrieval is currently message-centric (`convex/contextTools.ts`, `src/worker/history-context.ts`, `src/worker/context-orchestration-utils.ts`), not topic-lane-centric.
- Contact fact memory exists (`contactMemoryFacts`) via `convex/chatTools.ts` and is already fed into `contextPack`.

### Conversation Steering
- Steering currently focuses on close/pause/loop patterns (`src/worker/ai.ts` via `detectConversationSteeringMode` + `buildResponseWorkbench`).
- It handles “wrap up” and “loop” heuristically, but does not track explicit parallel topics per thread.

### Proactive Outreach
- Outreach cadence exists (`convex/outreach.ts`) and uses `lastActivityAt` + configured cadence.
- Prompt shaping exists (`src/worker/outreach-hydration.ts`) with strong style guardrails.
- It does not currently prioritize “time since mutual wellbeing check-in.”

## 3) Gaps Relative to Your Request

1. No persistent signal for **last mutual wellbeing check exchange** per thread.
2. No explicit model for **parallel topics** inside one chat.
3. “Topic dying” is inferred from generic ack/loop cues, not lane-specific momentum decay.
4. Outreach and inline replies cannot reason over “we’ve talked recently, but we haven’t checked on each other this week.”
5. No explicit **anti-dwelling budget** (turn limits / linger score) for topic endings or repetitive loops.
6. No controlled **topic-lead injection** path for deliberate out-of-topic pivots.

## 4) Proposed Design

## 4.1 New Convex Data Model

### A) `conversationSignals` (event stream)
Purpose: append-only message-level conversational signals.

Suggested fields:
- `threadId: Id<"threads">`
- `messageId: Id<"messages">`
- `direction: "inbound" | "outbound"`
- `signalType: "checkin_prompt" | "checkin_response" | "topic_start" | "topic_continue" | "topic_close" | "topic_pivot"`
- `topicKey?: string`
- `confidence: number`
- `excerpt?: string`
- `createdAt: number`

Suggested indexes:
- `by_threadId_and_createdAt`
- `by_threadId_and_signalType_and_createdAt`
- `by_threadId_and_topicKey_and_createdAt`
- `by_messageId`

### B) `threadConversationState` (thread summary)
Purpose: fast read for reply/outreach decisions.

Suggested fields:
- `threadId: Id<"threads">`
- `lastMutualCheckInAt?: number`
- `lastOutboundCheckInAt?: number`
- `lastInboundCheckInAt?: number`
- `currentPrimaryTopicKey?: string`
- `topicDyingScore?: number`
- `nextMove: "none" | "check_in" | "pivot" | "close"`
- `updatedAt: number`
- `createdAt: number`

Suggested indexes:
- `by_threadId`
- `by_nextMove_and_updatedAt`

### C) `threadTopicLanes` (parallel topic tracking)
Purpose: maintain active/cooling/closed topic lanes.

Suggested fields:
- `threadId: Id<"threads">`
- `topicKey: string`
- `topicLabel: string`
- `status: "active" | "cooling" | "closed"`
- `firstMessageAt: number`
- `lastMessageAt: number`
- `lastInboundAt?: number`
- `lastOutboundAt?: number`
- `inboundTurns: number`
- `outboundTurns: number`
- `ackStreak: number`
- `dyingScore: number`
- `updatedAt: number`
- `createdAt: number`

Suggested indexes:
- `by_threadId_and_topicKey`
- `by_threadId_and_status_and_lastMessageAt`

## 4.2 Signal Extraction Pipeline

Create a new module:
- `convex/conversationIntelligence.ts`
- helper logic in `convex/lib/conversationIntelligence.ts`

Core entrypoint:
- `internalMutation ingestMessageSignals({ threadId, messageId })`

Called from:
- `convex/inbound.ts` after message insert (for inbound text/image caption-derived text when relevant).
- `convex/outbox.ts` in `markSent` after outbound message insert.

Detection stages:
1. Normalize text + derive compact tokens.
2. Detect check-in prompt/response using:
   - existing English patterns (`how are you`, `checking in`, `you good`) and
   - Naija variants (`how you dey`, `how body`, `how far`, `you dey alright`, `hope say you dey okay`).
3. Resolve topic lane:
   - fast lexical overlap against active lanes;
   - fallback to embedding similarity (reusing existing embedding utilities where needed).
4. Update lane counters (`ackStreak`, `dyingScore`, status transitions).
5. Update thread state (`lastMutualCheckInAt`, `nextMove`, `topicDyingScore`).
6. Emit `systemEvents` for observability.

## 4.3 Mutual Check-in Definition

“Mutual check-in” should be marked when all are true:

1. One side sends a `checkin_prompt`.
2. The other side responds with `checkin_response` (or mirrored prompt) within a bounded window (recommended: 7 days).
3. Messages are in same thread and not stale/history artifact conflict.

When matched:
- set `lastMutualCheckInAt = response.messageAt`
- update directional timestamps as needed.

## 4.4 Worker/AI Integration

### In `src/worker/index.ts`
- Before reply generation, fetch `conversationIntelligence.getReplyGuidance(threadId, inboundMessageId)`.
- Merge into `contextPack.styleHints` and prompt context:
  - days since last mutual check-in
  - active topic lanes
  - dying score and pivot recommendation

### In `src/worker/ai.ts`
- Extend response workbench with a new effective mode: `pivot` (or infer pivot via intent flags while keeping current enum stable if preferred).
- Pivot behavior:
  - if current lane is dying and no hard-stop/pause/guardrail mode is active, send one concise bridge to a viable lane or wellbeing check.
  - preserve current strict close behavior for `hard_stop`, `pause`, `loop`, `wrap_up`, etc.

## 4.5 Outreach Integration

In `convex/outreach.ts`, prioritize by:
- `lastMutualCheckInAt` (from `threadConversationState`) instead of only `lastActivityAt`.

Suggested ordering score:
- oldest mutual check-in age first
- then oldest inbound/outbound activity
- then relationship tier (if needed)

In `src/worker/outreach-hydration.ts`, add optional guidance:
- avoid repetitive check-in opener if recent mutual check-in exists.
- if no mutual check-in for configured threshold, bias to warm welfare-check opener.

## 4.6 UI + Observability

Expose state through `convex/threads.ts:get`:
- `conversationState`
- top active `topicLanes` (e.g., 3-5 max)

Optional UI additions in `src/components/live-conversations.tsx`:
- “Last mutual check-in: X days ago”
- lane chips: `active`, `cooling`, `closed`
- “Suggested next move: check-in / pivot / close”

Log events:
- `conversation.checkin.detected`
- `conversation.checkin.mutual_updated`
- `conversation.topic_lane.updated`
- `conversation.topic_dying.detected`
- `conversation.next_move.updated`

## 4.7 Anti-dwelling + Topic Leadership Layer

This section covers your latest requirement directly.

### A) Endgame Anti-dwelling (about-to-end conversations)

Use existing steering (`pause`, `loop`, `wrap_up`) plus new stateful guards:

- Detect `conversationEndImminent` when:
  - low-signal ack chains continue across N turns,
  - inbound carries pause/close cues,
  - topic lane dying score crosses threshold.
- Once imminent:
  - allow exactly one concise close line,
  - enforce no follow-up question,
  - set short cooldown so the bot does not re-open the same close-out.

Implementation points:
- scoring in `convex/lib/conversationIntelligence.ts`,
- guidance emitted from `conversationIntelligence.getReplyGuidance`,
- enforced in `src/worker/ai.ts` response workbench.

### B) General Topic Anti-dwelling (any topic)

For each lane in `threadTopicLanes`, track:
- `turnCount` (or derive from inbound/outbound turns),
- `ackStreak`,
- `dyingScore`,
- `lastMeaningfulTurnAt`.

Rules:
- if `turnCount` exceeds soft budget and novelty is low, switch `nextMove` to `pivot` or `close`,
- if repetition risk is high, block “same-point restatement” and shorten output,
- prevent repeated reopening of recently closed lanes for a cooldown period.

### C) Deliberate Topic Leadership (lead out of current topic)

Add a controlled pivot mode (`lead_pivot`) that can ask one short out-of-the-blue but natural question when:
- relationship vibe is warm/neutral,
- no conflict/hard-stop/safety cue is active,
- current lane is cooling or exhausted.

Behavior:
- acknowledge current lane briefly (optional one short clause),
- ask one narrow pivot question to pull conversation into a fresh lane,
- avoid coercive tone and avoid multi-question dumps.

Examples of lead intent:
- “quick plans,” “wellbeing check,” “light day recap,” “next-step coordination.”

### D) Safety Constraints for Leadership

Never trigger `lead_pivot` when:
- `hard_stop`, `pause`, aggressive, or conflict-repair mode is active,
- user explicitly wants silence/space,
- recent unanswered outbound streak is high enough to suggest backing off.

### E) Suggested Additional State Fields

Extend `threadConversationState` (or derive transiently):
- `conversationEndImminent?: boolean`
- `topicDwellScore?: number`
- `lastPivotAt?: number`
- `lastCloseAt?: number`
- `lastLeadQuestionAt?: number`

## 5) Implementation Phases

### Phase 1: Schema + Plumbing
- Add three new tables and indexes in `convex/schema.ts`.
- Add `conversationIntelligence` module with no-op/stub scoring in shadow mode.
- Wire calls from `convex/inbound.ts` and `convex/outbox.ts`.

Exit criteria:
- Signals are written for new messages with no behavior change yet.

### Phase 2: Check-in Memory
- Implement robust check-in prompt/response classifier.
- Compute and persist `lastMutualCheckInAt`.
- Add read query for thread check-in summary.

Exit criteria:
- Dashboard/API can answer: “When was our last mutual check-in?”

### Phase 3: Parallel Topic Lanes
- Implement lane creation/update/closure and `dyingScore`.
- Add `getReplyGuidance` query returning lane + next-move recommendation.

Exit criteria:
- Single thread can maintain >1 active lane and select current lane deterministically.

### Phase 4: Reply Behavior (Pivot + Culture-aware Check-in)
- Inject guidance into `src/worker/index.ts` + `src/worker/ai.ts`.
- Add guarded pivot behavior for dying topics.
- Add check-in nudge when due and culturally appropriate.
- Add endgame anti-dwelling enforcement (single close line + no reopen cooldown).
- Add per-topic anti-dwelling enforcement (turn budget + repetition suppression).
- Add controlled `lead_pivot` mode for deliberate conversation leadership.

Exit criteria:
- Replies can gracefully pivot or close without forced awkwardness.

### Phase 5: Outreach + UI + Rollout
- Integrate mutual-check-in recency into outreach prioritization.
- Surface metrics and lane/check-in state in Conversations UI.
- Enable by feature flag gradually.

Exit criteria:
- End-to-end behavior visible and tunable from runtime settings.

## 6) Config + Feature Flags

Add runtime toggles in `convex/lib/config.ts` and `convex/settings.ts`:
- `conversationIntelligenceEnabled` (default `false` for safe rollout)
- `checkInRecencyTargetDays` (recommended default `7`)
- `topicDyingAckStreakThreshold` (recommended default `3`)
- `topicLaneMaxActive` (recommended default `4`)
- `pivotReplyEnabled` (default `false` initially)
- `antiDwellingEnabled` (recommended default `true`)
- `antiDwellingEndgameCloseCooldownMinutes` (recommended default `45`)
- `antiDwellingTopicTurnSoftLimit` (recommended default `6`)
- `antiDwellingTopicTurnHardLimit` (recommended default `10`)
- `topicLeadPivotEnabled` (recommended default `true`)
- `topicLeadPivotMinVibeScore` (recommended default `0.6`)
- `topicLeadPivotCooldownMinutes` (recommended default `180`)

## 7) Test Plan

### Unit tests
- `convex/conversationIntelligence.test.ts`
  - check-in prompt/response detection (English + Naija variants)
  - mutual check-in pairing rules
  - lane scoring and dying transitions

### Integration tests
- Extend:
  - `convex/inbound.test.ts`
  - `convex/outbox.test.ts`
  - `src/worker/ai.test.ts`
  - `src/worker/context-pack.test.ts`
- Validate:
  1. Active chat but no check-in this week => check-in prompt can be suggested.
  2. Parallel topics in one thread => reply stays on correct lane.
  3. Dying topic => pivot mode chosen when safe.
  4. Hard-stop/pause contexts => no pivot/check-in override.
  5. Outreach prioritizes stale mutual check-ins over raw last-message recency.
  6. Endgame anti-dwelling => one close line only, no repeated reopen.
  7. Topic anti-dwelling => repeated lane suppresses rehash and shifts move to pivot/close.
  8. Lead-out-of-topic enabled => one concise pivot question appears only under safe vibe conditions.

### Regression checks
- Ensure existing steering (`hard_stop`, `pause`, `loop`, `wrap_up`) remains unchanged where expected.
- Ensure no increase in duplicate sends or outbox churn.

## 8) Migration + Backfill

Add internal backfill mutation:
- scan recent messages (e.g., last 60-90 days per active thread),
- emit historical conversation signals,
- compute initial `threadConversationState`.

Run in bounded batches with scheduler continuation to stay within Convex transaction limits.

## 9) Recommended First Ticket Slice

Deliver a thin vertical slice first:

1. Add `conversationSignals` + `threadConversationState` schema.
2. Write signal ingestion hook from inbound + markSent.
3. Implement check-in classifier + `lastMutualCheckInAt`.
4. Expose in `threads:get`.
5. No reply behavior changes yet (shadow/read-only mode).

This gives immediate value (correct “last check-in” memory) with low risk before introducing topic-lane behavior changes.

## 10) Add-on Ticket Slice (Anti-dwelling First)

If you want to prioritize anti-dwelling before full lane intelligence, implement this thin slice:

1. Add `conversationEndImminent` + `topicDwellScore` computation from recent history (no new tables required yet).
2. Enforce endgame close guard in `src/worker/ai.ts` (`wrap_up` + cooldown).
3. Add minimal `lead_pivot` gate in response workbench for warm, low-risk contexts.
4. Add tests for:
   - no over-reply at conversation end,
   - no repetitive dwelling,
   - safe pivot leadership behavior.
