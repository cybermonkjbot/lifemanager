# Odogwu HQ

Odogwu HQ is your AI communication double for WhatsApp and Instagram. It can read the room, draft replies in your style, keep conversations warm, and, when you allow it, chat as you so people are not left hanging while you are busy.

This project combines:
- a private dashboard for seeing who needs you
- replies written in your tone, ready for approval or automatic sending
- memory of conversation context, promises, and follow-ups
- stickers, memes, and optional voice notes so replies do not feel robotic
- safe controls for when it should draft, send, pause, or ask you first

This is a proprietary, self-hostable product. Deep technical references live in `docs/reference`.

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
- [Distribution Notes](#distribution-notes)
- [Reference Docs](#reference-docs)

## What This Project Does

Odogwu HQ is a local-first personal automation system that helps you stay present in your chats without being glued to your phone. It watches incoming messages, understands the conversation history, writes like you, and can either queue replies for approval or send them automatically inside the boundaries you set.

Core capabilities:
- Watches your WhatsApp and Instagram conversations.
- Understands who you are talking to, what has been said before, and what kind of reply fits.
- Writes replies that match your tone, context, relationship, and current boundaries.
- Can chat on your behalf in approved/autonomous mode, including follow-ups, reconnects, and everyday replies.
- Lets you approve first, automate trusted situations, pause autonomy, or force review.
- Supports stickers, memes, reactions, and optional cloned voice-note responses.
- Supports a setup/onboarding flow with local instance security (PIN + unlock session).
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
- `Memes` (`/memes`): meme generation, sticker/meme asset review, and outbound media asset management.
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
- Sticker-aware inbound context, outbound sticker replies, and rolling sticker-thread behavior.
- Voice note STT plus optional cloned voice-note generation for explicit `/vn` requests or configured automatic replies.

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

This repository is proprietary and **not open source**. See [LICENSE](./LICENSE).

- No rights are granted unless they are expressly authorized in a separate written agreement.
- Self-hostability is a product and deployment feature, not a grant to copy, redistribute, or publish the source.
- Do not publish the working tree or generated builds without explicit authorization.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for private contribution workflow and contribution terms.

## Support and Security

- Support policy: [SUPPORT.md](./SUPPORT.md)
- Security policy and disclosure process: [SECURITY.md](./SECURITY.md)
- Community behavior standards: [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)

## Distribution Notes

Before any external distribution:

1. Confirm the intended distribution channel: hosted service, desktop build, container image, or licensed source access.
2. Confirm dependency license obligations for the chosen distribution format.
3. Ensure secrets, auth artifacts, runtime state, and customer data are excluded.
4. Ensure private admin, billing, tenant, and managed-secret features are only included in authorized builds.
5. Confirm release notes and support terms match the actual distribution.

Manual repository settings still required:

1. Keep the repository private unless a release plan explicitly says otherwise.
2. Enable branch protection on `main` and require CI + CodeQL checks.
3. Enable private vulnerability reporting and GitHub security features (secret scanning, Dependabot alerts, push protection).
4. Scrub full git history for secrets before any authorized source handoff.

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
