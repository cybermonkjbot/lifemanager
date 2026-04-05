import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { rm } from "node:fs/promises";
import { join } from "node:path";

type SetupStatus = "idle" | "starting" | "qr_ready" | "connected" | "error";

type BaileysDisconnectError = {
  output?: { statusCode?: number };
  data?: { statusCode?: number };
  statusCode?: number;
  message?: string;
};

type BaileysModule = typeof import("baileys");
type SetupSocket = ReturnType<BaileysModule["default"]>;

export type SetupState = {
  status: SetupStatus;
  message: string;
  qrDataUrl?: string;
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
  private state: Omit<SetupState, "hasAuth"> = {
    status: "idle",
    message: "Setup not started.",
    updatedAt: Date.now(),
  };

  private get authPath() {
    return process.env.WHATSAPP_AUTH_PATH || ".wa_auth";
  }

  private async hasAuthCreds() {
    try {
      await access(join(this.authPath, "creds.json"), constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  private setState(next: Partial<Omit<SetupState, "hasAuth">>) {
    this.state = {
      ...this.state,
      ...next,
      updatedAt: Date.now(),
    };
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

  private scheduleReconnect(reason: string) {
    if (this.manuallyStopped) {
      return;
    }

    if (this.retryCount >= WhatsAppSetupManager.MAX_RETRIES) {
      this.setState({
        status: "error",
        message: `Connection failed after ${WhatsAppSetupManager.MAX_RETRIES} retries (${reason}). Try again, and ensure the worker is not running.`,
        qrDataUrl: undefined,
      });
      return;
    }

    this.retryCount += 1;
    const delayMs = this.retryDelayMs(this.retryCount);

    this.setState({
      status: "starting",
      message: `Connection interrupted (${reason}). Retrying ${this.retryCount}/${WhatsAppSetupManager.MAX_RETRIES}...`,
      qrDataUrl: undefined,
    });

    this.clearRetryTimer();
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.openSocket();
    }, delayMs);
  }

  private async openSocket() {
    if (this.manuallyStopped) {
      return;
    }

    const { baileys, QRCode } = await this.getModules();
    const { state, saveCreds } = await baileys.useMultiFileAuthState(this.authPath);

    const sock = baileys.default({
      auth: state,
      printQRInTerminal: false,
      browser: ["Social Life Manager Setup", "Chrome", "1.0.0"],
      markOnlineOnConnect: false,
    });

    this.socket = sock;
    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (update) => {
      if (this.manuallyStopped) {
        return;
      }

      if (update.qr) {
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
          message: "Scan this QR with WhatsApp on your phone.",
          qrDataUrl,
        });
      }

      if (update.connection === "open") {
        this.clearRetryTimer();
        this.retryCount = 0;
        this.setState({
          status: "connected",
          message: "WhatsApp connected. You can now start the worker.",
          qrDataUrl: undefined,
        });
        this.closeSocket();
      }

      if (update.connection === "close") {
        const statusCode = this.getDisconnectStatusCode(update.lastDisconnect?.error);
        const disconnectMessage = this.getDisconnectMessage(update.lastDisconnect?.error);
        const reasonBits = [disconnectMessage, statusCode ? `code ${statusCode}` : ""].filter(Boolean).join(" · ");
        const reason = reasonBits || "temporary network/session issue";

        this.closeSocket();

        if (statusCode === baileys.DisconnectReason.loggedOut) {
          this.clearRetryTimer();
          this.retryCount = 0;
          this.setState({
            status: "idle",
            message: "Session logged out. Start setup again to generate a new QR.",
            qrDataUrl: undefined,
          });
          return;
        }

        if (statusCode === baileys.DisconnectReason.connectionReplaced) {
          this.clearRetryTimer();
          this.setState({
            status: "error",
            message: "Another WhatsApp session replaced this setup connection. Stop `bun run worker` and retry setup.",
            qrDataUrl: undefined,
          });
          return;
        }

        const retryableStatus = new Set<number>([
          baileys.DisconnectReason.connectionClosed,
          baileys.DisconnectReason.connectionLost,
          baileys.DisconnectReason.timedOut,
          baileys.DisconnectReason.restartRequired,
        ]);

        if (!statusCode || retryableStatus.has(statusCode)) {
          this.scheduleReconnect(reason);
          return;
        }

        this.clearRetryTimer();
        this.setState({
          status: "error",
          message: `Connection closed before pairing completed (${reason}). Start setup again.`,
          qrDataUrl: undefined,
        });
      }
    });
  }

  async getState(): Promise<SetupState> {
    const hasAuth = await this.hasAuthCreds();

    if (hasAuth && this.state.status === "idle") {
      return {
        ...this.state,
        status: "connected",
        message: "Paired credentials found.",
        hasAuth,
      };
    }

    return {
      ...this.state,
      hasAuth,
    };
  }

  async start(): Promise<SetupState> {
    if (this.socket || this.isStarting) {
      return this.getState();
    }

    const hasAuth = await this.hasAuthCreds();
    if (hasAuth) {
      this.clearRetryTimer();
      this.retryCount = 0;
      this.setState({
        status: "connected",
        message: "Paired credentials found. You can run the worker.",
        qrDataUrl: undefined,
      });
      return this.getState();
    }

    this.isStarting = true;
    this.manuallyStopped = false;
    this.retryCount = 0;
    this.clearRetryTimer();
    this.setState({
      status: "starting",
      message: "Starting WhatsApp setup session...",
      qrDataUrl: undefined,
    });

    try {
      await this.openSocket();
    } catch (error) {
      this.setState({
        status: "error",
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
    const hasAuth = await this.hasAuthCreds();

    this.setState({
      status: hasAuth ? "connected" : "idle",
      message: hasAuth ? "Paired credentials found." : "Setup session stopped.",
      qrDataUrl: undefined,
    });

    return this.getState();
  }

  async resetAuth(): Promise<SetupState> {
    this.manuallyStopped = true;
    this.clearRetryTimer();
    this.retryCount = 0;
    this.closeSocket();

    try {
      await rm(this.authPath, { recursive: true, force: true });
      this.setState({
        status: "idle",
        message: "Credentials reset. Start setup again to generate a fresh QR.",
        qrDataUrl: undefined,
      });
    } catch (error) {
      this.setState({
        status: "error",
        message: error instanceof Error ? error.message : "Failed to reset credentials.",
        qrDataUrl: undefined,
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
