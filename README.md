# Social Life Manager

Local-first social orchestration system for WhatsApp and Instagram, built with Bun, Next.js (App Router), Convex, and long-running channel workers.

This project combines:
- a real-time operator dashboard
- autonomous and review-first messaging workflows
- context-aware AI reply generation with fallback providers
- follow-up / todo extraction and scheduling
- media and meme workflows
- channel setup, runtime controls, and health telemetry

If you are preparing this repo for open source, this document is the entrypoint. Deep references live in `docs/reference`.

## Table of Contents

- [What This Project Does](#what-this-project-does)
- [System Architecture](#system-architecture)
- [Feature Surface](#feature-surface)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Runtime Scripts](#runtime-scripts)
- [OpenAI-Compatible Gateway](#openai-compatible-gateway)
- [Repository Layout](#repository-layout)
- [Testing](#testing)
- [License](#license)
- [Contributing](#contributing)
- [Support and Security](#support-and-security)
- [Open-Source Readiness Checklist](#open-source-readiness-checklist)
- [Reference Docs](#reference-docs)

## What This Project Does

Social Life Manager is a local-first personal automation system for social messaging.

Core capabilities:
- Ingests inbound activity from WhatsApp and Instagram workers.
- Persists messages, thread state, drafts, outbox jobs, follow-ups, todos, media assets, and telemetry in Convex.
- Generates replies with Azure AI first and Codex CLI fallback.
- Applies guardrails, quality checks, mimicry controls, and conversation steering rules.
- Supports review-first and autonomous send modes.
- Supports a setup/onboarding flow with local instance security (PIN + unlock session).
- Exposes an OpenAI-style chat completion endpoint powered by the same internal reply pipeline.
- Includes a local self-improvement loop (`codex exec`) with run history and dashboard visibility.

## System Architecture

High-level runtime topology:

1. `Next.js` app (`src/app/*`) renders the dashboard and serves route handlers under `/api/*`.
2. `Convex` backend (`convex/*`) stores state and executes queries/mutations/actions/crons.
3. `WhatsApp` worker (`src/worker/index.ts` via supervisor) handles socket events, ingestion, drafting, and outbox sends.
4. `Instagram` worker (`src/worker/instagram.ts` via supervisor) handles IG inbox/outbox flow.
5. `Azure AI` is the primary generation provider (text + optional image/video meme generation).
6. `Codex CLI` is used as fallback generation and for local self-improvement runs.
7. Optional local ML/audio tooling:
   - local embeddings via `@xenova/transformers`
   - local voice transcription via `whisper.cpp`
   - optional cloned voice note generation via VoxCPM setup flow

Automations are split between:
- worker-side loops (polling/claiming/sending/maintenance)
- Convex cron jobs (follow-up promotion, outreach, retention, stale cleanup, AI tuning jobs)

## Feature Surface

The dashboard is organized into product areas in `src/lib/ui/dashboard-nav.ts`.

Primary areas:
- `Home` (`/`): command-style home surface and navigation helper.
- `Queue` (`/queue`): draft approvals, snoozes/rejections, follow-up/todo actions, guardrail resolution.
- `Conversations` (`/conversations`): thread timeline, draft edits, grounding, personality overrides, per-thread ops.
- `Status` (`/status`): status drafts/posts pipeline and status automation controls.
- `Media` (`/media`): unified media stream with source-thread linkage.
- `Memes` (`/memes`): meme generation and meme asset review.
- `Backlog` (`/backlog`): stale/unread thread triage, importance/relationship overrides, snoozing, reconnect drafts.
- `Follow-ups` (`/followups`): follow-up timeline, confirm/snooze/cancel, agenda todo creation.
- `Activity Core` (`/activity-core`): live activity and media signal stream.
- `Systems Design` (`/systems-design`): runtime/system event visibility.

Secondary areas:
- `Setup` (`/setup`): onboarding, channel pairing, worker runtime checks.
- `Style Lab` (`/style-lab`): mimicry, learned traits, style rollback, persona packs.
- `Rules` (`/rules`): ignore target controls and boundary rules.
- `Settings` (`/settings`): full runtime tuning surface.
- `System` (`/system`): health metrics, provider traces, telemetry feed.
- `Spending` (`/spending`): Azure usage + spend analytics with optional env pricing.
- `Self Improvement` (`/self-improvement`): local Codex run history/report views.

Additional feature domains:
- Self-chat runtime commands (`pause/resume/restart/status` for worker/app/both).
- Smart self-control routing and manager planning for self-chat intents.
- Contact memory extraction and retrieval tools.
- Conversation intelligence signals (check-ins, topic lanes, pivot/close guidance).
- Relationship state tracking and adaptive romantic morning/outreach flows.
- Voice note STT and optional TTS cloning flow.

For complete capability mapping, see [docs/reference/feature-catalog.md](docs/reference/feature-catalog.md).

## Quick Start

### Option A: one-command installer (recommended)

From local checkout:

```bash
npx --yes . -- --in-place --system --serve
```

From npm after publish:

```bash
npx --yes odogwuhq -- --system --serve
```

From GitHub directly:

```bash
npx --yes github:cybermonkjbot/lifemanager -- --system --serve
```

Installer supports flags such as:
- `--no-system`
- `--with-voice`
- `--no-serve`
- `--no-config`
- `--yes`
- `--dir <path>`

### Option B: manual local setup

1. Install dependencies:

```bash
bun install
```

2. Create local env file:

```bash
cp .env.example .env.local
```

3. Set required values at minimum:
- `CONVEX_URL` (or `NEXT_PUBLIC_CONVEX_URL`)
- `AZURE_AI_ENDPOINT`
- `AZURE_AI_API_KEY`
- `AZURE_AI_MODEL`

4. Start all services:

```bash
bun run dev:all
```

This starts:
- `next dev`
- `convex dev`
- `whatsapp worker supervisor`
- `instagram worker supervisor`

5. Open the app and complete setup:
- `http://localhost:3000`
- first run routes to `/setup`
- create/confirm instance security and connect channels

## Configuration

Primary configuration sources:
- `.env.local` (runtime environment)
- Convex `appConfig` values (mutable runtime config via Settings page)
- local instance setup state (`.slm/instance-config.json`)

Key references:
- Full env var reference: [docs/reference/environment.md](docs/reference/environment.md)
- Convex function/module map: [docs/reference/feature-catalog.md](docs/reference/feature-catalog.md)
- HTTP route reference: [docs/reference/http-api.md](docs/reference/http-api.md)

## Runtime Scripts

From `package.json`:

- `bun run dev` / `bun run dev:next`: dashboard only
- `bun run dev:convex`: Convex backend only
- `bun run worker`: WhatsApp worker supervisor
- `bun run worker:instagram`: Instagram worker supervisor
- `bun run worker:raw`: direct WhatsApp worker entry
- `bun run worker:instagram:raw`: direct Instagram worker entry
- `bun run dev:all`: run next + convex + whatsapp worker + instagram worker concurrently
- `bun run build`: Next.js production build
- `bun run start`: production Next.js start
- `bun run lint`: ESLint checks
- `bun run pidgin:refresh`: refresh pidgin lexicon candidates
- `bun run pidgin:promote`: promote approved pidgin lexicon entries
- `bun run pidgin:refresh-and-promote`: run both lexicon stages
- `bun run self-improve`: run one local self-improvement cycle
- `bun run self-improve:daemon`: recurring self-improvement daemon

## OpenAI-Compatible Gateway

Endpoint:
- `POST /api/gateway/v1/chat/completions`

Behavior:
- OpenAI-style request/response shape.
- Uses the same internal generation pipeline as dashboard + workers.
- Requires `SLM_API_GATEWAY_KEY` and `Authorization: Bearer ...` (or `X-API-Key`).
- `stream: true` is rejected.
- Optional thread scoping via `threadId`, `thread_id`, or metadata aliases.
- Adds an `slm` object in response with provider/model/quality/guardrail/context metadata.

Example:

```bash
curl -sS http://localhost:3000/api/gateway/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $SLM_API_GATEWAY_KEY" \
  -d '{
    "model": "slm-gateway",
    "messages": [
      { "role": "system", "content": "Respect all house rules." },
      { "role": "user", "content": "Draft a short check-in text for this evening." }
    ]
  }'
```

## Repository Layout

- `src/app/*`: Next.js pages and API route handlers
- `src/components/*`: client/server dashboard components
- `src/lib/*`: shared runtime helpers, auth/gate helpers, setup managers, UI helpers
- `src/worker/*`: WhatsApp/Instagram workers and AI orchestration logic
- `convex/*`: schema, backend modules, actions, and crons
- `scripts/*`: installer, lexicon tooling, self-improvement runner, voice utility script
- `docs/*`: design docs, reports, and reference material
- `data/*`: lexicon approval/candidate inputs
- `shared/*`: shared constants/generated lexicon payloads

## Testing

The repo includes extensive `*.test.ts` coverage in both:
- `src/worker`
- `convex`

Run all tests:

```bash
bun test
```

Run targeted tests (examples):

```bash
bun test src/worker
bun test convex
```

## License

This repository is **source-available** under the [PolyForm Noncommercial 1.0.0 license](./LICENSE).

- Personal and other non-commercial use is permitted.
- Commercial use is not permitted under the default license.
- Because commercial use is restricted, this license does not meet OSI open source criteria.

If you need commercial usage rights, contact the maintainers to discuss a separate commercial license.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for contribution workflow and contribution license terms.

## Support and Security

- Support policy: [SUPPORT.md](./SUPPORT.md)
- Security policy and disclosure process: [SECURITY.md](./SECURITY.md)
- Community behavior standards: [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)

## Open-Source Readiness Checklist

Implemented in this repository:

1. Distribution license and package metadata are aligned (`LICENSE`, `package.json`).
2. Community and governance docs are present (`CONTRIBUTING`, `CODE_OF_CONDUCT`, `SUPPORT`, `SECURITY`).
3. Contributor workflows are present (`.github/ISSUE_TEMPLATE/*`, `.github/pull_request_template.md`, `.github/CODEOWNERS`).
4. Automation is present (`.github/workflows/ci.yml`, `.github/workflows/codeql.yml`, `.github/dependabot.yml`).
5. Release process docs are present (`CHANGELOG.md`, `RELEASE.md`).

Manual GitHub repo settings still required:

1. Enable branch protection on `main` and require CI + CodeQL checks.
2. Enable private vulnerability reporting and GitHub security features (secret scanning, Dependabot alerts, push protection).
3. Decide whether to enable GitHub Discussions for support questions.
4. Scrub full git history for secrets before public launch (if not already done).

## Reference Docs

- Feature catalog: [docs/reference/feature-catalog.md](docs/reference/feature-catalog.md)
- HTTP API reference: [docs/reference/http-api.md](docs/reference/http-api.md)
- Environment variables: [docs/reference/environment.md](docs/reference/environment.md)
- Dependencies and stack inventory: [docs/reference/dependencies.md](docs/reference/dependencies.md)
- Release process: [RELEASE.md](./RELEASE.md)
- Changelog: [CHANGELOG.md](./CHANGELOG.md)

Project-specific implementation docs already present in this repo:
- [docs/self-control-manager-tool-registry.md](docs/self-control-manager-tool-registry.md)
- [docs/self-improvement-cycle.md](docs/self-improvement-cycle.md)
- [docs/whatsapp-autopilot-technical-gap.md](docs/whatsapp-autopilot-technical-gap.md)
