# Dependencies

This inventory is based on `package.json` in the current repo state.

## Runtime stack

- Bun runtime/package manager
- Next.js `16.2.2` (App Router)
- React `19.2.4`
- Convex `1.34.1`
- TypeScript `^5`

## Runtime Dependencies (`dependencies`)

| Package | Version | Why it exists in this project |
|---|---:|---|
| `@azure-rest/ai-inference` | `^1.0.0-beta.6` | Azure AI Foundry/Inference client integration for generation paths. |
| `@azure/core-auth` | `^1.10.1` | Auth credential support for Azure request flows. |
| `@splinetool/react-spline` | `^4.1.0` | Embedding Spline scenes (Activity Core visuals). |
| `@xenova/transformers` | `^2.17.2` | Local embedding model execution for semantic context search/rerank. |
| `baileys` | `^7.0.0-rc.9` | WhatsApp Web socket integration for worker ingest/send. |
| `clsx` | `^2.1.1` | Utility for conditional className composition in UI. |
| `convex` | `^1.34.1` | Backend database/functions platform and React client hooks. |
| `convex-helpers` | `^0.1.114` | Helper utilities around Convex patterns. |
| `date-fns` | `^4.1.0` | Date formatting/manipulation in UI and runtime logic. |
| `instagram-private-api` | `^1.46.1` | Instagram login/session/API handling for IG worker/setup. |
| `next` | `16.2.2` | Full-stack web framework for dashboard and route handlers. |
| `pdf-parse` | `^2.4.5` | PDF extraction for document-aware reply context. |
| `pino` | `^10.3.1` | Structured logging for workers/runtime processes. |
| `qrcode` | `^1.5.4` | QR code generation during WhatsApp setup pairing flow. |
| `react` | `19.2.4` | UI rendering runtime. |
| `react-dom` | `19.2.4` | Browser/server React DOM bindings. |
| `zod` | `^4.3.6` | Validation/parsing utilities where schema typing is needed. |

## Development Dependencies (`devDependencies`)

| Package | Version | Why it exists in this project |
|---|---:|---|
| `@tailwindcss/postcss` | `^4` | Tailwind v4 PostCSS integration. |
| `@types/node` | `^20` | Node.js typing for TS tooling. |
| `@types/qrcode` | `^1.5.6` | Type definitions for `qrcode`. |
| `@types/react` | `^19` | React typing support. |
| `@types/react-dom` | `^19` | React DOM typing support. |
| `babel-plugin-react-compiler` | `1.0.0` | React compiler plugin usage path. |
| `concurrently` | `^9.2.1` | Multi-process local dev command orchestration (`dev:all`). |
| `eslint` | `^9` | Linting engine. |
| `eslint-config-next` | `16.2.2` | Next.js ESLint rules/config. |
| `tailwindcss` | `^4` | Utility-first CSS framework. |
| `typescript` | `^5` | Type checker/transpilation support. |

## Optional / External Tooling Dependencies

These are not all npm dependencies but are important operational dependencies:

- `codex` CLI (fallback generation + self-improvement cycle)
- `whisper-cli` (`whisper.cpp`) for local transcription
- `ffmpeg` / `ffprobe` for media conversion/processing
- Python + virtualenv for optional VoxCPM voice-note module install path

## Package Manager Notes

`package.json` includes:
- `ignoreScripts`: `sharp`, `unrs-resolver`
- `trustedDependencies`: `sharp`, `unrs-resolver`

If open-sourcing, document why these script trust settings are required for your target environments.
