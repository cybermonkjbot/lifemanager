import { CODE_SDK_REGISTRY } from "./sdk";
import type { CodeDiagnostic, CodeDiagnosticSeverity } from "./types";

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
  literalUrl?: string;
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
    sdkCalls: ProjectSdkCall[];
    workerHooks: ProjectSdkCall[];
    outboundHttp: ProjectSdkCall[];
    messageSends: ProjectSdkCall[];
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
const sdkCallPattern = /\b([A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)+)\s*\(/g;
const literalUrlPattern = /\bhttp\.(?:fetch|get|post|request)\s*\(\s*"([^"]+)"/;

const PROJECT_SDK_MODULES = new Set([
  ...Object.keys(CODE_SDK_REGISTRY),
  "http",
  "webhook",
  "orchestrator",
  "messages",
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
      const lineText = file.content.split("\n")[line - 1] || "";
      const urlMatch = lineText.match(literalUrlPattern);
      const sdkCall: ProjectSdkCall = {
        call: match[1],
        module: sdkModule,
        operation,
        line,
        column,
        literalUrl: urlMatch?.[1],
      };
      sdkCalls.push(sdkCall);
      const callNodeId = `sdk:${file.path}:${line}:${column}:${sdkCall.call}`;
      nodes.push({ id: callNodeId, label: sdkCall.call, kind: canvasKind(sdkCall), filePath: file.path, line });
      edges.push({ id: `edge:${fileNodeId}:${callNodeId}`, from: fileNodeId, to: callNodeId, label: "uses" });
      if (sdkModule === "http" && !["fetch", "get", "post", "request"].includes(operation)) {
        fileDiagnostics.push(diagnostic(file.path, line, column, "error", `Unknown http operation "${operation}".`));
      }
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
      sdkCalls: allCalls,
      workerHooks: allCalls.filter((item) => item.module === "worker"),
      outboundHttp: allCalls.filter((item) => item.module === "http"),
      messageSends: allCalls.filter((item) => item.module === "messages"),
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
