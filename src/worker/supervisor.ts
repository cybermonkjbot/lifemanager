import { spawn } from "node:child_process";
import pino from "pino";
import {
  acquireWorkerSupervisorLock,
  releaseWorkerSupervisorLockSync,
  type WorkerProvider,
} from "../lib/runtime/worker-lock";

const logger = pino({
  name: "slm-worker-supervisor",
  level: process.env.LOG_LEVEL || "info",
});

const WORKER_ENTRY_BY_PROVIDER: Record<WorkerProvider, string> = {
  whatsapp: "src/worker/index.ts",
  instagram: "src/worker/instagram.ts",
};

const CHILD_STOP_TIMEOUT_MS = 4500;
const QUICK_CRASH_RESET_MS = 120_000;

function parseProvider(argvValue: string | undefined): WorkerProvider {
  if (!argvValue || argvValue.trim() === "") {
    return "whatsapp";
  }
  if (argvValue === "whatsapp" || argvValue === "instagram") {
    return argvValue;
  }
  throw new Error(`Unknown worker provider: ${argvValue}`);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runSupervisor(provider: WorkerProvider) {
  await acquireWorkerSupervisorLock(provider);

  let child: ReturnType<typeof spawn> | null = null;
  let childStartedAt = 0;
  let restartTimer: ReturnType<typeof setTimeout> | null = null;
  let restartAttempt = 0;
  let shuttingDown = false;

  const clearRestartTimer = () => {
    if (!restartTimer) {
      return;
    }
    clearTimeout(restartTimer);
    restartTimer = null;
  };

  const computeRestartDelayMs = () => {
    const expo = Math.min(1_000 * 2 ** Math.max(0, restartAttempt - 1), 30_000);
    const jitter = Math.floor(Math.random() * 350);
    return expo + jitter;
  };

  const startChild = () => {
    if (shuttingDown || child) {
      return;
    }

    const bunBin = process.env.BUN_BIN || "bun";
    const entry = WORKER_ENTRY_BY_PROVIDER[provider];
    const nextAttempt = restartAttempt + 1;

    childStartedAt = Date.now();
    try {
      child = spawn(bunBin, ["run", entry], {
        cwd: ".",
        env: {
          ...process.env,
          SLM_WORKER_SUPERVISED: "1",
          SLM_WORKER_PROVIDER: provider,
        },
        stdio: "inherit",
      });
    } catch (error) {
      const err = error instanceof Error ? error.message : String(error);
      logger.error({ provider, err }, "Failed to spawn worker process");
      restartAttempt = nextAttempt;
      const delayMs = computeRestartDelayMs();
      restartTimer = setTimeout(() => {
        restartTimer = null;
        startChild();
      }, delayMs);
      return;
    }

    logger.info(
      { provider, pid: child.pid, attempt: nextAttempt },
      "Worker child process started",
    );

    child.once("exit", (code, signal) => {
      const uptimeMs = Date.now() - childStartedAt;
      const exitedPid = child?.pid;
      child = null;

      if (shuttingDown) {
        logger.info({ provider, code, signal, pid: exitedPid }, "Worker child exited during shutdown");
        return;
      }

      if (code === 0) {
        logger.info(
          { provider, code, signal, pid: exitedPid, uptimeMs },
          "Worker child exited cleanly; stopping supervisor without restart",
        );
        void shutdown(0, "Worker child exited cleanly.");
        return;
      }

      if (uptimeMs > QUICK_CRASH_RESET_MS) {
        restartAttempt = 0;
      }
      restartAttempt += 1;

      const delayMs = computeRestartDelayMs();
      logger.warn(
        { provider, code, signal, pid: exitedPid, uptimeMs, attempt: restartAttempt, restartInMs: delayMs },
        "Worker child exited unexpectedly; scheduling restart",
      );

      restartTimer = setTimeout(() => {
        restartTimer = null;
        startChild();
      }, delayMs);
    });

    child.once("error", (error) => {
      const err = error instanceof Error ? error.message : String(error);
      logger.error({ provider, err }, "Worker child process emitted spawn error");
    });
  };

  const stopChild = async () => {
    if (!child) {
      return;
    }
    const target = child;

    try {
      target.kill("SIGTERM");
    } catch {
      // ignore and proceed to wait
    }

    const waitedUntil = Date.now() + CHILD_STOP_TIMEOUT_MS;
    while (child && Date.now() < waitedUntil) {
      await sleep(120);
    }

    if (!child) {
      return;
    }

    try {
      target.kill("SIGKILL");
    } catch {
      // ignore final kill failure
    }

    const killWaitUntil = Date.now() + 1500;
    while (child && Date.now() < killWaitUntil) {
      await sleep(80);
    }
  };

  const shutdown = async (exitCode: number, reason: string) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    clearRestartTimer();
    logger.info({ provider, reason }, "Worker supervisor shutting down");
    await stopChild();
    releaseWorkerSupervisorLockSync(provider);
    process.exit(exitCode);
  };

  process.once("SIGINT", () => {
    void shutdown(0, "Supervisor stopped by SIGINT.");
  });
  process.once("SIGTERM", () => {
    void shutdown(0, "Supervisor stopped by SIGTERM.");
  });

  process.on("uncaughtException", (error) => {
    const err = error instanceof Error ? error.message : String(error);
    logger.error({ provider, err }, "Supervisor uncaught exception");
    void shutdown(1, "Supervisor uncaught exception.");
  });

  process.on("unhandledRejection", (reason) => {
    const err = reason instanceof Error ? reason.message : String(reason);
    logger.error({ provider, err }, "Supervisor unhandled rejection");
    void shutdown(1, "Supervisor unhandled rejection.");
  });

  startChild();
  await new Promise<void>(() => {
    // keep supervisor process alive until explicit shutdown
  });
}

const provider = parseProvider(process.argv[2]);

void runSupervisor(provider).catch((error) => {
  releaseWorkerSupervisorLockSync(provider);
  const err = error instanceof Error ? error.message : String(error);
  logger.error({ provider, err }, "Worker supervisor failed to start");
  process.exit(1);
});
