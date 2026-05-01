import type { CompiledCodeOperation, CompiledCodeProgram } from "../code-runtime";

export type CodeExecutionEvent = {
  name: string;
  payload: Record<string, unknown>;
};

export type CodeExecutionStepResult = {
  stepId: string;
  toolName: string;
  status: "success" | "error" | "skipped";
  latencyMs: number;
  outputSummary: string;
  errorMessage?: string;
};

export type CodeExecutionResult = {
  status: "success" | "error" | "skipped";
  steps: CodeExecutionStepResult[];
};

function getPath(source: unknown, path: string): unknown {
  const parts = path.split(".");
  let cursor = source;
  for (const part of parts) {
    if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) return undefined;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return cursor;
}

function minutes(value: string) {
  const match = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

function eventMinutes(payload: Record<string, unknown>) {
  const at = typeof payload.at === "string" ? payload.at : undefined;
  if (!at) return null;
  const localTime = at.match(/T(\d{2}):(\d{2})/);
  if (localTime) return Number(localTime[1]) * 60 + Number(localTime[2]);
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return null;
  return date.getHours() * 60 + date.getMinutes();
}

function conditionMatches(
  condition: CompiledCodeProgram["handlers"][number]["conditions"][number],
  context: Record<string, unknown>,
) {
  if (condition.kind === "equals") return getPath(context, condition.left) === condition.right;
  const start = minutes(condition.start);
  const end = minutes(condition.end);
  const now = eventMinutes(context.msg as Record<string, unknown>);
  if (start === null || end === null || now === null) return false;
  if (start <= end) return now >= start && now <= end;
  return now >= start || now <= end;
}

function summarizeOperation(operation: CompiledCodeOperation) {
  if (operation.module === "ai" && operation.operation === "set_mode") return `AI mode set to ${String(operation.args.value)}`;
  if (operation.module === "followups" && operation.operation === "create") return "Follow-up creation requested.";
  if (operation.module === "runtime") return `Runtime ${operation.operation} requested.`;
  if (operation.module === "outreach") return "Outreach run requested.";
  if (operation.module === "platform") {
    const via = typeof operation.args.via === "string" ? ` via ${operation.args.via}` : "";
    const target = typeof operation.args.to === "string" ? ` to ${operation.args.to}` : "";
    const targets = typeof operation.args.targets === "string" ? ` to ${operation.args.targets}` : "";
    return `Cross-platform ${operation.operation}${via}${target || targets} requested.`;
  }
  return `${operation.module}.${operation.operation} executed.`;
}

export async function executeCompiledCodeProgram(
  plan: CompiledCodeProgram,
  event: CodeExecutionEvent,
): Promise<CodeExecutionResult> {
  const startedAt = Date.now();
  const steps: CodeExecutionStepResult[] = [];

  for (const handler of plan.handlers.filter((item) => item.event === event.name)) {
    const context = { [handler.alias]: event.payload, msg: event.payload };
    if (!handler.conditions.every((condition) => conditionMatches(condition, context))) {
      continue;
    }

    for (const operation of handler.operations) {
      if (steps.length >= plan.limits.maxStepsPerRun) {
        steps.push({
          stepId: operation.id,
          toolName: `${operation.module}.${operation.operation}`,
          status: "skipped",
          latencyMs: 0,
          outputSummary: "Skipped because maxStepsPerRun was reached.",
        });
        break;
      }
      if (Date.now() - startedAt > plan.limits.maxRuntimeMs) {
        steps.push({
          stepId: operation.id,
          toolName: `${operation.module}.${operation.operation}`,
          status: "error",
          latencyMs: 0,
          outputSummary: "Execution stopped by runtime budget.",
          errorMessage: "maxRuntimeMs exceeded",
        });
        return { status: "error", steps };
      }

      const stepStartedAt = Date.now();
      steps.push({
        stepId: operation.id,
        toolName: `${operation.module}.${operation.operation}`,
        status: "success",
        latencyMs: Date.now() - stepStartedAt,
        outputSummary: summarizeOperation(operation),
      });
    }
  }

  if (steps.length === 0) return { status: "skipped", steps };
  return {
    status: steps.some((step) => step.status === "error") ? "error" : "success",
    steps,
  };
}
