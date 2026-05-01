import { CODE_SDK_REGISTRY } from "./sdk";
import type { CodeDiagnostic, CodeDiagnosticSeverity } from "./types";

export type PlatformProvider = "whatsapp" | "instagram" | "imessage" | "telegram";
export type PlatformProviderSelector = PlatformProvider | "all";

export type CodeProjectFile = {
  path: string;
  content: string;
  language?: "odogwu";
};

export type ProjectDiagnostic = CodeDiagnostic & {
  filePath: string;
};

export type ProjectExport = {
  kind: "rule" | "webhook" | "function" | "heuristic" | "lexicon" | "prompt";
  name: string;
  line: number;
  args: string[];
};

export type ProjectSdkCall = {
  call: string;
  module: string;
  operation: string;
  filePath?: string;
  line: number;
  column: number;
  args: ProjectSdkArg[];
  literalUrl?: string;
  secretUrlKey?: string;
};

export type ProjectSdkArgKind = "string" | "number" | "boolean" | "ref" | "call" | "unknown";

export type ProjectSdkArg = {
  key: string;
  raw: string;
  kind: ProjectSdkArgKind;
  value?: string | number | boolean;
};

export type ProjectEventBinding = {
  event: string;
  alias: string;
  provider?: PlatformProviderSelector;
  filePath: string;
  line: number;
  column: number;
};

export type ProjectPlatformAction = ProjectSdkCall & {
  sourceProvider: PlatformProviderSelector;
  targetProvider?: PlatformProviderSelector;
  targetProviders: PlatformProviderSelector[];
  crossPlatform: boolean;
};

export type ProjectPlatformRoute = {
  sourceProvider: PlatformProvider;
  targetProvider: PlatformProvider;
  operation: string;
  call: string;
  filePath?: string;
  line: number;
};

export type CodeCanvasNode = {
  id: string;
  label: string;
  kind:
    | "file"
    | "import"
    | "rule"
    | "webhook"
    | "function"
    | "heuristic"
    | "lexicon"
    | "prompt"
    | "sdk"
    | "http"
    | "message"
    | "platform"
    | "account"
    | "worker";
  filePath: string;
  line: number;
  status?: "idle" | "success" | "error";
};

export type CodeBehaviorExtension = {
  kind: "heuristic" | "lexicon" | "prompt";
  name: string;
  filePath: string;
  line: number;
  patterns: string[];
  terms: Array<{ token: string; meaning: string; tags: string[] }>;
  promptAdds: string[];
  targets: string[];
  priority: number;
};

export type CodeCanvasEdge = {
  id: string;
  from: string;
  to: string;
  label: string;
};

export type CodeProjectBundle = {
  entryPath: string;
  files: Array<{
    path: string;
    imports: string[];
    exports: ProjectExport[];
    sdkCalls: ProjectSdkCall[];
    diagnostics: ProjectDiagnostic[];
  }>;
  diagnostics: ProjectDiagnostic[];
  manifest: {
    handlers: Array<{ name: string; kind: "rule" | "webhook"; filePath: string; line: number }>;
    webhooks: Array<{ name: string; filePath: string; line: number; endpoint: string }>;
    functions: Array<{ name: string; filePath: string; line: number; args: string[] }>;
    behaviorExtensions: CodeBehaviorExtension[];
    heuristicPatterns: CodeBehaviorExtension[];
    lexiconEntries: CodeBehaviorExtension[];
    promptDerivations: CodeBehaviorExtension[];
    eventBindings: ProjectEventBinding[];
    sdkCalls: ProjectSdkCall[];
    workerHooks: ProjectSdkCall[];
    outboundHttp: ProjectSdkCall[];
    messageSends: ProjectSdkCall[];
    platformActions: ProjectPlatformAction[];
    crossPlatformActions: ProjectPlatformAction[];
    platformRoutes: ProjectPlatformRoute[];
    accountMutations: ProjectSdkCall[];
  };
  canvas: {
    nodes: CodeCanvasNode[];
    edges: CodeCanvasEdge[];
  };
};

export type CodeProjectTestResult = {
  passed: boolean;
  diagnostics: ProjectDiagnostic[];
  bundle: CodeProjectBundle;
  trace: Array<{ nodeId: string; status: "success" | "error"; summary: string }>;
};

const importPattern = /^\s*import\s+"([^"]+)"/gm;
const exportPattern = /^\s*export\s+(rule|webhook|function|heuristic|lexicon|prompt)\s+([A-Za-z_][\w]*)(?:\(([^)]*)\))?/gm;
const eventPattern = /^\s*on\s+([a-z][\w]*(?:\.[a-z][\w]*)*)\s+as\s+([a-z][\w]*)/gm;
const sdkCallPattern = /\b([A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)+)\s*\(/g;
const literalUrlPattern = /\bhttp\.(?:fetch|get|post|request)\s*\(\s*"([^"]+)"/;
const secretUrlPattern = /\bhttp\.(?:fetch|get|post|request)\s*\(\s*(?:url:\s*)?secret\("([^"]+)"\)|\bhttp\.(?:fetch|get|post|request)\s*\(\s*secret:\s*"([^"]+)"/;
const providerArgPattern = /\b(?:via|provider|platform|to_platform|target_platform|to|targets)\s*:\s*"([^"]+)"/gi;
const providerConditionPattern = /\b(?:msg|event|hook)\.(?:provider|platform)\s*==\s*"([^"]+)"/i;

const PLATFORM_PROVIDERS: PlatformProvider[] = ["whatsapp", "instagram", "imessage", "telegram"];
const PLATFORM_PROVIDER_SELECTORS = new Set<PlatformProviderSelector>([...PLATFORM_PROVIDERS, "all"]);

const PROJECT_SDK_MODULES = new Set([
  ...Object.keys(CODE_SDK_REGISTRY),
  "http",
  "webhook",
  "orchestrator",
  "messages",
  "platform",
  "account",
  "worker",
  "heuristics",
  "lexicon",
  "prompts",
]);

function normalizePath(path: string) {
  const clean = path.replace(/\\/g, "/").replace(/^\/+/, "");
  const segments: string[] = [];
  for (const segment of clean.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") segments.pop();
    else segments.push(segment);
  }
  return segments.join("/") || "main.odo";
}

function resolveImport(fromPath: string, specifier: string) {
  if (!specifier.startsWith(".")) return normalizePath(specifier);
  const base = fromPath.split("/").slice(0, -1);
  return normalizePath([...base, specifier].join("/"));
}

function diagnostic(filePath: string, line: number, column: number, severity: CodeDiagnosticSeverity, message: string): ProjectDiagnostic {
  return { filePath, line, column, severity, message };
}

function lineColumnForIndex(source: string, index: number) {
  const prefix = source.slice(0, index);
  const lines = prefix.split("\n");
  return { line: lines.length, column: lines[lines.length - 1].length + 1 };
}

function canvasKind(call: ProjectSdkCall): CodeCanvasNode["kind"] {
  if (call.module === "http") return "http";
  if (call.module === "messages") return "message";
  if (call.module === "platform") return "platform";
  if (call.module === "account") return "account";
  if (call.module === "worker") return "worker";
  return "sdk";
}

function hashFiles(files: CodeProjectFile[]) {
  return files
    .map((file) => `${normalizePath(file.path)}:${file.content.length}:${file.content.slice(0, 120)}`)
    .sort()
    .join("|");
}

function exportBlockBody(source: string, exportIndex: number) {
  const rest = source.slice(exportIndex);
  const next = rest.slice(1).search(/^[ \t]*export\s+/m);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

function quotedValues(line: string) {
  return Array.from(line.matchAll(/"([^"]+)"/g)).map((match) => match[1]);
}

function splitTopLevelArgs(argsText: string) {
  const args: string[] = [];
  let start = 0;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < argsText.length; index += 1) {
    const char = argsText[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "(" || char === "{" || char === "[") depth += 1;
    if (char === ")" || char === "}" || char === "]") depth = Math.max(0, depth - 1);
    if (char === "," && depth === 0) {
      args.push(argsText.slice(start, index).trim());
      start = index + 1;
    }
  }
  const tail = argsText.slice(start).trim();
  if (tail) args.push(tail);
  return args.filter(Boolean);
}

function extractCallArgsText(callText: string) {
  const openIndex = callText.indexOf("(");
  if (openIndex === -1) return "";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = openIndex; index < callText.length; index += 1) {
    const char = callText[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "(") depth += 1;
    if (char === ")") {
      depth -= 1;
      if (depth === 0) return callText.slice(openIndex + 1, index);
    }
  }
  return callText.slice(openIndex + 1);
}

function parseProjectArgValue(raw: string): Omit<ProjectSdkArg, "key"> {
  const value = raw.trim().replace(/,$/, "");
  const quoted = value.match(/^"([\s\S]*)"$/);
  if (quoted) return { raw: value, kind: "string", value: quoted[1] || "" };
  if (value === "true" || value === "false") return { raw: value, kind: "boolean", value: value === "true" };
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return { raw: value, kind: "number", value: Number(value) };
  if (/^[a-z][\w]*(?:\.[a-z][\w]*)*\([\s\S]*\)$/i.test(value)) return { raw: value, kind: "call" };
  if (/^[a-z][\w]*(?:\.[a-z][\w]*)*$/i.test(value)) return { raw: value, kind: "ref" };
  return { raw: value, kind: "unknown" };
}

function parseProjectSdkArgs(callText: string): ProjectSdkArg[] {
  return splitTopLevelArgs(extractCallArgsText(callText)).map((segment) => {
    const named = segment.match(/^([a-z][\w]*)\s*:\s*([\s\S]+)$/i);
    if (named) {
      return { key: named[1] || "", ...parseProjectArgValue(named[2] || "") };
    }
    return { key: "value", ...parseProjectArgValue(segment) };
  });
}

function hasProjectArg(call: ProjectSdkCall, argName: string, requiredArgCount: number) {
  if (call.args.some((arg) => arg.key === argName)) return true;
  if (requiredArgCount === 1 && call.args.some((arg) => arg.key === "value")) return true;
  if (call.module === "http" && argName === "url") return Boolean(call.literalUrl || call.secretUrlKey || call.args.some((arg) => arg.key === "url" || arg.key === "secret" || arg.key === "value"));
  return false;
}

function argForName(call: ProjectSdkCall, argName: string) {
  return call.args.find((arg) => arg.key === argName) || (call.args.length === 1 ? call.args[0] : undefined);
}

function validateProjectSdkCall(call: ProjectSdkCall, filePath: string, diagnostics: ProjectDiagnostic[]) {
  const moduleSpec = CODE_SDK_REGISTRY[call.module];
  const operationSpec = moduleSpec?.operations[call.operation];
  if (!moduleSpec) {
    diagnostics.push(diagnostic(filePath, call.line, call.column, "error", `Unknown SDK module "${call.module}".`));
    return;
  }
  if (!operationSpec) {
    diagnostics.push(diagnostic(filePath, call.line, call.column, "error", `Unknown SDK operation "${call.call}".`));
    return;
  }

  const requiredArgs = operationSpec.requiredArgs || [];
  for (const requiredArg of requiredArgs) {
    if (!hasProjectArg(call, requiredArg, requiredArgs.length)) {
      diagnostics.push(diagnostic(filePath, call.line, call.column, "error", `Missing required argument "${requiredArg}" for ${call.call}.`));
    }
  }

  if (call.module === "http" && call.literalUrl && !/^https?:\/\//i.test(call.literalUrl)) {
    diagnostics.push(diagnostic(filePath, call.line, call.column, "error", `${call.call} URL must start with http:// or https://.`));
  }

  if (call.module === "platform") {
    const providerArgNames = new Set(["via", "provider", "platform", "to_platform", "target_platform", "targets"]);
    for (const arg of call.args.filter((item) => providerArgNames.has(item.key))) {
      if (arg.kind !== "string" || typeof arg.value !== "string") {
        diagnostics.push(diagnostic(filePath, call.line, call.column, "error", `${call.call} argument "${arg.key}" must be a string platform selector.`));
        continue;
      }
      const values = arg.value.split(",").map((item) => item.trim()).filter(Boolean);
      const invalid = values.filter((value) => !normalizeProvider(value));
      if (invalid.length > 0) {
        diagnostics.push(diagnostic(filePath, call.line, call.column, "error", `${call.call} has unknown platform selector "${invalid[0]}". Use whatsapp, instagram, imessage, telegram, or all.`));
      }
    }
    const viaArg = call.args.find((arg) => arg.key === "via");
    if (viaArg?.value === "all") {
      diagnostics.push(diagnostic(filePath, call.line, call.column, "error", `${call.call} argument "via" must name one concrete target platform, not all.`));
    }
  }

  const numericValueOperations = new Set(["ai.set_confidence_floor", "heuristics.score"]);
  if (numericValueOperations.has(call.call)) {
    const valueArg = argForName(call, "value");
    if (valueArg && valueArg.kind !== "number") {
      diagnostics.push(diagnostic(filePath, call.line, call.column, "error", `${call.call} argument "value" must be a number.`));
    }
  }

  const stringLiteralOperations = new Set(["webhook.verify_secret"]);
  if (stringLiteralOperations.has(call.call)) {
    const valueArg = argForName(call, "secretKey");
    if (valueArg && valueArg.kind !== "string") {
      diagnostics.push(diagnostic(filePath, call.line, call.column, "error", `${call.call} secret must be a string literal.`));
    }
  }
}

function parseBehaviorExtension(kind: CodeBehaviorExtension["kind"], name: string, filePath: string, line: number, body: string): CodeBehaviorExtension {
  const patterns: string[] = [];
  const terms: CodeBehaviorExtension["terms"] = [];
  const promptAdds: string[] = [];
  const targets: string[] = [];
  let priority = 50;

  for (const rawLine of body.split("\n")) {
    const trimmed = rawLine.trim();
    if (trimmed.startsWith("pattern ")) patterns.push(...quotedValues(trimmed));
    if (trimmed.startsWith("target ")) targets.push(...quotedValues(trimmed));
    if (trimmed.startsWith("intent ")) targets.push(...quotedValues(trimmed).map((value) => `intent:${value}`));
    if (trimmed.startsWith("append ") || trimmed.startsWith("prepend ") || trimmed.startsWith("instruction ")) {
      promptAdds.push(...quotedValues(trimmed));
    }
    const priorityMatch = trimmed.match(/^priority\s+(\d+)/);
    if (priorityMatch) priority = Math.max(0, Math.min(100, Number(priorityMatch[1])));
    if (trimmed.startsWith("term ") || trimmed.startsWith("phrase ") || trimmed.startsWith("alias ")) {
      const values = quotedValues(trimmed);
      if (values.length >= 2) {
        terms.push({
          token: values[0],
          meaning: values[1],
          tags: values.slice(2).flatMap((value) => value.split(",").map((tag) => tag.trim()).filter(Boolean)),
        });
      }
    }
  }

  return { kind, name, filePath, line, patterns, terms, promptAdds, targets, priority };
}

function normalizeProvider(value: string | undefined): PlatformProviderSelector | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized && PLATFORM_PROVIDER_SELECTORS.has(normalized as PlatformProviderSelector) ? (normalized as PlatformProviderSelector) : undefined;
}

function providerFromEvent(event: string): PlatformProviderSelector | undefined {
  const prefix = event.split(".")[0];
  return normalizeProvider(prefix);
}

function providersFromLine(lineText: string): PlatformProviderSelector[] {
  const providers: PlatformProviderSelector[] = [];
  providerArgPattern.lastIndex = 0;
  for (let match = providerArgPattern.exec(lineText); match; match = providerArgPattern.exec(lineText)) {
    const values = (match[1] || "").split(",").map((item) => item.trim());
    for (const value of values) {
      const provider = normalizeProvider(value);
      if (provider && !providers.includes(provider)) providers.push(provider);
    }
  }
  return providers;
}

function providerFromNearbyCondition(lines: string[], lineIndex: number): PlatformProviderSelector | undefined {
  for (let index = lineIndex; index >= Math.max(0, lineIndex - 8); index -= 1) {
    const provider = normalizeProvider(lines[index]?.match(providerConditionPattern)?.[1]);
    if (provider) return provider;
  }
  return undefined;
}

function expandProviders(provider: PlatformProviderSelector): PlatformProvider[] {
  return provider === "all" ? PLATFORM_PROVIDERS : [provider];
}

function expandPlatformRoutes(action: ProjectPlatformAction): ProjectPlatformRoute[] {
  const sourceProviders = expandProviders(action.sourceProvider);
  const targetProviders = (action.targetProviders.length ? action.targetProviders : [action.targetProvider]).filter(
    (provider): provider is PlatformProviderSelector => Boolean(provider),
  );
  return sourceProviders.flatMap((sourceProvider) =>
    targetProviders
      .flatMap((targetProvider) => expandProviders(targetProvider))
      .filter((targetProvider) => targetProvider !== sourceProvider)
      .map((targetProvider) => ({
        sourceProvider,
        targetProvider,
        operation: action.operation,
        call: action.call,
        filePath: action.filePath,
        line: action.line,
      })),
  );
}

function callSnippet(lines: string[], lineIndex: number) {
  const parts: string[] = [];
  let depth = 0;
  for (let index = lineIndex; index < Math.min(lines.length, lineIndex + 12); index += 1) {
    const text = lines[index] || "";
    parts.push(text);
    depth += (text.match(/\(/g) || []).length;
    depth -= (text.match(/\)/g) || []).length;
    if (parts.length > 1 && depth <= 0) break;
  }
  return parts.join("\n");
}

export function getCodeProjectHash(files: CodeProjectFile[]) {
  let hash = 2166136261;
  const value = hashFiles(files);
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function compileCodeProject(files: CodeProjectFile[], entryPath = "main.odo"): CodeProjectBundle {
  const normalized = files.map((file) => ({
    path: normalizePath(file.path),
    content: file.content.replace(/\r\n/g, "\n"),
    language: file.language || ("odogwu" as const),
  }));
  const byPath = new Map(normalized.map((file) => [file.path, file]));
  const diagnostics: ProjectDiagnostic[] = [];
  const fileResults: CodeProjectBundle["files"] = [];
  const nodes: CodeCanvasNode[] = [];
  const edges: CodeCanvasEdge[] = [];
  const seenExports = new Map<string, ProjectExport & { filePath: string }>();
  const behaviorExtensions: CodeBehaviorExtension[] = [];

  const entry = normalizePath(entryPath);
  if (!byPath.has(entry)) {
    diagnostics.push(diagnostic(entry, 1, 1, "error", "main.odo is required as the project entry file."));
  }

  for (const file of normalized) {
    const imports: string[] = [];
    const exports: ProjectExport[] = [];
    const sdkCalls: ProjectSdkCall[] = [];
    const fileDiagnostics: ProjectDiagnostic[] = [];
    const fileNodeId = `file:${file.path}`;
    nodes.push({ id: fileNodeId, label: file.path, kind: "file", filePath: file.path, line: 1 });
    const contentLines = file.content.split("\n");

    importPattern.lastIndex = 0;
    for (let match = importPattern.exec(file.content); match; match = importPattern.exec(file.content)) {
      const resolved = resolveImport(file.path, match[1]);
      imports.push(resolved);
      const { line, column } = lineColumnForIndex(file.content, match.index);
      const importNodeId = `import:${file.path}:${resolved}`;
      nodes.push({ id: importNodeId, label: resolved, kind: "import", filePath: file.path, line });
      edges.push({ id: `edge:${fileNodeId}:${importNodeId}`, from: fileNodeId, to: importNodeId, label: "imports" });
      if (!byPath.has(resolved)) {
        fileDiagnostics.push(diagnostic(file.path, line, column, "error", `Import "${match[1]}" resolves to missing file "${resolved}".`));
      } else {
        edges.push({ id: `edge:${importNodeId}:file:${resolved}`, from: importNodeId, to: `file:${resolved}`, label: "opens" });
      }
    }

    eventPattern.lastIndex = 0;
    for (let match = eventPattern.exec(file.content); match; match = eventPattern.exec(file.content)) {
      const { line, column } = lineColumnForIndex(file.content, match.index);
      const event = match[1] || "";
      const provider = providerFromEvent(event);
      const eventNodeId = `event:${file.path}:${line}:${column}:${event}`;
      nodes.push({ id: eventNodeId, label: provider ? `${provider} ${event}` : event, kind: "sdk", filePath: file.path, line });
      edges.push({ id: `edge:${fileNodeId}:${eventNodeId}`, from: fileNodeId, to: eventNodeId, label: "listens" });
    }

    exportPattern.lastIndex = 0;
    for (let match = exportPattern.exec(file.content); match; match = exportPattern.exec(file.content)) {
      const exportIndex = match.index + Math.max(0, match[0].search(/\bexport\b/));
      const { line } = lineColumnForIndex(file.content, exportIndex);
      const args = (match[3] || "")
        .split(",")
        .map((arg) => arg.trim())
        .filter(Boolean);
      const exported: ProjectExport = { kind: match[1] as ProjectExport["kind"], name: match[2], line, args };
      const exportKey = `${exported.kind}:${exported.name}`;
      if (seenExports.has(exportKey)) {
        fileDiagnostics.push(diagnostic(file.path, line, 1, "error", `Duplicate export "${exported.name}".`));
      }
      seenExports.set(exportKey, { ...exported, filePath: file.path });
      exports.push(exported);
      const nodeKind = exported.kind;
      const nodeId = `${nodeKind}:${file.path}:${exported.name}`;
      nodes.push({ id: nodeId, label: `${exported.kind} ${exported.name}`, kind: nodeKind, filePath: file.path, line });
      edges.push({ id: `edge:${fileNodeId}:${nodeId}`, from: fileNodeId, to: nodeId, label: "exports" });
      if (exported.kind === "heuristic" || exported.kind === "lexicon" || exported.kind === "prompt") {
        behaviorExtensions.push(parseBehaviorExtension(exported.kind, exported.name, file.path, line, exportBlockBody(file.content, exportIndex)));
      }
    }

    sdkCallPattern.lastIndex = 0;
    for (let match = sdkCallPattern.exec(file.content); match; match = sdkCallPattern.exec(file.content)) {
      const parts = match[1].split(".");
      const sdkModule = parts[0];
      const operation = parts.slice(1).join(".");
      if (!PROJECT_SDK_MODULES.has(sdkModule)) continue;
      const { line, column } = lineColumnForIndex(file.content, match.index);
      const lineText = contentLines[line - 1] || "";
      const callText = callSnippet(contentLines, line - 1);
      const urlMatch = lineText.match(literalUrlPattern);
      const secretUrlMatch = lineText.match(secretUrlPattern);
      const sdkCall: ProjectSdkCall = {
        call: match[1],
        module: sdkModule,
        operation,
        line,
        column,
        args: parseProjectSdkArgs(callText),
        literalUrl: urlMatch?.[1],
        secretUrlKey: secretUrlMatch?.[1] || secretUrlMatch?.[2],
      };
      sdkCalls.push(sdkCall);
      const callNodeId = `sdk:${file.path}:${line}:${column}:${sdkCall.call}`;
      nodes.push({ id: callNodeId, label: sdkCall.call, kind: canvasKind(sdkCall), filePath: file.path, line });
      edges.push({ id: `edge:${fileNodeId}:${callNodeId}`, from: fileNodeId, to: callNodeId, label: "uses" });
      validateProjectSdkCall(sdkCall, file.path, fileDiagnostics);
    }

    fileResults.push({ path: file.path, imports, exports, sdkCalls, diagnostics: fileDiagnostics });
    diagnostics.push(...fileDiagnostics);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (path: string, stack: string[]) => {
    if (visiting.has(path)) {
      diagnostics.push(diagnostic(path, 1, 1, "error", `Cyclic import detected: ${[...stack, path].join(" -> ")}.`));
      return;
    }
    if (visited.has(path)) return;
    visiting.add(path);
    const result = fileResults.find((item) => item.path === path);
    for (const child of result?.imports || []) visit(child, [...stack, path]);
    visiting.delete(path);
    visited.add(path);
  };
  visit(entry, []);

  const allExports = fileResults.flatMap((file) => file.exports.map((item) => ({ ...item, filePath: file.path })));
  const allCalls = fileResults.flatMap((file) => file.sdkCalls.map((item) => ({ ...item, filePath: file.path })));
  const allEventBindings = normalized.flatMap((file) => {
    const bindings: ProjectEventBinding[] = [];
    eventPattern.lastIndex = 0;
    for (let match = eventPattern.exec(file.content); match; match = eventPattern.exec(file.content)) {
      const { line, column } = lineColumnForIndex(file.content, match.index);
      const event = match[1] || "";
      bindings.push({
        event,
        alias: match[2] || "event",
        provider: providerFromEvent(event),
        filePath: file.path,
        line,
        column,
      });
    }
    return bindings;
  });
  const webhooks = allExports
    .filter((item) => item.kind === "webhook")
    .map((item) => ({
      name: item.name,
      filePath: item.filePath,
      line: item.line,
      endpoint: `/api/code/webhooks/{projectSlug}/${item.name}`,
    }));
  const heuristicPatterns = behaviorExtensions.filter((item) => item.kind === "heuristic");
  const lexiconEntries = behaviorExtensions.filter((item) => item.kind === "lexicon");
  const promptDerivations = behaviorExtensions.filter((item) => item.kind === "prompt");
  const platformActions = allCalls
    .filter((item) => item.module === "platform")
    .map((item): ProjectPlatformAction => {
      const sourceFile = normalized.find((file) => file.path === item.filePath);
      const sourceLines = sourceFile?.content.split("\n") || [];
      const lineText = callSnippet(sourceLines, item.line - 1);
      const sourceEventProvider = allEventBindings
        .filter((binding) => binding.filePath === item.filePath && binding.line <= item.line)
        .sort((a, b) => b.line - a.line)[0]?.provider;
      const sourceProvider = sourceFile ? providerFromNearbyCondition(sourceLines, item.line - 1) || sourceEventProvider : sourceEventProvider;
      const targetProviders = providersFromLine(lineText);
      const targetProvider = targetProviders[0];
      return {
        ...item,
        sourceProvider: sourceProvider || "all",
        targetProvider,
        targetProviders,
        crossPlatform: expandPlatformRoutes({
          ...item,
          sourceProvider: sourceProvider || "all",
          targetProvider,
          targetProviders,
          crossPlatform: false,
        }).length > 0,
      };
    });
  const platformRoutes = platformActions.flatMap((action) => expandPlatformRoutes(action));

  return {
    entryPath: entry,
    files: fileResults,
    diagnostics,
    manifest: {
      handlers: allExports
        .filter((item): item is ProjectExport & { filePath: string; kind: "rule" | "webhook" } => item.kind === "rule" || item.kind === "webhook")
        .map((item) => ({ name: item.name, kind: item.kind, filePath: item.filePath, line: item.line })),
      webhooks,
      functions: allExports
        .filter((item) => item.kind === "function")
        .map((item) => ({ name: item.name, filePath: item.filePath, line: item.line, args: item.args })),
      behaviorExtensions,
      heuristicPatterns,
      lexiconEntries,
      promptDerivations,
      eventBindings: allEventBindings,
      sdkCalls: allCalls,
      workerHooks: allCalls.filter((item) => item.module === "worker"),
      outboundHttp: allCalls.filter((item) => item.module === "http"),
      messageSends: allCalls.filter((item) => item.module === "messages"),
      platformActions,
      crossPlatformActions: platformActions.filter((item) => item.crossPlatform),
      platformRoutes,
      accountMutations: allCalls.filter((item) => item.module === "account"),
    },
    canvas: { nodes, edges },
  };
}

export function runCodeProjectTests(files: CodeProjectFile[], entryPath = "main.odo"): CodeProjectTestResult {
  const bundle = compileCodeProject(files, entryPath);
  const hasHandler = bundle.manifest.handlers.length > 0;
  const diagnostics = [...bundle.diagnostics];
  if (!hasHandler) {
    diagnostics.push(diagnostic(entryPath, 1, 1, "warning", "Project has no exported rule or webhook handler yet."));
  }
  const passed = diagnostics.every((item) => item.severity !== "error");
  return {
    passed,
    diagnostics,
    bundle,
    trace: bundle.canvas.nodes.slice(0, 30).map((node) => ({
      nodeId: node.id,
      status: passed ? "success" : node.kind === "file" ? "error" : "success",
      summary: `${node.kind} ${node.label}`,
    })),
  };
}
