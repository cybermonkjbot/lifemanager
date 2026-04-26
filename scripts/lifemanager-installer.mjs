#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_ROOT = path.resolve(SCRIPT_DIR, "..");
const DEFAULT_TARGET_DIR = "odogwuhq";

const ROOT_IGNORES = new Set([
  ".git",
  ".next",
  ".wa_auth",
  ".ig_auth",
  ".slm",
  ".tmp",
  ".playwright-mcp",
  ".codex",
  ".agents",
  ".claude",
  ".trae",
  ".windsurf",
  "node_modules",
]);

const FILE_IGNORES = new Set([
  ".env.local",
  "tsconfig.tsbuildinfo",
]);

const REQUIRED_ENV_KEYS = [
  "AZURE_AI_ENDPOINT",
  "AZURE_AI_API_KEY",
  "AZURE_AI_MODEL",
];

function parseArgs(argv) {
  const args = {
    assumeYes: false,
    configure: true,
    dir: DEFAULT_TARGET_DIR,
    dryRun: false,
    help: false,
    inPlace: undefined,
    serve: true,
    serveExplicit: false,
    system: true,
    systemExplicit: false,
    withVoice: false,
    withVoiceExplicit: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === "--") {
      continue;
    }
    if (token === "--help" || token === "-h") {
      args.help = true;
      continue;
    }
    if (token === "--dir") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --dir");
      }
      args.dir = value;
      index += 1;
      continue;
    }
    if (token === "--dry-run") {
      args.dryRun = true;
      continue;
    }
    if (token === "--in-place") {
      args.inPlace = true;
      continue;
    }
    if (token === "--serve") {
      args.serve = true;
      args.serveExplicit = true;
      continue;
    }
    if (token === "--no-serve") {
      args.serve = false;
      args.serveExplicit = true;
      continue;
    }
    if (token === "--system") {
      args.system = true;
      args.systemExplicit = true;
      continue;
    }
    if (token === "--no-system") {
      args.system = false;
      args.systemExplicit = true;
      continue;
    }
    if (token === "--with-voice") {
      args.withVoice = true;
      args.withVoiceExplicit = true;
      continue;
    }
    if (token === "--no-with-voice") {
      args.withVoice = false;
      args.withVoiceExplicit = true;
      continue;
    }
    if (token === "--config") {
      args.configure = true;
      continue;
    }
    if (token === "--no-config") {
      args.configure = false;
      continue;
    }
    if (token === "--yes" || token === "-y") {
      args.assumeYes = true;
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  return args;
}

function printHelp() {
  console.log(`
OdogwuHQ Installer

Usage:
  odogwuhq [--in-place] [--dir <path>] [--with-voice] [--no-system] [--no-serve] [--no-config]

Options:
  --in-place       Install into the current directory (expects an existing project checkout)
  --dir <path>     Target directory when installing from package template (default: odogwuhq)
  --system         Install system-level dependencies where possible (default)
  --no-system      Skip system-level dependency installation
  --with-voice     Also install voice-note related system packages (ffmpeg/whisper where available)
  --no-with-voice  Skip voice-note system packages
  --serve          Start all services after install (default)
  --no-serve       Install only, do not start services
  --config         Prompt for .env.local setup (default in interactive mode)
  --no-config      Skip interactive .env.local prompts
  --yes, -y        Non-interactive mode with defaults
  --dry-run        Print steps without executing commands
  --help, -h       Show this help
`);
}

function isProjectDirectory(dirPath) {
  return (
    existsSync(path.join(dirPath, "package.json")) &&
    existsSync(path.join(dirPath, "src")) &&
    existsSync(path.join(dirPath, "convex"))
  );
}

function isNestedPath(parent, child) {
  const relative = path.relative(parent, child);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function directoryIsEmpty(dirPath) {
  if (!existsSync(dirPath)) {
    return true;
  }
  const entries = readdirSync(dirPath).filter((entry) => entry !== ".DS_Store");
  return entries.length === 0;
}

function runCommand(command, args, options = {}) {
  const { allowFailure = false, cwd = process.cwd(), dryRun = false, env = process.env } = options;
  const quoted = [command, ...args].join(" ");
  console.log(`\n$ ${quoted}`);

  if (dryRun) {
    return { status: 0 };
  }

  const result = spawnSync(command, args, {
    cwd,
    env,
    stdio: "inherit",
  });

  if (result.error) {
    if (allowFailure) {
      console.warn(`Command failed: ${quoted}`);
      return { status: 1 };
    }
    throw result.error;
  }

  if ((result.status ?? 1) !== 0 && !allowFailure) {
    throw new Error(`Command failed (${result.status}): ${quoted}`);
  }

  if ((result.status ?? 1) !== 0 && allowFailure) {
    console.warn(`Command exited with status ${result.status}: ${quoted}`);
  }

  return result;
}

function commandExists(command, env) {
  const checker = process.platform === "win32" ? "where" : "which";
  const probe = spawnSync(checker, [command], { env, stdio: "ignore" });
  return probe.status === 0;
}

function prependPath(env, entry) {
  if (!entry) {
    return;
  }
  const pathKey = process.platform === "win32" ? "Path" : "PATH";
  const current = env[pathKey] ?? process.env[pathKey] ?? "";
  const separator = process.platform === "win32" ? ";" : ":";
  if (current.split(separator).includes(entry)) {
    return;
  }
  env[pathKey] = `${entry}${separator}${current}`;
}

function runPrivileged(command, args, context, allowFailure = false) {
  const { dryRun, env } = context;

  if (process.platform === "win32") {
    return runCommand(command, args, { allowFailure, dryRun, env });
  }
  const uid = typeof process.getuid === "function" ? process.getuid() : 1;
  if (uid === 0) {
    return runCommand(command, args, { allowFailure, dryRun, env });
  }
  if (commandExists("sudo", env)) {
    return runCommand("sudo", [command, ...args], { allowFailure, dryRun, env });
  }
  console.warn("Skipping privileged package install because sudo is unavailable.");
  return { status: 1 };
}

function installSystemDependencies(context, withVoice) {
  const { dryRun, env } = context;
  const platform = process.platform;

  console.log("\nInstalling system-level dependencies (best effort)...");

  if (platform === "darwin") {
    if (!commandExists("brew", env)) {
      runCommand(
        "/bin/bash",
        [
          "-lc",
          "NONINTERACTIVE=1 /bin/bash -c \"$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\"",
        ],
        { allowFailure: true, dryRun, env },
      );
      prependPath(env, "/opt/homebrew/bin");
      prependPath(env, "/usr/local/bin");
    }

    if (!commandExists("brew", env)) {
      console.warn("Homebrew was not found/installed; skipping macOS system package installation.");
      return;
    }

    const packages = ["git", "curl", "unzip"];
    if (withVoice) {
      packages.push("ffmpeg", "whisper-cpp");
    }
    runCommand("brew", ["install", ...packages], { allowFailure: true, dryRun, env });
    return;
  }

  if (platform === "linux") {
    if (commandExists("apt-get", env)) {
      runPrivileged("apt-get", ["update"], context, true);
      const packages = ["curl", "git", "build-essential", "unzip"];
      if (withVoice) {
        packages.push("ffmpeg");
      }
      runPrivileged("apt-get", ["install", "-y", ...packages], context, true);
      return;
    }
    if (commandExists("dnf", env)) {
      const packages = ["curl", "git", "gcc", "gcc-c++", "make", "unzip"];
      if (withVoice) {
        packages.push("ffmpeg");
      }
      runPrivileged("dnf", ["install", "-y", ...packages], context, true);
      return;
    }
    if (commandExists("yum", env)) {
      const packages = ["curl", "git", "gcc", "gcc-c++", "make", "unzip"];
      if (withVoice) {
        packages.push("ffmpeg");
      }
      runPrivileged("yum", ["install", "-y", ...packages], context, true);
      return;
    }
    if (commandExists("pacman", env)) {
      const packages = ["curl", "git", "base-devel", "unzip"];
      if (withVoice) {
        packages.push("ffmpeg");
      }
      runPrivileged("pacman", ["-Syu", "--noconfirm", ...packages], context, true);
      return;
    }
    if (commandExists("zypper", env)) {
      const packages = ["curl", "git", "gcc", "gcc-c++", "make", "unzip"];
      if (withVoice) {
        packages.push("ffmpeg");
      }
      runPrivileged("zypper", ["--non-interactive", "install", ...packages], context, true);
      return;
    }

    console.warn("No supported Linux package manager detected. Skipping system package installation.");
    return;
  }

  if (platform === "win32") {
    if (!commandExists("winget", env)) {
      console.warn("winget not found; skipping Windows system package installation.");
      return;
    }
    runCommand(
      "winget",
      [
        "install",
        "--id",
        "Git.Git",
        "-e",
        "--accept-package-agreements",
        "--accept-source-agreements",
      ],
      { allowFailure: true, dryRun, env },
    );
    if (withVoice) {
      runCommand(
        "winget",
        [
          "install",
          "--id",
          "Gyan.FFmpeg",
          "-e",
          "--accept-package-agreements",
          "--accept-source-agreements",
        ],
        { allowFailure: true, dryRun, env },
      );
    }
    return;
  }

  console.warn(`Unsupported platform (${platform}). Skipping system package installation.`);
}

function resolveBunBinary(env) {
  if (commandExists("bun", env)) {
    return "bun";
  }
  const home = os.homedir();
  const candidate = process.platform === "win32"
    ? path.join(home, ".bun", "bin", "bun.exe")
    : path.join(home, ".bun", "bin", "bun");
  if (existsSync(candidate)) {
    return candidate;
  }
  return null;
}

function ensureBun(context) {
  const { dryRun, env } = context;
  let bunBinary = resolveBunBinary(env);
  if (bunBinary) {
    if (bunBinary !== "bun") {
      prependPath(env, path.dirname(bunBinary));
      return "bun";
    }
    return bunBinary;
  }

  console.log("\nBun was not found. Installing Bun...");

  if (process.platform === "win32") {
    runCommand(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", "irm bun.sh/install.ps1|iex"],
      { dryRun, env },
    );
  } else {
    runCommand("bash", ["-lc", "curl -fsSL https://bun.sh/install | bash"], { dryRun, env });
  }

  bunBinary = resolveBunBinary(env);
  if (!bunBinary) {
    throw new Error("Bun installation completed but bun binary was not found in PATH.");
  }

  if (bunBinary !== "bun") {
    prependPath(env, path.dirname(bunBinary));
    bunBinary = "bun";
  }

  return bunBinary;
}

function ensureProjectTemplate(targetRoot, context) {
  const { dryRun } = context;
  if (isProjectDirectory(targetRoot)) {
    return;
  }

  if (isNestedPath(TEMPLATE_ROOT, targetRoot)) {
    throw new Error("Target directory cannot be nested inside the installer template directory.");
  }

  if (!directoryIsEmpty(targetRoot)) {
    throw new Error(`Target directory is not empty: ${targetRoot}`);
  }

  console.log(`\nCopying project template into: ${targetRoot}`);
  if (!dryRun) {
    mkdirSync(targetRoot, { recursive: true });
    cpSync(TEMPLATE_ROOT, targetRoot, {
      recursive: true,
      force: true,
      filter(sourcePath) {
        const relative = path.relative(TEMPLATE_ROOT, sourcePath);
        if (!relative) {
          return true;
        }
        const parts = relative.split(path.sep);
        const first = parts[0];
        if (ROOT_IGNORES.has(first)) {
          return false;
        }
        const base = parts[parts.length - 1];
        if (FILE_IGNORES.has(base)) {
          return false;
        }
        return true;
      },
    });
  }
}

function ensureEnvFile(targetRoot, dryRun) {
  const envExample = path.join(targetRoot, ".env.example");
  const envLocal = path.join(targetRoot, ".env.local");
  if (existsSync(envLocal)) {
    return;
  }
  if (!existsSync(envExample)) {
    if (!dryRun) {
      console.warn("Skipping .env.local generation because .env.example is missing.");
    }
    return;
  }
  console.log("Creating .env.local from .env.example");
  if (!dryRun) {
    copyFileSync(envExample, envLocal);
  }
}

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return new Map();
  }
  const output = new Map();
  const content = readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const separator = trimmed.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    output.set(key, value);
  }
  return output;
}

function upsertEnvFile(filePath, updates) {
  const entries = Object.entries(updates).filter(([, value]) => value !== undefined);
  if (entries.length === 0) {
    return;
  }

  const source = existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
  const lines = source.length === 0 ? [] : source.split(/\r?\n/);
  const pending = new Map(entries.map(([key, value]) => [key, String(value)]));
  const keyPattern = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/;

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(keyPattern);
    if (!match) {
      continue;
    }
    const key = match[1];
    if (!pending.has(key)) {
      continue;
    }
    lines[index] = `${key}=${pending.get(key)}`;
    pending.delete(key);
  }

  for (const [key, value] of pending.entries()) {
    lines.push(`${key}=${value}`);
  }

  let output = lines.join("\n");
  if (output && !output.endsWith("\n")) {
    output += "\n";
  }
  writeFileSync(filePath, output);
}

function shouldPrompt(args) {
  return (
    args.configure &&
    !args.assumeYes &&
    !args.dryRun &&
    process.stdin.isTTY &&
    process.stdout.isTTY
  );
}

function questionLabel(text, defaultValue = undefined) {
  if (defaultValue === undefined || defaultValue === null || defaultValue === "") {
    return `${text}: `;
  }
  return `${text} [${defaultValue}]: `;
}

class MutableOutput extends Writable {
  constructor() {
    super();
    this.muted = false;
  }

  _write(chunk, encoding, callback) {
    if (!this.muted) {
      process.stdout.write(chunk, encoding);
    }
    callback();
  }
}

async function askText(rl, text, defaultValue = undefined) {
  const answer = (await rl.question(questionLabel(text, defaultValue))).trim();
  if (!answer && defaultValue !== undefined && defaultValue !== null) {
    return String(defaultValue);
  }
  return answer;
}

async function askRequired(rl, text, defaultValue = undefined) {
  while (true) {
    const answer = await askText(rl, text, defaultValue);
    if (answer) {
      return answer;
    }
    console.log("This value is required.");
  }
}

async function askYesNo(rl, text, defaultYes) {
  const suffix = defaultYes ? " [Y/n]: " : " [y/N]: ";
  while (true) {
    const answer = (await rl.question(`${text}${suffix}`)).trim().toLowerCase();
    if (!answer) {
      return defaultYes;
    }
    if (answer === "y" || answer === "yes") {
      return true;
    }
    if (answer === "n" || answer === "no") {
      return false;
    }
    console.log("Please answer y or n.");
  }
}

async function askSecret(rl, mutableOutput, text, options = {}) {
  const { required = false } = options;
  while (true) {
    let answer = "";
    mutableOutput.muted = false;
    try {
      const prompt = `${text}: `;
      const pending = rl.question(prompt);
      mutableOutput.muted = true;
      answer = (await pending).trim();
    } finally {
      mutableOutput.muted = false;
      process.stdout.write("\n");
    }

    if (answer || !required) {
      return answer;
    }
    console.log("This value is required.");
  }
}

async function collectInteractiveSetup(targetRoot, args) {
  if (!shouldPrompt(args)) {
    return {
      configured: false,
      withVoice: args.withVoice,
    };
  }

  const mutableOutput = new MutableOutput();
  const rl = createInterface({
    input: process.stdin,
    output: mutableOutput,
    terminal: true,
  });
  const envPath = path.join(targetRoot, ".env.local");
  const existing = parseEnvFile(envPath);

  try {
    console.log("\nInteractive setup");

    let withVoice = args.withVoice;
    if (!args.withVoiceExplicit) {
      const currentVoiceEnabled = (existing.get("SLM_WHISPER_ENABLED") || "").trim().toLowerCase() === "true";
      withVoice = await askYesNo(rl, "Install optional voice dependencies (ffmpeg/whisper)?", currentVoiceEnabled);
    }

    const doConfig = await askYesNo(rl, "Configure .env.local now?", true);
    if (!doConfig) {
      return { configured: false, withVoice };
    }

    const convexDefault = existing.get("CONVEX_URL") || existing.get("NEXT_PUBLIC_CONVEX_URL") || "";
    const azureEndpointDefault = existing.get("AZURE_AI_ENDPOINT") || "";
    const azureModelDefault = existing.get("AZURE_AI_MODEL") || "gpt-5.4";
    const apiStyleDefault = existing.get("AZURE_AI_API_STYLE") || "auto";
    const historySyncDefault = (existing.get("SLM_HISTORY_SYNC_ENABLED") || "true").toLowerCase() !== "false";
    const embeddingsDefault = (existing.get("SLM_EMBEDDINGS_LOCAL_ENABLED") || "true").toLowerCase() !== "false";
    const whisperEnabledDefault = (existing.get("SLM_WHISPER_ENABLED") || (withVoice ? "true" : "false")).toLowerCase() !== "false";

    const convexUrl = await askRequired(rl, "Convex URL (CONVEX_URL)", convexDefault || undefined);
    const azureEndpoint = await askRequired(rl, "Azure endpoint (AZURE_AI_ENDPOINT)", azureEndpointDefault || undefined);
    let azureApiKey;
    if ((existing.get("AZURE_AI_API_KEY") || "").trim()) {
      azureApiKey = await askSecret(
        rl,
        mutableOutput,
        "Azure API key (AZURE_AI_API_KEY, leave empty to keep current)",
      );
    } else {
      azureApiKey = await askSecret(rl, mutableOutput, "Azure API key (AZURE_AI_API_KEY)", { required: true });
    }
    const azureModel = await askRequired(rl, "Azure model (AZURE_AI_MODEL)", azureModelDefault);
    const azureApiStyle = await askText(rl, "Azure API style (AZURE_AI_API_STYLE)", apiStyleDefault);
    const historySyncEnabled = await askYesNo(
      rl,
      "Enable full direct-chat history sync (SLM_HISTORY_SYNC_ENABLED)?",
      historySyncDefault,
    );
    const embeddingsEnabled = await askYesNo(
      rl,
      "Enable local semantic embeddings (SLM_EMBEDDINGS_LOCAL_ENABLED)?",
      embeddingsDefault,
    );

    const instancePinDefault = existing.get("SLM_INSTANCE_PIN") || "";
    const instancePinPrompt = instancePinDefault
      ? "Instance PIN override (SLM_INSTANCE_PIN, leave empty to keep current)"
      : "Instance PIN override (SLM_INSTANCE_PIN, leave empty to use setup wizard)";
    const instancePin = await askSecret(rl, mutableOutput, instancePinPrompt);

    let gatewayKey = "";
    const existingGatewayKey = (existing.get("SLM_API_GATEWAY_KEY") || "").trim();
    const configureGatewayKey = await askYesNo(rl, "Configure API gateway key now (SLM_API_GATEWAY_KEY)?", !!existingGatewayKey);
    if (configureGatewayKey) {
      if (existingGatewayKey) {
        const regenerate = await askYesNo(rl, "Regenerate existing API gateway key?", false);
        gatewayKey = regenerate ? randomBytes(24).toString("base64url") : existingGatewayKey;
      } else {
        gatewayKey = randomBytes(24).toString("base64url");
      }
    } else {
      gatewayKey = existingGatewayKey;
    }

    let whisperEnabled = whisperEnabledDefault;
    let whisperModelPath = (existing.get("SLM_WHISPER_MODEL_PATH") || "").trim();
    if (withVoice) {
      whisperEnabled = await askYesNo(rl, "Enable local voice-note transcription (SLM_WHISPER_ENABLED)?", whisperEnabledDefault);
      if (whisperEnabled) {
        whisperModelPath = await askText(
          rl,
          "Whisper model path (SLM_WHISPER_MODEL_PATH, optional now)",
          whisperModelPath || undefined,
        );
      }
    } else {
      whisperEnabled = false;
    }

    const updates = {
      CONVEX_URL: convexUrl,
      NEXT_PUBLIC_CONVEX_URL: convexUrl,
      AZURE_AI_ENDPOINT: azureEndpoint,
      AZURE_AI_MODEL: azureModel,
      AZURE_AI_API_STYLE: azureApiStyle || "auto",
      SLM_HISTORY_SYNC_ENABLED: historySyncEnabled ? "true" : "false",
      SLM_EMBEDDINGS_LOCAL_ENABLED: embeddingsEnabled ? "true" : "false",
      SLM_WHISPER_ENABLED: whisperEnabled ? "true" : "false",
    };

    if (azureApiKey) {
      updates.AZURE_AI_API_KEY = azureApiKey;
    }
    if (instancePin) {
      updates.SLM_INSTANCE_PIN = instancePin;
    }
    if (gatewayKey) {
      updates.SLM_API_GATEWAY_KEY = gatewayKey;
    }
    if (whisperModelPath) {
      updates.SLM_WHISPER_MODEL_PATH = whisperModelPath;
    }

    upsertEnvFile(envPath, updates);
    console.log("Saved interactive config to .env.local.");
    return { configured: true, withVoice };
  } finally {
    rl.close();
  }
}

function checkRequiredEnv(targetRoot, dryRun) {
  const envPath = path.join(targetRoot, ".env.local");
  if (dryRun && !existsSync(envPath)) {
    return;
  }
  const envMap = parseEnvFile(envPath);
  const missing = [];

  for (const key of REQUIRED_ENV_KEYS) {
    const value = (envMap.get(key) || "").trim();
    if (!value) {
      missing.push(key);
    }
  }

  const convexPrimary = (envMap.get("CONVEX_URL") || "").trim();
  const convexPublic = (envMap.get("NEXT_PUBLIC_CONVEX_URL") || "").trim();
  if (!convexPrimary && !convexPublic) {
    missing.push("CONVEX_URL or NEXT_PUBLIC_CONVEX_URL");
  }

  if (missing.length > 0) {
    console.warn("\nConfiguration reminder:");
    console.warn(`Set these .env.local values before production use: ${missing.join(", ")}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    return;
  }

  const context = {
    dryRun: args.dryRun,
    env: { ...process.env },
  };

  const cwd = process.cwd();
  const defaultInPlace = isProjectDirectory(cwd);
  const installInPlace = typeof args.inPlace === "boolean" ? args.inPlace : defaultInPlace;
  const targetRoot = installInPlace ? cwd : path.resolve(cwd, args.dir);

  console.log("Lifemanager installer starting...");
  console.log(`Target directory: ${targetRoot}`);

  if (!installInPlace) {
    ensureProjectTemplate(targetRoot, context);
  } else if (!isProjectDirectory(targetRoot)) {
    throw new Error("--in-place was set but the current directory is not a lifemanager project.");
  }

  ensureEnvFile(targetRoot, args.dryRun);
  const interactive = await collectInteractiveSetup(targetRoot, args);
  const withVoice = interactive.withVoice;

  if (args.system) {
    installSystemDependencies(context, withVoice);
  }

  const bunBinary = ensureBun(context);

  runCommand(bunBinary, ["install"], {
    cwd: targetRoot,
    dryRun: args.dryRun,
    env: context.env,
  });

  checkRequiredEnv(targetRoot, args.dryRun);

  if (args.serve) {
    console.log("\nStarting all services (next + convex + workers)...");
    runCommand(bunBinary, ["run", "dev:all"], {
      cwd: targetRoot,
      dryRun: args.dryRun,
      env: context.env,
    });
  } else {
    console.log("\nInstall complete.");
    console.log(`Run this next:\n  cd ${targetRoot}\n  ${bunBinary} run dev:all`);
  }
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\nInstaller failed: ${message}`);
  process.exit(1);
}
