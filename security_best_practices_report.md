# Rate Limiting Security Report

## Executive Summary

Update, April 28, 2026: the fixes from this report have been implemented in app code. The repo now has a shared Convex-backed rate limiter with a local pre-setup fallback, route-level throttles for the sensitive Next.js endpoints listed below, direct Convex-side throttles for tenant registration/login functions, signed Code Lab webhooks, and request-size caps on webhook bodies.

I did a focused scan for rate limiting and abuse controls around the request-facing Next.js routes and public Convex functions. I did not find an app-level rate limiter, throttling helper, `429` response path, or `Retry-After` handling in the security-sensitive entry points reviewed. Existing authentication, same-origin checks, billing gates, payload length caps, and freshness caches reduce some risk, but they do not stop repeated requests from the same IP, email, tenant, API key, device, or webhook slug.

The highest-priority gaps are login/PIN brute-force protection, metering for AI/API gateway calls, and abuse controls for public webhooks and public Convex mutations. Because Convex public `query`, `mutation`, and `action` functions are exposed as public API surface, rate limiting should be enforced both at the Next.js route layer and at the Convex function layer for directly callable sensitive operations.

## High Severity

### RL-001: Login and PIN Attempts Are Not Rate Limited

- Rule ID: RATE-AUTH-001
- Severity: High
- Location: `src/app/api/auth/pin/route.ts` `POST`, lines 130-170 and 201-209; `src/app/api/admin/session/route.ts` `POST`, lines 17-36; `convex/tenantAccounts.ts` `getLoginPinSalt` and `verifyTenantLogin`, lines 334-369.
- Evidence: `/api/auth/pin` accepts form data, calls `verifyHostedTenantLogin`, and returns `401` for invalid credentials without recording failed attempts or issuing `429`. The self-hosted path calls `matchesInstancePin(pin)` directly. `/api/admin/session` similarly calls `verifyAdminCredentials(email, pin)` and redirects on failure without throttling. Convex exposes `getLoginPinSalt` and `verifyTenantLogin` publicly.
- Impact: Attackers can automate PIN/password guessing, email enumeration timing probes, and credential stuffing against hosted tenant login or admin unlock. Same-origin validation blocks basic CSRF, but it is not an anti-automation control.
- Fix: Add a shared rate limiter before credential checks, keyed by IP plus normalized email for hosted/admin login and by IP plus instance/device for local PIN. Use progressive backoff and return `429` with `Retry-After`. Also add Convex-backed failed-attempt counters or lockouts around `tenantAccounts:getLoginPinSalt` and `tenantAccounts:verifyTenantLogin`, because those public functions can be called without going through Next routes.
- Mitigation: At the edge or reverse proxy, immediately apply a conservative limit to `/api/auth/pin`, `/api/admin/session`, and Convex deployment paths for tenant login functions.
- False positive notes: Infrastructure-level WAF/CDN limits were not visible in this repo. If they exist, verify they key on email/tenant as well as IP.

### RL-002: OpenAI-Compatible Gateway Has API-Key Auth But No Usage Rate Limit

- Rule ID: RATE-AI-001
- Severity: High
- Location: `src/app/api/gateway/v1/chat/completions/route.ts` `POST`, lines 185-205, 245-257, 404-492.
- Evidence: The route rejects missing/invalid API keys and checks billing, then accepts JSON, caps inbound characters and output tokens, and calls `generateReplyWithFallback`. Tool execution can call `chatToolRouterPlan` with `execute: true` and `allowSideEffects: true`. There is no per-key, per-tenant, per-IP, or per-model quota gate.
- Impact: A leaked or shared gateway key can drive unbounded AI spend, exhaust provider quota, and repeatedly execute expensive context tools. CORS is intentionally wide for OpenAI compatibility, so API-key possession is the main boundary.
- Fix: Add a server-side quota check before model generation, keyed by gateway API key fingerprint, tenant/device, IP, model, and route. Track both request counts and estimated token/image/tool cost windows. Return OpenAI-shaped `429` errors with `Retry-After` and do not call `generateReplyWithFallback` after the limit is exceeded.
- Mitigation: Set provider-side spend limits and rotate gateway keys. Add emergency disable/config for the gateway if abuse is detected.
- False positive notes: Provider-side limits may exist outside the app, but the application currently has no visible local enforcement.

### RL-003: Public Code Lab Webhooks Can Be Replayed Without Auth, Signature, or Rate Limit

- Rule ID: RATE-WEBHOOK-001
- Severity: High
- Location: `src/app/api/code/webhooks/[projectSlug]/[handlerName]/route.ts` `POST`, lines 94-143.
- Evidence: The route reads JSON/text from any request, looks up a published project by URL slug, runs up to 50 SDK calls, may issue outbound HTTP calls, records a project run, and returns details. There is no signature verification, token, idempotency key, body-size cap, replay window, or rate limit.
- Impact: Anyone who discovers or guesses a webhook URL can repeatedly trigger project behavior, create database writes, force outbound requests to configured project URLs, and generate operational noise or cost.
- Fix: Require a per-webhook secret or HMAC signature, reject stale timestamps/nonces, cap body size, and rate limit by webhook slug plus source IP. Consider disabling outbound HTTP SDK calls for unsigned webhooks.
- Mitigation: Until signed webhooks exist, hide/rotate webhook slugs and put a reverse-proxy rate limit on `/api/code/webhooks/*`.
- False positive notes: Slug entropy helps against casual discovery, but it is not a durable rate limit or replay defense.

### RL-004: Public Convex Tenant Registration/Login Mutations Lack Direct Abuse Controls

- Rule ID: RATE-CONVEX-001
- Severity: High
- Location: `convex/tenantAccounts.ts` `registerFromDesktop`, lines 64-181; `issueConnectorToken`, lines 184-210; `getLoginPinSalt`, lines 334-359; `verifyTenantLogin`, lines 362-410.
- Evidence: These are registered with public `mutation`/`query`, not `internalMutation`/`internalQuery`. They validate input and PIN hashes, but there is no rate counter, attempt lockout, device registration throttle, or tenant/email creation quota in the functions themselves.
- Impact: Attackers can bypass Next.js route-level controls and call public Convex functions directly if they know the deployment URL. This can enable tenant-registration spam, login brute force, connector-token guessing pressure, and database write amplification.
- Fix: For operations that should only be called by trusted server routes, convert them to internal functions and invoke them through server-side Convex references. For operations that must stay public, add Convex-side rate-limit tables keyed by email, tenant, device ID, and caller fingerprint, with indexes and bounded retention cleanup.
- Mitigation: Restrict exposed Convex deployment URLs where possible and monitor tenant/device creation velocity.
- False positive notes: The scan did not verify external Convex deployment ACLs; this finding is based on public function registration in code.

## Medium Severity

### RL-005: Authenticated AI and Media Generation Routes Have No Per-Session/Tenant Limit

- Rule ID: RATE-AI-002
- Severity: Medium
- Location: `src/app/api/orchestrator/chat/route.ts` `POST`, lines 2322-2477; `src/app/api/actions/test-ai/route.ts` `POST`, lines 92-440; `src/app/api/actions/generate-meme/route.ts` `POST`, lines 81-233.
- Evidence: Each route checks `requireInstanceApiAccess`, validates body shape/length, and then performs AI or image generation. The test-AI and gateway routes have freshness caches, but cache hits only help repeated identical prompts; unique prompts remain unbounded.
- Impact: Any valid session, compromised browser session, or over-permissive tenant user can consume AI/image budget and tie up worker/provider capacity.
- Fix: Add tenant/session-scoped quotas for chat, test AI, and meme generation. Use stricter limits for image generation and tool-enabled chat than for lightweight reads. Include cost-aware counters, not just request counts.
- Mitigation: Enforce provider-side spending limits and expose current usage in admin/system views.
- False positive notes: Billing checks exist for some app access, but no request-frequency limiter was visible.

### RL-006: Billing Checkout and Webhook Endpoints Need Abuse-Specific Limits

- Rule ID: RATE-BILLING-001
- Severity: Medium
- Location: `src/app/api/billing/flutterwave/checkout/route.ts` `POST`, lines 62-150; `src/app/api/billing/flutterwave/webhook/route.ts` `POST`, lines 72-106.
- Evidence: Checkout requires instance and tenant owner/admin access, then calls Flutterwave and records checkout state. The webhook validates Flutterwave signatures before recording events. Neither endpoint has request throttling, duplicate request suppression, or explicit raw body size limits.
- Impact: Repeated checkout creation can create payment-link spam and external API load. Invalid webhook floods can consume app CPU before signature rejection, while valid replay floods can duplicate provider event processing unless Convex idempotency fully absorbs them.
- Fix: Rate limit checkout by tenant/user/IP and make `txRef` idempotent within a short window. For webhooks, cap raw body size before parsing, rate limit invalid signatures by IP, and dedupe provider event IDs before expensive work.
- Mitigation: Enable Flutterwave dashboard-side webhook retry/idempotency controls if available and monitor webhook failure rates.
- False positive notes: Convex billing logic may dedupe some events; the route still lacks visible request-level throttling.

### RL-007: Setup Bootstrap and Provisioning Actions Are High-Impact Without Throttling

- Rule ID: RATE-SETUP-001
- Severity: Medium
- Location: `src/app/api/setup/instance/route.ts` `POST`, lines 144-417; `src/app/api/setup/ai-settings/route.ts` `POST`, lines 34-119.
- Evidence: Before setup completion, remote access is gated by loopback or `SLM_SETUP_SECRET`. The instance setup route can register tenants, issue connector tokens, sync preferences, and write local config. The AI settings route performs AI generation once per setup run. There is no rate limit around failed setup-secret attempts, repeated tenant registration attempts, or the one-shot AI endpoint.
- Impact: If setup is exposed during onboarding or a bootstrap secret leaks, attackers can repeatedly hit expensive setup/provisioning behavior and attempt to race or exhaust the setup process.
- Fix: Rate limit setup endpoints by IP, setup-secret fingerprint, email, and device ID. Add a short-lived setup nonce/session after the bootstrap secret is accepted and throttle failed bootstrap-secret attempts.
- Mitigation: Keep setup routes bound to loopback unless remote setup is explicitly needed; rotate `SLM_SETUP_SECRET` after setup.
- False positive notes: The one-shot `setupAiSettingsToolAvailable` flag limits successful AI use, but failed/parallel attempts and setup mutations still need throttling.

### RL-008: Self-Improvement Run Launcher Has a Lock, But No Request Rate Limit or Strong Role Gate

- Rule ID: RATE-RUNTIME-001
- Severity: Medium
- Location: `src/app/api/system/self-improvement/conversation-quality/run/route.ts` `POST`, lines 57-164.
- Evidence: The route checks `requireInstanceApiAccess`, verifies no active lock file, prepares a finding run, then spawns `bun run self-improve`. The lock prevents concurrent runs, but repeated attempts can still hammer Convex and process startup/error paths, and `requireInstanceApiAccess` is broader than the runtime-control owner/admin gate used by other sensitive setup/control actions.
- Impact: A lower-privileged valid session or compromised session can repeatedly try to launch local automation and consume system resources.
- Fix: Use `requireRuntimeControlApiAccess` or a dedicated admin/owner check, then add a tenant/session/IP rate limit for launch attempts and failed runs.
- Mitigation: Keep this endpoint unavailable in production unless actively needed and monitor attempted launches.
- False positive notes: The file lock is useful concurrency control, but it is not a rate limiter and does not narrow authorization.

## Recommended Implementation Plan

1. Create a shared `src/lib/rate-limit.ts` helper for Next routes that supports fixed-window or sliding-window counters and returns consistent `429` JSON/OpenAI-shaped responses. If deployment is multi-instance, use Convex or Redis/Upstash rather than in-memory maps.
2. Add Convex-side rate-limit tables for public Convex functions that remain public. Include indexes by bucket key and expiry. Keep windows bounded to avoid unbounded table growth.
3. Protect credential endpoints first: `/api/auth/pin`, `/api/admin/session`, `tenantAccounts:getLoginPinSalt`, and `tenantAccounts:verifyTenantLogin`.
4. Protect expensive endpoints next: gateway chat completions, orchestrator chat, test AI, meme generation, checkout creation, setup AI, and self-improvement run launches.
5. Require signatures for Code Lab webhooks and add per-webhook idempotency/replay protection.
6. Add metrics: count allowed/blocked requests, dimensions for route/bucket/tenant, and alert on `429` spikes or near-budget AI usage.

## Suggested Initial Limits

- Login/admin PIN: 5 failures per 10 minutes per email plus IP; 20 per hour per IP; progressive lockout after repeated windows.
- API gateway: 30 requests/minute per API key, plus daily token/cost budget; lower limits for tool-enabled requests.
- Dashboard AI/test AI: 20 requests/hour per tenant/user; image generation 5/hour and 25/day.
- Code webhooks: 60/minute per webhook slug and 20/minute per IP; stricter for unsigned legacy webhooks.
- Billing checkout: 5/hour per tenant and 20/hour per IP.
- Setup endpoints: 10/minute per IP for bootstrap attempts; 3 setup AI attempts/day per setup identity even if only one success is allowed.

These numbers should be tuned after observing legitimate usage patterns.
