# Persona Pack Maintenance

This repo keeps persona packs in two forms:

1. Runtime source: `convex/lib/personaPacks.ts`
2. Export artifact: `docs/persona-packs/<pack-id>.json`

Update workflow:

1. Edit `convex/lib/personaPacks.ts` first.
2. Keep `id` stable when making non-breaking tweaks; bump `version` for any behavior change.
3. If behavior meaningfully changes, create a new `id` and keep the previous one for rollback safety.
4. Mirror the updated pack into `docs/persona-packs/<pack-id>.json`.
5. Run tests for validator + AI pipeline before rollout.

Guardrails:

- Checklist weights must sum to `1`.
- Keep at least `30` few-shot examples.
- Never include private PII in few-shots.
- Keep activation scopes explicit (`allowedProfileSlugs`).
