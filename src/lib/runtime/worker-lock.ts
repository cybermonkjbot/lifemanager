import { existsSync, rmSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export type WorkerProvider = "whatsapp" | "instagram";

const WORKER_PID_PATHS: Record<WorkerProvider, string> = {
  whatsapp: join(".slm", "worker.pid"),
  instagram: join(".slm", "worker-instagram.pid"),
};

const WORKER_SUPERVISOR_PID_PATHS: Record<WorkerProvider, string> = {
  whatsapp: join(".slm", "worker-supervisor.pid"),
  instagram: join(".slm", "worker-instagram-supervisor.pid"),
};

type StopWorkerResult = {
  action: "none" | "stale" | "terminated" | "killed" | "failed";
  pid?: number;
};

export type WorkerRuntimeStatus = {
  running: boolean;
  pid?: number;
  stalePid?: boolean;
  workerPid?: number;
  supervisorPid?: number;
  supervisorRunning?: boolean;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getWorkerPidPath(provider: WorkerProvider = "whatsapp") {
  return WORKER_PID_PATHS[provider];
}

function getWorkerSupervisorPidPath(provider: WorkerProvider = "whatsapp") {
  return WORKER_SUPERVISOR_PID_PATHS[provider];
}

function isPidAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function readPidFile(path: string) {
  try {
    const raw = await readFile(path, "utf8");
    const pid = Number.parseInt(raw.trim(), 10);
    if (!Number.isFinite(pid) || pid <= 0) {
      return undefined;
    }
    return pid;
  } catch {
    return undefined;
  }
}

async function readWorkerPid(provider: WorkerProvider = "whatsapp") {
  return await readPidFile(getWorkerPidPath(provider));
}

async function readWorkerSupervisorPid(provider: WorkerProvider = "whatsapp") {
  return await readPidFile(getWorkerSupervisorPidPath(provider));
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

export async function acquireWorkerLock(provider: WorkerProvider = "whatsapp") {
  const pidPath = getWorkerPidPath(provider);
  await mkdir(dirname(pidPath), { recursive: true });

  const existingPid = await readWorkerPid(provider);
  if (existingPid && existingPid !== process.pid && isPidAlive(existingPid)) {
    throw new Error(`Worker already running with PID ${existingPid}.`);
  }

  await writeFile(pidPath, `${process.pid}\n`, "utf8");
}

export async function acquireWorkerSupervisorLock(provider: WorkerProvider = "whatsapp") {
  const pidPath = getWorkerSupervisorPidPath(provider);
  await mkdir(dirname(pidPath), { recursive: true });

  const existingPid = await readWorkerSupervisorPid(provider);
  if (existingPid && existingPid !== process.pid && isPidAlive(existingPid)) {
    throw new Error(`Worker supervisor already running with PID ${existingPid}.`);
  }

  await writeFile(pidPath, `${process.pid}\n`, "utf8");
}

export async function releaseWorkerLock(provider: WorkerProvider = "whatsapp") {
  await rm(getWorkerPidPath(provider), { force: true });
}

export async function releaseWorkerSupervisorLock(provider: WorkerProvider = "whatsapp") {
  await rm(getWorkerSupervisorPidPath(provider), { force: true });
}

export function releaseWorkerLockSync(provider: WorkerProvider = "whatsapp") {
  const pidPath = getWorkerPidPath(provider);
  if (!existsSync(pidPath)) {
    return;
  }
  rmSync(pidPath, { force: true });
}

export function releaseWorkerSupervisorLockSync(provider: WorkerProvider = "whatsapp") {
  const pidPath = getWorkerSupervisorPidPath(provider);
  if (!existsSync(pidPath)) {
    return;
  }
  rmSync(pidPath, { force: true });
}

export async function ensureWorkerStopped(timeoutMs = 3500, provider: WorkerProvider = "whatsapp"): Promise<StopWorkerResult> {
  const workerPidPath = getWorkerPidPath(provider);
  const supervisorPidPath = getWorkerSupervisorPidPath(provider);
  let resultAction: StopWorkerResult["action"] = "none";
  let resultPid: number | undefined;
  let hadFailure = false;

  const priority: Record<StopWorkerResult["action"], number> = {
    none: 0,
    stale: 1,
    terminated: 2,
    killed: 3,
    failed: 4,
  };

  const setResult = (next: StopWorkerResult["action"], pid?: number) => {
    if (pid && !resultPid) {
      resultPid = pid;
    }
    if (next === "failed") {
      hadFailure = true;
    }
    if (priority[next] > priority[resultAction]) {
      resultAction = next;
    }
  };

  const stopPid = async (pid: number) => {
    if (!isPidAlive(pid)) {
      return "stale" as const;
    }

    try {
      process.kill(pid, "SIGTERM");
    } catch {
      return "failed" as const;
    }

    const exitedAfterTerm = await waitForPidExit(pid, timeoutMs);
    if (exitedAfterTerm) {
      return "terminated" as const;
    }

    try {
      process.kill(pid, "SIGKILL");
    } catch {
      return "failed" as const;
    }

    const exitedAfterKill = await waitForPidExit(pid, Math.max(1200, Math.floor(timeoutMs / 2)));
    if (exitedAfterKill) {
      return "killed" as const;
    }

    return "failed" as const;
  };

  const supervisorPid = await readWorkerSupervisorPid(provider);
  if (supervisorPid) {
    setResult(await stopPid(supervisorPid), supervisorPid);
  } else {
    await rm(supervisorPidPath, { force: true }).catch(() => undefined);
  }

  const workerPid = await readWorkerPid(provider);
  if (workerPid) {
    setResult(await stopPid(workerPid), workerPid);
  } else {
    await rm(workerPidPath, { force: true }).catch(() => undefined);
  }

  if (!hadFailure) {
    await rm(supervisorPidPath, { force: true }).catch(() => undefined);
    await rm(workerPidPath, { force: true }).catch(() => undefined);
  }

  return {
    action: resultAction,
    pid: resultPid,
  };
}

export async function getWorkerRuntimeStatus(provider: WorkerProvider = "whatsapp"): Promise<WorkerRuntimeStatus> {
  const pidPath = getWorkerPidPath(provider);
  const supervisorPidPath = getWorkerSupervisorPidPath(provider);
  const workerPid = await readWorkerPid(provider);
  const supervisorPid = await readWorkerSupervisorPid(provider);

  const workerAlive = Boolean(workerPid && isPidAlive(workerPid));
  const supervisorAlive = Boolean(supervisorPid && isPidAlive(supervisorPid));

  if (workerPid && !workerAlive) {
    await rm(pidPath, { force: true }).catch(() => undefined);
  }
  if (supervisorPid && !supervisorAlive) {
    await rm(supervisorPidPath, { force: true }).catch(() => undefined);
  }

  if (workerAlive || supervisorAlive) {
    const runningPid = workerAlive ? workerPid : supervisorPid;
    return {
      running: true,
      pid: runningPid,
      workerPid: workerAlive ? workerPid : undefined,
      supervisorPid: supervisorAlive ? supervisorPid : undefined,
      supervisorRunning: supervisorAlive,
    };
  }

  if (!workerPid && !supervisorPid) {
    await rm(pidPath, { force: true }).catch(() => undefined);
    await rm(supervisorPidPath, { force: true }).catch(() => undefined);
    return { running: false };
  }

  await rm(pidPath, { force: true }).catch(() => undefined);
  await rm(supervisorPidPath, { force: true }).catch(() => undefined);
  return {
    running: false,
    pid: workerPid || supervisorPid,
    stalePid: true,
  };
}
