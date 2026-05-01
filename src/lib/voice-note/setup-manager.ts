import { execFile } from "node:child_process";
import { appendFile, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  ensureVoiceModuleDataDir,
  getVoiceNoteInstallLogPath,
  getVoiceNotePendingSamplePath,
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
type VoiceInstallProgressCallback = (progress: number, message: string) => void | Promise<void>;

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
  private activeInstallPromise: Promise<VoiceModuleStateSnapshot> | null = null;

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

  private async commandSucceeds(command: string, args: string[], timeoutMs: number) {
    try {
      await this.runInstallCommand(command, args, timeoutMs);
      return true;
    } catch {
      return false;
    }
  }

  private async updateInstallProgress(progress: number, message: string, onProgress?: VoiceInstallProgressCallback) {
    await updateVoiceModuleState({
      status: "installing",
      message,
      installProgress: progress,
      lastError: undefined,
    });
    await onProgress?.(progress, message);
  }

  private async getMissingVoicePackages(pythonBinPath: string, timeoutMs: number) {
    const modulePackages = [
      ["voxcpm", "voxcpm"],
      ["soundfile", "soundfile"],
    ] as const;
    const script = [
      "import importlib.util",
      `packages = ${JSON.stringify(modulePackages)}`,
      "missing = [package for package, module in packages if importlib.util.find_spec(module) is None]",
      "print(','.join(missing))",
      "raise SystemExit(1 if missing else 0)",
    ].join("; ");
    await this.appendInstallLog(`$ ${pythonBinPath} -c <check voice packages>`);
    try {
      const result = await execFileAsync(pythonBinPath, ["-c", script], {
        timeout: timeoutMs,
        maxBuffer: 256 * 1024,
      });
      const stdout = (result.stdout || "").trim();
      if (stdout) {
        await this.appendInstallLog(stdout);
      }
      return stdout ? stdout.split(",").filter(Boolean) : [];
    } catch (error) {
      const output =
        typeof error === "object" && error && "stdout" in error
          ? String((error as { stdout?: unknown }).stdout || "").trim()
          : "";
      const missing = output ? output.split(",").filter(Boolean) : modulePackages.map(([packageName]) => packageName);
      await this.appendInstallLog(`Missing voice packages: ${missing.join(", ")}`);
      return missing;
    }
  }

  private async markReady(args: { modelId: string; pythonBinPath: string; reusedExisting: boolean; onProgress?: VoiceInstallProgressCallback }) {
    await this.updateInstallProgress(96, "Preparing voice sample.", args.onProgress);
    await this.preparePendingSample();
    const snapshot = await readVoiceModuleStateSnapshot();
    const hasSample = snapshot.hasSample;

    await updateVoiceModuleState({
      status: "ready",
      modelId: args.modelId,
      pythonBinPath: args.pythonBinPath,
      message: hasSample
        ? args.reusedExisting
          ? "Voice note module is ready. Existing packages were reused."
          : "Voice note module is ready. Sample already present; cloning can run now."
        : args.reusedExisting
          ? "Voice note packages are already available. Record a voice sample to enable cloning."
          : "Voice note module installed. Record a voice sample to enable cloning.",
      installProgress: 100,
      lastError: undefined,
    });
    await args.onProgress?.(100, "Voice note module is ready.");
    return await this.getState();
  }

  private async preparePendingSample() {
    const current = await readVoiceModuleState();
    if (!current.pendingSamplePath || !(await fileExists(current.pendingSamplePath))) {
      return;
    }

    const ffmpegPath = resolveFfmpegPath();
    const sampleTimeoutMs = parsePositiveInt(process.env.SLM_VOICE_SAMPLE_TIMEOUT_MS, DEFAULT_SAMPLE_TIMEOUT_MS);
    try {
      await execFileAsync(
        ffmpegPath,
        [
          "-y",
          "-hide_banner",
          "-loglevel",
          "error",
          "-i",
          current.pendingSamplePath,
          "-ac",
          "1",
          "-ar",
          "16000",
          "-c:a",
          "pcm_s16le",
          getVoiceNoteSamplePath(),
        ],
        {
          timeout: sampleTimeoutMs,
          maxBuffer: 8 * 1024 * 1024,
        },
      );
      await updateVoiceModuleState({
        sampleWavPath: getVoiceNoteSamplePath(),
        samplePromptText: current.pendingSamplePromptText || current.samplePromptText,
        sampleMimeType: "audio/wav",
        pendingSamplePath: undefined,
        pendingSamplePromptText: undefined,
        pendingSampleMimeType: undefined,
        message: "Voice sample prepared. Voice note cloning can use it now.",
        lastError: undefined,
      });
      await rm(current.pendingSamplePath, { force: true }).catch(() => undefined);
    } catch (error) {
      await updateVoiceModuleState({
        message: "Voice sample is saved locally. Install audio tools to finish preparing it.",
        lastError: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async getState() {
    return await readVoiceModuleStateSnapshot();
  }

  async install(options?: { modelId?: string; onProgress?: VoiceInstallProgressCallback }): Promise<VoiceModuleStateSnapshot> {
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
        installProgress: 6,
        pythonBinPath: undefined,
        lastError: undefined,
      });
      await options?.onProgress?.(6, `Installing voice note module (${modelId})...`);

      const probeTimeoutMs = Math.min(60_000, installTimeoutMs);
      await this.updateInstallProgress(14, "Checking existing voice environment.", options?.onProgress);
      const existingVenvReady =
        (await fileExists(pythonBinPath)) && (await this.commandSucceeds(pythonBinPath, ["--version"], probeTimeoutMs));
      if (existingVenvReady) {
        await this.updateInstallProgress(24, "Checking installed voice packages.", options?.onProgress);
        const missingPackages = await this.getMissingVoicePackages(pythonBinPath, probeTimeoutMs);
        if (missingPackages.length === 0) {
          return await this.markReady({ modelId, pythonBinPath, reusedExisting: true, onProgress: options?.onProgress });
        }
      }

      if (!existingVenvReady) {
        await this.updateInstallProgress(34, "Checking Python.", options?.onProgress);
        await this.runInstallCommand(basePythonBin, ["--version"], Math.min(25_000, installTimeoutMs));
        await this.updateInstallProgress(44, "Checking base Python packages.", options?.onProgress);
        const baseMissingPackages = await this.getMissingVoicePackages(basePythonBin, probeTimeoutMs);
        if (baseMissingPackages.length === 0) {
          return await this.markReady({ modelId, pythonBinPath: basePythonBin, reusedExisting: true, onProgress: options?.onProgress });
        }
        await this.updateInstallProgress(54, "Creating isolated voice environment.", options?.onProgress);
        await this.runInstallCommand(basePythonBin, ["-m", "venv", venvDir], installTimeoutMs);
      }

      await this.updateInstallProgress(62, "Verifying isolated voice environment.", options?.onProgress);
      await this.runInstallCommand(pythonBinPath, ["--version"], probeTimeoutMs);
      await this.updateInstallProgress(68, "Resolving voice package requirements.", options?.onProgress);
      const missingPackages = await this.getMissingVoicePackages(pythonBinPath, probeTimeoutMs);
      if (missingPackages.length > 0) {
        await this.updateInstallProgress(76, "Updating Python package installer.", options?.onProgress);
        await this.runInstallCommand(pythonBinPath, ["-m", "pip", "install", "--upgrade", "pip", "setuptools", "wheel"], installTimeoutMs);
        await this.updateInstallProgress(86, `Installing ${missingPackages.join(", ")}.`, options?.onProgress);
        await this.runInstallCommand(pythonBinPath, ["-m", "pip", "install", ...missingPackages], installTimeoutMs);
      }
      await this.updateInstallProgress(92, "Verifying voice packages.", options?.onProgress);
      await this.runInstallCommand(pythonBinPath, ["-c", "import voxcpm, soundfile"], probeTimeoutMs);

      return await this.markReady({ modelId, pythonBinPath, reusedExisting: missingPackages.length === 0, onProgress: options?.onProgress });
    } catch (error) {
      const err = error instanceof Error ? error.message : String(error);
      await this.appendInstallLog(`ERROR: ${err}`);
      await updateVoiceModuleState({
        status: "error",
        modelId,
        message: "Voice note module install failed. Check install log and retry.",
        installProgress: undefined,
        lastError: err,
      });
      return await this.getState();
    } finally {
      this.isInstalling = false;
      this.activeInstallPromise = null;
    }
  }

  async startInstall(options?: { modelId?: string; onProgress?: VoiceInstallProgressCallback }) {
    if (!this.activeInstallPromise) {
      this.activeInstallPromise = this.install(options);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
    return await this.getState();
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
    const inputExtension = extensionFromMimeType(args.mimeType);
    const inputPath = join(tempDir, `sample${inputExtension}`);
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
        pendingSamplePath: undefined,
        pendingSamplePromptText: undefined,
        pendingSampleMimeType: undefined,
        message:
          previous.status === "ready"
            ? "Voice sample saved. Voice note cloning is ready."
            : "Voice sample saved. Install voice note module to finish setup.",
        lastError: undefined,
      });

      return await this.getState();
    } catch {
      const previous = await readVoiceModuleState();
      const pendingPath = getVoiceNotePendingSamplePath(inputExtension);
      await writeFile(pendingPath, args.audioBytes);
      await updateVoiceModuleState({
        status: previous.status,
        pendingSamplePath: pendingPath,
        pendingSamplePromptText: promptText,
        pendingSampleMimeType: args.mimeType || "audio/webm",
        message: "Voice sample saved locally. Preparation will finish it when audio tools are ready.",
        lastError: undefined,
      });
      return await this.getState();
    } finally {
      await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  async reset() {
    const current = await readVoiceModuleState();
    const samplePath = current.sampleWavPath || getVoiceNoteSamplePath();
    const pendingSamplePath = current.pendingSamplePath;
    const venvDir = getVoiceNoteVenvDir();

    await rm(samplePath, { force: true }).catch(() => undefined);
    if (pendingSamplePath) {
      await rm(pendingSamplePath, { force: true }).catch(() => undefined);
    }
    await rm(venvDir, { recursive: true, force: true }).catch(() => undefined);
    await rm(getVoiceNoteInstallLogPath(), { force: true }).catch(() => undefined);

    const sampleStillExists = await fileExists(samplePath);
    await writeVoiceModuleState({
      status: "not_installed",
      message: sampleStillExists ? "Voice module reset failed to clear sample." : "Voice note module reset. Setup can run again.",
      modelId: current.modelId,
      updatedAt: Date.now(),
      installLogPath: getVoiceNoteInstallLogPath(),
      installProgress: undefined,
      sampleWavPath: undefined,
      samplePromptText: undefined,
      sampleMimeType: undefined,
      pendingSamplePath: undefined,
      pendingSamplePromptText: undefined,
      pendingSampleMimeType: undefined,
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
