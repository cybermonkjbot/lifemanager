# Release Process

This repository is proprietary and is not published as an npm package by default.

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

4. Tag the release
- `git tag vX.Y.Z`
- `git push origin vX.Y.Z`

5. Publish GitHub Release
- Create a new release from the tag.
- Use changelog notes as release notes.
- Call out breaking changes and migration notes.

## Patch Releases

For urgent fixes:
- branch from `main`
- implement minimal fix + tests/docs
- update changelog
- tag `vX.Y.(Z+1)`

## Security Releases

For vulnerability fixes:
- coordinate private triage per `SECURITY.md`
- prepare and validate patch privately when possible
- publish patched release and remediation notes
