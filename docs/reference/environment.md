# Environment Variables

This document catalogs environment variables used across `src/*`, `convex/*`, and `scripts/*`.

Primary source template: `.env.example`

## 1) Required for baseline runtime

- `CONVEX_URL` (required unless `NEXT_PUBLIC_CONVEX_URL` is provided)
- `NEXT_PUBLIC_CONVEX_URL` (frontend/runtime Convex URL)
- `AZURE_AI_ENDPOINT`
- `AZURE_AI_API_KEY`
- `AZURE_AI_MODEL` (default in template: `gpt-5.4`)

## 2) Instance security and bootstrap

- `SLM_INSTANCE_PIN`
  - Optional env-managed instance PIN override.
  - If set, setup-managed PIN in `.slm/instance-config.json` is not the source of truth.
- `SLM_INSTANCE_PIN_TTL_DAYS` (default: `30`, bounded internally)
- `SLM_INSTANCE_COOKIE_SECRET` (defaults to PIN when unset)
- `SLM_API_GATEWAY_KEY`
  - Enables and secures `/api/gateway/v1/chat/completions`.
- `SLM_SETUP_SECRET`
  - Enables remote setup bootstrap flows before local setup completion.

## 3) Azure/OpenAI generation configuration

### Primary Azure AI config
- `AZURE_AI_ENDPOINT`
- `AZURE_AI_API_KEY`
- `AZURE_AI_MODEL`
- `AZURE_AI_API_STYLE` (`auto` | `chat_completions` | `responses`, default `auto`)
- `AZURE_AI_SYSTEM_INSTRUCTION`

### Image generation config
- `AZURE_AI_IMAGE_ENDPOINT`
- `AZURE_AI_IMAGE_API_KEY`
- `AZURE_AI_IMAGE_MODEL` (template default: `gpt-image-1`)

### Video generation config
- `AZURE_AI_VIDEO_ENDPOINT`
- `AZURE_AI_VIDEO_API_KEY`
- `AZURE_AI_VIDEO_MODEL`

### Legacy/compat alias vars still read in code
- `AZURE_OPENAI_ENDPOINT`
- `AZURE_OPENAI_API_KEY`
- `AZURE_OPENAI_MODEL`
- `AZURE_OPENAI_IMAGE_MODEL`
- `AZURE_OPENAI_VIDEO_ENDPOINT`
- `AZURE_OPENAI_VIDEO_API_KEY`
- `AZURE_OPENAI_VIDEO_MODEL`
- `OPENAI_API_KEY` (fallback key source in some paths)

### AI runtime tuning variables
- `SLM_AI_REPLY_POLICY`
- `SLM_AI_FALLBACK_MODE` (`all` | `azure_only`)
- `SLM_AI_MAX_CONTEXT_TOKENS`
- `SLM_AI_ADAPTIVE_CONTEXT_MIN_TOKENS`
- `SLM_AI_CONTEXT_UTILIZATION_TARGET`
- `SLM_AI_CONTEXT_EXPANSION_LINE_STEP`
- `SLM_AI_CONTEXT_RESERVE_TOKENS`
- `SLM_AI_GUARDRAIL_REPROMPT_LIMIT`
- `SLM_AI_REPLY_GUARDRAIL_RETRY_MAX_ATTEMPTS`
- `SLM_AI_REPLY_GUARDRAIL_RETRY_MAX_TOTAL_MS`

### Model tool loop controls
- `SLM_AI_TOOL_MAX_ROUNDS`
- `SLM_AI_TOOL_MAX_CALLS_PER_ROUND`
- `SLM_AI_TOOL_TIMEOUT_MS`

## 4) Codex fallback and self-improvement

- `CODEX_CLI_PATH` (default commonly `codex`)
- `CODEX_FALLBACK_MODEL` (fallback default in code: `gpt-5.2`)
- `CODEX_SELF_IMPROVE_MODEL` (used by self-improvement cycle)

## 5) Worker runtime and process controls

- `WHATSAPP_AUTH_PATH` (default `.wa_auth`)
- `INSTAGRAM_AUTH_PATH` (default `.ig_auth`)
- `SLM_WORKER_ID` (default `local-worker` in template)
- `SLM_INSTAGRAM_WORKER_ID` (default `instagram-worker`)
- `SLM_OUTBOX_POLL_MS`
- `SLM_INSTAGRAM_OUTBOX_POLL_MS`
- `SLM_INSTAGRAM_INBOX_POLL_MS`
- `SLM_INBOUND_CONCURRENCY`
- `SLM_OUTBOX_CONCURRENCY`
- `SLM_APP_START_CMD` (default `bun run dev:next`)
- `SLM_CALL_FALLBACK_GRACE_MS`
- `SLM_CALL_CONTEXT_MIN_DURATION_MS`
- `SLM_CALL_OFFER_RECENCY_MAX_MS`
- `SLM_CALL_FALLBACK_TEXT`
- `SLM_CALL_FALLBACK_TEXT_VARIANTS`

### Runtime toggles and behavior defaults (env-level fallbacks)
- `SLM_QUIET_HOURS_ENABLED`
- `SLM_AUTO_MARK_READ_ENABLED`
- `SLM_AUTO_MARK_READ_GROUPS`
- `SLM_AUTO_MARK_READ_STATUS`
- `SLM_PRESENCE_SUBSCRIBE_ENABLED`
- `SLM_CHAT_MODIFY_QUIET_HOURS_ENABLED`
- `SLM_ABOUT_AUTOMATION_ENABLED`
- `SLM_ABOUT_AUTOMATION_INTERVAL_MINUTES`
- `SLM_ABOUT_AUTOMATION_TEMPLATE`

### Generic tool-execution guards
- `SLM_TOOL_TIMEOUT_MS`
- `SLM_TOOL_GLOBAL_DEADLINE_MS`
- `SLM_TOOL_MAX_TOOLS_PER_RUN`

## 6) Self-chat routing / manager / OpenClaw bridge

- `SLM_OPENCLAW_CLI_PATH` (default `openclaw`)
- `SLM_OPENCLAW_AGENT_ID` (default `main`)
- `SLM_OPENCLAW_AGENT_TIMEOUT_MS` (default `21600000` in template)
- `SLM_SELF_CONTROL_SMART_ROUTING_ENABLED` (default `true` in template)
- `SLM_SELF_CONTROL_ROUTER_MODEL` (template default `gpt-5.2`)
- `SLM_SELF_CONTROL_ROUTER_TIMEOUT_MS`
- `SLM_SELF_CONTROL_MANAGER_ENABLED`
- `SLM_SELF_CONTROL_MANAGER_MODEL`
- `SLM_SELF_CONTROL_MANAGER_TIMEOUT_MS`
- `SLM_SELF_CONTROL_MANAGER_MAX_STEPS`
- `SLM_SELF_CONTROL_IMPLICIT_ROUTING_ENABLED`
- `SLM_SELF_CONTROL_MESSAGE_PREFIX`

## 7) History, context, and embeddings

- `SLM_HISTORY_SYNC_ENABLED` (template default `true`)
- `SLM_HISTORY_FETCH_ON_DEMAND`
- `SLM_HISTORY_FETCH_MAX_BATCH`
- `SLM_HISTORY_FETCH_MAX_ROUNDS`
- `SLM_EMBEDDINGS_LOCAL_ENABLED`
- `SLM_EMBEDDINGS_MODEL` (template default `all-MiniLM-L6-v2`)
- `SLM_EMBEDDINGS_CACHE_DIR`
- `SLM_VISION_FILTER_MODE` (`smart` | `all` | `none`)
- `SLM_VISION_FILTER_UNCAPTIONED_COOLDOWN_MS`

## 8) Humanization controls

- `SLM_DELAY_MIN_MS`
- `SLM_DELAY_MAX_MS`
- `SLM_TYPING_MIN_MS`
- `SLM_TYPING_MAX_MS`

## 9) Voice transcription and voice-note generation

### Whisper/STT
- `SLM_WHISPER_ENABLED`
- `SLM_WHISPER_CLI_PATH`
- `SLM_WHISPER_MODEL_PATH`
- `SLM_WHISPER_LANGUAGE`
- `SLM_WHISPER_THREADS`
- `SLM_WHISPER_TIMEOUT_MS`

### ffmpeg/ffprobe
- `SLM_FFMPEG_PATH`
- `SLM_FFPROBE_PATH`

### Voice note clone setup/runtime
- `SLM_VOICE_NOTES_ENABLED`
- `SLM_VOICE_GENERATE_TIMEOUT_MS`
- `SLM_VOICE_FFMPEG_TIMEOUT_MS`
- `SLM_VOICE_SETUP_PYTHON_BIN`
- `SLM_VOICE_PYTHON_BASE_BIN`
- `SLM_VOICE_SETUP_TIMEOUT_MS`
- `SLM_VOICE_SAMPLE_TIMEOUT_MS`

## 10) Spend/cost analytics

- `SLM_AI_PRICING_VERSION`
- `SLM_AI_COST_AZURE_INPUT_PER_1M_USD`
- `SLM_AI_COST_AZURE_OUTPUT_PER_1M_USD`
- `SLM_AI_COST_DEFAULT_INPUT_PER_1M_USD`
- `SLM_AI_COST_DEFAULT_OUTPUT_PER_1M_USD`
- Also supported dynamically by pattern:
  - `SLM_AI_COST_<MODEL_NAME_NORMALIZED>_INPUT_PER_1M_USD`
  - `SLM_AI_COST_<MODEL_NAME_NORMALIZED>_OUTPUT_PER_1M_USD`

## 11) External connector search

- `SERPAPI_API_KEY` (used by external web search action path)
- `PERSONAL_CONNECTOR_ENDPOINTS` (connector endpoint list for personal connector search)

## 12) UI and miscellaneous

- `NEXT_PUBLIC_SPLINE_ACTIVITY_SCENE_URL`
- `LOG_LEVEL`
- `BUN_BIN`
- `SHELL`
- `NODE_ENV`

## Notes

- Runtime settings in Convex (`settings:save`) can override many env fallbacks at execution time.
- Keep secrets only in `.env.local` (do not commit).
- If preparing public release, keep `.env.example` in sync with variables listed here.
