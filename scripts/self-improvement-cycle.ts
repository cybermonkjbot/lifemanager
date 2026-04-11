import { exec as execCallback, spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import type { Dirent } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { promisify } from "node:util";

type FileSourceConfig = {
  type: "file";
  path: string;
  optional?: boolean;
  maxChars?: number;
};

type GlobSourceConfig = {
  type: "glob";
  pattern: string;
  optional?: boolean;
  maxFiles?: number;
  maxCharsPerFile?: number;
};

type CommandSourceConfig = {
  type: "command";
  name: string;
  command: string;
  optional?: boolean;
  timeoutMs?: number;
  maxChars?: number;
};

type SourceConfig = FileSourceConfig | GlobSourceConfig | CommandSourceConfig;

type SelfImprovementConfig = {
  intervalMinutes: number;
  codexPath: string;
  codexModel: string;
  codexSandbox: "read-only" | "workspace-write" | "danger-full-access";
  timeoutMs: number;
  outputDir: string;
  maxContextChars: number;
  latestReportChars: number;
  maxFileScanEntries: number;
  promptTemplate: string;
  sources: SourceConfig[];
};

type CliArgs = {
  mode: "once" | "daemon";
  configPath: string;
  intervalMinutesOverride?: number;
  dryRun: boolean;
  promptOverride?: string;
};

type RunStats = {
  includedSources: number;
  skippedOptionalSources: number;
  contextChars: number;
};

const execAsync = promisify(execCallback);

const DEFAULT_CONFIG_PATH = "self-improvement.config.json";

const DEFAULT_CONFIG: SelfImprovementConfig = {
  intervalMinutes: 240,
  codexPath: process.env.CODEX_CLI_PATH || "codex",
  codexModel: process.env.CODEX_SELF_IMPROVE_MODEL || process.env.CODEX_FALLBACK_MODEL || "gpt-5.4",
  codexSandbox: "workspace-write",
  timeoutMs: 300_000,
  outputDir: ".slm/self-improvement",
  maxContextChars: 120_000,
  latestReportChars: 8_000,
  maxFileScanEntries: 20_000,
  promptTemplate: [
    "You are running a recurring self-improvement cycle for this repository.",
    "Project root: {{PROJECT_ROOT}}",
    "Run ID: {{RUN_ID}}",
    "Timestamp: {{TIMESTAMP}}",
    "",
    "Use the provided context (logs, docs, source snapshots, git state) to identify the most impactful improvements.",
    "Focus on reliability, safety, test coverage, performance, and maintainability.",
    "",
    "Return markdown with exactly these sections:",
    "1) What Changed",
    "2) Top Improvement Opportunities (max 6 items, each with impact, effort, and exact file targets)",
    "3) Proposed Execution Plan (ordered, small PR-sized steps)",
    "4) Validation Checklist",
    "5) Ready-to-Run Codex Prompts (max 3 prompts)",
    "",
    "Be concrete. Reference real file paths. Avoid generic advice.",
  ].join("\n"),
  sources: [
    { type: "file", path: "README.md", maxChars: 18_000 },
    { type: "file", path: "docs/whatsapp-autopilot-technical-gap.md", optional: true, maxChars: 24_000 },
    { type: "glob", pattern: "convex/**/*.ts", maxFiles: 20, maxCharsPerFile: 7_000 },
    { type: "glob", pattern: "src/worker/**/*.ts", maxFiles: 20, maxCharsPerFile: 7_000 },
    { type: "glob", pattern: ".next/dev/logs/**/*.log", optional: true, maxFiles: 8, maxCharsPerFile: 8_000 },
    { type: "glob", pattern: ".slm/**/*.log", optional: true, maxFiles: 8, maxCharsPerFile: 8_000 },
    { type: "command", name: "git-status", command: "git status --short", maxChars: 4_000 },
    { type: "command", name: "git-diff-stat", command: "git diff --stat", maxChars: 5_000 },
    { type: "command", name: "recent-commits", command: "git log -n 12 --oneline", maxChars: 4_000 },
  ],
};

function nowIso() {
  return new Date().toISOString();
}

function runIdFromDate(d = new Date()) {
  return d.toISOString().replace(/[:.]/g, "-");
}

function normalizePath(p: string) {
  return p.replace(/\\/g, "/");
}

function truncate(text: string, maxChars: number) {
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxChars - 32))}\n\n...[truncated]`;
}

function sleep(ms: number) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function parseCliArgs(argv: string[]): CliArgs {
  let mode: "once" | "daemon" = "once";
  let configPath = DEFAULT_CONFIG_PATH;
  let intervalMinutesOverride: number | undefined;
  let dryRun = false;
  let promptOverride: string | undefined;

  const args = [...argv];
  if (args[0] === "once" || args[0] === "daemon") {
    mode = args.shift() as "once" | "daemon";
  }

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--config") {
      const value = args[i + 1];
      if (!value) {
        throw new Error("Missing value for --config");
      }
      configPath = value;
      i += 1;
      continue;
    }
    if (arg === "--interval-minutes") {
      const value = Number(args[i + 1]);
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error("--interval-minutes must be a positive number");
      }
      intervalMinutesOverride = value;
      i += 1;
      continue;
    }
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--prompt") {
      const value = args[i + 1];
      if (!value || !value.trim()) {
        throw new Error("Missing value for --prompt");
      }
      promptOverride = value.trim();
      i += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return {
    mode,
    configPath,
    intervalMinutesOverride,
    dryRun,
    promptOverride,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function fileExists(path: string) {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

function mergeConfig(raw: Partial<SelfImprovementConfig>): SelfImprovementConfig {
  const merged: SelfImprovementConfig = {
    ...DEFAULT_CONFIG,
    ...raw,
    sources: Array.isArray(raw.sources) && raw.sources.length > 0 ? raw.sources : DEFAULT_CONFIG.sources,
  };

  if (!Number.isFinite(merged.intervalMinutes) || merged.intervalMinutes <= 0) {
    throw new Error("config.intervalMinutes must be a positive number");
  }
  if (!Number.isFinite(merged.timeoutMs) || merged.timeoutMs <= 0) {
    throw new Error("config.timeoutMs must be a positive number");
  }
  if (!Number.isFinite(merged.maxContextChars) || merged.maxContextChars <= 1_000) {
    throw new Error("config.maxContextChars must be greater than 1000");
  }
  if (!Number.isFinite(merged.latestReportChars) || merged.latestReportChars < 0) {
    throw new Error("config.latestReportChars must be zero or greater");
  }
  if (!Number.isFinite(merged.maxFileScanEntries) || merged.maxFileScanEntries <= 0) {
    throw new Error("config.maxFileScanEntries must be a positive number");
  }
  if (!merged.codexPath.trim()) {
    throw new Error("config.codexPath must not be empty");
  }
  if (!merged.codexModel.trim()) {
    throw new Error("config.codexModel must not be empty");
  }
  if (!["read-only", "workspace-write", "danger-full-access"].includes(merged.codexSandbox)) {
    throw new Error("config.codexSandbox must be one of: read-only, workspace-write, danger-full-access");
  }
  if (!merged.outputDir.trim()) {
    throw new Error("config.outputDir must not be empty");
  }
  if (!merged.promptTemplate.trim()) {
    throw new Error("config.promptTemplate must not be empty");
  }

  return merged;
}

async function readConfig(projectRoot: string, configPathInput: string): Promise<SelfImprovementConfig> {
  const configPath = resolve(projectRoot, configPathInput);
  if (!(await fileExists(configPath))) {
    return { ...DEFAULT_CONFIG };
  }

  const rawText = await fs.readFile(configPath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown parse error";
    throw new Error(`Invalid JSON in ${configPath}: ${message}`);
  }

  if (!isRecord(parsed)) {
    throw new Error(`Expected object in ${configPath}`);
  }

  return mergeConfig(parsed as Partial<SelfImprovementConfig>);
}

function globToRegExp(pattern: string): RegExp {
  const normalized = normalizePath(pattern);
  const segments = normalized.split("/");
  const out: string[] = ["^"];
  const lastIndex = segments.length - 1;

  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i];

    if (segment === "**") {
      if (i === lastIndex) {
        out.push(".*");
      } else {
        out.push("(?:[^/]+/)*");
      }
      continue;
    }

    let segmentRegex = "";
    for (const char of segment) {
      if (char === "*") {
        segmentRegex += "[^/]*";
      } else if (char === "?") {
        segmentRegex += "[^/]";
      } else {
        segmentRegex += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
      }
    }
    out.push(segmentRegex);
    if (i < lastIndex) {
      out.push("/");
    }
  }

  out.push("$");
  return new RegExp(out.join(""));
}

function globBaseDir(pattern: string) {
  const parts = normalizePath(pattern).split("/");
  const fixedParts: string[] = [];
  for (const part of parts) {
    if (part.includes("*") || part.includes("?") || part.includes("[")) {
      break;
    }
    fixedParts.push(part);
  }
  return fixedParts.length > 0 ? fixedParts.join("/") : ".";
}

async function scanMatchingFiles(params: {
  projectRoot: string;
  startRelativeDir: string;
  matcher: RegExp;
  maxMatches: number;
  maxEntries: number;
}) {
  const { projectRoot, startRelativeDir, matcher, maxMatches, maxEntries } = params;
  const startAbs = resolve(projectRoot, startRelativeDir);
  if (!(await fileExists(startAbs))) {
    return [] as string[];
  }

  const pending: string[] = [startAbs];
  const matches: string[] = [];
  let seenEntries = 0;

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) {
      continue;
    }

    let entries: Dirent[];
    try {
      entries = (await fs.readdir(current, { withFileTypes: true, encoding: "utf8" })) as Dirent[];
    } catch {
      continue;
    }

    const sortedEntries = [...entries].sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of sortedEntries) {
      seenEntries += 1;
      if (seenEntries > maxEntries) {
        return matches.sort();
      }

      if (entry.name === ".git" || entry.name === "node_modules") {
        continue;
      }

      const abs = join(current, entry.name);
      if (entry.isSymbolicLink()) {
        continue;
      }

      if (entry.isDirectory()) {
        pending.push(abs);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const rel = normalizePath(relative(projectRoot, abs));
      if (!matcher.test(rel)) {
        continue;
      }

      matches.push(rel);
      if (matches.length >= maxMatches) {
        return matches.sort();
      }
    }
  }

  return matches.sort();
}

function renderTemplate(template: string, vars: Record<string, string>) {
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (_, key: string) => vars[key] ?? "");
}

async function collectSourceText(source: SourceConfig, config: SelfImprovementConfig, projectRoot: string) {
  if (source.type === "file") {
    const abs = resolve(projectRoot, source.path);
    if (!(await fileExists(abs))) {
      if (source.optional) {
        return null;
      }
      throw new Error(`Required source file not found: ${source.path}`);
    }
    const text = await fs.readFile(abs, "utf8");
    const capped = truncate(text, source.maxChars ?? 12_000);
    return [`## File: ${source.path}`, "```text", capped, "```"].join("\n");
  }

  if (source.type === "glob") {
    const matcher = globToRegExp(source.pattern);
    const base = globBaseDir(source.pattern);
    const maxFiles = Math.max(1, source.maxFiles ?? 10);
    const files = await scanMatchingFiles({
      projectRoot,
      startRelativeDir: base,
      matcher,
      maxMatches: maxFiles,
      maxEntries: config.maxFileScanEntries,
    });

    if (files.length === 0) {
      if (source.optional) {
        return null;
      }
      throw new Error(`No files matched required glob: ${source.pattern}`);
    }

    const sections: string[] = [`## Glob: ${source.pattern}`];
    for (const relPath of files) {
      const abs = resolve(projectRoot, relPath);
      const raw = await fs.readFile(abs, "utf8");
      const capped = truncate(raw, source.maxCharsPerFile ?? 8_000);
      sections.push(`### ${relPath}`);
      sections.push("```text");
      sections.push(capped);
      sections.push("```");
    }

    return sections.join("\n");
  }

  const timeout = source.timeoutMs ?? 60_000;
  try {
    const { stdout, stderr } = await execAsync(source.command, {
      cwd: projectRoot,
      timeout,
      maxBuffer: 4 * 1024 * 1024,
      shell: "/bin/zsh",
    });

    const combined = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n\n");
    const text = combined || "(no output)";
    const capped = truncate(text, source.maxChars ?? 8_000);
    return [`## Command: ${source.name}`, "```text", capped, "```"].join("\n");
  } catch (error) {
    const err = error as Error & { stdout?: string; stderr?: string };
    if (source.optional) {
      return [`## Command: ${source.name}`, "```text", `optional source failed: ${err.message}`, "```"].join("\n");
    }
    const details = [err.message, err.stdout?.trim(), err.stderr?.trim()].filter(Boolean).join("\n");
    throw new Error(`Required command source failed (${source.name}): ${details}`);
  }
}

async function buildContextMarkdown(params: {
  projectRoot: string;
  config: SelfImprovementConfig;
  outputRoot: string;
}): Promise<{ markdown: string; stats: RunStats }> {
  const { projectRoot, config, outputRoot } = params;
  let usedChars = 0;
  const sections: string[] = [];
  let includedSources = 0;
  let skippedOptionalSources = 0;

  const latestReportPath = join(outputRoot, "latest.md");
  if (config.latestReportChars > 0 && (await fileExists(latestReportPath))) {
    const latest = await fs.readFile(latestReportPath, "utf8");
    const latestSection = [
      "## Previous Cycle Report (excerpt)",
      "```text",
      truncate(latest, config.latestReportChars),
      "```",
    ].join("\n");
    const chunk = truncate(latestSection, config.maxContextChars - usedChars);
    sections.push(chunk);
    usedChars += chunk.length;
  }

  for (const source of config.sources) {
    if (usedChars >= config.maxContextChars) {
      break;
    }

    const text = await collectSourceText(source, config, projectRoot).catch((error) => {
      if ((source as { optional?: boolean }).optional) {
        return null;
      }
      throw error;
    });

    if (!text) {
      skippedOptionalSources += 1;
      continue;
    }

    const remaining = config.maxContextChars - usedChars;
    if (remaining <= 0) {
      break;
    }

    const chunk = truncate(text, remaining);
    sections.push(chunk);
    usedChars += chunk.length;
    includedSources += 1;
  }

  return {
    markdown: sections.join("\n\n"),
    stats: {
      includedSources,
      skippedOptionalSources,
      contextChars: usedChars,
    },
  };
}

async function acquireLock(lockPath: string) {
  await fs.mkdir(dirname(lockPath), { recursive: true });
  const handle = await fs.open(lockPath, "wx");
  await handle.writeFile(`${process.pid}\n${nowIso()}\n`);
  await handle.close();

  return async () => {
    await fs.unlink(lockPath).catch(() => undefined);
  };
}

function log(message: string) {
  console.log(`[self-improve] ${message}`);
}

function compactInline(text: string, maxChars: number) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxChars - 3))}...`;
}

async function runCodexExecWithStreaming(params: {
  projectRoot: string;
  config: SelfImprovementConfig;
  fullPrompt: string;
  tmpOut: string;
}) {
  const { projectRoot, config, fullPrompt, tmpOut } = params;

  const args = [
    "exec",
    "--model",
    config.codexModel,
    "--sandbox",
    config.codexSandbox,
    "--output-last-message",
    tmpOut,
    fullPrompt,
  ];

  return await new Promise<{ exitCode: number | null; errorMessage: string | null }>((resolve) => {
    let settled = false;
    let timedOut = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    let stdoutBuffer = "";
    let stderrBuffer = "";

    const finish = (result: { exitCode: number | null; errorMessage: string | null }) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      resolve(result);
    };

    const child = spawn(config.codexPath, args, {
      cwd: projectRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const flushLines = (channel: "stdout" | "stderr", force = false) => {
      const buffer = channel === "stdout" ? stdoutBuffer : stderrBuffer;
      const lines = buffer.split(/\r?\n/);
      const remainder = lines.pop() ?? "";
      if (channel === "stdout") {
        stdoutBuffer = force ? "" : remainder;
      } else {
        stderrBuffer = force ? "" : remainder;
      }

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) {
          continue;
        }
        log(`[codex ${channel}] ${compactInline(line, 260)}`);
      }

      if (force && remainder.trim()) {
        log(`[codex ${channel}] ${compactInline(remainder.trim(), 260)}`);
      }
    };

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdoutBuffer += chunk;
      flushLines("stdout", false);
    });
    child.stderr?.on("data", (chunk: string) => {
      stderrBuffer += chunk;
      flushLines("stderr", false);
    });

    timeoutHandle = setTimeout(() => {
      timedOut = true;
      log(`codex timed out after ${config.timeoutMs}ms, terminating process`);
      child.kill("SIGTERM");
      setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          // ignore
        }
      }, 1500);
    }, config.timeoutMs);

    child.once("error", (error) => {
      flushLines("stdout", true);
      flushLines("stderr", true);
      const message = error instanceof Error ? error.message : String(error);
      finish({
        exitCode: null,
        errorMessage: `failed to start codex process: ${message}`,
      });
    });

    child.once("close", (code, signal) => {
      flushLines("stdout", true);
      flushLines("stderr", true);

      if (timedOut) {
        finish({
          exitCode: typeof code === "number" ? code : null,
          errorMessage: `codex timed out after ${config.timeoutMs}ms`,
        });
        return;
      }

      if (typeof code === "number" && code !== 0) {
        finish({
          exitCode: code,
          errorMessage: `codex exited with code ${code}${signal ? ` (${signal})` : ""}`,
        });
        return;
      }

      if (typeof code !== "number" && signal) {
        finish({
          exitCode: null,
          errorMessage: `codex terminated by signal ${signal}`,
        });
        return;
      }

      finish({
        exitCode: typeof code === "number" ? code : null,
        errorMessage: null,
      });
    });
  });
}

async function runSingleCycle(params: {
  projectRoot: string;
  config: SelfImprovementConfig;
  dryRun: boolean;
  promptOverride?: string;
}) {
  const { projectRoot, config, dryRun, promptOverride } = params;
  const start = Date.now();
  const runId = runIdFromDate(new Date(start));
  const outputRoot = resolve(projectRoot, config.outputDir);
  const runDir = join(outputRoot, "runs", runId);
  const lockPath = join(outputRoot, "runner.lock");

  await fs.mkdir(runDir, { recursive: true });
  const releaseLock = await acquireLock(lockPath).catch(() => {
    throw new Error(`Another self-improvement run is already active (${lockPath}).`);
  });

  try {
    log(`starting run ${runId}`);

    const { markdown: contextMarkdown, stats } = await buildContextMarkdown({
      projectRoot,
      config,
      outputRoot,
    });

    const prompt = renderTemplate(config.promptTemplate, {
      PROJECT_ROOT: projectRoot,
      RUN_ID: runId,
      TIMESTAMP: nowIso(),
    });

    const operatorPrompt = promptOverride
      ? [
          "",
          "Operator Priority Prompt:",
          "Treat this as a high-priority focus for this run:",
          promptOverride,
        ].join("\n")
      : "";

    const fullPrompt = [
      prompt,
      operatorPrompt,
      "",
      "---",
      "Context below. Use it to produce specific, high-leverage improvements.",
      "",
      contextMarkdown,
    ].join("\n");

    await fs.writeFile(join(runDir, "prompt.md"), fullPrompt, "utf8");
    await fs.writeFile(join(runDir, "context.md"), contextMarkdown, "utf8");

    let report = "";
    let codexExitCode: number | null = null;
    let codexErrorMessage: string | null = null;
    if (dryRun) {
      report = [
        "# Dry Run",
        "Codex execution was skipped because `--dry-run` was provided.",
        "Use this prompt file to inspect what would be sent:",
        `- ${join(runDir, "prompt.md")}`,
      ].join("\n");
    } else {
      const tmpOut = join(tmpdir(), `self-improve-${runId}.md`);
      const codexRun = await runCodexExecWithStreaming({
        projectRoot,
        config,
        fullPrompt,
        tmpOut,
      });
      codexExitCode = codexRun.exitCode;
      codexErrorMessage = codexRun.errorMessage;

      report = await fs.readFile(tmpOut, "utf8").catch(() => "");
      await fs.unlink(tmpOut).catch(() => undefined);
      if (!report.trim()) {
        if (codexErrorMessage) {
          throw new Error(`Codex failed and produced no report: ${codexErrorMessage}`);
        }
        throw new Error("Codex returned an empty report.");
      }
      if (codexErrorMessage) {
        log(`warning: codex exited non-zero but report was captured (${codexErrorMessage})`);
      }
    }

    const meta = {
      runId,
      startedAt: new Date(start).toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - start,
      dryRun,
      codexPath: config.codexPath,
      codexModel: config.codexModel,
      codexSandbox: config.codexSandbox,
      codexExitCode,
      codexErrorMessage,
      promptOverride: promptOverride || null,
      stats,
    };

    await fs.writeFile(join(runDir, "report.md"), report, "utf8");
    await fs.writeFile(join(runDir, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`, "utf8");
    await fs.writeFile(join(outputRoot, "latest.md"), report, "utf8");
    await fs.writeFile(join(outputRoot, "latest-meta.json"), `${JSON.stringify(meta, null, 2)}\n`, "utf8");

    log(`finished run ${runId} in ${meta.durationMs}ms`);
    log(`report: ${join(runDir, "report.md")}`);
  } finally {
    await releaseLock();
  }
}

async function runDaemon(params: {
  projectRoot: string;
  config: SelfImprovementConfig;
  intervalMinutes: number;
  dryRun: boolean;
  promptOverride?: string;
}) {
  const { projectRoot, config, intervalMinutes, dryRun, promptOverride } = params;
  let stopRequested = false;

  process.on("SIGINT", () => {
    stopRequested = true;
    log("received SIGINT, shutting down after current run");
  });
  process.on("SIGTERM", () => {
    stopRequested = true;
    log("received SIGTERM, shutting down after current run");
  });

  log(`daemon mode active, interval=${intervalMinutes} minutes`);
  while (!stopRequested) {
    try {
      await runSingleCycle({ projectRoot, config, dryRun, promptOverride });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`run failed: ${message}`);
    }

    if (stopRequested) {
      break;
    }

    const sleepMs = Math.round(intervalMinutes * 60_000);
    log(`sleeping for ${sleepMs}ms`);
    await sleep(sleepMs);
  }
}

async function main() {
  const projectRoot = process.cwd();
  const args = parseCliArgs(process.argv.slice(2));
  const config = await readConfig(projectRoot, args.configPath);

  if (args.intervalMinutesOverride) {
    config.intervalMinutes = args.intervalMinutesOverride;
  }

  const outputRoot = resolve(projectRoot, config.outputDir);
  await fs.mkdir(join(outputRoot, "runs"), { recursive: true });

  if (args.mode === "daemon") {
    await runDaemon({
      projectRoot,
      config,
      intervalMinutes: config.intervalMinutes,
      dryRun: args.dryRun,
      promptOverride: args.promptOverride,
    });
    return;
  }

  await runSingleCycle({
    projectRoot,
    config,
    dryRun: args.dryRun,
    promptOverride: args.promptOverride,
  });
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  console.error(`[self-improve] fatal: ${message}`);
  process.exit(1);
});
