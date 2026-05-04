import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { spawn } from "node:child_process";
import { ConvexHttpClient } from "convex/browser";
import { Api, TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { convexRefs } from "../convex-refs";
import { getWorkerCommand } from "../runtime/worker-command";
import { ensureWorkerStopped, getWorkerRuntimeStatus } from "../runtime/worker-lock";
import { getRuntimeDataPath } from "../runtime/paths";
import {
  connectorPlanUnavailableMessage,
  readLocalTenantConnectorCredentials,
  tenantConnectorEnv,
  verifyLocalTenantConnectorAccess,
} from "../tenant-connector-runtime";

type TelegramSetupStatus = "idle" | "starting" | "code_required" | "password_required" | "connected" | "error";
type TelegramSetupMode = "phone_code";

type TelegramStartOptions = {
  apiId?: number;
  apiHash?: string;
  phoneNumber?: string;
  forceSMS?: boolean;
};

type TelegramChallengeOptions = {
  code?: string;
  password?: string;
};

type TelegramSessionFile = {
  apiId: number;
  apiHash: string;
  phoneNumber: string;
  sessionString: string;
  updatedAt: number;
};

type TelegramPendingFile = TelegramSessionFile & {
  phoneCodeHash: string;
  isCodeViaApp: boolean;
};

export type TelegramSetupState = {
  status: TelegramSetupStatus;
  mode: TelegramSetupMode;
  message: string;
  phoneNumberMasked?: string;
  codeDelivery?: "app" | "sms";
  updatedAt: number;
  hasAuth: boolean;
};

function maskPhone(value: string) {
  const compact = value.replace(/\s+/g, "");
  if (compact.length <= 5) {
    return compact ? "***" : undefined;
  }
  return `${compact.slice(0, 3)}***${compact.slice(-3)}`;
}

function readErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  if (error && typeof error === "object") {
    const record = error as { errorMessage?: unknown; message?: unknown };
    return String(record.errorMessage || record.message || "Telegram setup failed.");
  }
  return "Telegram setup failed.";
}

function readTelegramApiCredentials(options: TelegramStartOptions) {
  return {
    apiId: Math.round(Number(options.apiId || process.env.SLM_TELEGRAM_API_ID || process.env.TELEGRAM_API_ID || 0)),
    apiHash: (options.apiHash || process.env.SLM_TELEGRAM_API_HASH || process.env.TELEGRAM_API_HASH || "").trim(),
  };
}

class TelegramSetupManager {
  private state: Omit<TelegramSetupState, "hasAuth"> = {
    status: "idle",
    mode: "phone_code",
    message: "Telegram setup not started.",
    updatedAt: Date.now(),
  };
  private convexClient: ConvexHttpClient | null = null;
  private isAutoStartingWorker = false;

  private get sessionPath() {
    return getRuntimeDataPath("telegram-session.json");
  }

  private get pendingPath() {
    return getRuntimeDataPath("telegram-pending-login.json");
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

  private async readSessionFile() {
    try {
      return JSON.parse(await readFile(this.sessionPath, "utf8")) as TelegramSessionFile;
    } catch {
      return null;
    }
  }

  private async readPendingFile() {
    try {
      return JSON.parse(await readFile(this.pendingPath, "utf8")) as TelegramPendingFile;
    } catch {
      return null;
    }
  }

  private async writeJson(path: string, value: unknown) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  }

  private async hasSession() {
    const session = await this.readSessionFile();
    return Boolean(session?.sessionString);
  }

  private async autoStartWorker() {
    if (this.isAutoStartingWorker) {
      return;
    }
    this.isAutoStartingWorker = true;
    try {
      const before = await getWorkerRuntimeStatus("telegram");
      if (before.running) {
        this.setState({
          status: "connected",
          message: before.pid
            ? `Telegram worker is already running (PID ${before.pid}).`
            : "Telegram worker is already running.",
        });
        return;
      }

      const credentials = await readLocalTenantConnectorCredentials();
      const workerEnv = {
        ...process.env,
        ...tenantConnectorEnv(credentials),
      };
      const workerCommand = getWorkerCommand("telegram", workerEnv);
      const child = spawn(workerCommand.command, workerCommand.args, {
        cwd: ".",
        env: workerCommand.env,
        detached: true,
        stdio: "ignore",
      });
      child.unref();

      await new Promise((resolve) => setTimeout(resolve, 1200));
      const status = await getWorkerRuntimeStatus("telegram");
      this.setState({
        status: status.running ? "connected" : "error",
        message: status.running
          ? status.pid
            ? `Telegram worker started (PID ${status.pid}).`
            : "Telegram worker started."
          : "Telegram worker did not stay up. Run `bun run worker:telegram` manually.",
      });
    } finally {
      this.isAutoStartingWorker = false;
    }
  }

  private setState(next: Partial<Omit<TelegramSetupState, "hasAuth">>) {
    this.state = {
      ...this.state,
      ...next,
      updatedAt: Date.now(),
    };
    void this.pushStateToConvex();
  }

  private async pushStateToConvex(forcedState?: TelegramSetupState) {
    const client = this.getConvexClient();
    if (!client) {
      return;
    }
    const credentials = await readLocalTenantConnectorCredentials();
    const snapshot =
      forcedState ||
      ({
        ...this.state,
        hasAuth: await this.hasSession(),
      } satisfies TelegramSetupState);

    try {
      await client.mutation(convexRefs.systemUpsertSetupStatus, {
        ...(credentials
          ? {
              tenantId: credentials.tenantId,
              connectorTokenHash: credentials.connectorTokenHash,
            }
          : {}),
        provider: "telegram",
        status: snapshot.status,
        mode: "phone_code",
        message: snapshot.message,
        hasAuth: snapshot.hasAuth,
        updatedAt: snapshot.updatedAt,
      });
    } catch {
      // best effort setup sync
    }
  }

  async getState(): Promise<TelegramSetupState> {
    return {
      ...this.state,
      hasAuth: await this.hasSession(),
    };
  }

  async start(options: TelegramStartOptions): Promise<TelegramSetupState> {
    if (!(await verifyLocalTenantConnectorAccess("telegram"))) {
      this.setState({
        status: "error",
        message: connectorPlanUnavailableMessage("telegram"),
      });
      return this.getState();
    }

    const { apiId, apiHash } = readTelegramApiCredentials(options);
    const phoneNumber = (options.phoneNumber || "").trim();
    if (!apiId || !apiHash || !phoneNumber) {
      this.setState({
        status: "error",
        message: "Telegram login is not configured. Add Telegram API credentials on the server, then retry.",
      });
      return this.getState();
    }

    this.setState({
      status: "starting",
      message: "Requesting Telegram login code...",
      phoneNumberMasked: maskPhone(phoneNumber),
    });

    const client = new TelegramClient(new StringSession(""), apiId, apiHash, {
      connectionRetries: 5,
    });

    try {
      await client.connect();
      const result = await client.sendCode({ apiId, apiHash }, phoneNumber, Boolean(options.forceSMS));
      const sessionString = String(client.session.save());
      await this.writeJson(this.pendingPath, {
        apiId,
        apiHash,
        phoneNumber,
        sessionString,
        phoneCodeHash: result.phoneCodeHash,
        isCodeViaApp: result.isCodeViaApp,
        updatedAt: Date.now(),
      } satisfies TelegramPendingFile);
      this.setState({
        status: "code_required",
        message: result.isCodeViaApp
          ? "Telegram sent a login code to the Telegram app."
          : "Telegram sent a login code by SMS.",
        phoneNumberMasked: maskPhone(phoneNumber),
        codeDelivery: result.isCodeViaApp ? "app" : "sms",
      });
    } catch (error) {
      this.setState({
        status: "error",
        message: readErrorMessage(error),
      });
    } finally {
      await client.disconnect().catch(() => undefined);
    }

    return this.getState();
  }

  async submitChallenge(options: TelegramChallengeOptions): Promise<TelegramSetupState> {
    const pending = await this.readPendingFile();
    if (!pending) {
      this.setState({
        status: "idle",
        message: "No pending Telegram login found. Start Telegram setup first.",
      });
      return this.getState();
    }

    const code = (options.code || "").trim();
    if (!code) {
      this.setState({
        status: "code_required",
        message: "Telegram login code is required.",
        phoneNumberMasked: maskPhone(pending.phoneNumber),
      });
      return this.getState();
    }

    const client = new TelegramClient(new StringSession(pending.sessionString), pending.apiId, pending.apiHash, {
      connectionRetries: 5,
    });

    try {
      await client.connect();
      await client.invoke(
        new Api.auth.SignIn({
          phoneNumber: pending.phoneNumber,
          phoneCodeHash: pending.phoneCodeHash,
          phoneCode: code,
        }),
      );

      const sessionString = String(client.session.save());
      await this.writeJson(this.sessionPath, {
        apiId: pending.apiId,
        apiHash: pending.apiHash,
        phoneNumber: pending.phoneNumber,
        sessionString,
        updatedAt: Date.now(),
      } satisfies TelegramSessionFile);
      await rm(this.pendingPath, { force: true }).catch(() => undefined);

      this.setState({
        status: "connected",
        message: "Telegram session saved locally.",
        phoneNumberMasked: maskPhone(pending.phoneNumber),
      });
      await this.autoStartWorker();
    } catch (error) {
      const detail = readErrorMessage(error);
      const needsPassword = /SESSION_PASSWORD_NEEDED|PASSWORD/i.test(detail);
      this.setState({
        status: "error",
        message: needsPassword ? "Telegram accounts with 2FA passwords are not supported by this login flow yet." : detail,
        phoneNumberMasked: maskPhone(pending.phoneNumber),
      });
    } finally {
      await client.disconnect().catch(() => undefined);
    }

    return this.getState();
  }

  async stop(): Promise<TelegramSetupState> {
    const workerStop = await ensureWorkerStopped(3500, "telegram");
    if (workerStop.action === "failed") {
      this.setState({
        status: "error",
        message: "Could not stop Telegram worker automatically. Stop `bun run worker:telegram` and retry.",
      });
      return this.getState();
    }
    this.setState({
      status: (await this.hasSession()) ? "connected" : "idle",
      message: (await this.hasSession()) ? "Telegram worker stopped. Saved session remains local." : "Telegram worker stopped.",
    });
    return this.getState();
  }

  async restartWorker(): Promise<TelegramSetupState> {
    await this.stop();
    if (!(await this.hasSession())) {
      this.setState({
        status: "idle",
        message: "No saved Telegram session found. Connect Telegram before starting the worker.",
      });
      return this.getState();
    }
    await this.autoStartWorker();
    return this.getState();
  }

  async resetAuth(): Promise<TelegramSetupState> {
    await this.stop();
    await rm(this.sessionPath, { force: true }).catch(() => undefined);
    await rm(this.pendingPath, { force: true }).catch(() => undefined);
    this.setState({
      status: "idle",
      message: "Telegram local session cleared.",
      phoneNumberMasked: undefined,
      codeDelivery: undefined,
    });
    return this.getState();
  }
}

declare global {
  var __slmTelegramSetupManager: TelegramSetupManager | undefined;
}

export function getTelegramSetupManager(): TelegramSetupManager {
  const existing = globalThis.__slmTelegramSetupManager;
  if (existing) {
    return existing;
  }
  const manager = new TelegramSetupManager();
  globalThis.__slmTelegramSetupManager = manager;
  return manager;
}
