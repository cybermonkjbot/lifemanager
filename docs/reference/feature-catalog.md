# Feature Catalog

This file documents the implemented feature surface of Odogwu HQ based on the current codebase.

Plain-language product promise: Odogwu HQ can help chat as the account owner. It reads conversation context, drafts replies in the owner's style, queues them for approval when review mode is enabled, and can send on the owner's behalf when autonomy is enabled.

## 1) Product Areas

### Home (`/`)
- Command-style home interface for quick navigation and lightweight orchestration prompts.
- Route-aware navigation commands (for example: `go queue`, `open conversations`, `/queue`).
- Falls back to `/api/actions/test-ai` for natural-language orchestration replies.

### Queue (`/queue`)
- Lists pending drafts, follow-up suggestions, todo candidates, unresolved guardrails.
- Supports:
  - draft approve/reject/snooze/edit
  - follow-up confirm/reschedule/snooze/cancel/clear
  - todo accept/status updates/clear
  - guardrail resolve/clear
- Backed by `queue:list`, `draft:*`, `followups:*`, `todos:*`, `queue:resolveGuardrail`.

### Conversations (`/conversations`)
- Thread timeline + detail for active contacts.
- Per-thread controls:
  - draft lifecycle controls
  - follow-up controls
  - grounding (names, aliases, vibe notes)
  - thread personality/profile overrides
  - queue guardrail resolution
  - candidate todo promotion
  - thread deletion
- Observability: fetches per-thread tool events (`threads:getToolEvents`).

### Status (`/status`)
- Status-related drafts/posts in queue context.
- Status-builder enable/disable toggle (`settings:setStatusBuilderEnabled`).
- Status draft moderation through same draft flow APIs.

### Media (`/media`)
- Unified media feed (`media:listUnifiedMedia`) across supported media types.
- Links media back to source thread context.

### Memes (`/memes`)
- Manual meme generation endpoint integration (`/api/actions/generate-meme`).
- Asset listing/management for meme items (`media:listAssets`).
- Contact/thread-aware meme targeting support.

### Backlog (`/backlog`)
- Backlog triage of unresolved/stale threads.
- Overrides:
  - relationship class
  - importance tier
  - snooze/unsnooze
  - ignore thread
- Draft creation for restart/answer flows.
- Bulk clear and refresh actions.

### Follow-ups (`/followups`)
- Follow-up timeline and list views with due ordering.
- Confirm/snooze/reschedule/cancel/clear actions.
- Agenda generation into todos for date ranges.

### Activity Core (`/activity-core`)
- Live operational activity + media signals.
- Uses system log feed and unified media stream.

### Systems Design (`/systems-design`)
- System log/timeline surface for runtime topology inspection.

### Setup (`/setup`)
- Guided instance onboarding with staged flow.
- Channel setup status (WhatsApp + Instagram).
- Voice note module setup surface.
- Instance PIN and first-run preference capture.

### Style Lab (`/style-lab`)
- Global mimicry controls.
- Learned trait management (update/remove/clear sections).
- Style history and rollback.
- Persona pack installation and profile operations.

### Rules (`/rules`)
- Ignore rules CRUD by target type (`contact`, `group`, `keyword`).
- Enable/disable per rule.

### Settings (`/settings`)
- Full runtime config management (`settings:get`, `settings:save`, `settings:defaults`).
- Includes AI, autonomy, delays, status automation, outreach, quiet hours, rate limits, Instagram controls, voice-note auto behavior, etc.
- Media asset management controls (toggle/update/merge/delete/register).

### System (`/system`)
- Health query with alert synthesis and operational metrics.
- Provider run traces, token/cost metrics, follow-up metrics, queue/guardrail pressure.
- Includes AI test action surface (`/api/actions/test-ai`).

### Spending (`/spending`)
- Azure provider cost/usage analytics across windows (`7d`, `30d`, `90d`, `all`).
- Supports fallback pricing inputs when provider-side pricing data is absent.

### Self Improvement (`/self-improvement`)
- Reads local self-improvement run artifacts from `.slm/self-improvement`.
- Displays run summaries/status and previews of report/prompt/context.

### Tools (`/tools`, redirect behavior)
- Route currently redirects to `/`.
- `LiveTools` component exists and exposes internal tooling operations (memory search, recall, contact facts, router plan, external search, history import), but the route currently redirects.

## 2) Channel + Worker Capabilities

### Supported providers
- WhatsApp worker (`src/worker/index.ts` + `src/worker/whatsapp.ts`)
- Instagram worker (`src/worker/instagram.ts`)

### Inbound parsing and storage
- Normalized inbound/outbound message persistence in `messages` table.
- Message type support includes:
  - `text`, `reaction`, `sticker`, `meme`, `image`, `video`, `audio`, `voice_note`, `document`
- Call session tracking and call fallback logic (`callSessions`, `calls:*`).
- Inbound dedupe key tracking (`inboundDedupeKeys`).

### Reply generation pipeline
- Primary provider: Azure AI.
- Fallback provider: local Codex CLI.
- Runtime strategy includes:
  - owner-style reply drafting and autonomous send paths
  - configurable deterministic guardrail modes
  - quality gate modes (`auto_rewrite_once`, `manual_review`, `log_only`)
  - context/rerank/tool-router execution support
  - style/mimicry/personality overlays
  - human-like delay/typing timing simulation

### Outbox lifecycle
- Claim/send/mark sent/mark failed/defer/recover-expired flows.
- Lease-based claiming and recovery.
- Idempotency key support.
- Send kinds include text, reaction, sticker, meme, voice note, and status-post variants.

### Autonomy and runtime controls
- Autonomy pause/resume mutations.
- Self-chat command parser supports runtime control for:
  - worker
  - dashboard app process
  - both
- Status/read/typing behavior controls plus optional auto-mark-read and presence subscribe.

### Self-control manager and smart routing
- Manager planning layer for self-chat intents.
- Smart routing between runtime commands, OpenClaw, and Codex self-improvement intents.
- Step-level telemetry is emitted to `systemEvents`.
- Tool registry docs: `docs/self-control-manager-tool-registry.md`.

### Context and memory
- Full-text and embeddings-assisted memory retrieval.
- Contact memory fact extraction/upsert/list.
- Thread style profile rebuild.
- Conversation recall query pipeline.
- Optional external/personal connector search actions.

### Media and meme capabilities
- Storage-backed media asset registry with dedupe/merge flows.
- Sticker context inference, visual-frame preparation, dedupe, compaction, and outbound sticker reply selection.
- Rolling sticker-thread behavior can choose sticker-only or sticker-companion replies when a chat is already operating in that mode.
- Manual meme generation endpoint with Azure image/video support.
- Asset enable/disable and metadata updates.

### Voice features
- Inbound transcription via local `whisper.cpp` integration.
- Voice-note generation path with optional local VoxCPM setup and sample capture.
- Explicit `/vn`/voice-note directives can send generated voice notes, and runtime settings can allow automatic voice-note replies for configured intent cues.
- Setup APIs for install/status/reset/sample capture.

## 3) Convex Cron Jobs

Defined in `convex/crons.ts`:

- Every 1 min: process confirmed follow-ups (`followupsPromoter.run`)
- Every 2 min: recover stuck outbox claims (`outbox.recoverExpiredClaims`)
- Every 30 min: proactive outreach (`outreach.run`)
- Every 20 min: adaptive romantic morning (`romanceProtocol.run`)
- Every 20 min: auto status builder (`statusBuilder.run`)
- Every 30 min: queue stale sweeper (`queueStaleSweeper.run`)
- Every 30 min: backlog refresh snapshots (`backlog.refreshRecentInternal`)
- Every 24 hrs: nightly memory summary (`memoryBatch.run`)
- Every 24 hrs: retention cleanup (`retention.run`)
- Every 6 hrs: AI smartness outcomes backfill (`aiFeedback.backfillOutcomes30d`)
- Every 24 hrs: AI tuning train (`aiFeedback.trainTuningProfiles`)

## 4) Convex Module Catalog (Public Surface)

Public here means exported query/mutation/action (excluding internal-only exports).

### Core workflow modules
- `threads`: list/get/update metadata, eligibility, contact listing, thread tool events, delete, backfills
- `inbound`: ingest live/history messages, attach media assets
- `draft`: approve/reject/snooze/update/clear drafts; manual generation action
- `outbox`: claim due, mark typing/sent/failed, rewrite/defer, status hydration
- `queue`: queue list + guardrail resolution/clear
- `followups`: list/timeline + confirm/reschedule/snooze/cancel/clear
- `todos`: list, accept from candidates, agenda range creation, status update, dismiss/clear
- `backlog`: list, create draft, overrides, snooze/ignore/refresh/clear

### Intelligence + style modules
- `conversationIntelligence`: thread state and reply guidance surfaces
- `chatTools`: memory search, recall, style profile, fact extraction, router plan, external/personal search
- `contextTools`: history search, embeddings read/write, context window diagnostics
- `style`: profile read/update, mimicry, emoji/humor learning, history and rollback
- `personality`: profile CRUD/versioning, persona packs, per-thread settings
- `relationshipState`: compute/list relationship priority state
- `grounding`: per-thread grounding read/write

### System + operations modules
- `settings`: read/save runtime config + onboarding presets
- `system`: health, spending analytics, log feed, setup status, runtime event/provider/tool logging, autonomy toggles
- `rules`: ignore rule CRUD + enable toggles
- `calls`: call event tracking and recent fallback checks
- `media`: upload URLs, register/list/toggle/update/merge/delete assets and media context operations

### AI feedback + tuning modules
- `aiFeedback`: signal recording, candidate evals, active tuning profile, adaptive hints

For exact function names and signatures, see files in `convex/*.ts` and generated API types under `convex/_generated`.

## 5) Data Model Overview (Convex Schema)

Defined in `convex/schema.ts`.

Major table groups:
- Runtime config/state: `appConfig`, `setupRuntime`
- Threads/messages: `threads`, `messages`, `messageReactions`, `callSessions`, `inboundDedupeKeys`
- Draft/send pipeline: `replyDrafts`, `outbox`, `guardrailEvents`, `providerRuns`, `toolRuns`, `systemEvents`
- Follow-up/tasking: `followUps`, `todoCandidates`, `todos`
- Backlog/state: `backlogThreadState`, `relationshipThreadState`, `threadConversationState`, `threadTopicLanes`
- Memory/context: `threadMemory`, `contactMemoryFacts`, `messageEmbeddings`, `threadGrounding`
- Style/personality: `styleProfiles`, `styleProfileHistory`, `personalityProfiles`, `personalityProfileVersions`, `threadPersonalitySettings`
- Media: `mediaAssets`
- AI feedback/tuning: `aiFeedbackSignals`, `aiOutcomes`, `aiCandidateEvals`, `aiTuningProfiles`, `aiBackfillJobs`
- Rules: `ignoreRules`
- Romance tracking: `romanceMorningState`

## 6) Security and Access Model

- First-run setup gate routes to `/setup` until setup is complete.
- Instance-local PIN gate controls dashboard/API access via signed cookie sessions.
- Gateway endpoint requires API key if enabled.
- Setup bootstrap secret (`SLM_SETUP_SECRET`) allows secure remote setup bootstrap when not on localhost.

## 7) Operational Observability

- `system:health` provides aggregate metrics and runbook hints.
- `systemEvents`, `providerRuns`, and `toolRuns` capture operational traces.
- Dedicated system and systems-design views expose runtime event feeds.
