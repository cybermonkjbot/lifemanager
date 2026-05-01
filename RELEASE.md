# Release Process

This repository is source-available for noncommercial use and is not published
as an npm package by default.

## Release Checklist

1. Update `CHANGELOG.md`
- Move relevant entries from `Unreleased` into a new version section.
- Ensure user-visible changes are documented.

2. Verify quality gates
- `bun install`
- `bun run lint`
- `bun test`
- `bun run build`

3. Verify docs
- Confirm README and `docs/reference/*` reflect current behavior.
- Confirm `.env.example` is still complete and sanitized.
- Confirm `LICENSE`, `NOTICE`, `USE_POLICY.md`, and `TRADEMARKS.md` are
  included in the release artifact.
- Confirm release notes do not describe the project as open source.

4. Promote to the release branch
- Keep `main` as the playground branch.
- Bump `package.json` to the release version.
- Merge or cherry-pick the ready commit onto `release`.
- `git push origin release`

5. Publish GitHub Release
- The `Desktop Release` workflow runs on every push to `release`.
- It runs lint, tests, and build, then creates `desktop-vX.Y.Z` from `package.json`.
- It uploads the macOS and Windows desktop artifacts, including updater metadata, to GitHub Releases.
- If `desktop-vX.Y.Z` already exists, bump `package.json` before pushing `release` again.

6. Verify desktop updates
- Install the previous desktop version.
- Publish the new release from `release`.
- Launch the previous desktop version and confirm it downloads the GitHub Release update.

7. Verify source hygiene before public release
- Run secret scanning on the full git history.
- Confirm local runtime directories such as `.slm`, `.wa_auth`, `.ig_auth`,
  `.tmp`, `.next`, `dist`, and `node_modules` are not tracked.
- Confirm third-party dependency licenses are compatible with the release
  format.

## Patch Releases

For urgent fixes:
- branch from `release` when patching a shipped version, or from `main` when promoting a new ready fix
- implement minimal fix + tests/docs
- update changelog
- bump `package.json` to `X.Y.(Z+1)`
- push the fix to `release`

## Security Releases

For vulnerability fixes:
- coordinate private triage per `SECURITY.md`
- prepare and validate patch privately when possible
- publish patched release and remediation notes
