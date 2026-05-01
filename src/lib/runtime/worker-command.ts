import { existsSync } from "node:fs";

import type { WorkerProvider } from "./worker-lock";

type WorkerCommand = {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
};

const ENTRY_ENV_BY_PROVIDER: Record<WorkerProvider, string> = {
  whatsapp: "ODOGWU_CONNECTOR_WHATSAPP_ENTRY",
  instagram: "ODOGWU_CONNECTOR_INSTAGRAM_ENTRY",
  imessage: "ODOGWU_CONNECTOR_IMESSAGE_ENTRY",
  telegram: "ODOGWU_CONNECTOR_TELEGRAM_ENTRY",
};

const SCRIPT_BY_PROVIDER: Record<WorkerProvider, string> = {
  whatsapp: "worker",
  instagram: "worker:instagram",
  imessage: "worker:imessage",
  telegram: "worker:telegram",
};

export function getWorkerCommand(provider: WorkerProvider, env: NodeJS.ProcessEnv = process.env): WorkerCommand {
  const entry = (env[ENTRY_ENV_BY_PROVIDER[provider]] || "").trim();
  const nodeBin = (env.ODOGWU_DESKTOP_NODE_BIN || "").trim();

  if (env.ODOGWU_DESKTOP === "1" && entry && nodeBin && existsSync(/* turbopackIgnore: true */ entry)) {
    return {
      command: nodeBin,
      args: [entry],
      env: {
        ...env,
        ELECTRON_RUN_AS_NODE: "1",
        SLM_WORKER_PROVIDER: provider,
      },
    };
  }

  const bunBin = env.BUN_BIN || "bun";
  return {
    command: bunBin,
    args: ["run", SCRIPT_BY_PROVIDER[provider]],
    env,
  };
}
