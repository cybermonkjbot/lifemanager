# Social Life Manager

Local-first WhatsApp brain built with Bun, Next.js, TypeScript, Convex, and Baileys.

## What It Does

- Runs a dashboard for queue triage, conversations, follow-ups, style controls, rules, and system health.
- Stores backend state in Convex (threads, messages, drafts, outbox, follow-ups, todos, style memory, logs).
- Keeps a persistent Baileys worker for WhatsApp socket handling.
- Uses Azure AI Foundry for reply generation with local `codex exec` fallback.
- Ingests historical WhatsApp messages (when available) for context search.
- Simulates human behavior with delay + typing windows before outbound messages.
- Detects future commitments and creates follow-up candidates and TODO candidates.

## Stack

- `Bun` runtime and package manager
- `Next.js` App Router for dashboard UI + action routes
- `Convex` for storage, backend functions, and scheduled jobs
- `Baileys` worker for WhatsApp connection + message I/O
- `Azure AI Foundry` primary generation
- `Codex CLI` fallback generation

## Quick Start

1. Install deps:

```bash
bun install
```

2. Create env file:

```bash
cp .env.example .env.local
```

3. Fill in at least:
- `CONVEX_URL` (or `NEXT_PUBLIC_CONVEX_URL`)
- `AZURE_AI_ENDPOINT`
- `AZURE_AI_API_KEY`
- `AZURE_AI_MODEL` (for example `gpt-5.4`)
- `SLM_HISTORY_SYNC_ENABLED=true` (full history sync for direct chats; group + broadcast/status JIDs are ignored)
- `SLM_EMBEDDINGS_LOCAL_ENABLED=true` (semantic context rerank)

If you use an Azure AI Foundry `.../responses` URI, set `AZURE_AI_API_STYLE=responses` (or keep `auto` and it will be inferred).

Optional instance gate override:
- the default flow is to create the instance PIN during the full-screen `/setup` onboarding
- `SLM_INSTANCE_PIN=2468` overrides the setup-managed PIN and forces a fixed env-managed PIN for this instance
- `SLM_INSTANCE_PIN_TTL_DAYS=30` controls how long the local unlock cookie stays valid
- `SLM_INSTANCE_COOKIE_SECRET=...` lets you sign the cookie with a secret separate from the PIN

Optional meme-image generation config:
- `AZURE_AI_IMAGE_ENDPOINT` (dedicated image endpoint; if omitted, derived from `AZURE_AI_ENDPOINT`)
- `AZURE_AI_IMAGE_API_KEY` (if image endpoint uses a different key)
- `AZURE_AI_IMAGE_MODEL` (for example `gpt-image-1`; do not use text models like `gpt-5.4` here)

Optional history/context tuning:
- `SLM_HISTORY_FETCH_ON_DEMAND=true`
- `SLM_HISTORY_FETCH_MAX_BATCH=50`
- `SLM_HISTORY_FETCH_MAX_ROUNDS=3`
- `SLM_CALL_FALLBACK_GRACE_MS=2000` (delay before call fallback text sends, so answered calls can suppress it)
- `SLM_VISION_FILTER_MODE=smart` (`smart` | `all` | `none`)
- `SLM_VISION_FILTER_UNCAPTIONED_COOLDOWN_MS=5400000` (used in `smart` mode)
- `SLM_EMBEDDINGS_MODEL=all-MiniLM-L6-v2`
- `SLM_EMBEDDINGS_CACHE_DIR=/path/to/cache`

4. Start all services:

```bash
bun run dev:all
```

This runs:
- `next dev`
- `convex dev`
- `bun run worker`

On first run, the app now redirects into a full-screen `/setup` onboarding flow where you set the per-instance PIN, choose runtime defaults, and connect channels. After setup completes, PIN-protected instances redirect to `/unlock` until the local PIN is entered.

## Setup Onboarding

1. Open `http://localhost:3000/setup` on first run, or just visit the app root and let it redirect there.
2. Move through the onboarding stages:
   - create the local instance PIN
   - choose behavior defaults like autonomy mode, reply pace, mimicry, memes, and quiet hours
   - connect WhatsApp and optionally Instagram
3. Finish setup and keep the unlock session for immediate access to the dashboard.

The onboarding flow persists its local state in `.slm/instance-config.json`. This is intentional: it keeps the gate per-instance and local-first instead of introducing SaaS-style multi-user auth.

If QR pairing keeps disconnecting, use `Get Pairing Code` in the wizard and enter your phone number in international format (for example `2348012345678`).

The setup wizard uses API routes:
- `POST /api/setup/whatsapp/start`
- `GET /api/setup/whatsapp/status`
- `POST /api/setup/whatsapp/stop`
- `POST /api/setup/whatsapp/reset`

## OpenAI-Compatible API Gateway

This app now exposes an OpenAI-style chat endpoint for external tools:

- `POST /api/gateway/v1/chat/completions`

It routes requests through the same `generateReplyWithFallback` pipeline used by the product, so runtime settings, guardrails, persona/style logic, and tool-routing behavior are preserved.

### Auth

- If `SLM_API_GATEWAY_KEY` is set, send `Authorization: Bearer <SLM_API_GATEWAY_KEY>` (or `X-API-Key`).
- If no gateway key is set, the existing instance PIN/unlock gate still applies.

### Request compatibility

- Accepts OpenAI-style `messages`, `model`, `temperature`, and `max_tokens`/`max_completion_tokens`.
- `stream: true` is currently rejected (set `stream: false` or omit it).
- Optional thread scoping can be passed via `threadId`, `thread_id`, or `metadata.threadId`.

### Example

```bash
curl -sS http://localhost:3000/api/gateway/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $SLM_API_GATEWAY_KEY" \
  -d '{
    "model": "slm-gateway",
    "messages": [
      { "role": "system", "content": "Respect all house rules." },
      { "role": "user", "content": "Write a short reply to: hey, are you free this evening?" }
    ]
  }'
```

## WhatsApp Runtime Commands (Self Chat)

Send a message to your own WhatsApp chat to control runtime without opening the dashboard:

- `pause worker`
- `resume worker`
- `restart worker`
- `pause app`
- `resume app`
- `restart app`
- `pause both`
- `resume both`
- `restart both`
- `status worker`
- `status app`
- `status both`

Notes:
- Commands only execute from your self chat (your own JID).
- Shortcuts are supported for worker control: `pause`, `resume`, `restart`, `status` (and `/slm pause`, etc.).
- Send `help` anytime to get the full command list in chat.
- Optional hard gate: set `SLM_SELF_CONTROL_MESSAGE_PREFIX` (for example `slm`) to require prefixed commands like `slm help`.
- Implicit self-chat routing is enabled by default, so plain messages can trigger manager/smart routing without `openclaw` or `codex` mentions.
- Plain self-chat requests are also auto-routed by a model router (OpenClaw vs Codex improve), so explicit prefixes are no longer required.
- Natural language requests for conversation ops are supported, e.g. "run a reach out campaign", "start conversations with dormant contacts", "draft follow-up agenda for this week".
- A manager planner now runs first for self-chat requests and can orchestrate multiple in-system tools (runtime control, outreach run, agenda scheduling, settings/contacts snapshots, OpenClaw, Codex improve).
- Manager is now the primary self-chat control plane: it is evaluated before direct `openclaw`, `improve`, and runtime command handlers (which remain as compatibility fallback).
- Manager now sends live progress updates in self chat (plan ready, tools selected, per-step start/completion/failure, final summary).
- Manager tool registry and telemetry reference: `docs/self-control-manager-tool-registry.md`.
- `pause worker` pauses automation while keeping the listener alive, so `resume worker` still works.
- App controls use `.slm/app.pid` and start with `SLM_APP_START_CMD` (default `bun run dev:next`).

## Local Codex Self-Improve Commands (Self Chat)

You can also trigger a local Codex improvement run with project context from your self chat:

- `improve <prompt>` (or `/slm improve <prompt>`)
- `improve status`
- `improve latest`

Examples:
- `improve tighten self-message command handling and add tests`
- `improve status`

Notes:
- Runs execute in the background via `bun run self-improve -- --prompt "<prompt>"`.
- Latest report path: `.slm/self-improvement/latest.md`.

## OpenClaw CLI Commands (Self Chat)

Your current WhatsApp workflow stays intact. These commands trigger your local OpenClaw CLI from self chat (no OpenClaw WhatsApp channel required):

- `openclaw <instruction>`
- `openclaw status`
- `openclaw help`
- `@openclaw <instruction>`
- `anything @openclaw <instruction>`
- `anything openclaw: <instruction>`

Example:
- `openclaw summarize inbox and suggest top 3 follow-ups`
- `yo @openclaw summarize inbox and give me next actions`

Environment variables:
- `SLM_OPENCLAW_CLI_PATH` (optional, default `openclaw`)
- `SLM_OPENCLAW_AGENT_ID` (optional, default `main`)
- `SLM_OPENCLAW_AGENT_TIMEOUT_MS` (optional, default `21600000` = 6h)
- `SLM_SELF_CONTROL_SMART_ROUTING_ENABLED` (optional, default `true`)
- `SLM_SELF_CONTROL_ROUTER_MODEL` (optional, default `gpt-5.2`)
- `SLM_SELF_CONTROL_ROUTER_TIMEOUT_MS` (optional, default `45000`)
- `SLM_SELF_CONTROL_MANAGER_ENABLED` (optional, default `true`)
- `SLM_SELF_CONTROL_MANAGER_MODEL` (optional, default `gpt-5.2`)
- `SLM_SELF_CONTROL_MANAGER_TIMEOUT_MS` (optional, default `60000`)
- `SLM_SELF_CONTROL_MANAGER_MAX_STEPS` (optional, default `3`, max `5`)
- `SLM_SELF_CONTROL_IMPLICIT_ROUTING_ENABLED` (optional, default `true`; set `false` to enforce strict prefix-only command handling)

Long-running behavior:
- `openclaw <instruction>` and `@openclaw <instruction>` are queued and run in background.
- You get an immediate queued confirmation, then a final completion/failure message when OpenClaw finishes (supports multi-hour jobs).

## Useful Commands

- `bun run dev:next` - Next.js dashboard only
- `bun run dev:convex` - Convex backend only
- `bun run worker` - WhatsApp worker only
- `bun run self-improve --dry-run` - build improvement context and prompt without calling Codex
- `bun run self-improve` - run one Codex self-improvement cycle
- `bun run self-improve:daemon` - run recurring self-improvement cycles locally
- `bun run lint` - lint checks

## Self-Improvement Cycle (Local Codex Job)

This repo includes a local recurring job runner that feeds project context/logs into `codex exec` and writes actionable improvement reports.

- Config file: `self-improvement.config.json`
- Runner: `scripts/self-improvement-cycle.ts`
- Reports output: `.slm/self-improvement/runs/<run-id>/report.md`
- Latest report shortcut: `.slm/self-improvement/latest.md`
- UI workspace: `/self-improvement` (history, status, errors, and full run reports)

Run one cycle:

```bash
bun run self-improve
```

Run continuously (default every 240 minutes, configurable):

```bash
bun run self-improve:daemon
```

Use system cron (example: every 6 hours):

```bash
0 */6 * * * cd /Users/joshua/Documents/lifemanager && /opt/homebrew/bin/bun run self-improve >> .slm/self-improvement/cron.log 2>&1
```

More setup/tuning details: `docs/self-improvement-cycle.md`

## Voice Notes (whisper.cpp, No API Key)

Incoming WhatsApp voice notes/audio can be transcribed locally and fed into the same AI reply flow.

1. Build/install `whisper.cpp` locally so `whisper-cli` is available.
2. Download a Whisper GGML model file (for example `ggml-base.en.bin`).
3. Set env vars in `.env.local`:

```bash
SLM_WHISPER_ENABLED=true
SLM_WHISPER_CLI_PATH=whisper-cli
SLM_WHISPER_MODEL_PATH=/absolute/path/to/ggml-base.en.bin
SLM_WHISPER_LANGUAGE=auto
SLM_WHISPER_THREADS=4
SLM_WHISPER_TIMEOUT_MS=120000
SLM_FFMPEG_PATH=ffmpeg
```

Notes:
- `SLM_WHISPER_MODEL_PATH` is required.
- `ffmpeg` is optional but recommended; when available, audio is converted to 16k mono WAV before transcription for better compatibility.
- When transcription fails or is not configured, the worker still ingests the message and marks transcription as unavailable in logs/events.

## Project Map

- `src/app/*` dashboard pages + route handlers
- `src/worker/*` Baileys worker and AI fallback pipeline
- `src/lib/*` Convex client refs and server helpers
- `convex/*` schema, functions, actions, and cron jobs

## Notes

- The worker stores WhatsApp auth at `WHATSAPP_AUTH_PATH` (default `.wa_auth`).
- `SLM_HISTORY_SYNC_ENABLED` defaults to `true`; group + broadcast/system JIDs are ignored at the socket layer so sync stays direct-chat only.
- Group chats are ignored by default unless rules override behavior.
- High-risk inbound content is guardrail-blocked for manual review.
