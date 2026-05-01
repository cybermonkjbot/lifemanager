import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { ConvexHttpClient } from "convex/browser";
import { convexRefs } from "../convex-refs";
import { getWorkerCommand } from "../runtime/worker-command";
import { ensureWorkerStopped, getWorkerRuntimeStatus } from "../runtime/worker-lock";
import {
  readLocalTenantConnectorCredentials,
  tenantConnectorEnv,
  verifyLocalTenantConnectorAccess,
} from "../tenant-connector-runtime";

type IMessageSetupStatus = "idle" | "starting" | "connected" | "error";
type IMessageSetupMode = "local";

export type IMessageSetupState = {
  status: IMessageSetupStatus;
  mode: IMessageSetupMode;
  message: string;
  databasePath?: string;
  listenerActive?: boolean;
  listenerWorkerId?: string;
  listenerMessage?: string;
  listenerLastSeenAt?: number;
  updatedAt: number;
  hasAuth: boolean;
  platform: NodeJS.Platform;
  macos: boolean;
  databaseReadable: boolean;
};

class IMessageSetupManager {
  private state: Omit<IMessageSetupState, "hasAuth" | "platform" | "macos" | "databaseReadable"> = {
    status: "idle",
    mode: "local",
    message: "iMessage setup not started.",
    databasePath: this.databasePath,
    updatedAt: Date.now(),
  };
  private convexClient: ConvexHttpClient | null = null;
  private isAutoStartingWorker = false;

  private get databasePath() {
    const configured = (process.env.SLM_IMESSAGE_DATABASE_PATH || "").trim();
    return configured || join(homedir(), "Library", "Messages", "chat.db");
  }

  private getConvexClient() {
    if (this.convexClient) {
      return this.convexClient;
    }
    const url = process.env.CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL;
    if (!url) {
      return null;
    }
    this.convexClient = new ConvexHttpClient(url);
    return this.convexClient;
  }

  private async databaseReadable() {
    if (process.platform !== "darwin") {
      return false;
    }
    try {
      await access(this.databasePath, constants.R_OK);
      return true;
    } catch {
      return false;
    }
  }

  private async hasLocalAccess() {
    return process.platform === "darwin" && (await this.databaseReadable());
  }

  private async snapshot(forcedState?: Partial<IMessageSetupState>): Promise<IMessageSetupState> {
    const databaseReadable = await this.databaseReadable();
    return {
      ...this.state,
      ...forcedState,
      databasePath: this.databasePath,
      hasAuth: databaseReadable,
      platform: process.platform,
      macos: process.platform === "darwin",
      databaseReadable,
    };
  }

  private setState(next: Partial<Omit<IMessageSetupState, "hasAuth" | "platform" | "macos" | "databaseReadable">>) {
    this.state = {
      ...this.state,
      ...next,
      databasePath: this.databasePath,
      updatedAt: Date.now(),
    };
    void this.pushStateToConvex();
  }

  private async pushStateToConvex(forcedState?: IMessageSetupState) {
    const client = this.getConvexClient();
    if (!client) {
      return;
    }
    const snapshot = forcedState || (await this.snapshot());
    const credentials = await readLocalTenantConnectorCredentials();

    try {
      await client.mutation(convexRefs.systemUpsertSetupStatus, {
        ...(credentials
          ? {
              tenantId: credentials.tenantId,
              connectorTokenHash: credentials.connectorTokenHash,
            }
          : {}),
        provider: "imessage",
        status: snapshot.status,
        mode: "local",
        message: snapshot.message,
        hasAuth: snapshot.hasAuth,
        updatedAt: snapshot.updatedAt,
      });
    } catch {
      // best effort setup sync
    }
  }

  private async reportListenerRuntimeState(listenerActive: boolean, listenerMessage: string, hasAuth?: boolean) {
    const client = this.getConvexClient();
    if (!client) {
      return;
    }
    const credentials = await readLocalTenantConnectorCredentials();

    try {
      await client.mutation(convexRefs.systemReportSetupListener, {
        ...(credentials
          ? {
              tenantId: credentials.tenantId,
              connectorTokenHash: credentials.connectorTokenHash,
            }
          : {}),
        provider: "imessage",
        listenerActive,
        listenerMessage,
        listenerLastSeenAt: Date.now(),
        hasAuth: hasAuth ?? (await this.hasLocalAccess()),
      });
    } catch {
      // best effort setup sync
    }
  }

  private async autoStartWorker() {
    if (this.isAutoStartingWorker) {
      return;
    }
    this.isAutoStartingWorker = true;
    try {
      const before = await getWorkerRuntimeStatus("imessage");
      if (before.running) {
        this.setState({
          status: "connected",
          message: before.pid
            ? `iMessage worker is already running (PID ${before.pid}).`
            : "iMessage worker is already running.",
        });
        await this.reportListenerRuntimeState(true, "iMessage worker listener is online.", true);
        return;
      }

      const credentials = await readLocalTenantConnectorCredentials();
      const workerEnv = {
        ...process.env,
        ...tenantConnectorEnv(credentials),
      };
      const workerCommand = getWorkerCommand("imessage", workerEnv);
      const child = spawn(workerCommand.command, workerCommand.args, {
        cwd: ".",
        env: workerCommand.env,
        detached: true,
        stdio: "ignore",
      });
      child.unref();

      await new Promise((resolve) => setTimeout(resolve, 1200));
      const status = await getWorkerRuntimeStatus("imessage");
      this.setState({
        status: status.running ? "connected" : "error",
        message: status.running
          ? status.pid
            ? `iMessage worker started (PID ${status.pid}).`
            : "iMessage worker started."
          : "iMessage worker did not stay up. Run `bun run worker:imessage` manually.",
      });
      await this.reportListenerRuntimeState(status.running, status.running ? "iMessage worker listener is online." : "iMessage worker is offline.", true);
    } finally {
      this.isAutoStartingWorker = false;
    }
  }

  async getState(): Promise<IMessageSetupState> {
    const hasAuth = await this.hasLocalAccess();
    const worker = await getWorkerRuntimeStatus("imessage");
    if (worker.running && this.state.status !== "connected") {
      const snapshot = await this.snapshot({
        status: "connected",
        message: worker.pid ? `iMessage worker is running (PID ${worker.pid}).` : "iMessage worker is running.",
        listenerActive: true,
        hasAuth,
      });
      return snapshot;
    }
    return await this.snapshot({ hasAuth });
  }

  async start(): Promise<IMessageSetupState> {
    if (!(await verifyLocalTenantConnectorAccess("imessage"))) {
      this.setState({
        status: "error",
        message: "iMessage is disabled for this tenant plan. Enable it from admin entitlements before connecting.",
      });
      return this.getState();
    }
    if (process.platform !== "darwin") {
      this.setState({
        status: "error",
        message: "iMessage support requires macOS.",
      });
      return this.getState();
    }
    if (!(await this.databaseReadable())) {
      this.setState({
        status: "error",
        message: "Messages database is not readable. Grant Full Disk Access to this app or terminal, then retry.",
      });
      return this.getState();
    }

    this.setState({
      status: "starting",
      message: "Starting local iMessage worker...",
    });
    await this.autoStartWorker();
    return this.getState();
  }

  async stop(): Promise<IMessageSetupState> {
    const workerStop = await ensureWorkerStopped(3500, "imessage");
    if (workerStop.action === "failed") {
      this.setState({
        status: "error",
        message: "Could not stop iMessage worker automatically. Stop `bun run worker:imessage` and retry.",
      });
      return this.getState();
    }
    const hasAuth = await this.hasLocalAccess();
    this.setState({
      status: "idle",
      message: hasAuth ? "iMessage worker stopped. Local Messages access remains available." : "iMessage worker stopped.",
    });
    await this.reportListenerRuntimeState(false, "iMessage worker listener is offline.", hasAuth);
    return this.getState();
  }

  async restartWorker(): Promise<IMessageSetupState> {
    await this.stop();
    return await this.start();
  }

  async resetAuth(): Promise<IMessageSetupState> {
    await this.stop();
    this.setState({
      status: "idle",
      message: "iMessage has no stored Odogwu credentials to reset. Local Messages access remains controlled by macOS Full Disk Access.",
    });
    return this.getState();
  }
}

declare global {
  var __slmIMessageSetupManager: IMessageSetupManager | undefined;
}

export function getIMessageSetupManager(): IMessageSetupManager {
  const existing = globalThis.__slmIMessageSetupManager;
  if (existing) {
    return existing;
  }
  const manager = new IMessageSetupManager();
  globalThis.__slmIMessageSetupManager = manager;
  return manager;
}
