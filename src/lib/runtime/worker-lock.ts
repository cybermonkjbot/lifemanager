import { existsSync, rmSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const WORKER_PID_PATH = join(".slm", "worker.pid");

type StopWorkerResult = {
  action: "none" | "stale" | "terminated" | "killed" | "failed";
  pid?: number;
};

export type WorkerRuntimeStatus = {
  running: boolean;
  pid?: number;
  stalePid?: boolean;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getWorkerPidPath() {
  return WORKER_PID_PATH;
}

function isPidAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function readWorkerPid() {
  try {
    const raw = await readFile(getWorkerPidPath(), "utf8");
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

export async function acquireWorkerLock() {
  const pidPath = getWorkerPidPath();
  await mkdir(dirname(pidPath), { recursive: true });

  const existingPid = await readWorkerPid();
  if (existingPid && existingPid !== process.pid && isPidAlive(existingPid)) {
    throw new Error(`Worker already running with PID ${existingPid}.`);
  }

  await writeFile(pidPath, `${process.pid}\n`, "utf8");
}

export async function releaseWorkerLock() {
  await rm(getWorkerPidPath(), { force: true });
}

export function releaseWorkerLockSync() {
  const pidPath = getWorkerPidPath();
  if (!existsSync(pidPath)) {
    return;
  }
  rmSync(pidPath, { force: true });
}

export async function ensureWorkerStopped(timeoutMs = 3500): Promise<StopWorkerResult> {
  const pidPath = getWorkerPidPath();
  const pid = await readWorkerPid();

  if (!pid) {
    await rm(pidPath, { force: true }).catch(() => undefined);
    return { action: "none" };
  }

  if (!isPidAlive(pid)) {
    await rm(pidPath, { force: true }).catch(() => undefined);
    return { action: "stale", pid };
  }

  try {
    process.kill(pid, "SIGTERM");
  } catch {
    await rm(pidPath, { force: true }).catch(() => undefined);
    return { action: "failed", pid };
  }

  const exitedAfterTerm = await waitForPidExit(pid, timeoutMs);
  if (exitedAfterTerm) {
    await rm(pidPath, { force: true }).catch(() => undefined);
    return { action: "terminated", pid };
  }

  try {
    process.kill(pid, "SIGKILL");
  } catch {
    return { action: "failed", pid };
  }

  const exitedAfterKill = await waitForPidExit(pid, Math.max(1200, Math.floor(timeoutMs / 2)));
  if (exitedAfterKill) {
    await rm(pidPath, { force: true }).catch(() => undefined);
    return { action: "killed", pid };
  }

  return { action: "failed", pid };
}

export async function getWorkerRuntimeStatus(): Promise<WorkerRuntimeStatus> {
  const pidPath = getWorkerPidPath();
  const pid = await readWorkerPid();

  if (!pid) {
    await rm(pidPath, { force: true }).catch(() => undefined);
    return { running: false };
  }

  if (isPidAlive(pid)) {
    return { running: true, pid };
  }

  await rm(pidPath, { force: true }).catch(() => undefined);
  return { running: false, pid, stalePid: true };
}
