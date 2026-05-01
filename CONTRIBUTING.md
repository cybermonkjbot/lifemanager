# Contributing

Thanks for contributing to Odogwu HQ.

## License Gate

This is a source-available, noncommercial repository. It is not open source.
Commercial use is not permitted. See [LICENSE](./LICENSE),
[USE_POLICY.md](./USE_POLICY.md), and [TRADEMARKS.md](./TRADEMARKS.md).

By submitting a contribution, you certify that:

- you have the right to submit the contribution;
- the contribution is your original work or is otherwise compatible with this
  repository's license;
- the contribution does not include secrets, customer data, private auth
  artifacts, or third-party code that cannot be redistributed under this
  repository's terms;
- you grant Marvengrey Technologies Nig LTD a perpetual, worldwide,
  irrevocable, royalty-free license to use, copy, modify, publish, distribute,
  sublicense, relicense, and otherwise exploit your contribution as part of
  Odogwu HQ and related products or services.

If a maintainer asks you to sign a separate contributor agreement for a larger
change, do not submit the contribution until that agreement is complete.

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
- Do not add dependencies, assets, models, datasets, generated output, or
  copied snippets unless their licenses are compatible with noncommercial
  source-available distribution.
- Do not add names, logos, screenshots, or branding from third-party products
  unless the project has permission to use them.

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
