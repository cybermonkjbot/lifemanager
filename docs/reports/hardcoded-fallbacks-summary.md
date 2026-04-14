# Hardcoded Fallback Inventory

Generated: 2026-04-14 (Africa/Lagos)

## Scope
Excluded paths:
- `node_modules/**`
- `.next/**`
- `dist/**`
- `build/**`
- `.tmp/**`
- `.git/**`
- `.slm/**`

## Matching Heuristics
- `fallback_keyword`: lines containing `fallback`.
- `env_default`: lines where `process.env.*` is combined with `||` or `??`.
- `literal_default`: lines with literal default operators (`??` / `||` with literal-like RHS).

## Reports
- `hardcoded-fallbacks-all.tsv`: all unique matched lines across all heuristics.
- `hardcoded-fallbacks-strict.tsv`: only `fallback_keyword` and/or `env_default` matches.
- `hardcoded-fallbacks-runtime-all.tsv`: same as `all`, but excludes tests/docs/non-runtime files.
- `hardcoded-fallbacks-runtime-strict.tsv`: runtime-only + strict heuristics.

## Counts
- all: 2,198
- strict: 884
- runtime-all: 1,848
- runtime-strict: 589

## Runtime-Strict Category Breakdown
- fallback_keyword: 522
- literal_default: 81
- env_default: 73

## Top Runtime-Strict Files (by match count)
- 186 `src/worker/index.ts`
- 91 `src/worker/ai.ts`
- 23 `src/components/live-systems-design.tsx`
- 21 `src/worker/outreach-hydration.ts`
- 21 `src/components/live-settings.tsx`
- 17 `convex/personality.ts`
- 17 `convex/lib/config.ts`
- 14 `src/worker/instagram.ts`
- 13 `src/worker/history-context.ts`
- 13 `convex/calls.ts`
- 12 `convex/chatTools.ts`
- 10 `src/worker/stt.ts`
- 9 `src/components/autonomy-controls.tsx`
- 7 `src/worker/meme-policy.ts`
- 7 `src/worker/call-fallback.ts`
- 6 `src/worker/status-policy.ts`
- 6 `src/worker/pdf.ts`
- 6 `convex/system.ts`
- 6 `convex/settings.ts`
- 6 `convex/inbound.ts`
- 5 `src/worker/emoji-policy.ts`
- 5 `src/components/live-tools.tsx`
- 5 `src/app/api/actions/test-ai/route.ts`
- 5 `convex/outbox.ts`
- 5 `convex/media.ts`

## TSV Columns
1. file path
2. line number
3. matched category list (comma-separated)
4. source line
