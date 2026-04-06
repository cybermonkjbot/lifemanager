import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const DEFAULT_TIMEOUT_MS = 120_000;

export type WhisperTranscriptionResult =
  | {
      status: "success";
      text: string;
      latencyMs: number;
      modelPath: string;
      usedSource: "original" | "wav";
    }
  | {
      status: "not_configured";
      reason: string;
      latencyMs: number;
    }
  | {
      status: "error";
      error: string;
      latencyMs: number;
    };

function parseBoolean(raw: string | undefined, fallback: boolean) {
  if (raw === undefined) {
    return fallback;
  }
  const normalized = raw.trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function parsePositiveInt(raw: string | undefined, fallback: number) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.round(parsed);
}

function normalizeTranscript(raw: string) {
  return raw
    .split(/\r?\n/)
    .map((line) => line.replace(/^\[[^\]]+\]\s*/, "").trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function extensionFromMimeType(mimeType?: string) {
  const normalized = (mimeType || "").toLowerCase();
  if (normalized.includes("wav")) {
    return "wav";
  }
  if (normalized.includes("webm")) {
    return "webm";
  }
  if (normalized.includes("mpeg")) {
    return "mp3";
  }
  if (normalized.includes("aac")) {
    return "aac";
  }
  if (normalized.includes("mp4")) {
    return "m4a";
  }
  if (normalized.includes("ogg") || normalized.includes("opus")) {
    return "ogg";
  }
  return "audio";
}

async function convertToMonoWav(args: {
  ffmpegPath: string;
  inputPath: string;
  outputPath: string;
  timeoutMs: number;
}) {
  await execFileAsync(
    args.ffmpegPath,
    [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      args.inputPath,
      "-ac",
      "1",
      "-ar",
      "16000",
      "-c:a",
      "pcm_s16le",
      args.outputPath,
    ],
    {
      timeout: args.timeoutMs,
      maxBuffer: 8 * 1024 * 1024,
    },
  );
}

export async function transcribeWithWhisperCpp(args: { audioBytes: Buffer; mimeType?: string }): Promise<WhisperTranscriptionResult> {
  const startedAt = Date.now();
  const whisperEnabled = parseBoolean(process.env.SLM_WHISPER_ENABLED, true);
  if (!whisperEnabled) {
    return {
      status: "not_configured",
      reason: "SLM_WHISPER_ENABLED is false.",
      latencyMs: Date.now() - startedAt,
    };
  }

  const modelPath = (process.env.SLM_WHISPER_MODEL_PATH || "").trim();
  if (!modelPath) {
    return {
      status: "not_configured",
      reason: "SLM_WHISPER_MODEL_PATH is not set.",
      latencyMs: Date.now() - startedAt,
    };
  }

  const cliPath = (process.env.SLM_WHISPER_CLI_PATH || "whisper-cli").trim() || "whisper-cli";
  const ffmpegPath = (process.env.SLM_FFMPEG_PATH || "ffmpeg").trim() || "ffmpeg";
  const language = (process.env.SLM_WHISPER_LANGUAGE || "auto").trim().toLowerCase();
  const timeoutMs = parsePositiveInt(process.env.SLM_WHISPER_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
  const threadCount = parsePositiveInt(process.env.SLM_WHISPER_THREADS, 4);

  const tempDirectory = await fs.mkdtemp(join(tmpdir(), "slm-whisper-"));
  const inputPath = join(tempDirectory, `input.${extensionFromMimeType(args.mimeType)}`);
  const outputPrefix = join(tempDirectory, "transcript");
  const wavPath = join(tempDirectory, "input.wav");

  let usedSource: "original" | "wav" = "original";
  let whisperInputPath = inputPath;

  try {
    await fs.writeFile(inputPath, args.audioBytes);

    try {
      await convertToMonoWav({
        ffmpegPath,
        inputPath,
        outputPath: wavPath,
        timeoutMs,
      });
      whisperInputPath = wavPath;
      usedSource = "wav";
    } catch {
      // Best effort conversion only; whisper.cpp may still parse the original container/codec.
    }

    const whisperArgs = ["-m", modelPath, "-f", whisperInputPath, "-of", outputPrefix, "-otxt", "-np"];
    if (language && language !== "auto") {
      whisperArgs.push("-l", language);
    }
    if (threadCount > 0) {
      whisperArgs.push("-t", String(threadCount));
    }

    const { stdout } = await execFileAsync(cliPath, whisperArgs, {
      timeout: timeoutMs,
      maxBuffer: 16 * 1024 * 1024,
    });

    const outputPath = `${outputPrefix}.txt`;
    const outputFileText = await fs.readFile(outputPath, "utf8").catch(() => "");
    const transcript = normalizeTranscript(outputFileText || stdout || "");
    if (!transcript) {
      return {
        status: "error",
        error: "Whisper completed but produced an empty transcript.",
        latencyMs: Date.now() - startedAt,
      };
    }

    return {
      status: "success",
      text: transcript,
      latencyMs: Date.now() - startedAt,
      modelPath,
      usedSource,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      status: "error",
      error: errorMessage,
      latencyMs: Date.now() - startedAt,
    };
  } finally {
    await fs.rm(tempDirectory, { recursive: true, force: true }).catch(() => undefined);
  }
}
