import { join } from "node:path";

export function getRuntimeDataDir() {
  return process.env.SLM_DATA_DIR || ".slm";
}

export function getRuntimeDataPath(...segments: string[]) {
  return join(/* turbopackIgnore: true */ getRuntimeDataDir(), ...segments);
}
