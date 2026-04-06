# Social Life Manager

Local-first WhatsApp brain built with Bun, Next.js, TypeScript, Convex, and Baileys.

## What It Does

- Runs a dashboard for queue triage, conversations, follow-ups, style controls, rules, and system health.
- Stores backend state in Convex (threads, messages, drafts, outbox, follow-ups, todos, style memory, logs).
- Keeps a persistent Baileys worker for WhatsApp socket handling.
- Uses Azure AI Foundry for reply generation with local `codex exec` fallback.
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

If you use an Azure AI Foundry `.../responses` URI, set `AZURE_AI_API_STYLE=responses` (or keep `auto` and it will be inferred).

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

## Useful Commands

- `bun run dev:next` - Next.js dashboard only
- `bun run dev:convex` - Convex backend only
- `bun run worker` - WhatsApp worker only
- `bun run lint` - lint checks

## Project Map

- `src/app/*` dashboard pages + route handlers
- `src/worker/*` Baileys worker and AI fallback pipeline
- `src/lib/*` Convex client refs and server helpers
- `convex/*` schema, functions, actions, and cron jobs

## Notes

- The worker stores WhatsApp auth at `WHATSAPP_AUTH_PATH` (default `.wa_auth`).
- Group chats are ignored by default unless rules override behavior.
- High-risk inbound content is guardrail-blocked for manual review.
