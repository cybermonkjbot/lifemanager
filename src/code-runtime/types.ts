export type CodeDiagnosticSeverity = "error" | "warning";

export type CodeDiagnostic = {
  severity: CodeDiagnosticSeverity;
  message: string;
  line: number;
  column: number;
};

export type LiteralValue = string | number | boolean;

export type CodeProgramAst = {
  kind: "program";
  name: string;
  version: string;
  uses: string[];
  handlers: CodeHandlerAst[];
  tests: CodeTestAst[];
};

export type CodeHandlerAst = {
  event: string;
  alias: string;
  conditions: CodeConditionAst[];
  actions: CodeActionAst[];
  line: number;
};

export type CodeConditionAst =
  | {
      kind: "equals";
      left: string;
      right: LiteralValue;
      line: number;
    }
  | {
      kind: "betweenTime";
      left: string;
      start: string;
      end: string;
      line: number;
    };

export type CodeActionArgAst = {
  key: string;
  value: string | number | boolean | { ref: string } | { call: string; args: LiteralValue[] };
};

export type CodeActionAst = {
  module: string;
  operation: string;
  args: CodeActionArgAst[];
  line: number;
};

export type CodeTestAst = {
  name: string;
  event: string;
  given: Record<string, LiteralValue>;
  expectations: CodeExpectationAst[];
  line: number;
};

export type CodeExpectationAst = {
  left: string;
  right: LiteralValue;
  line: number;
};

export type CompiledCodeProgram = {
  name: string;
  version: string;
  modules: string[];
  handlers: CompiledCodeHandler[];
  limits: CodeExecutionLimits;
};

export type CompiledCodeHandler = {
  event: string;
  alias: string;
  conditions: CodeConditionAst[];
  operations: CompiledCodeOperation[];
};

export type CompiledCodeOperation = {
  id: string;
  module: string;
  operation: string;
  args: Record<string, CodeActionArgAst["value"]>;
  danger: "read" | "write" | "runtime" | "send";
};

export type CodeExecutionLimits = {
  maxStepsPerRun: number;
  maxRuntimeMs: number;
  maxFollowupsCreated: number;
  maxSendsQueued: number;
};

export type CodeParseResult = {
  ast: CodeProgramAst | null;
  diagnostics: CodeDiagnostic[];
};

export type CodeCompileResult = {
  ast: CodeProgramAst | null;
  plan: CompiledCodeProgram | null;
  diagnostics: CodeDiagnostic[];
};

export type CodeTestResult = {
  name: string;
  passed: boolean;
  diagnostics: CodeDiagnostic[];
  operations: CompiledCodeOperation[];
};

export type CodeTestSuiteResult = {
  passed: boolean;
  tests: CodeTestResult[];
  diagnostics: CodeDiagnostic[];
  plan: CompiledCodeProgram | null;
};
