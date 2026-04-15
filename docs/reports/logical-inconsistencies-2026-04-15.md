# Logical Inconsistency Report

Date: 2026-04-15  
Project: `/Users/joshua/Documents/lifemanager`

## Scope and method

I scanned for cross-module behavior mismatches (UI/config/backend/worker/docs), then validated with static checks:

- `bun run lint` (pass)
- `bunx tsc --noEmit` (pass)
- `bun test` (465 pass, 0 fail)

This report only lists inconsistencies where behavior or contract diverges across files.

## Findings

### 1) `statusBuilderAudienceJids` is configurable but never applied

Severity: High

`statusBuilderAudienceJids` is accepted in settings, persisted in `appConfig`, and exposed in the UI, but the status builder never reads or uses it when selecting audience candidates.

Evidence:

- Config declares and loads it: `convex/lib/config.ts:107`, `convex/lib/config.ts:484`
- Settings accepts and saves it: `convex/settings.ts:240`, `convex/settings.ts:264`, `convex/settings.ts:589`
- Runtime selection ignores it and always starts from an empty list + auto-derived threads: `convex/statusBuilder.ts:282`, `convex/statusBuilder.ts:312`
- Global search shows no effective usage in status generation path: `statusBuilderAudienceJids` appears in config/settings/UI and worker type only, not in `convex/statusBuilder.ts` audience sourcing logic.

Impact:

- Operators can set a curated audience list in Settings, but generation behavior does not follow it.
- This creates false confidence in runtime targeting controls.

Suggested fix:

- Seed `audienceJids` from `config.statusBuilderAudienceJids` before fallback sampling.
- Keep current fallback only when configured list is empty.

---

### 2) Quiet-hours toggle is not honored by worker-side quiet-hours behavior

Severity: High

The worker applies quiet-hour based muting and night wind-down behavior using start/end hours, but never checks `quietHoursEnabled`. Other backend paths do check it.

Evidence:

- UI communicates mute-sync depends on quiet-hours enablement: `src/components/live-settings.tsx:2400`, `src/components/live-settings.tsx:2415`
- Worker computes quiet-hour window from start/end only, with no `quietHoursEnabled` gate: `src/worker/index.ts:3550`, `src/worker/index.ts:3553`
- Worker applies chat mute if `chatModifyQuietHoursEnabled` only: `src/worker/index.ts:3563`, `src/worker/index.ts:3570`
- Worker night wind-down inference also uses start/end without `quietHoursEnabled`: `src/worker/index.ts:6224`, `src/worker/index.ts:6229`
- Backend scheduling paths do require `quietHoursEnabled`: `convex/outbox.ts:590`, `convex/outreach.ts:69`

Impact:

- Quiet hours can be disabled in config, yet worker can still mute chats and apply night wind-down behavior if start/end fall in current window.
- Different subsystems disagree on whether quiet hours are “on”.

Suggested fix:

- Add a shared helper that gates hour-window checks with `quietHoursEnabled`.
- Use it in worker mute logic and night wind-down path for consistent semantics with Convex schedulers.

---

### 3) Convex URL resolution order differs between client-facing and server-facing helpers

Severity: Medium

Two URL helpers resolve env vars in opposite priority order:

- Client-facing runtime helper prefers `NEXT_PUBLIC_CONVEX_URL` first.
- Server helper prefers `CONVEX_URL` first.

Evidence:

- `src/lib/runtime-env.ts:2`
- `src/lib/convex-server.ts:5`
- The dashboard uses that runtime value to initialize client provider: `src/components/dashboard-shell.tsx:35`

Impact:

- If both env vars are set but differ, UI realtime/client mutations can target one deployment while server routes/actions target another.
- This can manifest as split-brain state (different data across tabs/actions).

Suggested fix:

- Standardize one precedence policy across both helpers.
- Optionally assert mismatch at startup and fail fast with a clear error.

---

### 4) Instagram timing controls allow ranges the worker intentionally overrides

Severity: Medium

Settings/UI permit very low Instagram delay/typing values, but worker enforces higher “quality floor” minimums at send time.

Evidence:

- Settings/API clamps permit low values: `convex/settings.ts:429-447`
- UI allows low values (e.g., delay min `500`, typing min `200`): `src/components/live-settings.tsx:2534`, `src/components/live-settings.tsx:2566`
- Worker floors to higher constants (`14s`, `70s`, `2.8s`, `11s`): `src/worker/instagram.ts:66-69`, `src/worker/instagram.ts:559-574`

Impact:

- Saved values can appear accepted in UI but are not the actual runtime values used.
- Operator tuning becomes non-intuitive.

Suggested fix:

- Either align settings/UI min bounds with worker floors, or remove hard floors in worker and rely on saved config clamping.
- If floors remain, expose them explicitly in UI help text.

---

## Notes

- No TypeScript/lint/test failures were found; these are behavioral contract inconsistencies rather than compile/runtime crashes.
