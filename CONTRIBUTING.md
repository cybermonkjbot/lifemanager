# Contributing

Thanks for contributing to Odogwu HQ.

## License Gate

This is a proprietary repository. Do not submit external contributions unless the maintainers have explicitly authorized the work and the required contribution agreement is in place.

By submitting an authorized contribution, you agree that the contribution may be used, modified, sublicensed, and distributed by the project owner under proprietary or other license terms.

## Development Setup

1. Install dependencies:

```bash
bun install
```

2. Create local env file:

```bash
cp .env.example .env.local
```

3. Start local stack:

```bash
bun run dev:all
```

## Common Commands

- `bun run lint`
- `bun test`
- `bun run dev:next`
- `bun run dev:convex`
- `bun run worker`
- `bun run worker:instagram`

## Pull Request Expectations

- Keep PRs focused and reviewable.
- Add or update tests for behavior changes.
- Update docs when functionality or configuration changes.
- Do not commit secrets, auth artifacts, or local runtime state.

## Security and Sensitive Data

Do not include real personal conversation data, API keys, cookies, or auth folders in commits.
Use `.env.local` for local secrets and keep `.env.example` sanitized.

## Reporting Issues

Please include:
- what you expected
- what happened
- reproduction steps
- relevant logs (redacted)
- environment details (OS, Bun, Node, browser)

See [SUPPORT.md](./SUPPORT.md) for support scope and expectations.

## Code of Conduct

This project follows [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md). By participating, you agree to those standards.

## Security Reports

Do not report vulnerabilities in public issues. Follow [SECURITY.md](./SECURITY.md).
