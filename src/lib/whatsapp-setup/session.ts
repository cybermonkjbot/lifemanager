import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { convexRefs } from "../convex-refs";
import { ensureWorkerStopped } from "../runtime/worker-lock";

type SetupStatus = "idle" | "starting" | "qr_ready" | "code_ready" | "connected" | "error";
export type SetupMode = "qr" | "pairing_code";

export type SetupStartOptions = {
  mode?: SetupMode;
  phoneNumber?: string;
};

type BaileysDisconnectError = {
  output?: { statusCode?: number };
  data?: { statusCode?: number };
  statusCode?: number;
  message?: string;
};

type ConnectionUpdate = {
  qr?: string;
  connection?: string;
  lastDisconnect?: { error?: unknown } | null;
};

type BaileysModule = typeof import("baileys");
type SetupSocket = ReturnType<BaileysModule["default"]>;

export type SetupState = {
  status: SetupStatus;
  mode: SetupMode;
  message: string;
  qrDataUrl?: string;
  pairingCode?: string;
  listenerActive?: boolean;
  listenerWorkerId?: string;
  listenerMessage?: string;
  listenerLastSeenAt?: number;
  updatedAt: number;
  hasAuth: boolean;
};

class WhatsAppSetupManager {
  private static readonly MAX_RETRIES = 6;
  private static readonly BASE_RETRY_MS = 1250;

  private socket: SetupSocket | null = null;
  private baileysModule: BaileysModule | null = null;
  private qrCodeModule: typeof import("qrcode") | null = null;
  private isStarting = false;
  private retryCount = 0;
  private manuallyStopped = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private setupMode: SetupMode = "qr";
  private pairingPhoneNumber: string | undefined;
  private convexClient: ConvexHttpClient | null = null;
  private state: Omit<SetupState, "hasAuth"> = {
    status: "idle",
    mode: "qr",
    message: "Setup not started.",
    updatedAt: Date.now(),
  };

  private get authPath() {
    return process.env.WHATSAPP_AUTH_PATH || ".wa_auth";
  }

  private async hasRegisteredCreds() {
    try {
      const raw = await readFile(join(this.authPath, "creds.json"), "utf8");
      const parsed = JSON.parse(raw) as { registered?: boolean };
      return parsed.registered === true;
    } catch {
      return false;
    }
  }

  private normalizePhone(raw?: string) {
    return (raw || "").replace(/[^\d]/g, "");
  }

  private setState(next: Partial<Omit<SetupState, "hasAuth">>) {
    this.state = {
      ...this.state,
      ...next,
      updatedAt: Date.now(),
    };
    void this.pushStateToConvex();
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

  private async pushStateToConvex(forcedState?: SetupState) {
    const client = this.getConvexClient();
    if (!client) {
      return;
    }

    const hasAuth = forcedState?.hasAuth ?? (await this.hasRegisteredCreds());
    const snapshot =
      forcedState ||
      ({
        ...this.state,
        hasAuth,
      } satisfies SetupState);

    try {
      await client.mutation(convexRefs.systemUpsertSetupStatus, {
        status: snapshot.status,
        mode: snapshot.mode,
        message: snapshot.message,
        qrDataUrl: snapshot.qrDataUrl,
        pairingCode: snapshot.pairingCode,
        hasAuth: snapshot.hasAuth,
        updatedAt: snapshot.updatedAt,
      });
    } catch {
      // best effort sync for websocket UI; local setup flow should continue
    }
  }

  private closeSocket() {
    if (!this.socket) {
      return;
    }

    try {
      this.socket.end(undefined);
    } catch {
      // ignore cleanup failures
    }

    this.socket = null;
  }

  private clearRetryTimer() {
    if (!this.retryTimer) {
      return;
    }
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private getDisconnectStatusCode(errorLike: unknown) {
    if (!errorLike || typeof errorLike !== "object") {
      return undefined;
    }
    const parsed = errorLike as BaileysDisconnectError;
    return parsed.output?.statusCode ?? parsed.data?.statusCode ?? parsed.statusCode;
  }

  private getDisconnectMessage(errorLike: unknown) {
    if (errorLike instanceof Error) {
      return errorLike.message;
    }
    if (!errorLike || typeof errorLike !== "object") {
      return "";
    }
    const parsed = errorLike as BaileysDisconnectError;
    return parsed.message || "";
  }

  private isAuthStateRegistered(authState: unknown) {
    if (!authState || typeof authState !== "object") {
      return false;
    }
    const creds = (authState as { creds?: { registered?: boolean } }).creds;
    return Boolean(creds?.registered);
  }

  private retryDelayMs(retryCount: number) {
    return Math.min(WhatsAppSetupManager.BASE_RETRY_MS * 2 ** (retryCount - 1), 9000);
  }

  private async getModules() {
    if (!this.baileysModule) {
      this.baileysModule = await import("baileys");
    }
    if (!this.qrCodeModule) {
      this.qrCodeModule = await import("qrcode");
    }
    return {
      baileys: this.baileysModule,
      QRCode: this.qrCodeModule,
    };
  }

  private async getLatestVersion(baileys: BaileysModule) {
    try {
      const latest = await baileys.fetchLatestWaWebVersion();
      return latest.version;
    } catch {
      return undefined;
    }
  }

  private scheduleReconnect(reason: string) {
    if (this.manuallyStopped) {
      return;
    }

    if (this.retryCount >= WhatsAppSetupManager.MAX_RETRIES) {
      this.setState({
        status: "error",
        message: `Connection failed after ${WhatsAppSetupManager.MAX_RETRIES} retries (${reason}). Stop worker, reset credentials, and try pairing code mode.`,
        qrDataUrl: undefined,
        pairingCode: undefined,
      });
      return;
    }

    this.retryCount += 1;
    const delayMs = this.retryDelayMs(this.retryCount);

    this.setState({
      status: "starting",
      message: `Connection interrupted (${reason}). Retrying ${this.retryCount}/${WhatsAppSetupManager.MAX_RETRIES}...`,
      qrDataUrl: undefined,
      pairingCode: undefined,
    });

    this.clearRetryTimer();
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.openSocket();
    }, delayMs);
  }

  private async issuePairingCode(sock: SetupSocket) {
    if (this.manuallyStopped || this.setupMode !== "pairing_code" || !this.pairingPhoneNumber) {
      return;
    }

    try {
      const rawCode = await sock.requestPairingCode(this.pairingPhoneNumber);
      const pairingCode = rawCode.match(/.{1,4}/g)?.join("-") ?? rawCode;
      this.retryCount = 0;
      this.setState({
        status: "code_ready",
        mode: "pairing_code",
        message: "Enter this code in WhatsApp > Linked Devices > Link with phone number.",
        pairingCode,
        qrDataUrl: undefined,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Unable to request pairing code";
      this.setState({
        status: "error",
        mode: "pairing_code",
        message: `${reason}. Confirm your phone number in international format and retry.`,
        pairingCode: undefined,
        qrDataUrl: undefined,
      });
    }
  }

  private async openSocket() {
    if (this.manuallyStopped) {
      return;
    }

    const { baileys, QRCode } = await this.getModules();
    const { state, saveCreds } = await baileys.useMultiFileAuthState(this.authPath);
    const version = await this.getLatestVersion(baileys);
    const browser = baileys.Browsers.macOS("Desktop");
    const socketConfig: Parameters<BaileysModule["default"]>[0] = {
      auth: state,
      printQRInTerminal: false,
      browser,
      markOnlineOnConnect: false,
      syncFullHistory: false,
      fireInitQueries: false,
      shouldSyncHistoryMessage: () => false,
      emitOwnEvents: false,
      connectTimeoutMs: 60_000,
      defaultQueryTimeoutMs: 60_000,
      keepAliveIntervalMs: 20_000,
    };

    if (version) {
      socketConfig.version = version;
    }

    const sock = baileys.default(socketConfig);

    this.socket = sock;
    sock.ev.on("creds.update", saveCreds);

    if (this.setupMode === "pairing_code" && this.pairingPhoneNumber && !this.isAuthStateRegistered(state)) {
      this.setState({
        status: "starting",
        mode: "pairing_code",
        message: "Requesting pairing code...",
        pairingCode: undefined,
        qrDataUrl: undefined,
      });

      setTimeout(() => {
        void this.issuePairingCode(sock);
      }, 1800);
    }

    sock.ev.on("connection.update", async (update: ConnectionUpdate) => {
      if (this.manuallyStopped) {
        return;
      }

      if (update.qr && this.setupMode === "qr") {
        this.retryCount = 0;
        const qrDataUrl = await QRCode.toDataURL(update.qr, {
          margin: 1,
          width: 320,
          color: {
            dark: "#000000",
            light: "#FFFFFF",
          },
        });

        this.setState({
          status: "qr_ready",
          mode: "qr",
          message: "Scan this QR with WhatsApp on your phone.",
          qrDataUrl,
          pairingCode: undefined,
        });
      }

      if (update.connection === "open") {
        this.clearRetryTimer();
        this.retryCount = 0;
        this.setState({
          status: "connected",
          mode: this.setupMode,
          message: "WhatsApp connected. You can now start the worker.",
          qrDataUrl: undefined,
          pairingCode: undefined,
        });
        // We intentionally end the temporary setup socket after a successful pair.
        // Mark this as an expected stop so we don't enter reconnect logic.
        this.manuallyStopped = true;
        this.closeSocket();
        return;
      }

      if (update.connection === "close") {
        if (this.state.status === "connected") {
          this.clearRetryTimer();
          return;
        }

        const statusCode = this.getDisconnectStatusCode(update.lastDisconnect?.error);
        const disconnectMessage = this.getDisconnectMessage(update.lastDisconnect?.error);
        const reasonBits = [disconnectMessage, statusCode ? `code ${statusCode}` : ""].filter(Boolean).join(" · ");
        const reason = reasonBits || "temporary network/session issue";
        const mode = this.setupMode;

        this.closeSocket();

        if (statusCode === baileys.DisconnectReason.loggedOut) {
          const hasAuth = await this.hasRegisteredCreds();
          if (!hasAuth) {
            const reason =
              mode === "pairing_code"
                ? "pairing session expired before code confirmation"
                : "QR session expired before scan";
            this.scheduleReconnect(reason);
            return;
          }

          this.clearRetryTimer();
          this.retryCount = 0;
          this.setState({
            status: "idle",
            mode,
            message: "Session logged out. Start setup again to generate a new QR or pairing code.",
            qrDataUrl: undefined,
            pairingCode: undefined,
          });
          return;
        }

        if (statusCode === baileys.DisconnectReason.connectionReplaced) {
          this.clearRetryTimer();
          this.setState({
            status: "error",
            mode,
            message: "Another WhatsApp session replaced this setup connection. Stop `bun run worker`, then retry setup.",
            qrDataUrl: undefined,
            pairingCode: undefined,
          });
          return;
        }

        if (statusCode === 405) {
          this.clearRetryTimer();
          this.setState({
            status: "error",
            mode,
            message: "WhatsApp rejected this handshake (code 405). Click Reset Credentials, then use pairing code mode.",
            qrDataUrl: undefined,
            pairingCode: undefined,
          });
          return;
        }

        const retryableStatus = new Set<number>([
          baileys.DisconnectReason.connectionClosed,
          baileys.DisconnectReason.connectionLost,
          baileys.DisconnectReason.timedOut,
          baileys.DisconnectReason.restartRequired,
          baileys.DisconnectReason.unavailableService,
        ]);

        if (!statusCode || retryableStatus.has(statusCode)) {
          this.scheduleReconnect(reason);
          return;
        }

        this.clearRetryTimer();
        this.setState({
          status: "error",
          mode,
          message: `Connection closed before pairing completed (${reason}). Try pairing code mode and reset credentials.`,
          qrDataUrl: undefined,
          pairingCode: undefined,
        });
      }
    });
  }

  async getState(): Promise<SetupState> {
    const hasAuth = await this.hasRegisteredCreds();

    if (hasAuth && this.state.status === "idle") {
      const snapshot: SetupState = {
        ...this.state,
        status: "idle",
        message: "Paired credentials found. Worker is not connected yet.",
        hasAuth,
      };
      void this.pushStateToConvex(snapshot);
      return snapshot;
    }

    const snapshot: SetupState = {
      ...this.state,
      hasAuth,
    };
    void this.pushStateToConvex(snapshot);
    return snapshot;
  }

  async start(options?: SetupStartOptions): Promise<SetupState> {
    if (this.socket || this.isStarting) {
      return this.getState();
    }

    const mode: SetupMode = options?.mode === "pairing_code" ? "pairing_code" : "qr";
    const normalizedPhone = this.normalizePhone(options?.phoneNumber);
    if (mode === "pairing_code" && normalizedPhone.length < 8) {
      this.setState({
        status: "error",
        mode,
        message: "Phone number is required for pairing code mode. Use country code, e.g. 2348012345678.",
        qrDataUrl: undefined,
        pairingCode: undefined,
      });
      return this.getState();
    }

    this.setupMode = mode;
    this.pairingPhoneNumber = mode === "pairing_code" ? normalizedPhone : undefined;

    const workerStop = await ensureWorkerStopped();
    if (workerStop.action === "failed") {
      this.setState({
        status: "error",
        mode,
        message: "Could not stop the running worker automatically. Stop `bun run worker` and retry setup.",
        qrDataUrl: undefined,
        pairingCode: undefined,
      });
      return this.getState();
    }
    const workerStoppedAutomatically = workerStop.action === "terminated" || workerStop.action === "killed";

    const hasAuth = await this.hasRegisteredCreds();
    if (hasAuth) {
      this.clearRetryTimer();
      this.retryCount = 0;
      this.setState({
        status: "idle",
        mode,
        message: workerStoppedAutomatically
          ? "Paired credentials found. Existing worker was paused; restart the worker to reconnect."
          : "Paired credentials found. Start the worker to connect WhatsApp.",
        qrDataUrl: undefined,
        pairingCode: undefined,
      });
      return this.getState();
    }

    this.isStarting = true;
    this.manuallyStopped = false;
    this.retryCount = 0;
    this.clearRetryTimer();
    this.setState({
      status: "starting",
      mode,
      message:
        mode === "pairing_code"
          ? workerStoppedAutomatically
            ? "Worker paused. Starting pairing code session..."
            : "Starting pairing code session..."
          : workerStoppedAutomatically
            ? "Worker paused. Starting WhatsApp setup session..."
            : "Starting WhatsApp setup session...",
      qrDataUrl: undefined,
      pairingCode: undefined,
    });

    try {
      await this.openSocket();
    } catch (error) {
      this.setState({
        status: "error",
        mode,
        message: error instanceof Error ? error.message : "Failed to start setup session.",
      });
    } finally {
      this.isStarting = false;
    }

    return this.getState();
  }

  async stop(): Promise<SetupState> {
    this.manuallyStopped = true;
    this.clearRetryTimer();
    this.retryCount = 0;
    this.closeSocket();
    const hasAuth = await this.hasRegisteredCreds();

    this.setState({
      status: "idle",
      mode: this.setupMode,
      message: hasAuth ? "Setup session stopped. Paired credentials found." : "Setup session stopped.",
      qrDataUrl: undefined,
      pairingCode: undefined,
    });

    return this.getState();
  }

  async resetAuth(): Promise<SetupState> {
    this.manuallyStopped = true;
    this.clearRetryTimer();
    this.retryCount = 0;
    this.closeSocket();
    this.setupMode = "qr";
    this.pairingPhoneNumber = undefined;

    try {
      await rm(this.authPath, { recursive: true, force: true });
      this.setState({
        status: "idle",
        mode: "qr",
        message: "Credentials reset. Start setup again to generate a fresh QR or pairing code.",
        qrDataUrl: undefined,
        pairingCode: undefined,
      });
    } catch (error) {
      this.setState({
        status: "error",
        mode: "qr",
        message: error instanceof Error ? error.message : "Failed to reset credentials.",
        qrDataUrl: undefined,
        pairingCode: undefined,
      });
    }

    return this.getState();
  }
}

declare global {
  var __slmWhatsAppSetupManager: WhatsAppSetupManager | undefined;
}

export function getWhatsAppSetupManager() {
  if (!globalThis.__slmWhatsAppSetupManager) {
    globalThis.__slmWhatsAppSetupManager = new WhatsAppSetupManager();
  }

  return globalThis.__slmWhatsAppSetupManager;
}
