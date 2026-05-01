import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { platform } from "node:os";
import { join } from "node:path";
import { getRuntimeDataPath } from "../runtime/paths";

export type VoiceModuleStatus = "not_installed" | "installing" | "ready" | "error";

export type VoiceModuleState = {
  status: VoiceModuleStatus;
  message: string;
  modelId: string;
  updatedAt: number;
  pythonBinPath?: string;
  sampleWavPath?: string;
  samplePromptText?: string;
  sampleMimeType?: string;
  pendingSamplePath?: string;
  pendingSamplePromptText?: string;
  pendingSampleMimeType?: string;
  installLogPath?: string;
  installProgress?: number;
  installingPid?: number;
  lastError?: string;
};

export type VoiceModuleStateSnapshot = VoiceModuleState & {
  hasSample: boolean;
  hasPendingSample: boolean;
};

const DEFAULT_MODEL_ID = "openbmb/VoxCPM-0.5B";

export function getVoiceNoteDataDir() {
  return getRuntimeDataPath("voice-note");
}

export function getVoiceNoteStatePath() {
  return join(getVoiceNoteDataDir(), "state.json");
}

export function getVoiceNoteSamplePath() {
  return join(getVoiceNoteDataDir(), "prompt_sample.wav");
}

export function getVoiceNotePendingSamplePath(extension = ".audio") {
  const safeExtension = extension.startsWith(".") && /^[a-z0-9.]+$/i.test(extension) ? extension : ".audio";
  return join(getVoiceNoteDataDir(), `prompt_sample_original${safeExtension}`);
}

export function getVoiceNoteVenvDir() {
  return join(getVoiceNoteDataDir(), "venv");
}

export function getVoiceNotePythonBinPath() {
  if (platform() === "win32") {
    return join(getVoiceNoteVenvDir(), "Scripts", "python.exe");
  }
  return join(getVoiceNoteVenvDir(), "bin", "python");
}

export function getVoiceNoteInstallLogPath() {
  return join(getVoiceNoteDataDir(), "install.log");
}

export function getVoiceNoteGeneratorScriptPath() {
  return join(process.cwd(), "scripts", "voxcpm_generate.py");
}

function defaultVoiceModuleState(): VoiceModuleState {
  return {
    status: "not_installed",
    message: "Voice note module is not installed.",
    modelId: DEFAULT_MODEL_ID,
    updatedAt: Date.now(),
    installLogPath: getVoiceNoteInstallLogPath(),
  };
}

async function fileExists(path: string | undefined) {
  if (!path) {
    return false;
  }
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function normalizeModelId(raw: string | undefined) {
  const next = (raw || "").trim();
  return next || DEFAULT_MODEL_ID;
}

function normalizeState(raw: Partial<VoiceModuleState> | null | undefined): VoiceModuleState {
  const fallback = defaultVoiceModuleState();
  if (!raw) {
    return fallback;
  }

  const status =
    raw.status === "installing" || raw.status === "ready" || raw.status === "error" || raw.status === "not_installed"
      ? raw.status
      : fallback.status;

  const message = (raw.message || "").trim() || fallback.message;
  const updatedAt = Number.isFinite(raw.updatedAt) ? Number(raw.updatedAt) : Date.now();
  const installProgress = Number(raw.installProgress);

  return {
    status,
    message,
    modelId: normalizeModelId(raw.modelId),
    updatedAt,
    pythonBinPath: raw.pythonBinPath,
    sampleWavPath: raw.sampleWavPath,
    samplePromptText: raw.samplePromptText,
    sampleMimeType: raw.sampleMimeType,
    pendingSamplePath: raw.pendingSamplePath,
    pendingSamplePromptText: raw.pendingSamplePromptText,
    pendingSampleMimeType: raw.pendingSampleMimeType,
    installLogPath: raw.installLogPath || fallback.installLogPath,
    installProgress: Number.isFinite(installProgress) ? Math.max(0, Math.min(100, Math.round(installProgress))) : undefined,
    installingPid: Number.isFinite(raw.installingPid) ? Number(raw.installingPid) : undefined,
    lastError: raw.lastError,
  };
}

export async function ensureVoiceModuleDataDir() {
  await mkdir(getVoiceNoteDataDir(), { recursive: true });
}

export async function readVoiceModuleState(): Promise<VoiceModuleState> {
  try {
    const raw = await readFile(getVoiceNoteStatePath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<VoiceModuleState>;
    return normalizeState(parsed);
  } catch {
    return defaultVoiceModuleState();
  }
}

export async function writeVoiceModuleState(next: VoiceModuleState) {
  await ensureVoiceModuleDataDir();
  const normalized = normalizeState(next);
  await writeFile(getVoiceNoteStatePath(), `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  return normalized;
}

export async function updateVoiceModuleState(patch: Partial<VoiceModuleState>) {
  const previous = await readVoiceModuleState();
  return await writeVoiceModuleState({
    ...previous,
    ...patch,
    modelId: normalizeModelId(patch.modelId || previous.modelId),
    updatedAt: Date.now(),
  });
}

export async function readVoiceModuleStateSnapshot(): Promise<VoiceModuleStateSnapshot> {
  const state = await readVoiceModuleState();
  const hasSample = await fileExists(state.sampleWavPath);
  const hasPendingSample = await fileExists(state.pendingSamplePath);
  return {
    ...state,
    hasSample,
    hasPendingSample,
  };
}

export function resolveVoiceModelId(input?: string) {
  return normalizeModelId(input);
}
