import { compileCodeProgram } from "./compiler";
import type {
  CodeActionArgAst,
  CodeConditionAst,
  CodeDiagnostic,
  CodeTestAst,
  CodeTestSuiteResult,
  CompiledCodeOperation,
  LiteralValue,
} from "./types";

type ExecutionState = {
  ai: {
    mode: "review_first" | "autopilot" | "";
    instruction: string;
    confidence_floor: number;
  };
  followups: {
    created_count: number;
  };
  memory: {
    remembered_count: number;
  };
  runtime: {
    paused: boolean;
  };
  outreach: {
    run_count: number;
  };
  platform: {
    actions_count: number;
    sends_count: number;
    reactions_count: number;
    routes_count: number;
    last_target: string;
    last_operation: string;
  };
};

function diagnostic(message: string, line: number): CodeDiagnostic {
  return { severity: "error", message, line, column: 1 };
}

function setPath(target: Record<string, unknown>, path: string, value: LiteralValue) {
  const parts = path.split(".");
  let cursor: Record<string, unknown> = target;
  for (const part of parts.slice(0, -1)) {
    const existing = cursor[part];
    if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
      cursor[part] = {};
    }
    cursor = cursor[part] as Record<string, unknown>;
  }
  cursor[parts[parts.length - 1] || path] = value;
}

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
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }
  return hour * 60 + minute;
}

function eventTimeMinutes(event: Record<string, unknown>) {
  const at = typeof event.at === "string" ? event.at : undefined;
  if (!at) return null;
  const localTime = at.match(/T(\d{2}):(\d{2})/);
  if (localTime) return Number(localTime[1]) * 60 + Number(localTime[2]);
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return null;
  return date.getHours() * 60 + date.getMinutes();
}

function conditionPasses(condition: CodeConditionAst, context: Record<string, unknown>) {
  if (condition.kind === "equals") {
    return getPath(context, condition.left) === condition.right;
  }

  const start = minutes(condition.start);
  const end = minutes(condition.end);
  const current = eventTimeMinutes(context.msg as Record<string, unknown>);
  if (start === null || end === null || current === null) return false;
  if (start <= end) return current >= start && current <= end;
  return current >= start || current <= end;
}

function resolveArg(value: CodeActionArgAst["value"], context: Record<string, unknown>): unknown {
  if (typeof value !== "object" || value === null) return value;
  if ("ref" in value) return getPath(context, value.ref);
  if ("call" in value && value.call === "time.tomorrow_at") {
    return `tomorrow ${String(value.args[0] || "09:00")}`;
  }
  return value;
}

function executeOperation(operation: CompiledCodeOperation, state: ExecutionState, context: Record<string, unknown>) {
  const args = Object.fromEntries(Object.entries(operation.args).map(([key, value]) => [key, resolveArg(value, context)]));

  if (operation.module === "ai" && operation.operation === "set_mode") {
    if (args.value === "review_first" || args.value === "autopilot") state.ai.mode = args.value;
  }
  if (operation.module === "ai" && operation.operation === "set_instruction" && typeof args.value === "string") {
    state.ai.instruction = args.value;
  }
  if (operation.module === "ai" && operation.operation === "set_confidence_floor" && typeof args.value === "number") {
    state.ai.confidence_floor = args.value;
  }
  if (operation.module === "followups" && operation.operation === "create") state.followups.created_count += 1;
  if (operation.module === "memory" && operation.operation === "remember") state.memory.remembered_count += 1;
  if (operation.module === "runtime" && operation.operation === "pause") state.runtime.paused = true;
  if (operation.module === "runtime" && operation.operation === "resume") state.runtime.paused = false;
  if (operation.module === "outreach" && operation.operation === "run") state.outreach.run_count += 1;
  if (operation.module === "platform") {
    state.platform.actions_count += 1;
    state.platform.last_operation = operation.operation;
    if (typeof args.via === "string") state.platform.last_target = args.via;
    if (typeof args.to === "string" && !state.platform.last_target) state.platform.last_target = args.to;
    if (typeof args.targets === "string" && !state.platform.last_target) state.platform.last_target = args.targets;
    if (operation.operation === "send" || operation.operation === "draft" || operation.operation === "broadcast") state.platform.sends_count += 1;
    if (operation.operation === "react") state.platform.reactions_count += 1;
    if (operation.operation === "mirror" || operation.operation === "route" || operation.operation === "relay" || operation.operation === "broadcast") {
      state.platform.routes_count += 1;
    }
  }
}

function initialState(): ExecutionState {
  return {
    ai: { mode: "", instruction: "", confidence_floor: 0 },
    followups: { created_count: 0 },
    memory: { remembered_count: 0 },
    runtime: { paused: false },
    outreach: { run_count: 0 },
    platform: { actions_count: 0, sends_count: 0, reactions_count: 0, routes_count: 0, last_target: "", last_operation: "" },
  };
}

function makeEvent(test: CodeTestAst) {
  const event: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(test.given)) setPath(event, key, value);
  return event;
}

export function runCodeTests(source: string): CodeTestSuiteResult {
  const compiled = compileCodeProgram(source);
  if (!compiled.ast || !compiled.plan) {
    return {
      passed: false,
      tests: [],
      diagnostics: compiled.diagnostics,
      plan: null,
    };
  }

  const tests = compiled.ast.tests.map((test) => {
    const state = initialState();
    const event = makeEvent(test);
    const context = { [compiled.plan!.handlers[0]?.alias || "msg"]: event, msg: event };
    const operations: CompiledCodeOperation[] = [];
    const diagnostics: CodeDiagnostic[] = [];

    for (const handler of compiled.plan!.handlers.filter((item) => item.event === test.event)) {
      if (!handler.conditions.every((condition) => conditionPasses(condition, context))) continue;
      for (const operation of handler.operations.slice(0, compiled.plan!.limits.maxStepsPerRun)) {
        operations.push(operation);
        executeOperation(operation, state, context);
      }
    }

    for (const expectation of test.expectations) {
      const actual = getPath(state, expectation.left);
      if (actual !== expectation.right) {
        diagnostics.push(diagnostic(`Expected ${expectation.left} to equal ${JSON.stringify(expectation.right)}, got ${JSON.stringify(actual)}.`, expectation.line));
      }
    }

    return {
      name: test.name,
      passed: diagnostics.length === 0,
      diagnostics,
      operations,
    };
  });

  const diagnostics =
    compiled.ast.tests.length === 0 ? [diagnostic("Program needs at least one test before publishing.", 1)] : compiled.diagnostics;

  return {
    passed: diagnostics.length === 0 && tests.every((test) => test.passed),
    tests,
    diagnostics,
    plan: compiled.plan,
  };
}
