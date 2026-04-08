import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const APP_PID_PATH = join(".slm", "app.pid");

export type AppRuntimeStatus = {
  running: boolean;
  pid?: number;
  stalePid?: boolean;
};

type AppSignalResult = {
  action: "none" | "stale" | "paused" | "resumed" | "terminated" | "killed" | "started" | "failed";
  pid?: number;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPidAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function readAppPid() {
  try {
    const raw = await readFile(APP_PID_PATH, "utf8");
    const pid = Number.parseInt(raw.trim(), 10);
    if (!Number.isFinite(pid) || pid <= 0) {
      return undefined;
    }
    return pid;
  } catch {
    return undefined;
  }
}

async function waitForPidExit(pid: number, timeoutMs: number) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!isPidAlive(pid)) {
      return true;
    }
    await sleep(120);
  }
  return !isPidAlive(pid);
}

export async function getAppRuntimeStatus(): Promise<AppRuntimeStatus> {
  const pid = await readAppPid();
  if (!pid) {
    await rm(APP_PID_PATH, { force: true }).catch(() => undefined);
    return { running: false };
  }

  if (isPidAlive(pid)) {
    return { running: true, pid };
  }

  await rm(APP_PID_PATH, { force: true }).catch(() => undefined);
  return { running: false, pid, stalePid: true };
}

export async function pauseAppRuntime(): Promise<AppSignalResult> {
  const pid = await readAppPid();
  if (!pid) {
    await rm(APP_PID_PATH, { force: true }).catch(() => undefined);
    return { action: "none" };
  }
  if (!isPidAlive(pid)) {
    await rm(APP_PID_PATH, { force: true }).catch(() => undefined);
    return { action: "stale", pid };
  }

  try {
    process.kill(pid, "SIGSTOP");
    return { action: "paused", pid };
  } catch {
    return { action: "failed", pid };
  }
}

export async function resumeAppRuntime(): Promise<AppSignalResult> {
  const pid = await readAppPid();
  if (!pid) {
    await rm(APP_PID_PATH, { force: true }).catch(() => undefined);
    return { action: "none" };
  }
  if (!isPidAlive(pid)) {
    await rm(APP_PID_PATH, { force: true }).catch(() => undefined);
    return { action: "stale", pid };
  }

  try {
    process.kill(pid, "SIGCONT");
    return { action: "resumed", pid };
  } catch {
    return { action: "failed", pid };
  }
}

export async function ensureAppStopped(timeoutMs = 4000): Promise<AppSignalResult> {
  const pid = await readAppPid();
  if (!pid) {
    await rm(APP_PID_PATH, { force: true }).catch(() => undefined);
    return { action: "none" };
  }
  if (!isPidAlive(pid)) {
    await rm(APP_PID_PATH, { force: true }).catch(() => undefined);
    return { action: "stale", pid };
  }

  try {
    process.kill(pid, "SIGCONT");
  } catch {
    // continue termination path even if process wasn't stopped
  }

  try {
    process.kill(pid, "SIGTERM");
  } catch {
    await rm(APP_PID_PATH, { force: true }).catch(() => undefined);
    return { action: "failed", pid };
  }

  const exitedAfterTerm = await waitForPidExit(pid, timeoutMs);
  if (exitedAfterTerm) {
    await rm(APP_PID_PATH, { force: true }).catch(() => undefined);
    return { action: "terminated", pid };
  }

  try {
    process.kill(pid, "SIGKILL");
  } catch {
    return { action: "failed", pid };
  }

  const exitedAfterKill = await waitForPidExit(pid, Math.max(1200, Math.floor(timeoutMs / 2)));
  if (exitedAfterKill) {
    await rm(APP_PID_PATH, { force: true }).catch(() => undefined);
    return { action: "killed", pid };
  }

  return { action: "failed", pid };
}

export async function startAppRuntime(): Promise<AppSignalResult> {
  const running = await getAppRuntimeStatus();
  if (running.running) {
    return { action: "none", pid: running.pid };
  }

  const shell = process.env.SHELL || "sh";
  const startCommand = (process.env.SLM_APP_START_CMD || "bun run dev:next").trim();

  await mkdir(dirname(APP_PID_PATH), { recursive: true });

  try {
    const child = spawn(shell, ["-lc", startCommand], {
      cwd: ".",
      env: process.env,
      detached: true,
      stdio: "ignore",
    });
    if (child.pid) {
      await writeFile(APP_PID_PATH, `${child.pid}\n`, "utf8");
    }
    child.unref();
  } catch {
    return { action: "failed" };
  }

  for (let i = 0; i < 24; i += 1) {
    await sleep(250);
    const status = await getAppRuntimeStatus();
    if (status.running) {
      return { action: "started", pid: status.pid };
    }
  }

  return { action: "failed" };
}

export async function restartAppRuntime(): Promise<AppSignalResult> {
  const stopResult = await ensureAppStopped();
  if (stopResult.action === "failed") {
    return stopResult;
  }
  return await startAppRuntime();
}
