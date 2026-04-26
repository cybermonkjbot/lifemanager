import { execFile } from "node:child_process";
import { appendFile, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  ensureVoiceModuleDataDir,
  getVoiceNoteInstallLogPath,
  getVoiceNotePythonBinPath,
  getVoiceNoteSamplePath,
  getVoiceNoteVenvDir,
  readVoiceModuleState,
  readVoiceModuleStateSnapshot,
  resolveVoiceModelId,
  updateVoiceModuleState,
  writeVoiceModuleState,
  type VoiceModuleStateSnapshot,
} from "./state";

const execFileAsync = promisify(execFile);
const DEFAULT_INSTALL_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_SAMPLE_TIMEOUT_MS = 2 * 60 * 1000;

function parsePositiveInt(raw: string | undefined, fallback: number) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.round(parsed);
}

function resolveBasePythonBin() {
  const configured = (process.env.SLM_VOICE_SETUP_PYTHON_BIN || process.env.SLM_VOICE_PYTHON_BASE_BIN || "").trim();
  return configured || "python3";
}

function resolveFfmpegPath() {
  const configured = (process.env.SLM_FFMPEG_PATH || "").trim();
  return configured || "ffmpeg";
}

function normalizePromptText(raw: string | undefined) {
  return (raw || "").replace(/\s+/g, " ").trim();
}

function extensionFromMimeType(mimeType?: string) {
  const normalized = (mimeType || "").toLowerCase();
  if (normalized.includes("wav")) {
    return ".wav";
  }
  if (normalized.includes("ogg") || normalized.includes("opus")) {
    return ".ogg";
  }
  if (normalized.includes("mpeg")) {
    return ".mp3";
  }
  if (normalized.includes("aac")) {
    return ".aac";
  }
  if (normalized.includes("mp4")) {
    return ".m4a";
  }
  if (normalized.includes("webm")) {
    return ".webm";
  }
  return ".audio";
}

async function fileExists(path: string) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

class VoiceNoteSetupManager {
  private isInstalling = false;

  private async resetInstallLog() {
    await ensureVoiceModuleDataDir();
    await writeFile(getVoiceNoteInstallLogPath(), "", "utf8");
  }

  private async appendInstallLog(line: string) {
    await ensureVoiceModuleDataDir();
    await appendFile(getVoiceNoteInstallLogPath(), `${line}\n`, "utf8").catch(() => undefined);
  }

  private async runInstallCommand(command: string, args: string[], timeoutMs: number) {
    await this.appendInstallLog(`$ ${command} ${args.join(" ")}`);
    const result = await execFileAsync(command, args, {
      timeout: timeoutMs,
      maxBuffer: 16 * 1024 * 1024,
    });
    const stdout = (result.stdout || "").trim();
    const stderr = (result.stderr || "").trim();
    if (stdout) {
      await this.appendInstallLog(stdout);
    }
    if (stderr) {
      await this.appendInstallLog(stderr);
    }
  }

  async getState() {
    return await readVoiceModuleStateSnapshot();
  }

  async install(options?: { modelId?: string }): Promise<VoiceModuleStateSnapshot> {
    if (this.isInstalling) {
      return await this.getState();
    }

    this.isInstalling = true;
    const modelId = resolveVoiceModelId(options?.modelId);
    const installTimeoutMs = parsePositiveInt(process.env.SLM_VOICE_SETUP_TIMEOUT_MS, DEFAULT_INSTALL_TIMEOUT_MS);
    const basePythonBin = resolveBasePythonBin();
    const pythonBinPath = getVoiceNotePythonBinPath();
    const venvDir = getVoiceNoteVenvDir();

    try {
      await this.resetInstallLog();
      await updateVoiceModuleState({
        status: "installing",
        message: `Installing voice note module (${modelId})...`,
        modelId,
        installLogPath: getVoiceNoteInstallLogPath(),
        pythonBinPath: undefined,
        lastError: undefined,
      });

      await this.runInstallCommand(basePythonBin, ["--version"], Math.min(25_000, installTimeoutMs));
      await this.runInstallCommand(basePythonBin, ["-m", "venv", venvDir], installTimeoutMs);
      await this.runInstallCommand(pythonBinPath, ["-m", "pip", "install", "--upgrade", "pip", "setuptools", "wheel"], installTimeoutMs);
      await this.runInstallCommand(pythonBinPath, ["-m", "pip", "install", "--upgrade", "voxcpm", "soundfile"], installTimeoutMs);
      await this.runInstallCommand(pythonBinPath, ["-m", "pip", "show", "voxcpm"], Math.min(60_000, installTimeoutMs));

      const snapshot = await readVoiceModuleStateSnapshot();
      const hasSample = snapshot.hasSample;

      await updateVoiceModuleState({
        status: "ready",
        modelId,
        pythonBinPath,
        message: hasSample
          ? "Voice note module is ready. Sample already present; cloning can run now."
          : "Voice note module installed. Record a voice sample to enable cloning.",
        lastError: undefined,
      });
      return await this.getState();
    } catch (error) {
      const err = error instanceof Error ? error.message : String(error);
      await this.appendInstallLog(`ERROR: ${err}`);
      await updateVoiceModuleState({
        status: "error",
        modelId,
        message: "Voice note module install failed. Check install log and retry.",
        lastError: err,
      });
      return await this.getState();
    } finally {
      this.isInstalling = false;
    }
  }

  async saveSample(args: { audioBytes: Buffer; mimeType?: string; promptText?: string }) {
    const promptText = normalizePromptText(args.promptText);
    if (!promptText) {
      await updateVoiceModuleState({
        status: "error",
        message: "Prompt transcript is required for voice cloning sample.",
        lastError: "Missing prompt transcript.",
      });
      return await this.getState();
    }

    const ffmpegPath = resolveFfmpegPath();
    const sampleTimeoutMs = parsePositiveInt(process.env.SLM_VOICE_SAMPLE_TIMEOUT_MS, DEFAULT_SAMPLE_TIMEOUT_MS);
    const tempDir = await mkdtemp(join(tmpdir(), "slm-voice-sample-"));
    const inputPath = join(tempDir, `sample${extensionFromMimeType(args.mimeType)}`);
    const outputPath = getVoiceNoteSamplePath();

    try {
      await ensureVoiceModuleDataDir();
      await writeFile(inputPath, args.audioBytes);
      await execFileAsync(
        ffmpegPath,
        [
          "-y",
          "-hide_banner",
          "-loglevel",
          "error",
          "-i",
          inputPath,
          "-ac",
          "1",
          "-ar",
          "16000",
          "-c:a",
          "pcm_s16le",
          outputPath,
        ],
        {
          timeout: sampleTimeoutMs,
          maxBuffer: 8 * 1024 * 1024,
        },
      );

      const previous = await readVoiceModuleState();
      const nextStatus = previous.status === "ready" ? "ready" : previous.status;
      await updateVoiceModuleState({
        status: nextStatus,
        sampleWavPath: outputPath,
        samplePromptText: promptText,
        sampleMimeType: "audio/wav",
        message:
          previous.status === "ready"
            ? "Voice sample saved. Voice note cloning is ready."
            : "Voice sample saved. Install voice note module to finish setup.",
        lastError: undefined,
      });

      return await this.getState();
    } catch (error) {
      const err = error instanceof Error ? error.message : String(error);
      await updateVoiceModuleState({
        status: "error",
        message: "Could not process the recorded audio sample. Verify ffmpeg and retry.",
        lastError: err,
      });
      return await this.getState();
    } finally {
      await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  async reset() {
    const current = await readVoiceModuleState();
    const samplePath = current.sampleWavPath || getVoiceNoteSamplePath();
    const venvDir = getVoiceNoteVenvDir();

    await rm(samplePath, { force: true }).catch(() => undefined);
    await rm(venvDir, { recursive: true, force: true }).catch(() => undefined);
    await rm(getVoiceNoteInstallLogPath(), { force: true }).catch(() => undefined);

    const sampleStillExists = await fileExists(samplePath);
    await writeVoiceModuleState({
      status: "not_installed",
      message: sampleStillExists ? "Voice module reset failed to clear sample." : "Voice note module reset. Setup can run again.",
      modelId: current.modelId,
      updatedAt: Date.now(),
      installLogPath: getVoiceNoteInstallLogPath(),
      sampleWavPath: undefined,
      samplePromptText: undefined,
      sampleMimeType: undefined,
      pythonBinPath: undefined,
      lastError: sampleStillExists ? "Failed to remove sample file." : undefined,
    });

    return await this.getState();
  }

  async readInstallLog(maxChars = 12_000) {
    try {
      const raw = await readFile(getVoiceNoteInstallLogPath(), "utf8");
      if (raw.length <= maxChars) {
        return raw;
      }
      return raw.slice(raw.length - maxChars);
    } catch {
      return "";
    }
  }
}

let manager: VoiceNoteSetupManager | null = null;

export function getVoiceNoteSetupManager() {
  if (!manager) {
    manager = new VoiceNoteSetupManager();
  }
  return manager;
}
