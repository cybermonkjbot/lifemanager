import { cp, mkdir, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const nextDir = join(root, ".next");
const standaloneDir = join(nextDir, "standalone");

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function copyIntoStandalone(source, destination) {
  if (!(await exists(source))) {
    throw new Error(`Expected build artifact does not exist: ${source}`);
  }

  await rm(destination, { recursive: true, force: true });
  await mkdir(join(destination, ".."), { recursive: true });
  await cp(source, destination, { recursive: true });
}

if (!(await exists(join(standaloneDir, "server.js")))) {
  throw new Error("Missing .next/standalone/server.js. Ensure next.config.ts uses output: \"standalone\".");
}

await copyIntoStandalone(join(root, "public"), join(standaloneDir, "public"));
await copyIntoStandalone(join(nextDir, "static"), join(standaloneDir, ".next", "static"));

console.log("Prepared desktop standalone runtime.");
