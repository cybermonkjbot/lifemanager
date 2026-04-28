# HTTP API Reference

This reference documents `src/app/api/**/route.ts` endpoints.

## Access and Auth

Most endpoints are guarded by instance access checks:
- `requireInstanceApiAccess` (PIN/unlock session cookie required when PIN is enabled)
- setup endpoints are additionally constrained by setup bootstrap rules before setup completion
- gateway endpoint requires `SLM_API_GATEWAY_KEY`

Global route gate behavior is implemented in `proxy.ts`.

## 1) Dashboard Action Endpoints

### `POST /api/actions/approve-draft`
- Auth: instance API access
- Input: `multipart/form-data` with `draftId`
- Action: approves a draft and sends immediately
- Redirects: `/`

### `POST /api/actions/confirm-followup`
- Auth: instance API access
- Input: `multipart/form-data` with `followUpId`
- Action: confirms follow-up
- Redirects: `/followups`

### `POST /api/actions/generate-meme`
- Auth: instance API access
- Input JSON:
  - `prompt` (required, max 8000 chars)
  - `label` (optional)
  - `threadId` (optional)
- Action:
  - generates meme media via Azure image/video path
  - uploads to Convex storage
  - registers media asset
- Output: JSON with `assetId`, `label`, `mimeType`, `url`, `model`, `latencyMs`, `createdAt`

### `POST /api/actions/pause-autonomy`
- Auth: instance API access
- Action: pauses autonomy via `system:pauseAutonomy`
- Redirects: `/system`

### `POST /api/actions/resume-autonomy`
- Auth: instance API access
- Action: resumes autonomy via `system:resumeAutonomy`
- Redirects: `/system`

### `POST /api/actions/set-mimicry`
- Auth: instance API access
- Input: `multipart/form-data` with `mimicryLevel`
- Action: updates global mimicry
- Redirects: `/style-lab`

### `POST /api/actions/snooze-draft`
- Auth: instance API access
- Input: `multipart/form-data` with `draftId`, optional `minutes`
- Action: snoozes draft
- Redirects: `/`

### `POST /api/actions/test-ai`
- Auth: instance API access
- Input JSON:
  - `message` (required, max 8000 chars)
  - `threadId` (optional)
  - `purpose` (optional: `reply_test` | `todo_title` | `followup_reason`)
- Action:
  - builds thread/style/contact/personality context
  - runs `generateReplyWithFallback`
  - logs attempt/provider telemetry
  - caches fresh result via AI freshness cache
- Output JSON includes:
  - `replyText`, `provider`, `model`, `latencyMs`
  - `guardrailBlocked`, `guardrailReason`
  - `attempts`, `contextToolCalls`, `contextWindow`
  - `qualityScore`, `qualityChecks`, `qualityRewriteApplied`
  - freshness metadata

### `POST /api/actions/todo-from-candidate`
- Auth: instance API access
- Input: `multipart/form-data` with `candidateId`
- Action: promotes todo candidate to todo
- Redirects: `/`

### `POST /api/actions/toggle-ignore-contact`
- Auth: instance API access
- Input: `multipart/form-data` with `targetValue`, `enabled`, `targetType`
- Action: upserts ignore rule target
- Redirects: `/rules`

## 2) Instance PIN Auth Endpoints

### `POST /api/auth/pin`
- Input: form data `pin`, optional `next`
- Behavior:
  - verifies instance PIN when enabled
  - sets signed unlock cookie on success
  - redirects to requested next path

### `POST /api/auth/pin/logout`
- Input: optional form data `mode`
  - `lock`: clears local access cookies only
  - `nuke`: resets local WhatsApp and Instagram auth, marks connected accounts disconnected when possible, then clears access cookies
- Behavior:
  - clears unlock cookie
  - clears tenant session cookie
  - redirects to `/unlock`

## 3) OpenAI-Compatible Gateway

### `OPTIONS /api/gateway/v1/chat/completions`
- CORS preflight handler

### `POST /api/gateway/v1/chat/completions`
- Auth:
  - requires configured `SLM_API_GATEWAY_KEY`
  - accepts `Authorization: Bearer <key>` or `X-API-Key`
- Input (OpenAI-style):
  - `messages` (required)
  - `model` (optional)
  - `temperature` (optional)
  - `max_tokens` or `max_completion_tokens` (optional)
  - `threadId` / `thread_id` / metadata thread fields (optional)
  - `stream` must be omitted or `false`
- Behavior:
  - maps OpenAI messages to inbound + history
  - runs internal reply pipeline with runtime settings
  - logs attempts/provider events
  - returns OpenAI chat completion payload plus `slm` diagnostics object

## 4) Setup Endpoints

All setup endpoints use node runtime and dynamic responses.

### Instance setup

### `GET /api/setup/instance`
- Returns current setup state

### `POST /api/setup/instance`
- Input JSON supports:
  - `pin`
  - `setupSecret` (header-based remote bootstrap flows)
  - `preferences`
  - `setupCompleted`
  - `issueSession`
- Behavior:
  - validates setup bootstrap permissions when setup incomplete
  - writes local setup config
  - syncs onboarding preferences to Convex settings/style
  - optionally issues unlock session cookie

### WhatsApp setup

### `POST /api/setup/whatsapp/start`
- Input JSON optional:
  - `mode`: `qr` or `pairing_code`
  - `phoneNumber` (for pairing code mode)

### `GET /api/setup/whatsapp/status`
- Returns current WhatsApp setup manager state

### `POST /api/setup/whatsapp/stop`
- Stops setup session

### `POST /api/setup/whatsapp/reset`
- Resets auth credentials

### `POST /api/setup/whatsapp/restart-worker`
- Restarts WhatsApp worker process

### Instagram setup

### `POST /api/setup/instagram/start`
- Input JSON: `username`, `password`

### `POST /api/setup/instagram/challenge`
- Input JSON: `code` (checkpoint/2FA flow)

### `GET /api/setup/instagram/status`
- Returns current Instagram setup state

### `POST /api/setup/instagram/stop`
- Stops setup flow

### `POST /api/setup/instagram/reset`
- Resets Instagram auth state

### `POST /api/setup/instagram/restart-worker`
- Restarts Instagram worker process

### Voice setup

### `POST /api/setup/voice/install`
- Input JSON optional: `modelId`
- Installs voice-note module runtime dependencies

### `GET /api/setup/voice/status`
- Query option: `?log=1` includes install log excerpt

### `POST /api/setup/voice/sample`
- Input: multipart form data
  - `sample` audio blob
  - `promptText`
- Saves and normalizes voice sample

### `POST /api/setup/voice/reset`
- Resets voice-note setup state and files

## 5) System Endpoints

### `GET /api/system/self-improvement/runs`
- Auth: instance API access
- Query params:
  - `limit` (max 200)
  - `runId` (optional detail selection)
- Reads run metadata from `.slm/self-improvement/runs/*`
- Returns:
  - lock status
  - run summaries
  - selected run detail (`report`, `prompt`, `contextPreview`)

## 6) Common Error Shapes

- Instance access failures generally return `401` JSON with `redirectPath` (or redirect for form endpoints).
- Gateway errors use OpenAI-style error envelope:
  - `invalid_request_error`
  - `authentication_error`
  - `api_error`
