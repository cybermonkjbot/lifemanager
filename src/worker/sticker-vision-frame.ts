import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const DEFAULT_TIMEOUT_MS = 30_000;

export type StickerVisionInput = {
  imageBytes: Buffer;
  mimeType: string;
  extractedFrame: boolean;
  frameTimestampSeconds?: number;
  error?: string;
};

export function shouldExtractStickerMidFrame(mimeType?: string) {
  const normalized = (mimeType || "").trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  return (
    normalized.includes("webp") ||
    normalized.includes("gif") ||
    normalized.includes("lottie") ||
    normalized.includes("tgs")
  );
}

function extensionFromMimeType(mimeType?: string) {
  const normalized = (mimeType || "").trim().toLowerCase();
  if (normalized.includes("webp")) {
    return "webp";
  }
  if (normalized.includes("gif")) {
    return "gif";
  }
  if (normalized.includes("lottie") || normalized.includes("tgs") || normalized.includes("json")) {
    return "json";
  }
  return "bin";
}

async function probeDurationSeconds(args: {
  ffprobePath: string;
  inputPath: string;
  timeoutMs: number;
}) {
  try {
    const { stdout } = await execFileAsync(
      args.ffprobePath,
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        args.inputPath,
      ],
      {
        timeout: args.timeoutMs,
        maxBuffer: 256 * 1024,
      },
    );
    const parsed = Number(String(stdout || "").trim());
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  } catch {
    // best effort probe; fall back to first frame extraction.
  }
  return undefined;
}

async function extractStillFrame(args: {
  ffmpegPath: string;
  inputPath: string;
  outputPath: string;
  timeoutMs: number;
  seekSeconds?: number;
}) {
  const ffmpegArgs = ["-y", "-hide_banner", "-loglevel", "error"];
  if (Number.isFinite(args.seekSeconds) && (args.seekSeconds || 0) > 0) {
    ffmpegArgs.push("-ss", (args.seekSeconds || 0).toFixed(3));
  }
  ffmpegArgs.push(
    "-i",
    args.inputPath,
    "-frames:v",
    "1",
    "-q:v",
    "2",
    args.outputPath,
  );
  await execFileAsync(args.ffmpegPath, ffmpegArgs, {
    timeout: args.timeoutMs,
    maxBuffer: 512 * 1024,
  });
}

export async function prepareStickerVisionInput(args: {
  stickerBytes: Buffer;
  mimeType?: string;
  ffmpegPath?: string;
  ffprobePath?: string;
  timeoutMs?: number;
}): Promise<StickerVisionInput> {
  const normalizedMimeType = (args.mimeType || "image/webp").trim().toLowerCase() || "image/webp";

  if (!args.stickerBytes.length) {
    return {
      imageBytes: args.stickerBytes,
      mimeType: normalizedMimeType,
      extractedFrame: false,
      error: "Sticker payload is empty.",
    };
  }

  if (!shouldExtractStickerMidFrame(normalizedMimeType)) {
    return {
      imageBytes: args.stickerBytes,
      mimeType: normalizedMimeType,
      extractedFrame: false,
    };
  }

  const ffmpegPath = (args.ffmpegPath || process.env.SLM_FFMPEG_PATH || "ffmpeg").trim() || "ffmpeg";
  const ffprobePath = (args.ffprobePath || process.env.SLM_FFPROBE_PATH || "ffprobe").trim() || "ffprobe";
  const timeoutMs = Math.max(5_000, Math.round(args.timeoutMs || DEFAULT_TIMEOUT_MS));
  const tempDirectory = await fs.mkdtemp(join(tmpdir(), "slm-sticker-frame-"));
  const inputPath = join(tempDirectory, `sticker.${extensionFromMimeType(normalizedMimeType)}`);
  const outputPath = join(tempDirectory, "frame.jpg");

  try {
    await fs.writeFile(inputPath, args.stickerBytes);
    const durationSeconds = await probeDurationSeconds({
      ffprobePath,
      inputPath,
      timeoutMs,
    });
    const frameTimestampSeconds = durationSeconds && durationSeconds > 0.1 ? durationSeconds / 2 : undefined;
    await extractStillFrame({
      ffmpegPath,
      inputPath,
      outputPath,
      timeoutMs,
      seekSeconds: frameTimestampSeconds,
    });
    const frameBytes = await fs.readFile(outputPath);
    if (!frameBytes.length) {
      throw new Error("Extracted frame is empty.");
    }
    return {
      imageBytes: frameBytes,
      mimeType: "image/jpeg",
      extractedFrame: true,
      frameTimestampSeconds,
    };
  } catch (error) {
    return {
      imageBytes: args.stickerBytes,
      mimeType: normalizedMimeType,
      extractedFrame: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await fs.rm(tempDirectory, { recursive: true, force: true }).catch(() => undefined);
  }
}
