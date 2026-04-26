# Contributing

Thanks for contributing to Social Life Manager.

## License Gate

By submitting a contribution, you agree that your contribution is licensed under the project license in [`LICENSE`](./LICENSE), currently **PolyForm Noncommercial 1.0.0**.

This repository is source-available for non-commercial use.
Commercial use is not permitted under the default project license.

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
