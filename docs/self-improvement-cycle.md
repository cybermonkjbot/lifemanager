# Self-Improvement Cycle

Date: 2026-04-06

## Overview

This project includes a local Codex-driven self-improvement job:

- It gathers context from configured files, globs, and shell commands.
- It sends that context to `codex exec`.
- It stores each report under `.slm/self-improvement/runs/<run-id>/`.
- It keeps `.slm/self-improvement/latest.md` for quick access.

The goal is to continuously generate practical, repo-specific engineering improvements as logs and code evolve.

## Files

- Runner: `scripts/self-improvement-cycle.ts`
- Config: `self-improvement.config.json`
- Output root (default): `.slm/self-improvement`

## Usage

Run a single cycle:

```bash
bun run self-improve
```

Run a single cycle without calling Codex:

```bash
bun run self-improve --dry-run
```

Run continuously in the foreground:

```bash
bun run self-improve:daemon
```

Override interval for daemon mode:

```bash
bun run self-improve:daemon --interval-minutes 120
```

Use a different config file:

```bash
bun run scripts/self-improvement-cycle.ts once --config ./self-improvement.config.json
```

## Config Tuning

Edit `self-improvement.config.json`:

- `intervalMinutes`: frequency for daemon mode.
- `codexPath`: Codex binary path (`codex` by default).
- `codexModel`: model used for improvement cycles.
- `timeoutMs`: per-run Codex timeout.
- `maxContextChars`: max total context passed to Codex.
- `latestReportChars`: how much of the previous report to include as memory.
- `sources`: ordered context sources (`file`, `glob`, `command`).

The runner processes sources in order until `maxContextChars` is reached.

## Scheduling with Cron

Open crontab:

```bash
crontab -e
```

Add a job (every 6 hours):

```bash
0 */6 * * * cd /Users/joshua/Documents/lifemanager && /opt/homebrew/bin/bun run self-improve >> .slm/self-improvement/cron.log 2>&1
```

Notes:

- Use absolute paths for `cd` and `bun`.
- Keep logs so you can inspect failed runs.
- If a previous run is still active, the lock file prevents overlap.

## Output Layout

For each run:

- `prompt.md`: exact prompt sent to Codex.
- `context.md`: collected context snippets.
- `report.md`: Codex output for this run.
- `meta.json`: run metadata (duration, model, stats).

Global pointers:

- `latest.md`: most recent report.
- `latest-meta.json`: metadata for latest report.

## Troubleshooting

If you see lock errors:

- Ensure no `self-improvement-cycle` process is still running.
- Remove stale lock file only after confirming no active process:
  `.slm/self-improvement/runner.lock`

If Codex is not found:

- Install Codex CLI and verify `codex exec` works.
- Or set `codexPath` in config (or `CODEX_CLI_PATH` env).
