# Telegram Support Plan

Odogwu HQ should use GramJS (`telegram` npm package) for Telegram support. Treat it as the Telegram equivalent of the current Baileys worker: a Node/Bun-side session client that logs in with Telegram API ID, API hash, phone number, login code, and optional 2FA password, then normalizes events into the existing Convex messaging pipeline.

## Gate First

Telegram is now represented as a message provider and an admin entitlement. Admin plan config includes:

- `whatsappEnabled`
- `instagramEnabled`
- `imessageEnabled`
- `telegramEnabled`

Connector writes and worker token verification must pass provider-specific entitlement checks. If `telegramEnabled` is false for the tenant plan, the Telegram setup flow and worker cannot authenticate, ingest, claim outbox, or send.

## Adapter Shape

`src/worker/telegram.ts` is built around GramJS:

- Store a local StringSession under the existing runtime data directory.
- Use `TelegramClient` from `telegram`.
- Login with API ID/hash, phone number, login code, and optional 2FA password.
- Listen for new messages and map them into `convexRefs.inboundIngest` with `provider: "telegram"`.
- Claim outbox with `messageProvider: "telegram"`.
- Send text first; add media/reactions/replies after baseline delivery is reliable.

## Setup Surface

`/api/setup/telegram/*` routes exist for backend-only setup and worker control. Keep this out of the main UI until we intentionally design a quiet setup surface. Any future setup panel should request:

- Telegram API ID
- Telegram API hash
- Phone number
- Login code
- Optional 2FA password

Use managed secrets or local encrypted instance config for API ID/hash depending on hosted vs self-hosted mode.

## Safety Defaults

Keep Telegram disabled by default for all plans until the setup flow and worker have been tested end to end. Start in draft-first mode, direct chats first, then groups/channels once thread classification and outbound guardrails are verified.
