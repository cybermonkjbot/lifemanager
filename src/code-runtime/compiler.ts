import { DEFAULT_CODE_LIMITS, CODE_SDK_REGISTRY } from "./sdk";
import { parseCodeProgram } from "./parser";
import type {
  CodeActionAst,
  CodeCompileResult,
  CodeDiagnostic,
  CodeProgramAst,
  CompiledCodeOperation,
  CompiledCodeProgram,
} from "./types";

function error(message: string, line: number): CodeDiagnostic {
  return { severity: "error", message, line, column: 1 };
}

function actionArgsToRecord(action: CodeActionAst) {
  return Object.fromEntries(action.args.map((arg) => [arg.key, arg.value]));
}

function validateProgram(ast: CodeProgramAst) {
  const diagnostics: CodeDiagnostic[] = [];
  const imported = new Set(ast.uses);
  imported.add("time");

  for (const moduleName of ast.uses) {
    if (!CODE_SDK_REGISTRY[moduleName]) {
      diagnostics.push(error(`Unknown SDK module \`${moduleName}\`.`, 1));
    }
  }

  if (ast.handlers.length === 0) {
    diagnostics.push(error("Program needs at least one `on` handler.", 1));
  }

  for (const handler of ast.handlers) {
    if (handler.actions.length === 0) {
      diagnostics.push(error("Handler needs at least one SDK action.", handler.line));
    }

    for (const action of handler.actions) {
      const moduleSpec = CODE_SDK_REGISTRY[action.module];
      if (!moduleSpec) {
        diagnostics.push(error(`Unknown SDK module \`${action.module}\`.`, action.line));
        continue;
      }
      if (!imported.has(action.module)) {
        diagnostics.push(error(`Add \`use ${action.module}\` before calling ${action.module}.${action.operation}.`, action.line));
      }

      const operation = moduleSpec.operations[action.operation];
      if (!operation) {
        diagnostics.push(error(`Unknown SDK operation \`${action.module}.${action.operation}\`.`, action.line));
        continue;
      }

      const args = actionArgsToRecord(action);
      for (const requiredArg of operation.requiredArgs || []) {
        if (!(requiredArg in args)) {
          diagnostics.push(error(`Missing required argument \`${requiredArg}\` for ${action.module}.${action.operation}.`, action.line));
        }
      }
    }
  }

  for (const test of ast.tests) {
    if (test.expectations.length === 0) {
      diagnostics.push(error("Test needs at least one `expect` assertion.", test.line));
    }
  }

  return diagnostics;
}

export function compileCodeProgram(source: string): CodeCompileResult {
  const parsed = parseCodeProgram(source);
  if (!parsed.ast) {
    return { ast: null, plan: null, diagnostics: parsed.diagnostics };
  }

  const diagnostics = [...parsed.diagnostics, ...validateProgram(parsed.ast)];
  if (diagnostics.some((item) => item.severity === "error")) {
    return { ast: parsed.ast, plan: null, diagnostics };
  }

  const plan: CompiledCodeProgram = {
    name: parsed.ast.name,
    version: parsed.ast.version,
    modules: [...new Set(parsed.ast.uses)],
    limits: DEFAULT_CODE_LIMITS,
    handlers: parsed.ast.handlers.map((handler, handlerIndex) => ({
      event: handler.event,
      alias: handler.alias,
      conditions: handler.conditions,
      operations: handler.actions.map((action, actionIndex): CompiledCodeOperation => {
        const operation = CODE_SDK_REGISTRY[action.module]?.operations[action.operation];
        return {
          id: `${handlerIndex + 1}.${actionIndex + 1}`,
          module: action.module,
          operation: action.operation,
          args: actionArgsToRecord(action),
          danger: operation?.danger || "read",
        };
      }),
    })),
  };

  return { ast: parsed.ast, plan, diagnostics };
}

export function formatCodeDiagnostics(diagnostics: CodeDiagnostic[]) {
  if (diagnostics.length === 0) return "No diagnostics.";
  return diagnostics.map((item) => `${item.line}:${item.column} ${item.severity}: ${item.message}`).join("\n");
}
