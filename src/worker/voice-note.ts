import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  getVoiceNoteGeneratorScriptPath,
  readVoiceModuleStateSnapshot,
  resolveVoiceModelId,
} from "../lib/voice-note/state";

const execFileAsync = promisify(execFile);

const VOICE_NOTE_PREFIX_PATTERN =
  /^\s*(\[voice(?:\s*note)?(?:\s*auto)?\]|\/voice(?:_?note)?|\/vna|\/vn)\s*[:\-]?\s*/i;
const DEFAULT_GENERATE_TIMEOUT_MS = 6 * 60 * 1000;
const DEFAULT_FFMPEG_TIMEOUT_MS = 90_000;
const DEFAULT_AUTO_VOICE_NEED_KEYWORDS = [
  "voice note",
  "voice",
  "call",
  "explain",
  "walk you through",
  "hear me out",
  "quick update",
  "sorry",
  "miss you",
  "love you",
];
const AUTO_VOICE_MIN_TEXT_CHARS = 24;
const AUTO_VOICE_MAX_TEXT_CHARS = 480;

export type VoiceNoteDirective = {
  originalText: string;
  normalizedText: string;
  source: "explicit" | "auto";
};

export type VoiceNoteAutoRuntimeConfig = {
  enabled?: boolean;
  probability?: number;
  maxPerThreadPerDay?: number;
  needKeywords?: string[];
};

export type VoiceNoteAutoDecision = {
  shouldAttempt: boolean;
  reason:
    | "selected"
    | "disabled"
    | "empty_text"
    | "too_short"
    | "too_long"
    | "content_not_suitable"
    | "need_not_detected"
    | "cap_reached"
    | "probability_zero"
    | "probability_fail";
  normalizedText: string;
  probability: number;
  roll?: number;
  matchedKeywords: string[];
  maxPerThreadPerDay: number;
  sentToday: number;
};

export type VoiceNoteGenerationResult =
  | {
      status: "success";
      buffer: Buffer;
      mimeType: string;
      generatedText: string;
      modelId: string;
      durationMs: number;
      usedTranscode: boolean;
    }
  | {
      status: "not_configured";
      reason: string;
    }
  | {
      status: "error";
      error: string;
      generatedText: string;
    };

function parsePositiveInt(raw: string | undefined, fallback: number) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.round(parsed);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max));
}

function stableHash(input: string) {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function normalizeNeedKeywords(input: string[] | undefined) {
  const list = (input && input.length > 0 ? input : DEFAULT_AUTO_VOICE_NEED_KEYWORDS)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  return [...new Set(list)].slice(0, 40);
}

function containsUnsuitableVoiceContent(text: string) {
  return /https?:\/\//i.test(text) || /`{1,3}/.test(text);
}

export function decideAutoVoiceNote(args: {
  text: string;
  threadId: string;
  outboxId: string;
  dayBucket: string;
  sentToday: number;
  runtimeConfig?: VoiceNoteAutoRuntimeConfig | null;
}): VoiceNoteAutoDecision {
  const normalizedText = (args.text || "").trim();
  const enabled = args.runtimeConfig?.enabled ?? false;
  const probability = clamp(args.runtimeConfig?.probability ?? 0.35, 0, 1);
  const maxPerThreadPerDay = Math.round(clamp(args.runtimeConfig?.maxPerThreadPerDay ?? 1, 1, 12));
  const matchedKeywords: string[] = [];

  if (!enabled) {
    return {
      shouldAttempt: false,
      reason: "disabled",
      normalizedText,
      probability,
      matchedKeywords,
      maxPerThreadPerDay,
      sentToday: args.sentToday,
    };
  }

  if (!normalizedText) {
    return {
      shouldAttempt: false,
      reason: "empty_text",
      normalizedText,
      probability,
      matchedKeywords,
      maxPerThreadPerDay,
      sentToday: args.sentToday,
    };
  }

  if (normalizedText.length < AUTO_VOICE_MIN_TEXT_CHARS) {
    return {
      shouldAttempt: false,
      reason: "too_short",
      normalizedText,
      probability,
      matchedKeywords,
      maxPerThreadPerDay,
      sentToday: args.sentToday,
    };
  }

  if (normalizedText.length > AUTO_VOICE_MAX_TEXT_CHARS) {
    return {
      shouldAttempt: false,
      reason: "too_long",
      normalizedText,
      probability,
      matchedKeywords,
      maxPerThreadPerDay,
      sentToday: args.sentToday,
    };
  }

  if (containsUnsuitableVoiceContent(normalizedText)) {
    return {
      shouldAttempt: false,
      reason: "content_not_suitable",
      normalizedText,
      probability,
      matchedKeywords,
      maxPerThreadPerDay,
      sentToday: args.sentToday,
    };
  }

  if (args.sentToday >= maxPerThreadPerDay) {
    return {
      shouldAttempt: false,
      reason: "cap_reached",
      normalizedText,
      probability,
      matchedKeywords,
      maxPerThreadPerDay,
      sentToday: args.sentToday,
    };
  }

  const lowerText = normalizedText.toLowerCase();
  const needKeywords = normalizeNeedKeywords(args.runtimeConfig?.needKeywords);
  for (const keyword of needKeywords) {
    if (lowerText.includes(keyword)) {
      matchedKeywords.push(keyword);
      if (matchedKeywords.length >= 8) {
        break;
      }
    }
  }

  if (matchedKeywords.length === 0) {
    return {
      shouldAttempt: false,
      reason: "need_not_detected",
      normalizedText,
      probability,
      matchedKeywords,
      maxPerThreadPerDay,
      sentToday: args.sentToday,
    };
  }

  if (probability <= 0) {
    return {
      shouldAttempt: false,
      reason: "probability_zero",
      normalizedText,
      probability,
      matchedKeywords,
      maxPerThreadPerDay,
      sentToday: args.sentToday,
    };
  }

  const seed = `${args.threadId}|${args.outboxId}|${args.dayBucket}|voice-note-auto`;
  const roll = (stableHash(seed) % 1000) / 1000;
  if (roll >= probability) {
    return {
      shouldAttempt: false,
      reason: "probability_fail",
      normalizedText,
      probability,
      roll,
      matchedKeywords,
      maxPerThreadPerDay,
      sentToday: args.sentToday,
    };
  }

  return {
    shouldAttempt: true,
    reason: "selected",
    normalizedText,
    probability,
    roll,
    matchedKeywords,
    maxPerThreadPerDay,
    sentToday: args.sentToday,
  };
}

function resolveFfmpegPath() {
  const configured = (process.env.SLM_FFMPEG_PATH || "").trim();
  return configured || "ffmpeg";
}

function voiceNotesEnabled() {
  const raw = (process.env.SLM_VOICE_NOTES_ENABLED || "true").trim().toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "off";
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

export function parseVoiceNoteDirective(text: string): VoiceNoteDirective | null {
  const input = (text || "").trim();
  if (!input) {
    return null;
  }

  const matched = input.match(VOICE_NOTE_PREFIX_PATTERN);
  if (!matched) {
    return null;
  }

  const normalizedText = input.slice(matched[0].length).trim();
  if (!normalizedText) {
    return null;
  }
  const prefix = (matched[1] || matched[0] || "").trim().toLowerCase();
  const source = prefix.includes("auto") || prefix.startsWith("/vna") ? "auto" : "explicit";

  return {
    originalText: input,
    normalizedText,
    source,
  };
}

async function transcodeWavToOgg(args: { ffmpegPath: string; inputPath: string; outputPath: string; timeoutMs: number }) {
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
      "libopus",
      "-b:a",
      "24k",
      "-vbr",
      "on",
      "-compression_level",
      "10",
      args.outputPath,
    ],
    {
      timeout: args.timeoutMs,
      maxBuffer: 8 * 1024 * 1024,
    },
  );
}

export async function generateVoiceNoteFromDirective(args: { text: string }): Promise<VoiceNoteGenerationResult> {
  const generatedText = (args.text || "").trim();
  if (!generatedText) {
    return {
      status: "not_configured",
      reason: "Voice note text is empty.",
    };
  }

  if (!voiceNotesEnabled()) {
    return {
      status: "not_configured",
      reason: "SLM_VOICE_NOTES_ENABLED is false.",
    };
  }

  const state = await readVoiceModuleStateSnapshot();
  if (state.status !== "ready") {
    return {
      status: "not_configured",
      reason: "Voice note module is not ready. Run setup voice note sending in the app.",
    };
  }

  if (!(await fileExists(state.pythonBinPath))) {
    return {
      status: "not_configured",
      reason: "Voice note python runtime is missing. Re-run setup voice note sending.",
    };
  }

  if (!state.hasSample || !(await fileExists(state.sampleWavPath))) {
    return {
      status: "not_configured",
      reason: "Voice sample is missing. Record a sample in setup first.",
    };
  }

  const promptText = (state.samplePromptText || "").trim();
  if (!promptText) {
    return {
      status: "not_configured",
      reason: "Voice sample transcript is missing. Re-record sample with transcript.",
    };
  }

  const scriptPath = getVoiceNoteGeneratorScriptPath();
  if (!(await fileExists(scriptPath))) {
    return {
      status: "not_configured",
      reason: "VoxCPM generation script is missing from scripts/voxcpm_generate.py.",
    };
  }

  const ffmpegPath = resolveFfmpegPath();
  const generateTimeoutMs = parsePositiveInt(process.env.SLM_VOICE_GENERATE_TIMEOUT_MS, DEFAULT_GENERATE_TIMEOUT_MS);
  const ffmpegTimeoutMs = parsePositiveInt(process.env.SLM_VOICE_FFMPEG_TIMEOUT_MS, DEFAULT_FFMPEG_TIMEOUT_MS);
  const modelId = resolveVoiceModelId(state.modelId);

  const tempDir = await mkdtemp(join(tmpdir(), "slm-voice-note-"));
  const outputWavPath = join(tempDir, "voice.wav");
  const outputOggPath = join(tempDir, "voice.ogg");
  const startedAt = Date.now();

  try {
    await execFileAsync(
      state.pythonBinPath as string,
      [
        scriptPath,
        "--hf-model-id",
        modelId,
        "--text",
        generatedText,
        "--prompt-wav-path",
        state.sampleWavPath as string,
        "--prompt-text",
        promptText,
        "--reference-wav-path",
        state.sampleWavPath as string,
        "--output",
        outputWavPath,
      ],
      {
        timeout: generateTimeoutMs,
        maxBuffer: 16 * 1024 * 1024,
      },
    );

    if (!(await fileExists(outputWavPath))) {
      return {
        status: "error",
        error: "VoxCPM generation did not produce an output wav.",
        generatedText,
      };
    }

    try {
      await transcodeWavToOgg({
        ffmpegPath,
        inputPath: outputWavPath,
        outputPath: outputOggPath,
        timeoutMs: ffmpegTimeoutMs,
      });
      const oggBuffer = await readFile(outputOggPath);
      return {
        status: "success",
        buffer: oggBuffer,
        mimeType: "audio/ogg; codecs=opus",
        generatedText,
        modelId,
        durationMs: Date.now() - startedAt,
        usedTranscode: true,
      };
    } catch {
      const wavBuffer = await readFile(outputWavPath);
      return {
        status: "success",
        buffer: wavBuffer,
        mimeType: "audio/wav",
        generatedText,
        modelId,
        durationMs: Date.now() - startedAt,
        usedTranscode: false,
      };
    }
  } catch (error) {
    const err = error instanceof Error ? error.message : String(error);
    return {
      status: "error",
      error: err,
      generatedText,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
