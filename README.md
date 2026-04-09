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
- `SLM_HISTORY_SYNC_ENABLED=true` (recommended for history/context enrichment)
- `SLM_EMBEDDINGS_LOCAL_ENABLED=true` (semantic context rerank)

If you use an Azure AI Foundry `.../responses` URI, set `AZURE_AI_API_STYLE=responses` (or keep `auto` and it will be inferred).

Optional history/context tuning:
- `SLM_HISTORY_FETCH_ON_DEMAND=true`
- `SLM_HISTORY_FETCH_MAX_BATCH=50`
- `SLM_HISTORY_FETCH_MAX_ROUNDS=3`
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

## WhatsApp Setup Wizard

1. Open the dashboard at `http://localhost:3000/setup`.
2. Click `Start QR Session`.
3. Scan the QR code with WhatsApp on your phone.
4. Wait for `Connected` status.
5. Start the worker (`bun run worker`) if it is not already running.

If QR pairing keeps disconnecting, use `Get Pairing Code` in the wizard and enter your phone number in international format (for example `2348012345678`).

The setup wizard uses API routes:
- `POST /api/setup/whatsapp/start`
- `GET /api/setup/whatsapp/status`
- `POST /api/setup/whatsapp/stop`
- `POST /api/setup/whatsapp/reset`

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
- Group chats are ignored by default unless rules override behavior.
- High-risk inbound content is guardrail-blocked for manual review.
