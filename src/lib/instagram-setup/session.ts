import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ConvexHttpClient } from "convex/browser";
import {
  IgApiClient,
  IgChallengeWrongCodeError,
  IgCheckpointError,
  IgLoginBadPasswordError,
  IgLoginInvalidUserError,
  IgLoginTwoFactorRequiredError,
  IgResponseError,
} from "instagram-private-api";
import { convexRefs } from "../convex-refs";
import { ensureWorkerStopped, getWorkerRuntimeStatus } from "../runtime/worker-lock";

type InstagramSetupStatus = "idle" | "starting" | "authenticating" | "challenge_required" | "connected" | "error";
type InstagramSetupMode = "password" | "challenge_code";

type InstagramStartOptions = {
  username?: string;
  password?: string;
};

type InstagramChallengeOptions = {
  code?: string;
};

type PersistedSessionMeta = {
  username: string;
  updatedAt: number;
};

type PersistedChallenge = {
  kind: "checkpoint";
  username: string;
  serializedState: Record<string, unknown>;
  updatedAt: number;
};

type PersistedTwoFactor = {
  kind: "two_factor";
  username: string;
  serializedState: Record<string, unknown>;
  twoFactorIdentifier: string;
  verificationMethod: "1" | "3";
  trustThisDevice: "1" | "0";
  updatedAt: number;
};

export type InstagramSetupState = {
  status: InstagramSetupStatus;
  mode: InstagramSetupMode;
  message: string;
  challengeContactPoint?: string;
  listenerActive?: boolean;
  listenerWorkerId?: string;
  listenerMessage?: string;
  listenerLastSeenAt?: number;
  updatedAt: number;
  hasAuth: boolean;
};

class InstagramSetupManager {
  private state: Omit<InstagramSetupState, "hasAuth"> = {
    status: "idle",
    mode: "password",
    message: "Instagram setup not started.",
    updatedAt: Date.now(),
  };
  private convexClient: ConvexHttpClient | null = null;
  private challengeClient: IgApiClient | null = null;
  private challengeUsername: string | null = null;
  private isAutoStartingWorker = false;

  private get authDir() {
    const configured = (process.env.INSTAGRAM_AUTH_PATH || "").trim();
    if (!configured) {
      return join(process.cwd(), ".ig_auth");
    }
    if (configured.startsWith("/")) {
      return configured;
    }
    return join(process.cwd(), configured);
  }

  private get sessionPath() {
    return join(this.authDir, "session.json");
  }

  private get sessionMetaPath() {
    return join(this.authDir, "session-meta.json");
  }

  private get challengePath() {
    return join(this.authDir, "challenge.json");
  }

  private get twoFactorPath() {
    return join(this.authDir, "two-factor.json");
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

  private setState(next: Partial<Omit<InstagramSetupState, "hasAuth">>) {
    this.state = {
      ...this.state,
      ...next,
      updatedAt: Date.now(),
    };
    void this.pushStateToConvex();
  }

  private async pushStateToConvex(forcedState?: InstagramSetupState) {
    const client = this.getConvexClient();
    if (!client) {
      return;
    }

    const hasAuth = forcedState?.hasAuth ?? (await this.hasPersistedSession());
    const snapshot =
      forcedState ||
      ({
        ...this.state,
        hasAuth,
      } satisfies InstagramSetupState);

    try {
      await client.mutation(convexRefs.systemUpsertSetupStatus, {
        provider: "instagram",
        status: snapshot.status,
        mode: snapshot.mode,
        message: snapshot.message,
        challengeContactPoint: snapshot.challengeContactPoint,
        hasAuth: snapshot.hasAuth,
        updatedAt: snapshot.updatedAt,
      });
    } catch {
      // best effort sync for setup UI
    }
  }

  private async reportListenerRuntimeState(listenerActive: boolean, listenerMessage: string, hasAuth?: boolean) {
    const client = this.getConvexClient();
    if (!client) {
      return;
    }

    const authState = hasAuth ?? (await this.hasPersistedSession());

    try {
      await client.mutation(convexRefs.systemReportSetupListener, {
        provider: "instagram",
        listenerActive,
        listenerMessage,
        hasAuth: authState,
      });
    } catch {
      // best effort runtime sync
    }
  }

  private async ensureAuthDir() {
    await mkdir(this.authDir, { recursive: true });
  }

  private async hasPersistedSession() {
    try {
      const raw = await readFile(this.sessionPath, "utf8");
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return Object.keys(parsed || {}).length > 0;
    } catch {
      return false;
    }
  }

  private async readSessionMeta(): Promise<PersistedSessionMeta | null> {
    try {
      const raw = await readFile(this.sessionMetaPath, "utf8");
      const parsed = JSON.parse(raw) as Partial<PersistedSessionMeta>;
      if (!parsed.username || typeof parsed.username !== "string") {
        return null;
      }
      return {
        username: parsed.username,
        updatedAt: Number(parsed.updatedAt || Date.now()),
      };
    } catch {
      return null;
    }
  }

  private async writeSessionState(ig: IgApiClient, username: string) {
    await this.ensureAuthDir();
    const serialized = (await ig.state.serialize()) as Record<string, unknown>;
    delete (serialized as { constants?: unknown }).constants;

    await writeFile(this.sessionPath, JSON.stringify(serialized), "utf8");
    await writeFile(
      this.sessionMetaPath,
      JSON.stringify({ username, updatedAt: Date.now() } satisfies PersistedSessionMeta),
      "utf8",
    );
    await rm(this.challengePath, { force: true }).catch(() => undefined);
  }

  private async writeChallengeState(ig: IgApiClient, username: string) {
    await this.ensureAuthDir();
    const serialized = (await ig.state.serialize()) as Record<string, unknown>;
    delete (serialized as { constants?: unknown }).constants;

    const payload: PersistedChallenge = {
      kind: "checkpoint",
      username,
      serializedState: serialized,
      updatedAt: Date.now(),
    };
    await writeFile(this.challengePath, JSON.stringify(payload), "utf8");
  }

  private async writeTwoFactorState(
    ig: IgApiClient,
    options: {
      username: string;
      twoFactorIdentifier: string;
      verificationMethod: "1" | "3";
      trustThisDevice?: "1" | "0";
    },
  ) {
    await this.ensureAuthDir();
    const serialized = (await ig.state.serialize()) as Record<string, unknown>;
    delete (serialized as { constants?: unknown }).constants;

    const payload: PersistedTwoFactor = {
      kind: "two_factor",
      username: options.username,
      serializedState: serialized,
      twoFactorIdentifier: options.twoFactorIdentifier,
      verificationMethod: options.verificationMethod,
      trustThisDevice: options.trustThisDevice || "1",
      updatedAt: Date.now(),
    };
    await writeFile(this.twoFactorPath, JSON.stringify(payload), "utf8");
  }

  private async clearChallengeState() {
    this.challengeClient = null;
    this.challengeUsername = null;
    await rm(this.challengePath, { force: true }).catch(() => undefined);
    await rm(this.twoFactorPath, { force: true }).catch(() => undefined);
  }

  private async restoreChallengeClient() {
    if (this.challengeClient && this.challengeUsername) {
      return { ig: this.challengeClient, username: this.challengeUsername };
    }

    try {
      const raw = await readFile(this.challengePath, "utf8");
      const parsed = JSON.parse(raw) as PersistedChallenge;
      if ((parsed.kind && parsed.kind !== "checkpoint") || !parsed.username || !parsed.serializedState) {
        return null;
      }

      const ig = new IgApiClient();
      ig.state.generateDevice(parsed.username);
      await ig.state.deserialize(parsed.serializedState);
      this.challengeClient = ig;
      this.challengeUsername = parsed.username;
      return { ig, username: parsed.username };
    } catch {
      return null;
    }
  }

  private async restoreTwoFactorClient() {
    try {
      const raw = await readFile(this.twoFactorPath, "utf8");
      const parsed = JSON.parse(raw) as PersistedTwoFactor;
      if (
        parsed.kind !== "two_factor" ||
        !parsed.username ||
        !parsed.serializedState ||
        !parsed.twoFactorIdentifier
      ) {
        return null;
      }

      const ig = new IgApiClient();
      ig.state.generateDevice(parsed.username);
      await ig.state.deserialize(parsed.serializedState);
      return {
        ig,
        username: parsed.username,
        twoFactorIdentifier: parsed.twoFactorIdentifier,
        verificationMethod: parsed.verificationMethod || "1",
        trustThisDevice: parsed.trustThisDevice || "1",
      };
    } catch {
      return null;
    }
  }

  private async buildClientFromSession() {
    const [meta, raw] = await Promise.all([readFile(this.sessionMetaPath, "utf8"), readFile(this.sessionPath, "utf8")]);
    const parsedMeta = JSON.parse(meta) as PersistedSessionMeta;
    const parsedState = JSON.parse(raw) as Record<string, unknown>;
    if (!parsedMeta.username) {
      throw new Error("Instagram session metadata is missing username.");
    }

    const ig = new IgApiClient();
    ig.state.generateDevice(parsedMeta.username);
    await ig.state.deserialize(parsedState);
    return {
      ig,
      username: parsedMeta.username,
    };
  }

  private async login(username: string, password: string) {
    const ig = new IgApiClient();
    ig.state.generateDevice(username);
    await ig.simulate.preLoginFlow().catch(() => undefined);
    try {
      await ig.account.login(username, password);
    } catch (error) {
      const withClient = error as Error & { igClient?: IgApiClient };
      withClient.igClient = ig;
      throw withClient;
    }
    process.nextTick(async () => {
      await ig.simulate.postLoginFlow().catch(() => undefined);
    });
    return ig;
  }

  private async autoStartWorker() {
    if (this.isAutoStartingWorker) {
      return;
    }
    this.isAutoStartingWorker = true;

    try {
      const before = await getWorkerRuntimeStatus("instagram");
      if (before.running) {
        this.setState({
          status: "connected",
          mode: "password",
          message: before.pid
            ? `Instagram connected. Worker is already running (PID ${before.pid}).`
            : "Instagram connected. Worker is already running.",
        });
        return;
      }

      this.setState({
        status: "connected",
        mode: "password",
        message: "Instagram connected. Starting worker automatically...",
      });

      try {
        const bunBin = process.env.BUN_BIN || "bun";
        const child = spawn(bunBin, ["run", "worker:instagram"], {
          cwd: ".",
          env: process.env,
          detached: true,
          stdio: "ignore",
        });
        child.unref();
      } catch {
        this.setState({
          status: "connected",
          mode: "password",
          message: "Instagram connected, but auto-start failed. Run `bun run worker:instagram` manually.",
        });
        return;
      }

      for (let i = 0; i < 20; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 300));
        const status = await getWorkerRuntimeStatus("instagram");
        if (status.running) {
          this.setState({
            status: "connected",
            mode: "password",
            message: status.pid
              ? `Instagram connected. Worker started automatically (PID ${status.pid}).`
              : "Instagram connected. Worker started automatically.",
          });
          return;
        }
      }

      this.setState({
        status: "connected",
        mode: "password",
        message: "Instagram connected, but worker did not stay up. Run `bun run worker:instagram` manually.",
      });
    } finally {
      this.isAutoStartingWorker = false;
    }
  }

  private extractChallengeContactPoint(error: unknown) {
    if (!(error instanceof IgCheckpointError)) {
      return undefined;
    }
    const body = (error.response?.body || {}) as {
      challenge?: {
        step_data?: {
          contact_point?: string;
          email?: string;
        };
      };
    };
    return body.challenge?.step_data?.contact_point || body.challenge?.step_data?.email;
  }

  private describeResponseError(error: IgResponseError) {
    const body = (error.response?.body || {}) as {
      message?: unknown;
      error_type?: unknown;
      checkpoint_url?: unknown;
    };

    const message = typeof body.message === "string" ? body.message.trim() : "";
    const errorType = typeof body.error_type === "string" ? body.error_type.trim() : "";
    const hasCheckpointUrl = typeof body.checkpoint_url === "string" && body.checkpoint_url.length > 0;

    if (hasCheckpointUrl) {
      return "Instagram requested a verification checkpoint. Retry sign-in and enter the challenge code when prompted.";
    }

    if (message) {
      if (/please wait a few minutes/i.test(message)) {
        return "Instagram is rate-limiting login attempts. Wait a few minutes, then retry.";
      }
      if (/suspicious login|unusual login attempt/i.test(message)) {
        return "Instagram flagged this as a suspicious login attempt. Confirm the challenge and retry.";
      }
      return message;
    }

    if (errorType) {
      return `Instagram authentication failed (${errorType}).`;
    }

    return "";
  }

  async getState(): Promise<InstagramSetupState> {
    const hasAuth = await this.hasPersistedSession();

    if (!hasAuth && this.state.status === "connected") {
      const snapshot: InstagramSetupState = {
        ...this.state,
        status: "idle",
        message: "No active Instagram session found. Start setup again.",
        mode: "password",
        hasAuth,
      };
      this.state = { ...snapshot };
      return snapshot;
    }

    if (hasAuth && this.state.status === "idle") {
      const worker = await getWorkerRuntimeStatus("instagram");
      if (worker.running) {
        const snapshot: InstagramSetupState = {
          ...this.state,
          status: "connected",
          mode: "password",
          message: worker.pid
            ? `Instagram connected. Worker is running (PID ${worker.pid}).`
            : "Instagram connected. Worker is running.",
          hasAuth,
        };
        this.state = { ...snapshot };
        return snapshot;
      }

      const snapshot: InstagramSetupState = {
        ...this.state,
        status: "connected",
        mode: "password",
        message: "Instagram session found. Starting worker automatically...",
        hasAuth,
      };
      this.state = { ...snapshot };
      if (!this.isAutoStartingWorker) {
        void this.autoStartWorker();
      }
      return snapshot;
    }

    return {
      ...this.state,
      hasAuth,
    };
  }

  async start(options?: InstagramStartOptions): Promise<InstagramSetupState> {
    const username = (options?.username || "").trim();
    const password = options?.password || "";
    if (!username || !password) {
      this.setState({
        status: "error",
        mode: "password",
        message: "Instagram username and password are required.",
      });
      return this.getState();
    }

    const workerStop = await ensureWorkerStopped(3500, "instagram");
    if (workerStop.action === "failed") {
      this.setState({
        status: "error",
        mode: "password",
        message: "Could not stop the Instagram worker automatically. Stop `bun run worker:instagram` and retry.",
      });
      return this.getState();
    }

    this.setState({
      status: "starting",
      mode: "password",
      message: "Starting Instagram sign-in...",
      challengeContactPoint: undefined,
    });

    try {
      this.setState({
        status: "authenticating",
        mode: "password",
        message: "Authenticating with Instagram...",
      });
      const ig = await this.login(username, password);
      await this.writeSessionState(ig, username);
      await this.clearChallengeState();
      await this.reportListenerRuntimeState(false, "Instagram worker listener is offline.", true);
      this.setState({
        status: "connected",
        mode: "password",
        message: "Instagram connected. Starting worker automatically...",
      });
      void this.autoStartWorker();
      return this.getState();
    } catch (error) {
      if (error instanceof IgCheckpointError) {
        const ig = new IgApiClient();
        ig.state.generateDevice(username);
        try {
          // Re-run login on fresh client so challenge state is owned by this in-memory instance.
          await ig.simulate.preLoginFlow().catch(() => undefined);
          await ig.account.login(username, password);
        } catch {
          // Expected: login call throws checkpoint again and seeds challenge state.
        }
        await ig.challenge.auto(true).catch(() => undefined);
        this.challengeClient = ig;
        this.challengeUsername = username;
        await this.writeChallengeState(ig, username).catch(() => undefined);
        const contactPoint = this.extractChallengeContactPoint(error) || "your trusted channel";
        this.setState({
          status: "challenge_required",
          mode: "challenge_code",
          challengeContactPoint: contactPoint,
          message: `Challenge required. Enter the code sent to ${contactPoint}.`,
        });
        await this.reportListenerRuntimeState(false, "Instagram challenge required.", false);
        return this.getState();
      }

      if (error instanceof IgLoginTwoFactorRequiredError) {
        const body = (error.response?.body || {}) as {
          two_factor_info?: {
            two_factor_identifier?: string;
            sms_two_factor_on?: boolean;
            totp_two_factor_on?: boolean;
            obfuscated_phone_number?: string;
          };
        };
        const info = body.two_factor_info || {};
        const twoFactorIdentifier = String(info.two_factor_identifier || "").trim();
        const verificationMethod: "1" | "3" = info.totp_two_factor_on ? "3" : "1";
        const contactPoint = info.obfuscated_phone_number || "your authenticator app";
        const maybeClient = (error as Error & { igClient?: IgApiClient }).igClient;

        if (!maybeClient || !twoFactorIdentifier) {
          this.setState({
            status: "error",
            mode: "password",
            message: "Instagram requested two-factor authentication. Retry login and enter code when prompted.",
          });
          return this.getState();
        }

        await this.writeTwoFactorState(maybeClient, {
          username,
          twoFactorIdentifier,
          verificationMethod,
          trustThisDevice: "1",
        }).catch(() => undefined);

        await rm(this.challengePath, { force: true }).catch(() => undefined);
        this.challengeClient = null;
        this.challengeUsername = null;

        this.setState({
          status: "challenge_required",
          mode: "challenge_code",
          challengeContactPoint: contactPoint,
          message:
            verificationMethod === "3"
              ? "Two-factor required. Enter the code from your authenticator app."
              : `Two-factor required. Enter the code sent to ${contactPoint}.`,
        });
        await this.reportListenerRuntimeState(false, "Instagram two-factor required.", false);
        return this.getState();
      }

      if (error instanceof IgLoginBadPasswordError || error instanceof IgLoginInvalidUserError) {
        const responseMessage = this.describeResponseError(error);
        this.setState({
          status: "error",
          mode: "password",
          message:
            responseMessage ||
            (error instanceof IgLoginInvalidUserError
              ? "Instagram could not find that username. Use your Instagram username (not email/phone) and try again."
              : "Instagram rejected the password for this account. Re-enter password and retry."),
        });
        return this.getState();
      }

      if (error instanceof IgResponseError) {
        const responseMessage = this.describeResponseError(error);
        this.setState({
          status: "error",
          mode: "password",
          message: responseMessage || "Instagram setup failed during authentication.",
        });
        return this.getState();
      }

      this.setState({
        status: "error",
        mode: "password",
        message: error instanceof Error ? error.message : "Instagram setup failed.",
      });
      return this.getState();
    }
  }

  async submitChallenge(options?: InstagramChallengeOptions): Promise<InstagramSetupState> {
    const code = (options?.code || "").trim();
    if (!code) {
      this.setState({
        status: "challenge_required",
        mode: "challenge_code",
        message: "Challenge code is required.",
      });
      return this.getState();
    }

    const twoFactor = await this.restoreTwoFactorClient();
    if (twoFactor) {
      this.setState({
        status: "authenticating",
        mode: "challenge_code",
        message: "Submitting two-factor code...",
      });

      try {
        await twoFactor.ig.account.twoFactorLogin({
          username: twoFactor.username,
          verificationCode: code,
          twoFactorIdentifier: twoFactor.twoFactorIdentifier,
          verificationMethod: twoFactor.verificationMethod,
          trustThisDevice: twoFactor.trustThisDevice,
        });
        process.nextTick(async () => {
          await twoFactor.ig.simulate.postLoginFlow().catch(() => undefined);
        });
        await this.writeSessionState(twoFactor.ig, twoFactor.username);
        await this.clearChallengeState();
        await this.reportListenerRuntimeState(false, "Instagram worker listener is offline.", true);
        this.setState({
          status: "connected",
          mode: "password",
          challengeContactPoint: undefined,
          message: "Instagram verified. Starting worker automatically...",
        });
        void this.autoStartWorker();
        return this.getState();
      } catch (error) {
        if (error instanceof IgCheckpointError) {
          const contactPoint = this.extractChallengeContactPoint(error) || this.state.challengeContactPoint;
          await this.writeChallengeState(twoFactor.ig, twoFactor.username).catch(() => undefined);
          await rm(this.twoFactorPath, { force: true }).catch(() => undefined);
          this.setState({
            status: "challenge_required",
            mode: "challenge_code",
            challengeContactPoint: contactPoint,
            message: contactPoint
              ? `Challenge still pending. Enter the code sent to ${contactPoint}.`
              : "Challenge still pending. Enter the latest code and retry.",
          });
          return this.getState();
        }

        if (error instanceof IgResponseError) {
          const responseMessage = this.describeResponseError(error);
          this.setState({
            status: "challenge_required",
            mode: "challenge_code",
            message: responseMessage || "Invalid two-factor code. Check the latest code and retry.",
          });
          return this.getState();
        }

        this.setState({
          status: "error",
          mode: "challenge_code",
          message: error instanceof Error ? error.message : "Failed to submit two-factor code.",
        });
        return this.getState();
      }
    }

    const challenge = await this.restoreChallengeClient();
    if (!challenge) {
      this.setState({
        status: "error",
        mode: "password",
        message: "No pending Instagram challenge found. Start login again.",
      });
      return this.getState();
    }

    this.setState({
      status: "authenticating",
      mode: "challenge_code",
      message: "Submitting challenge code...",
    });

    try {
      await challenge.ig.challenge.sendSecurityCode(code);
      await this.writeSessionState(challenge.ig, challenge.username);
      await this.clearChallengeState();
      await this.reportListenerRuntimeState(false, "Instagram worker listener is offline.", true);
      this.setState({
        status: "connected",
        mode: "password",
        challengeContactPoint: undefined,
        message: "Instagram verified. Starting worker automatically...",
      });
      void this.autoStartWorker();
      return this.getState();
    } catch (error) {
      if (error instanceof IgChallengeWrongCodeError) {
        this.setState({
          status: "challenge_required",
          mode: "challenge_code",
          message: "Invalid challenge code. Check the latest code and retry.",
        });
        return this.getState();
      }

      if (error instanceof IgCheckpointError) {
        await this.writeChallengeState(challenge.ig, challenge.username).catch(() => undefined);
        const contactPoint = this.extractChallengeContactPoint(error) || this.state.challengeContactPoint;
        this.setState({
          status: "challenge_required",
          mode: "challenge_code",
          challengeContactPoint: contactPoint,
          message: contactPoint
            ? `Challenge still pending. Enter the code sent to ${contactPoint}.`
            : "Challenge still pending. Enter the latest code and retry.",
        });
        return this.getState();
      }

      this.setState({
        status: "error",
        mode: "challenge_code",
        message: error instanceof Error ? error.message : "Failed to submit challenge code.",
      });
      return this.getState();
    }
  }

  async stop(): Promise<InstagramSetupState> {
    const workerStop = await ensureWorkerStopped(3500, "instagram");
    if (workerStop.action === "failed") {
      this.setState({
        status: "error",
        mode: this.state.mode,
        message: "Could not stop Instagram worker automatically. Stop `bun run worker:instagram` and retry.",
      });
      return this.getState();
    }

    const hasAuth = await this.hasPersistedSession();
    this.setState({
      status: "idle",
      mode: "password",
      message: hasAuth ? "Instagram setup stopped. Session remains saved." : "Instagram setup stopped.",
    });
    await this.reportListenerRuntimeState(false, "Instagram worker listener is offline.", hasAuth);
    return this.getState();
  }

  async resetAuth(): Promise<InstagramSetupState> {
    const workerStop = await ensureWorkerStopped(3500, "instagram");
    if (workerStop.action === "failed") {
      this.setState({
        status: "error",
        mode: "password",
        message: "Could not stop Instagram worker automatically. Stop `bun run worker:instagram` and retry reset.",
      });
      return this.getState();
    }

    await rm(this.authDir, { recursive: true, force: true }).catch(() => undefined);
    await this.clearChallengeState();
    this.setState({
      status: "idle",
      mode: "password",
      challengeContactPoint: undefined,
      message: "Instagram session reset. Start setup again to sign in.",
    });
    await this.reportListenerRuntimeState(false, "Instagram worker listener is offline.", false);
    return this.getState();
  }

  async restartWorker(): Promise<InstagramSetupState> {
    const hasAuth = await this.hasPersistedSession();
    if (!hasAuth) {
      this.setState({
        status: "idle",
        mode: "password",
        message: "No Instagram session found. Start setup first.",
      });
      return this.getState();
    }

    const workerStop = await ensureWorkerStopped(3500, "instagram");
    if (workerStop.action === "failed") {
      this.setState({
        status: "error",
        mode: "password",
        message: "Could not stop Instagram worker automatically. Stop `bun run worker:instagram` and retry.",
      });
      return this.getState();
    }

    this.setState({
      status: "connected",
      mode: "password",
      message: "Restarting Instagram worker...",
    });
    await this.reportListenerRuntimeState(false, "Restarting Instagram worker...", true);
    await this.autoStartWorker();
    return this.getState();
  }

  async validateSessionClient() {
    try {
      const { ig } = await this.buildClientFromSession();
      await ig.account.currentUser();
      return true;
    } catch {
      return false;
    }
  }
}

declare global {
  var __slmInstagramSetupManager: InstagramSetupManager | undefined;
}

export function getInstagramSetupManager(): InstagramSetupManager {
  const existing = globalThis.__slmInstagramSetupManager as
    | (InstagramSetupManager & { restartWorker?: () => Promise<InstagramSetupState> })
    | undefined;

  if (!existing || typeof existing.restartWorker !== "function") {
    globalThis.__slmInstagramSetupManager = new InstagramSetupManager();
  }

  return globalThis.__slmInstagramSetupManager as InstagramSetupManager;
}
