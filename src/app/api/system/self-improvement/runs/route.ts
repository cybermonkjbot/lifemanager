import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { NextResponse } from "next/server";

const ROOT_DIR = resolve(process.cwd(), ".slm", "self-improvement");
const RUNS_DIR = join(ROOT_DIR, "runs");
const LOCK_PATH = join(ROOT_DIR, "runner.lock");
const MAX_LIST_LIMIT = 200;
const DEFAULT_LIST_LIMIT = 60;
const MAX_TEXT_SIZE = 120_000;
const MAX_PREVIEW_SIZE = 320;
const MAX_CONTEXT_PREVIEW_SIZE = 8_000;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RunStatus = "success" | "warning" | "error" | "incomplete";
type RunMode = "once" | "daemon" | "unknown";

type RunStats = {
  includedSources?: number;
  skippedOptionalSources?: number;
  contextChars?: number;
};

type RunMeta = {
  runId?: string;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  status?: RunStatus;
  runMode?: RunMode;
  dryRun?: boolean;
  codexPath?: string;
  codexModel?: string;
  codexSandbox?: string;
  codexExitCode?: number | null;
  codexErrorMessage?: string | null;
  fatalErrorMessage?: string | null;
  promptOverride?: string | null;
  stats?: RunStats;
};

type RunSummary = {
  runId: string;
  status: RunStatus;
  runMode: RunMode;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  dryRun: boolean;
  codexModel: string | null;
  codexExitCode: number | null;
  codexErrorMessage: string | null;
  fatalErrorMessage: string | null;
  promptOverride: string | null;
  stats: RunStats | null;
  hasReport: boolean;
  hasPrompt: boolean;
  hasContext: boolean;
  reportPreview: string | null;
};

function parseJsonObject(raw: string) {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function toTrimmedString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function toNullableString(value: unknown) {
  const normalized = toTrimmedString(value);
  return normalized || null;
}

function toNullableNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function truncate(value: string, maxChars: number) {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxChars - 3))}...`;
}

function normalizeRunMode(value: unknown): RunMode {
  return value === "once" || value === "daemon" ? value : "unknown";
}

function normalizeRunStatus(meta: RunMeta, hasReport: boolean): RunStatus {
  if (meta.status === "success" || meta.status === "warning" || meta.status === "error" || meta.status === "incomplete") {
    return meta.status;
  }
  if (meta.fatalErrorMessage || meta.codexErrorMessage) {
    return "error";
  }
  if (typeof meta.codexExitCode === "number" && meta.codexExitCode !== 0) {
    return "warning";
  }
  if (meta.finishedAt) {
    return "success";
  }
  return hasReport ? "warning" : "incomplete";
}

async function readTextFile(path: string) {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

async function readRunMeta(path: string): Promise<RunMeta | null> {
  const raw = await readTextFile(path);
  if (!raw.trim()) {
    return null;
  }
  const parsed = parseJsonObject(raw);
  if (!parsed) {
    return null;
  }
  return {
    runId: toTrimmedString(parsed.runId),
    startedAt: toTrimmedString(parsed.startedAt),
    finishedAt: toTrimmedString(parsed.finishedAt),
    durationMs: toNullableNumber(parsed.durationMs) ?? undefined,
    status: parsed.status as RunStatus | undefined,
    runMode: parsed.runMode as RunMode | undefined,
    dryRun: typeof parsed.dryRun === "boolean" ? parsed.dryRun : undefined,
    codexPath: toTrimmedString(parsed.codexPath),
    codexModel: toTrimmedString(parsed.codexModel),
    codexSandbox: toTrimmedString(parsed.codexSandbox),
    codexExitCode: toNullableNumber(parsed.codexExitCode),
    codexErrorMessage: toNullableString(parsed.codexErrorMessage),
    fatalErrorMessage: toNullableString(parsed.fatalErrorMessage),
    promptOverride: toNullableString(parsed.promptOverride),
    stats:
      parsed.stats && typeof parsed.stats === "object" && !Array.isArray(parsed.stats)
        ? {
            includedSources: toNullableNumber((parsed.stats as Record<string, unknown>).includedSources) ?? undefined,
            skippedOptionalSources:
              toNullableNumber((parsed.stats as Record<string, unknown>).skippedOptionalSources) ?? undefined,
            contextChars: toNullableNumber((parsed.stats as Record<string, unknown>).contextChars) ?? undefined,
          }
        : undefined,
  };
}

async function listRunDirectories() {
  try {
    const entries = await readdir(RUNS_DIR, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((a, b) => (a > b ? -1 : a < b ? 1 : 0));
  } catch {
    return [];
  }
}

async function readLockSummary() {
  const raw = await readTextFile(LOCK_PATH);
  if (!raw.trim()) {
    return {
      active: false,
      pid: null,
      startedAt: null,
    };
  }

  const [pidLine, startedAtLine] = raw.split(/\r?\n/);
  const parsedPid = Number(pidLine);
  return {
    active: true,
    pid: Number.isFinite(parsedPid) ? parsedPid : null,
    startedAt: toNullableString(startedAtLine),
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const selectedRunId = toTrimmedString(url.searchParams.get("runId"));
  const requestedLimit = Number(url.searchParams.get("limit"));
  const listLimit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(Math.round(requestedLimit), MAX_LIST_LIMIT))
    : DEFAULT_LIST_LIMIT;

  const [runDirectoryNames, lock] = await Promise.all([listRunDirectories(), readLockSummary()]);
  const runIds = runDirectoryNames.slice(0, listLimit);

  const summaries = await Promise.all(
    runIds.map(async (runId): Promise<RunSummary> => {
      const runDir = join(RUNS_DIR, runId);
      const [meta, reportRaw, promptRaw, contextRaw] = await Promise.all([
        readRunMeta(join(runDir, "meta.json")),
        readTextFile(join(runDir, "report.md")),
        readTextFile(join(runDir, "prompt.md")),
        readTextFile(join(runDir, "context.md")),
      ]);

      const hasReport = Boolean(reportRaw.trim());
      const hasPrompt = Boolean(promptRaw.trim());
      const hasContext = Boolean(contextRaw.trim());
      const normalizedStatus = normalizeRunStatus(meta || {}, hasReport);

      return {
        runId,
        status: normalizedStatus,
        runMode: normalizeRunMode(meta?.runMode),
        startedAt: toNullableString(meta?.startedAt),
        finishedAt: toNullableString(meta?.finishedAt),
        durationMs: toNullableNumber(meta?.durationMs),
        dryRun: Boolean(meta?.dryRun),
        codexModel: toNullableString(meta?.codexModel),
        codexExitCode: toNullableNumber(meta?.codexExitCode),
        codexErrorMessage: toNullableString(meta?.codexErrorMessage),
        fatalErrorMessage: toNullableString(meta?.fatalErrorMessage),
        promptOverride: toNullableString(meta?.promptOverride),
        stats: meta?.stats || null,
        hasReport,
        hasPrompt,
        hasContext,
        reportPreview: hasReport ? truncate(reportRaw.trim(), MAX_PREVIEW_SIZE) : null,
      };
    }),
  );

  const detailRunId = selectedRunId || summaries[0]?.runId || "";
  let detail:
    | {
        runId: string;
        meta: RunMeta | null;
        codexResponse: string;
        report: string;
        prompt: string;
        contextPreview: string;
      }
    | null = null;

  if (detailRunId) {
    const runDir = join(RUNS_DIR, detailRunId);
    const [meta, reportRaw, promptRaw, contextRaw] = await Promise.all([
      readRunMeta(join(runDir, "meta.json")),
      readTextFile(join(runDir, "report.md")),
      readTextFile(join(runDir, "prompt.md")),
      readTextFile(join(runDir, "context.md")),
    ]);
    const codexResponse = truncate(reportRaw, MAX_TEXT_SIZE);
    detail = {
      runId: detailRunId,
      meta,
      codexResponse,
      report: codexResponse,
      prompt: truncate(promptRaw, MAX_TEXT_SIZE),
      contextPreview: truncate(contextRaw, MAX_CONTEXT_PREVIEW_SIZE),
    };
  }

  return NextResponse.json({
    rootDir: ROOT_DIR,
    lock,
    runs: summaries,
    detail,
    fetchedAt: new Date().toISOString(),
  });
}
