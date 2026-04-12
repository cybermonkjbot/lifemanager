import { readFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { convexRefs } from "../convex-refs";
import { ensureWorkerStopped, getWorkerRuntimeStatus } from "../runtime/worker-lock";

type SetupStatus = "idle" | "starting" | "qr_ready" | "code_ready" | "syncing" | "connected" | "error";
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
  private static readonly MAX_RETRIES = 30;
  private static readonly BASE_RETRY_MS = 1250;
  private static readonly SYNCING_GRACE_MS = 20_000;

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
  private isAutoStartingWorker = false;
  private state: Omit<SetupState, "hasAuth"> = {
    status: "idle",
    mode: "qr",
    message: "Setup not started.",
    updatedAt: Date.now(),
  };

  private markConnectedAndStopSetupSocket(mode: SetupMode) {
    this.clearRetryTimer();
    this.retryCount = 0;
    this.setState({
      status: "connected",
      mode,
      message: "WhatsApp connected. Starting worker automatically...",
      qrDataUrl: undefined,
      pairingCode: undefined,
    });
    // We intentionally end the temporary setup socket after a successful pair.
    // Mark this as an expected stop so we don't enter reconnect logic.
    this.manuallyStopped = true;
    this.closeSocket();
    void this.autoStartWorker();
  }

  private sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async autoStartWorker() {
    if (this.isAutoStartingWorker) {
      return;
    }
    this.isAutoStartingWorker = true;

    try {
      const before = await getWorkerRuntimeStatus("whatsapp");
      if (before.running) {
        this.setState({
          status: "connected",
          mode: this.setupMode,
          message: before.pid
            ? `WhatsApp connected. Worker is already running (PID ${before.pid}).`
            : "WhatsApp connected. Worker is already running.",
        });
        return;
      }

      this.setState({
        status: "connected",
        mode: this.setupMode,
        message: "WhatsApp connected. Starting worker automatically...",
      });

      try {
        const bunBin = process.env.BUN_BIN || "bun";
        const child = spawn(bunBin, ["run", "worker"], {
          cwd: ".",
          env: process.env,
          detached: true,
          stdio: "ignore",
        });
        child.unref();
      } catch {
        this.setState({
          status: "connected",
          mode: this.setupMode,
          message: "WhatsApp connected, but auto-start failed. Run `bun run worker` manually.",
        });
        return;
      }

      for (let i = 0; i < 16; i += 1) {
        await this.sleep(300);
        const status = await getWorkerRuntimeStatus("whatsapp");
        if (status.running) {
          this.setState({
            status: "connected",
            mode: this.setupMode,
            message: status.pid
              ? `WhatsApp connected. Worker started automatically (PID ${status.pid}).`
              : "WhatsApp connected. Worker started automatically.",
          });
          return;
        }
      }

      this.setState({
        status: "connected",
        mode: this.setupMode,
        message: "WhatsApp connected, but worker did not stay up. Run `bun run worker` manually.",
      });
    } finally {
      this.isAutoStartingWorker = false;
    }
  }

  private get authPath() {
    const configured = (process.env.WHATSAPP_AUTH_PATH || "").trim();
    if (configured) {
      if (configured.startsWith("/")) {
        return configured;
      }
      return join(/* turbopackIgnore: true */ process.cwd(), configured);
    }
    return join(/* turbopackIgnore: true */ process.cwd(), ".wa_auth");
  }

  private async hasRegisteredCreds() {
    try {
      const raw = await readFile(join(this.authPath, "creds.json"), "utf8");
      const parsed = JSON.parse(raw) as {
        registered?: boolean;
        pairingCode?: string;
        me?: { id?: string };
      };

      if (parsed.registered === true) {
        return true;
      }

      // In some Baileys/WA flows, `registered` may stay false even after successful link.
      // Treat a device-style JID (contains ":<deviceId>@") without active pairing code as linked.
      const meId = parsed.me?.id || "";
      const hasDeviceSuffix = meId.includes(":") && meId.includes("@s.whatsapp.net");
      const hasPendingPairingCode = Boolean(parsed.pairingCode);
      return hasDeviceSuffix && !hasPendingPairingCode;
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
        provider: "whatsapp",
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

  private async reportListenerRuntimeState(listenerActive: boolean, listenerMessage: string, hasAuth?: boolean) {
    const client = this.getConvexClient();
    if (!client) {
      return;
    }

    const authState = hasAuth ?? (await this.hasRegisteredCreds());

    try {
      await client.mutation(convexRefs.systemReportSetupListener, {
        provider: "whatsapp",
        listenerActive,
        listenerMessage,
        hasAuth: authState,
      });
    } catch {
      // best effort runtime sync for setup UI
    }
  }

  private async waitForRegisteredCreds(maxWaitMs = 3500) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < maxWaitMs) {
      if (await this.hasRegisteredCreds()) {
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return await this.hasRegisteredCreds();
  }

  private async invalidateCredentials() {
    try {
      await rm(this.authPath, { recursive: true, force: true });
      return true;
    } catch {
      return false;
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

  private hasExplicitInvalidationMessage(message: string) {
    const normalized = message.toLowerCase();
    return (
      normalized.includes("signed this device out") ||
      normalized.includes("logged out this device") ||
      normalized.includes("credentials were cleared") ||
      normalized.includes("credentials were invalidated")
    );
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
    const historySyncEnabled = (() => {
      const raw = (process.env.SLM_HISTORY_SYNC_ENABLED || "true").trim().toLowerCase();
      return raw !== "false" && raw !== "0" && raw !== "off";
    })();
    const socketConfig: Parameters<BaileysModule["default"]>[0] = {
      auth: state,
      printQRInTerminal: false,
      browser,
      markOnlineOnConnect: false,
      // Keep setup socket direct-chat only (ignore group + broadcast/system).
      shouldIgnoreJid: (jid) => {
        const normalized = (jid || "").trim().toLowerCase();
        if (normalized.endsWith("@g.us")) {
          return true;
        }
        if (normalized === "status@broadcast") {
          return true;
        }
        if (normalized.startsWith("status@")) {
          return true;
        }
        return normalized.endsWith("@broadcast") || normalized.endsWith("@newsletter");
      },
      syncFullHistory: historySyncEnabled,
      fireInitQueries: false,
      shouldSyncHistoryMessage: () => historySyncEnabled,
      emitOwnEvents: false,
      connectTimeoutMs: 60_000,
      defaultQueryTimeoutMs: 60_000,
      keepAliveIntervalMs: 20_000,
    };

    if (version) {
      socketConfig.version = version;
    }

    const sock = baileys.default(socketConfig);
    let connectionOpened = false;

    this.socket = sock;
    sock.ev.on("creds.update", async () => {
      try {
        await saveCreds();
      } catch {
        // best effort save
      }

      if (this.manuallyStopped || this.socket !== sock) {
        return;
      }

      if (this.state.status === "connected") {
        return;
      }

      // Avoid closing setup early; wait until WhatsApp reports the socket as open.
      if (!connectionOpened) {
        return;
      }

      const hasAuth = await this.hasRegisteredCreds();
      if (!hasAuth) {
        return;
      }

      this.markConnectedAndStopSetupSocket(this.setupMode);
    });

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
        connectionOpened = true;
        try {
          await saveCreds();
        } catch {
          // best effort auth flush before closing temporary setup socket
        }

        const mode = this.setupMode;
        const persistedAuth = await this.waitForRegisteredCreds(5000);
        if (persistedAuth) {
          this.markConnectedAndStopSetupSocket(mode);
          return;
        }

        this.clearRetryTimer();
        this.retryCount = 0;
        this.setState({
          status: "syncing",
          mode,
          message: "Connection opened. Syncing credentials with WhatsApp...",
          qrDataUrl: undefined,
          pairingCode: undefined,
        });
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
          const invalidated = await this.invalidateCredentials();
          this.setState({
            status: "idle",
            mode,
            message: invalidated
              ? "WhatsApp signed this device out. Credentials were cleared. Start setup again to generate a new QR or pairing code."
              : "WhatsApp signed this device out. Could not clear credentials automatically; click Reset Credentials, then start setup again.",
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
    const hasExplicitInvalidation = this.hasExplicitInvalidationMessage(this.state.message);
    const setupSessionActive = Boolean(this.socket) && !this.manuallyStopped;

    if (!hasAuth && this.state.status === "syncing") {
      const syncAgeMs = Date.now() - this.state.updatedAt;
      if (syncAgeMs <= WhatsAppSetupManager.SYNCING_GRACE_MS) {
        return {
          ...this.state,
          hasAuth,
        };
      }

      const snapshot: SetupState = {
        ...this.state,
        status: "error",
        message:
          "Connection opened, but credentials are taking too long to sync. Wait a moment and click Refresh. If this persists, stop session and start setup again.",
        qrDataUrl: undefined,
        pairingCode: undefined,
        hasAuth,
      };
      this.state = {
        ...snapshot,
      };
      return snapshot;
    }

    if (!hasAuth && this.state.status === "connected") {
      const message = hasExplicitInvalidation
        ? this.state.message
        : "No active WhatsApp credentials found. Start setup again to generate a new QR or pairing code.";
      const snapshot: SetupState = {
        ...this.state,
        status: "idle",
        message,
        qrDataUrl: undefined,
        pairingCode: undefined,
        hasAuth,
      };
      this.state = {
        ...snapshot,
      };
      return snapshot;
    }

    if (hasAuth && this.state.status === "idle") {
      if (setupSessionActive) {
        return {
          ...this.state,
          status: "syncing",
          message: "Pairing succeeded. Finalizing credentials before starting worker...",
          hasAuth,
        };
      }

      const worker = await getWorkerRuntimeStatus("whatsapp");
      if (worker.running) {
        const snapshot: SetupState = {
          ...this.state,
          status: "connected",
          message: worker.pid
            ? `WhatsApp connected. Worker is running (PID ${worker.pid}).`
            : "WhatsApp connected. Worker is running.",
          hasAuth,
        };
        this.state = {
          ...snapshot,
        };
        return snapshot;
      }

      const snapshot: SetupState = {
        ...this.state,
        status: "connected",
        message: "Paired credentials found. Starting worker automatically...",
        hasAuth,
      };
      this.state = {
        ...snapshot,
      };
      if (!this.isAutoStartingWorker) {
        void this.autoStartWorker();
      }
      return snapshot;
    }

    if (hasAuth && (this.state.status === "syncing" || this.state.status === "connected")) {
      if (setupSessionActive) {
        const snapshot: SetupState = {
          ...this.state,
          status: "syncing",
          message: "Pairing succeeded. Finalizing credentials before starting worker...",
          hasAuth,
        };
        this.state = {
          ...snapshot,
        };
        return snapshot;
      }

      const worker = await getWorkerRuntimeStatus("whatsapp");
      if (worker.running) {
        const snapshot: SetupState = {
          ...this.state,
          status: "connected",
          message: worker.pid
            ? `WhatsApp connected. Worker is running (PID ${worker.pid}).`
            : "WhatsApp connected. Worker is running.",
          hasAuth,
        };
        this.state = {
          ...snapshot,
        };
        return snapshot;
      }

      const currentMessage = this.state.message.toLowerCase();
      const shouldKeepFailureMessage =
        currentMessage.includes("auto-start failed") || currentMessage.includes("did not stay up");
      const message = shouldKeepFailureMessage
        ? this.state.message
        : "WhatsApp connected. Starting worker automatically...";

      const snapshot: SetupState = {
        ...this.state,
        status: "connected",
        message,
        hasAuth,
      };
      this.state = {
        ...snapshot,
      };

      if (!shouldKeepFailureMessage && !this.isAutoStartingWorker) {
        void this.autoStartWorker();
      }

      return snapshot;
    }

    const snapshot: SetupState = {
      ...this.state,
      hasAuth,
    };
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

    const workerStop = await ensureWorkerStopped(3500, "whatsapp");
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
    await this.reportListenerRuntimeState(false, "Setup session in progress.", hasAuth);
    if (hasAuth) {
      this.clearRetryTimer();
      this.retryCount = 0;
      this.setState({
        status: "connected",
        mode,
        message: workerStoppedAutomatically
          ? "Paired credentials found. Existing worker was paused. Starting worker automatically..."
          : "Paired credentials found. Starting worker automatically...",
        qrDataUrl: undefined,
        pairingCode: undefined,
      });
      void this.autoStartWorker();
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
    const workerStop = await ensureWorkerStopped(3500, "whatsapp");
    if (workerStop.action === "failed") {
      this.setState({
        status: "error",
        mode: this.setupMode,
        message: "Could not stop the running worker automatically. Stop `bun run worker`, then retry Stop Session.",
        qrDataUrl: undefined,
        pairingCode: undefined,
      });
      return this.getState();
    }

    const workerStopped = workerStop.action === "terminated" || workerStop.action === "killed";
    const hasAuth = await this.hasRegisteredCreds();

    this.setState({
      status: "idle",
      mode: this.setupMode,
      message: workerStopped
        ? hasAuth
          ? "Setup session stopped and worker stopped. Paired credentials found."
          : "Setup session stopped and worker stopped."
        : hasAuth
          ? "Setup session stopped. Paired credentials found."
          : "Setup session stopped.",
      qrDataUrl: undefined,
      pairingCode: undefined,
    });
    await this.reportListenerRuntimeState(false, "Worker listener is offline.", hasAuth);

    return this.getState();
  }

  async resetAuth(): Promise<SetupState> {
    this.manuallyStopped = true;
    this.clearRetryTimer();
    this.retryCount = 0;
    this.closeSocket();
    this.setupMode = "qr";
    this.pairingPhoneNumber = undefined;
    const workerStop = await ensureWorkerStopped(3500, "whatsapp");
    if (workerStop.action === "failed") {
      this.setState({
        status: "error",
        mode: "qr",
        message: "Could not stop the running worker automatically. Stop `bun run worker`, then retry Reset Credentials.",
        qrDataUrl: undefined,
        pairingCode: undefined,
      });
      return this.getState();
    }

    const workerStopped = workerStop.action === "terminated" || workerStop.action === "killed";

    try {
      await rm(this.authPath, { recursive: true, force: true });
      this.setState({
        status: "idle",
        mode: "qr",
        message: workerStopped
          ? "Credentials reset and worker stopped. Start setup again to generate a fresh QR or pairing code."
          : "Credentials reset. Start setup again to generate a fresh QR or pairing code.",
        qrDataUrl: undefined,
        pairingCode: undefined,
      });
      await this.reportListenerRuntimeState(false, "Worker listener is offline.", false);
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

  async restartWorker(): Promise<SetupState> {
    const hasAuth = await this.hasRegisteredCreds();
    if (!hasAuth) {
      this.setState({
        status: "idle",
        mode: this.setupMode,
        message: "No paired credentials found. Start setup first before restarting the worker.",
        qrDataUrl: undefined,
        pairingCode: undefined,
      });
      await this.reportListenerRuntimeState(false, "Worker listener is offline.", false);
      return this.getState();
    }

    const setupSessionActive = Boolean(this.socket) && !this.manuallyStopped;
    if (setupSessionActive) {
      this.setState({
        status: this.state.status,
        mode: this.setupMode,
        message: "Setup session is active. Stop setup session before restarting the worker.",
      });
      return this.getState();
    }

    const workerStop = await ensureWorkerStopped(3500, "whatsapp");
    if (workerStop.action === "failed") {
      this.setState({
        status: "error",
        mode: this.setupMode,
        message: "Could not stop the running worker automatically. Stop `bun run worker`, then retry Restart Worker.",
        qrDataUrl: undefined,
        pairingCode: undefined,
      });
      return this.getState();
    }

    const workerWasRunning = workerStop.action === "terminated" || workerStop.action === "killed";
    this.setState({
      status: "connected",
      mode: this.setupMode,
      message: workerWasRunning
        ? "Worker stopped. Restarting without resetting credentials..."
        : "Starting worker without resetting credentials...",
      qrDataUrl: undefined,
      pairingCode: undefined,
    });
    await this.reportListenerRuntimeState(false, "Restarting worker...", hasAuth);

    await this.autoStartWorker();
    return this.getState();
  }
}

declare global {
  var __slmWhatsAppSetupManager: WhatsAppSetupManager | undefined;
}

export function getWhatsAppSetupManager(): WhatsAppSetupManager {
  const existing = globalThis.__slmWhatsAppSetupManager as
    | (WhatsAppSetupManager & { restartWorker?: () => Promise<SetupState> })
    | undefined;

  if (!existing || typeof existing.restartWorker !== "function") {
    globalThis.__slmWhatsAppSetupManager = new WhatsAppSetupManager();
  }

  return globalThis.__slmWhatsAppSetupManager as WhatsAppSetupManager;
}
