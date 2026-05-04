import { rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const outDir = resolve(root, "dist", "connector");

await rm(outDir, { recursive: true, force: true });

const args = [
  "build",
  "src/worker/index.ts",
  "src/worker/instagram.ts",
  "src/worker/imessage.ts",
  "src/worker/telegram.ts",
  "--target",
  "node",
  "--format",
  "esm",
  "--outdir",
  "dist/connector",
  "--entry-naming",
  "[name].mjs",
];

const child = spawn(process.env.BUN_BIN || "bun", args, {
  cwd: root,
  stdio: "inherit",
  env: process.env,
});

const code = await new Promise((resolvePromise) => {
  child.once("exit", (exitCode) => resolvePromise(exitCode ?? 1));
  child.once("error", () => resolvePromise(1));
});

if (code !== 0) {
  process.exit(code);
}
