import { execFile } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { platform, release } from "node:os";
import { dirname } from "node:path";
import { promisify } from "node:util";
import { getRuntimeDataPath } from "@/lib/runtime/paths";
import { getVoiceNoteSetupManager } from "@/lib/voice-note/setup-manager";

const execFileAsync = promisify(execFile);
const PREPARATION_STATE_PATH = getRuntimeDataPath("preparation-state.json");
const STALE_RUNNING_PREPARATION_MS = 60 * 60 * 1000;

export type SetupPreparationStatus = "idle" | "running" | "ready" | "skipped" | "error";

export type SetupPreparationState = {
  status: SetupPreparationStatus;
  message: string;
  detail: string;
  progress: number;
  platform: string;
  updatedAt: number;
  startedAt: number | null;
  completedAt: number | null;
  lastError?: string;
};

const defaultState = (): SetupPreparationState => ({
  status: "idle",
  message: "Ready to prepare OdogwuHQ.",
  detail: "Local tools can be installed now.",
  progress: 0,
  platform: resolvePlatformLabel(),
  updatedAt: Date.now(),
  startedAt: null,
  completedAt: null,
});

let preparationPromise: Promise<void> | null = null;
let preparationStartingPromise: Promise<SetupPreparationState> | null = null;

function resolvePlatformLabel() {
  const current = platform();
  if (current === "darwin") {
    return "macOS";
  }
  if (current === "win32") {
    return "Windows";
  }
  if (current === "linux") {
    return "Linux";
  }
  return `${current} ${release()}`.trim();
}

async function commandWorks(command: string, args: string[]) {
  try {
    await execFileAsync(command, args, { timeout: 8_000, maxBuffer: 256 * 1024 });
    return true;
  } catch {
    return false;
  }
}

function parseEnabledFlag(value: string | undefined, fallback: boolean) {
  const normalized = (value || "").trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  return fallback;
}

async function fileExists(path: string) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function resolveTranscriptionReadiness() {
  const enabled = parseEnabledFlag(process.env.SLM_WHISPER_ENABLED, true);
  if (!enabled) {
    return {
      ready: true,
      message: "Transcription is off.",
      detail: "Local transcription will stay disabled.",
    };
  }

  const modelPath = (process.env.SLM_WHISPER_MODEL_PATH || "").trim();
  if (!modelPath) {
    return {
      ready: false,
      message: "Transcription needs a model.",
      detail: "Set SLM_WHISPER_MODEL_PATH to use local transcription.",
    };
  }

  if (!(await fileExists(modelPath))) {
    return {
      ready: false,
      message: "Transcription model was not found.",
      detail: "Check the local Whisper model path.",
    };
  }

  const cliPath = (process.env.SLM_WHISPER_CLI_PATH || "whisper-cli").trim() || "whisper-cli";
  const cliReady = await commandWorks(cliPath, ["--help"]);
  return cliReady
    ? {
        ready: true,
        message: "Transcription is ready.",
        detail: "Local transcription tools are available.",
      }
    : {
        ready: false,
        message: "Transcription tool was not found.",
        detail: "Install whisper-cli to use local transcription.",
      };
}

function normalizeState(raw: Partial<SetupPreparationState> | null | undefined): SetupPreparationState {
  const fallback = defaultState();
  const status =
    raw?.status === "idle" ||
    raw?.status === "running" ||
    raw?.status === "ready" ||
    raw?.status === "skipped" ||
    raw?.status === "error"
      ? raw.status
      : fallback.status;
  const progress = Number(raw?.progress);
  return {
    status,
    message: typeof raw?.message === "string" && raw.message.trim() ? raw.message : fallback.message,
    detail: typeof raw?.detail === "string" && raw.detail.trim() ? raw.detail : fallback.detail,
    progress: Number.isFinite(progress) ? Math.max(0, Math.min(100, Math.round(progress))) : fallback.progress,
    platform: typeof raw?.platform === "string" && raw.platform.trim() ? raw.platform : fallback.platform,
    updatedAt: Number.isFinite(Number(raw?.updatedAt)) ? Number(raw?.updatedAt) : Date.now(),
    startedAt: Number.isFinite(Number(raw?.startedAt)) ? Number(raw?.startedAt) : null,
    completedAt: Number.isFinite(Number(raw?.completedAt)) ? Number(raw?.completedAt) : null,
    lastError: typeof raw?.lastError === "string" ? raw.lastError : undefined,
  };
}

export async function readSetupPreparationState(): Promise<SetupPreparationState> {
  try {
    const raw = await readFile(PREPARATION_STATE_PATH, "utf8");
    return normalizeState(JSON.parse(raw) as Partial<SetupPreparationState>);
  } catch {
    return defaultState();
  }
}

async function writeSetupPreparationState(next: SetupPreparationState) {
  await mkdir(dirname(PREPARATION_STATE_PATH), { recursive: true });
  const normalized = normalizeState({ ...next, updatedAt: Date.now() });
  await writeFile(PREPARATION_STATE_PATH, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  return normalized;
}

async function updateSetupPreparationState(patch: Partial<SetupPreparationState>) {
  const current = await readSetupPreparationState();
  return await writeSetupPreparationState({
    ...current,
    ...patch,
  });
}

function isStaleRunningState(state: SetupPreparationState) {
  return state.status === "running" && Date.now() - state.updatedAt > STALE_RUNNING_PREPARATION_MS;
}

async function runPreparation() {
  try {
    const voiceManager = getVoiceNoteSetupManager();
    const syncVoiceInstallProgress = async (voiceProgress: number, message: string) => {
      await updateSetupPreparationState({
        status: "running",
        message,
        detail: "Installing local voice packages.",
        progress: Math.max(58, Math.min(96, 58 + Math.round(voiceProgress * 0.38))),
      });
    };
    const existingVoiceState = await voiceManager.getState();
    if (existingVoiceState.status === "ready") {
      const ffmpegReady = await commandWorks(process.env.SLM_FFMPEG_PATH || "ffmpeg", ["-version"]);
      const transcription = await resolveTranscriptionReadiness();
      const verifiedVoiceState = await voiceManager.install({ onProgress: syncVoiceInstallProgress });
      if (!ffmpegReady || !transcription.ready) {
        const details = [
          !ffmpegReady ? "Install ffmpeg for audio conversion." : "",
          !transcription.ready ? transcription.detail : "",
        ].filter(Boolean);
        await updateSetupPreparationState({
          status: "error",
          message: "Preparation needs attention.",
          detail: details.join(" "),
          progress: 88,
          completedAt: Date.now(),
          lastError: details.join(" "),
        });
        return;
      }
      if (verifiedVoiceState.status !== "ready") {
        await updateSetupPreparationState({
          status: "error",
          message: "Preparation needs attention.",
          detail: verifiedVoiceState.message || "Voice tools could not finish installing.",
          progress: 88,
          completedAt: Date.now(),
          lastError: verifiedVoiceState.lastError,
        });
        return;
      }
      await updateSetupPreparationState({
        status: "ready",
        message: "OdogwuHQ is ready.",
        detail: "Local transcription and voice tools are already installed.",
        progress: 100,
        completedAt: Date.now(),
        lastError: undefined,
      });
      return;
    }

    const pythonReady = await commandWorks(process.env.SLM_VOICE_SETUP_PYTHON_BIN || "python3", ["--version"]);
    await updateSetupPreparationState({
      status: "running",
      message: pythonReady ? "Python is ready." : "Python was not found.",
      detail: pythonReady ? "Preparing local voice tools." : "Local voice tools need Python 3.",
      progress: pythonReady ? 24 : 18,
    });

    if (!pythonReady) {
      await updateSetupPreparationState({
        status: "error",
        message: "Python 3 is required.",
        detail: "Install Python 3, then run preparation again.",
        progress: 18,
        completedAt: Date.now(),
        lastError: "python3 was not found.",
      });
      return;
    }

    const ffmpegReady = await commandWorks(process.env.SLM_FFMPEG_PATH || "ffmpeg", ["-version"]);
    await updateSetupPreparationState({
      status: "running",
      message: ffmpegReady ? "Audio tools are ready." : "Audio tools need attention.",
      detail: ffmpegReady ? "Downloading voice packages." : "Install ffmpeg for voice notes and transcription.",
      progress: ffmpegReady ? 38 : 30,
    });

    const transcription = await resolveTranscriptionReadiness();
    await updateSetupPreparationState({
      status: "running",
      message: transcription.message,
      detail: transcription.detail,
      progress: transcription.ready ? 46 : 42,
    });

    await updateSetupPreparationState({
      status: "running",
      message: "Downloading voice packages.",
      detail: "This can take a few minutes.",
      progress: 58,
    });

    const voiceState = await voiceManager.install({ onProgress: syncVoiceInstallProgress });
    if (voiceState.status === "ready") {
      if (!ffmpegReady || !transcription.ready) {
        const details = [
          !ffmpegReady ? "Install ffmpeg for audio conversion." : "",
          !transcription.ready ? transcription.detail : "",
        ].filter(Boolean);
        await updateSetupPreparationState({
          status: "error",
          message: "Preparation needs attention.",
          detail: details.join(" "),
          progress: 88,
          completedAt: Date.now(),
          lastError: details.join(" "),
        });
        return;
      }
      await updateSetupPreparationState({
        status: "ready",
        message: "OdogwuHQ is ready.",
        detail: "Local transcription and voice tools are installed.",
        progress: 100,
        completedAt: Date.now(),
        lastError: undefined,
      });
      return;
    }

    await updateSetupPreparationState({
      status: "error",
      message: "Preparation needs attention.",
      detail: voiceState.message || "Voice tools could not finish installing.",
      progress: 72,
      completedAt: Date.now(),
      lastError: voiceState.lastError,
    });
  } catch (error) {
    await updateSetupPreparationState({
      status: "error",
      message: "Preparation needs attention.",
      detail: error instanceof Error ? error.message : "Could not finish installing local tools.",
      completedAt: Date.now(),
      lastError: error instanceof Error ? error.message : String(error),
    });
  } finally {
    preparationPromise = null;
  }
}

export async function startSetupPreparation() {
  if (preparationStartingPromise) {
    return await preparationStartingPromise;
  }
  const current = await readSetupPreparationState();
  if (current.status === "running" && !isStaleRunningState(current)) {
    return current;
  }
  if (current.status === "ready") {
    return current;
  }
  if (!preparationPromise) {
    preparationStartingPromise = (async () => {
      const startedAt = Date.now();
      const startingState = await writeSetupPreparationState({
        ...defaultState(),
        status: "running",
        message: "Checking this computer.",
        detail: "Detecting environment.",
        progress: 8,
        startedAt,
      });
      preparationPromise = runPreparation().catch(() => undefined);
      return startingState;
    })();
    try {
      return await preparationStartingPromise;
    } finally {
      preparationStartingPromise = null;
    }
  }
  return await readSetupPreparationState();
}

export async function skipSetupPreparation() {
  if (preparationStartingPromise) {
    return await preparationStartingPromise;
  }
  const current = await readSetupPreparationState();
  if (current.status === "running" && !isStaleRunningState(current)) {
    return current;
  }
  if (current.status === "ready") {
    return current;
  }
  return await writeSetupPreparationState({
    ...defaultState(),
    status: "skipped",
    message: "Preparation skipped.",
    detail: "You can install local tools later.",
    progress: 0,
    completedAt: Date.now(),
  });
}
