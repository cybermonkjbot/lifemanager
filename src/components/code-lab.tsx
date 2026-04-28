"use client";

import { ActionNotices } from "@/components/action-notices";
import { LoadingIndicator } from "@/components/loading-state";
import { useTenantScopeArgs } from "@/components/tenant-scope-provider";
import { UIModal } from "@/components/ui-modal";
import {
  compileCodeProject,
  runCodeProjectTests,
  type CodeProjectBundle,
  type CodeProjectFile,
  type ProjectDiagnostic,
} from "@/code-runtime";
import { useActionStateRegistry } from "@/lib/ui/action-state";
import { autocompletion, CompletionContext } from "@codemirror/autocomplete";
import { defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { linter } from "@codemirror/lint";
import { EditorState, RangeSetBuilder } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, hoverTooltip, keymap, lineNumbers, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useAction, useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

type FileDialogMode = "create" | "rename" | "duplicate";
type FileDialogState = {
  mode: FileDialogMode;
  path: string;
  sourcePath?: string;
} | null;

const starterProjectFiles: CodeProjectFile[] = [
  {
    path: "main.odo",
    language: "odogwu",
    content: `# Lead Desk keeps paid consults, inbound leads, and personal replies sane.
project LeadDesk version "1.0"

import "./messages.odo"
import "./webhooks/paystack.odo"
import "./behavior/language.odo"

use webhook
use http
use ai
use followups
use messages
use orchestrator
use account
use worker
use heuristics
use lexicon
use prompts

# Direct messages stay review-first, but the worker can still classify urgency.
export rule DirectMessageTriage
on message.received as msg
when msg.thread.kind == "direct"
do
  account.behavior.set("review_first")
  ai.set_confidence_floor(0.78)
  worker.extend("relationship-priority-router")
end`,
  },
  {
    path: "messages.odo",
    language: "odogwu",
    content: `# Shared reply helpers for leads and payment events.
export function draftPaidConsultReply(payload)
do
  messages.draft(
    to: payload.phone,
    text: "Payment received. I will confirm a time and send the prep notes shortly."
  )
end`,
  },
  {
    path: "webhooks/paystack.odo",
    language: "odogwu",
    content: `# Paystack posts here after a consultation checkout succeeds.
export webhook paidConsultation
on webhook.received as hook
do
  webhook.verify_secret("paystackWebhookSecret")
  http.post(secret: "ops.paymentWebhookUrl")
  followups.create(
    title: "Schedule paid consultation",
    thread: hook.payload.thread,
    due: time.tomorrow_at("09:00")
  )
  messages.preview(
    to: hook.payload.phone,
    text: "Payment received. I will confirm a time and send prep notes shortly."
  )
  orchestrator.run_tool("update_customer_timeline")
end`,
  },
  {
    path: "behavior/language.odo",
    language: "odogwu",
    content: `# Tenant-specific behavior overlays used by prompt and worker systems.
export heuristic PaidConsultIntent
pattern "paid for consultation"
pattern "sent payment"
target "todo_candidate"
instruction "Treat successful consultation payments as scheduling commitments."
priority 86
end

export lexicon ClientLanguage
term "deck" "pitch deck or proposal document" "sales,client"
term "call slot" "available meeting time" "scheduling"
phrase "no wahala" "no problem; keep the tone relaxed"
end

export prompt ConsultationReplyStyle
target "intent:paid_consult"
append "Be concise, confirm payment, state the next scheduling step, and avoid overexplaining."
priority 88
end`,
  },
];

const hoverDocs: Record<string, string> = {
  project: "Declares a multi-file ODOGWU extension project.",
  program: "Legacy single-file declaration. New Code Lab projects prefer project.",
  import: "Imports another file in this project by relative path.",
  export: "Makes a rule, webhook, or function visible to the project bundle.",
  rule: "A handler that reacts to account or worker events.",
  webhook: "A published HTTP handler and SDK module for inbound webhook payloads.",
  function: "Reusable ODOGWU code callable from project files.",
  heuristic: "A tenant-scoped pattern overlay for routing, todo detection, guardrails, and worker heuristics.",
  lexicon: "A tenant-specific dictionary and SDK module for slang, aliases, relationship phrases, or domain language.",
  prompt: "A bounded prompt-derivation overlay applied when targets, terms, or patterns match.",
  version: "Pins a human-readable version string for this file.",
  use: "Imports an approved in-app SDK module.",
  on: "Starts an event handler.",
  when: "Adds a guard condition.",
  and: "Continues a multi-line condition.",
  between: "Checks whether a time is inside a local time window.",
  do: "Starts the action block for a handler.",
  end: "Closes the current block.",
  test: "Defines a fake-event test that must pass before publishing.",
  given: "Creates a fake event payload for a test.",
  expect: "Asserts sandbox state after actions run.",
  "webhook.received": "Event fired when an external platform posts to this handler.",
  "message.received": "Event fired when ODOGWU receives a connected account message.",
  chat: "SDK module for inspecting message and thread context.",
  ai: "SDK module for shaping AI behavior.",
  followups: "SDK module for conversation reminders.",
  memory: "SDK module for bounded contact facts.",
  settings: "SDK module for safe runtime settings.",
  outreach: "SDK module for approved outreach flows.",
  runtime: "SDK module for local runtime status and pause/resume.",
  time: "SDK helpers for dates and clock conditions.",
  http: "SDK module for audited outbound API calls.",
  orchestrator: "SDK module for account-scoped AI orchestration and tools.",
  messages: "SDK module for send, draft, and preview message operations.",
  account: "SDK module for account behavior and settings changes.",
  worker: "SDK module for local worker extension hooks.",
  heuristics: "SDK module for tenant-owned heuristic patterns and scores.",
  prompts: "SDK module for bounded prompt derivation overlays.",
  "http.post": "POST to a literal URL through the audited HTTP adapter.",
  "http.get": "GET a literal URL through the audited HTTP adapter.",
  "http.fetch": "Run an outbound HTTP request through the audited adapter.",
  "http.request": "Run an outbound HTTP request with an explicit method.",
  "webhook.reply": "Return a JSON response from a webhook handler.",
  "webhook.verify_secret": "Verify an inbound webhook secret reference.",
  "orchestrator.ask": "Ask the account-scoped orchestrator to reason over this event.",
  "orchestrator.run_tool": "Run an approved tool exposed to the orchestrator.",
  "messages.send": "Queue a message send when this project is allowed to do so.",
  "messages.draft": "Create a reviewable message draft.",
  "messages.preview": "Render a send preview without queueing.",
  "account.settings.patch": "Patch selected account settings through an audited adapter.",
  "account.behavior.set": "Set account behavior flags for the owner account.",
  "account.behavior_set": "Set account behavior flags for the owner account.",
  "worker.extend": "Register a published bundle hook for the local worker.",
  "worker.schedule": "Schedule a handler on the local worker.",
  "worker.run_local": "Run an approved local adapter without shell or filesystem access.",
  "heuristics.pattern": "Register a tenant-scoped text pattern for a heuristic target.",
  "heuristics.score": "Adjust a heuristic target score for the current event.",
  "heuristics.mark_intent": "Mark a derived intent for prompt and worker routing.",
  "heuristics.block": "Send a matched case to review or block with a reason.",
  "lexicon.term": "Teach a tenant-specific word or phrase meaning.",
  "lexicon.phrase": "Teach a phrase with tags for prompt derivation.",
  "lexicon.alias": "Teach a person, object, or domain alias.",
  "prompts.append": "Append a bounded instruction when this extension matches.",
  "prompts.prepend": "Prepend a high-priority bounded instruction.",
  "prompts.derive": "Create a prompt derivation hook from heuristics or lexicon terms.",
  "prompts.set_context": "Add a bounded context label for prompt construction.",
};

const keywordSet = new Set([
  "project",
  "program",
  "version",
  "import",
  "export",
  "rule",
  "webhook",
  "function",
  "heuristic",
  "lexicon",
  "prompt",
  "use",
  "on",
  "when",
  "and",
  "between",
  "do",
  "end",
  "test",
  "given",
  "expect",
  "as",
]);
const eventSet = new Set(["message.received", "webhook.received"]);
const sdkModuleSet = new Set([
  "chat",
  "ai",
  "followups",
  "memory",
  "settings",
  "outreach",
  "runtime",
  "time",
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
const sdkCallSet = new Set(Object.keys(hoverDocs).filter((key) => key.includes(".")));
const tokenPattern = /#[^\n]*|"(?:[^"\\]|\\.)*"|\b\d+(?:\.\d+)?\b|==|[A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)*/g;

function tokenClass(token: string) {
  if (token.startsWith("#")) return "cm-odogwu-comment";
  if (token.startsWith('"')) return "cm-odogwu-string";
  if (/^\d/.test(token)) return "cm-odogwu-number";
  if (token === "==") return "cm-odogwu-operator";
  if (keywordSet.has(token)) return "cm-odogwu-keyword";
  if (eventSet.has(token)) return "cm-odogwu-event";
  if (sdkCallSet.has(token)) return "cm-odogwu-call";
  if (sdkModuleSet.has(token)) return "cm-odogwu-module";
  if (/^(msg|hook|payload|thread|text|kind|at|title|due|value|phone|sourceHash)$/.test(token)) return "cm-odogwu-property";
  return "";
}

function buildSyntaxDecorations(view: EditorView) {
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to } of view.visibleRanges) {
    const text = view.state.doc.sliceString(from, to);
    tokenPattern.lastIndex = 0;
    for (let match = tokenPattern.exec(text); match; match = tokenPattern.exec(text)) {
      const className = tokenClass(match[0]);
      if (className) builder.add(from + match.index, from + match.index + match[0].length, Decoration.mark({ class: className }));
    }
  }
  return builder.finish();
}

const odogwuSyntaxHighlighter = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildSyntaxDecorations(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) this.decorations = buildSyntaxDecorations(update.view);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

function odogwuHoverTooltip(view: EditorView, pos: number) {
  const line = view.state.doc.lineAt(pos);
  const before = view.state.doc.sliceString(line.from, pos);
  const after = view.state.doc.sliceString(pos, line.to);
  const startMatch = before.match(/[A-Za-z_][\w.]*$/);
  const endMatch = after.match(/^[A-Za-z_][\w.]*/);
  const start = pos - (startMatch?.[0].length || 0);
  const end = pos + (endMatch?.[0].length || 0);
  const token = view.state.doc.sliceString(start, end);
  const doc = hoverDocs[token];
  if (!doc) return null;
  return {
    pos: start,
    end,
    above: true,
    create() {
      const dom = document.createElement("div");
      dom.className = "code-hover-tooltip";
      const title = document.createElement("strong");
      title.textContent = token;
      const body = document.createElement("p");
      body.textContent = doc;
      dom.append(title, body);
      return { dom };
    },
  };
}

type CodeProjectRow = {
  _id: Id<"codeProjects">;
  name: string;
  status: "draft" | "published" | "disabled";
  webhookSlug: string;
  activeVersionId?: Id<"codeProjectVersions">;
  updatedAt: number;
};

type CodeProjectDetail = {
  project: CodeProjectRow & { description?: string; lastTestSuiteId?: Id<"codeTestSuites"> };
  files: Array<{ _id: Id<"codeFiles">; path: string; content: string; language: "odogwu"; updatedAt: number }>;
  versions: Array<{ _id: Id<"codeProjectVersions">; status: string; versionLabel: string; filesJson: string; createdAt: number; publishedAt?: number }>;
  testSuites: Array<{ _id: Id<"codeTestSuites">; passed: boolean; resultJson: string; sourceHash: string; createdAt: number }>;
  runs: Array<{ _id: Id<"codeProjectRuns">; handlerName: string; eventName: string; status: string; createdAt: number }>;
};

function safeJson<T>(value: string | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function stableFilesJson(files: CodeProjectFile[]) {
  return JSON.stringify([...files].sort((a, b) => a.path.localeCompare(b.path)));
}

function validateOdogwuPath(path: string, files: CodeProjectFile[], currentPath?: string) {
  const trimmed = path.trim().replace(/^\/+/, "");
  if (!trimmed) return "Path is required.";
  if (trimmed.includes("..")) return "Parent directory segments are not allowed.";
  if (!/^[A-Za-z0-9_./-]+$/.test(trimmed)) return "Use letters, numbers, dashes, underscores, slashes, and dots.";
  if (!trimmed.endsWith(".odo")) return "ODOGWU source files must end in .odo.";
  if (files.some((file) => file.path === trimmed && file.path !== currentPath)) return "A file already exists at that path.";
  return "";
}

function defaultFileTemplate(path: string) {
  const name = path
    .split("/")
    .pop()
    ?.replace(/\.odo$/, "")
    .replace(/[^A-Za-z0-9_]/g, "_") || "helper";
  return `# ${path}
export function ${name}(payload)
do
  messages.preview(text: "Ready")
end`;
}

function duplicatePath(path: string, files: CodeProjectFile[]) {
  const basePath = path.endsWith(".odo") ? path.slice(0, -4) : path;
  for (let index = 1; index < 100; index += 1) {
    const nextPath = `${basePath}.copy${index === 1 ? "" : index}.odo`;
    if (!files.some((file) => file.path === nextPath)) return nextPath;
  }
  return `${basePath}.copy.odo`;
}

type GeneratedCanvasPreview = {
  hash: string;
  title: string;
  summary: string[];
  mermaid: string;
  lanes: Array<{
    title: string;
    items: Array<{ label: string; detail: string; filePath?: string }>;
  }>;
};

function mermaidId(value: string) {
  return value.replace(/[^A-Za-z0-9_]/g, "_").replace(/^(\d)/, "_$1").slice(0, 48) || "node";
}

function mermaidLabel(value: string) {
  return value.replace(/["[\]{}]/g, "").slice(0, 80);
}

function buildCanvasPreview(args: {
  files: CodeProjectFile[];
  bundle: CodeProjectBundle;
  projectName: string;
  webhookBase: string;
}): GeneratedCanvasPreview {
  const { files, bundle, projectName, webhookBase } = args;
  const fileItems = files.map((file) => ({
    label: file.path,
    detail: `${file.content.split("\n").length} lines`,
    filePath: file.path,
  }));
  const triggerItems = [
    ...bundle.manifest.handlers.map((handler) => ({
      label: `${handler.kind} ${handler.name}`,
      detail: `${handler.filePath}:${handler.line}`,
      filePath: handler.filePath,
    })),
    ...bundle.manifest.webhooks.map((webhook) => ({
      label: `POST ${webhookBase}/${webhook.name}`,
      detail: `${webhook.filePath}:${webhook.line}`,
      filePath: webhook.filePath,
    })),
  ];
  const behaviorItems = bundle.manifest.behaviorExtensions.map((extension) => ({
    label: `${extension.kind} ${extension.name}`,
    detail: `${extension.patterns.length} patterns, ${extension.terms.length} terms, ${extension.promptAdds.length} prompt adds`,
    filePath: extension.filePath,
  }));
  const runtimeItems = [
    ...bundle.manifest.outboundHttp.map((call) => ({
      label: call.call,
      detail: call.literalUrl || `${call.filePath}:${call.line}`,
      filePath: call.filePath,
    })),
    ...bundle.manifest.messageSends.map((call) => ({
      label: call.call,
      detail: `${call.filePath}:${call.line}`,
      filePath: call.filePath,
    })),
    ...bundle.manifest.accountMutations.map((call) => ({
      label: call.call,
      detail: `${call.filePath}:${call.line}`,
      filePath: call.filePath,
    })),
    ...bundle.manifest.workerHooks.map((call) => ({
      label: call.call,
      detail: `${call.filePath}:${call.line}`,
      filePath: call.filePath,
    })),
  ];
  const lanes = [
    { title: "Files", items: fileItems },
    { title: "Triggers", items: triggerItems },
    { title: "Tenant Behavior", items: behaviorItems },
    { title: "Runtime Effects", items: runtimeItems },
  ];
  const summary = [
    `${files.length} files compile into ${bundle.manifest.handlers.length} handler(s).`,
    `${bundle.manifest.webhooks.length} webhook endpoint(s), ${bundle.manifest.outboundHttp.length} outbound API call(s), ${bundle.manifest.messageSends.length} message operation(s).`,
    `${bundle.manifest.behaviorExtensions.length} tenant behavior overlay(s) can influence heuristics, lexicons, and prompt derivation after publish.`,
  ];

  const mermaidLines = ["flowchart LR", `  project["${mermaidLabel(projectName)}"]`];
  for (const file of files) {
    mermaidLines.push(`  ${mermaidId(`file_${file.path}`)}["${mermaidLabel(file.path)}"]`);
    mermaidLines.push(`  project --> ${mermaidId(`file_${file.path}`)}`);
  }
  for (const handler of bundle.manifest.handlers) {
    mermaidLines.push(`  ${mermaidId(`handler_${handler.name}`)}["${mermaidLabel(`${handler.kind} ${handler.name}`)}"]`);
    mermaidLines.push(`  ${mermaidId(`file_${handler.filePath}`)} --> ${mermaidId(`handler_${handler.name}`)}`);
  }
  for (const webhook of bundle.manifest.webhooks) {
    mermaidLines.push(`  ${mermaidId(`webhook_${webhook.name}`)}["${mermaidLabel(`POST /${webhook.name}`)}"]`);
    mermaidLines.push(`  ${mermaidId(`handler_${webhook.name}`)} --> ${mermaidId(`webhook_${webhook.name}`)}`);
  }
  for (const extension of bundle.manifest.behaviorExtensions) {
    mermaidLines.push(`  ${mermaidId(`behavior_${extension.name}`)}["${mermaidLabel(`${extension.kind} ${extension.name}`)}"]`);
    mermaidLines.push(`  ${mermaidId(`file_${extension.filePath}`)} --> ${mermaidId(`behavior_${extension.name}`)}`);
  }
  for (const call of runtimeItems.slice(0, 16)) {
    const id = mermaidId(`effect_${call.label}_${call.detail}`);
    mermaidLines.push(`  ${id}["${mermaidLabel(call.label)}"]`);
    if (call.filePath) mermaidLines.push(`  ${mermaidId(`file_${call.filePath}`)} --> ${id}`);
  }

  return {
    hash: stableFilesJson(files),
    title: `${projectName} canvas`,
    summary,
    mermaid: mermaidLines.join("\n"),
    lanes,
  };
}

function diagnosticLine(diagnostic: ProjectDiagnostic) {
  return `${diagnostic.filePath}:${diagnostic.line}:${diagnostic.column} ${diagnostic.severity} ${diagnostic.message}`;
}

function codeCompletions(filePathsRef: { current: string[] }) {
  return (context: CompletionContext) => {
    const word = context.matchBefore(/[A-Za-z_./]*/);
    if (!word || (word.from === word.to && !context.explicit)) return null;
    const options = [
      ...Array.from(keywordSet).map((label) => ({ label, type: "keyword" })),
      ...Array.from(sdkModuleSet).map((label) => ({ label, type: "namespace" })),
      ...Array.from(sdkCallSet).map((label) => ({ label, type: "function" })),
      ...filePathsRef.current.map((path) => ({ label: `import "./${path}"`, type: "text" })),
    ];
    return { from: word.from, options };
  };
}

type CodeEditorProps = {
  value: string;
  diagnostics: ProjectDiagnostic[];
  filePaths: string[];
  onChange: (next: string) => void;
  onSave: () => void;
  onRunTests: () => void;
  onPublish: () => void;
  onFormat: () => void;
};

function CodeEditor({ value, diagnostics, filePaths, onChange, onSave, onRunTests, onPublish, onFormat }: CodeEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  const onRunTestsRef = useRef(onRunTests);
  const onPublishRef = useRef(onPublish);
  const onFormatRef = useRef(onFormat);
  const diagnosticsRef = useRef(diagnostics);
  const filePathsRef = useRef(filePaths);
  const initialValueRef = useRef(value);

  useEffect(() => {
    onChangeRef.current = onChange;
    onSaveRef.current = onSave;
    onRunTestsRef.current = onRunTests;
    onPublishRef.current = onPublish;
    onFormatRef.current = onFormat;
    diagnosticsRef.current = diagnostics;
    filePathsRef.current = filePaths;
  }, [diagnostics, filePaths, onChange, onFormat, onPublish, onRunTests, onSave]);

  useEffect(() => {
    if (!hostRef.current) return;
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: initialValueRef.current,
        extensions: [
          lineNumbers(),
          keymap.of([
            { key: "Mod-s", preventDefault: true, run: () => (onSaveRef.current(), true) },
            { key: "Mod-Enter", preventDefault: true, run: () => (onRunTestsRef.current(), true) },
            { key: "Shift-Mod-Enter", preventDefault: true, run: () => (onPublishRef.current(), true) },
            { key: "Shift-Alt-f", preventDefault: true, run: () => (onFormatRef.current(), true) },
          ]),
          syntaxHighlighting(defaultHighlightStyle),
          odogwuSyntaxHighlighter,
          hoverTooltip(odogwuHoverTooltip),
          autocompletion({ override: [codeCompletions(filePathsRef)] }),
          linter((editorView) =>
            diagnosticsRef.current.map((item) => {
              const line = editorView.state.doc.line(Math.min(Math.max(1, item.line), editorView.state.doc.lines));
              return {
                from: line.from + Math.max(0, item.column - 1),
                to: line.to,
                severity: item.severity,
                message: item.message,
              };
            }),
          ),
          EditorView.lineWrapping,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChangeRef.current(update.state.doc.toString());
          }),
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.doc.toString() === value) return;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
  }, [value]);

  return <div className="code-editor" ref={hostRef} />;
}

function formatDate(value: number) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function formatOdogwuSource(source: string) {
  let indent = 0;
  return source
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return "";
      if (trimmed === "end" || trimmed.startsWith("expect ")) indent = Math.max(0, indent - 1);
      const next = `${"  ".repeat(indent)}${trimmed}`;
      if (/^(on|export|test)\b/.test(trimmed) || trimmed === "do" || trimmed.endsWith("{")) indent += 1;
      if (trimmed === "}") indent = Math.max(0, indent - 1);
      return next;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
}

export function CodeLab() {
  const router = useRouter();
  const tenantScope = useTenantScopeArgs();
  const projects = useQuery(api.code.listProjects, { ...tenantScope, limit: 80 }) as CodeProjectRow[] | undefined;
  const createProject = useMutation(api.code.createProject);
  const saveProjectFiles = useMutation(api.code.saveProjectFiles);
  const publishProject = useMutation(api.code.publishProject);
  const setProjectEnabled = useMutation(api.code.setProjectEnabled);
  const runProjectTestsRemote = useAction(api.code.runProjectTests);
  const { runAction, getRecord, notices, dismissNotice } = useActionStateRegistry();

  const [selectedProjectId, setSelectedProjectId] = useState<Id<"codeProjects"> | null>(null);
  const [loadedProjectId, setLoadedProjectId] = useState<Id<"codeProjects"> | null>(null);
  const [files, setFiles] = useState<CodeProjectFile[]>(starterProjectFiles);
  const [activePath, setActivePath] = useState("main.odo");
  const [lastSavedFilesJson, setLastSavedFilesJson] = useState("");
  const [description, setDescription] = useState("");
  const [localTestJson, setLocalTestJson] = useState("");
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [terminalOutput, setTerminalOutput] = useState("");
  const [fileDialog, setFileDialog] = useState<FileDialogState>(null);
  const [fileDialogError, setFileDialogError] = useState("");
  const [canvasPreview, setCanvasPreview] = useState<GeneratedCanvasPreview | null>(null);
  const detail = useQuery(
    api.code.getProject,
    selectedProjectId ? { ...tenantScope, projectId: selectedProjectId, runLimit: 20 } : "skip",
  ) as CodeProjectDetail | undefined;

  useEffect(() => {
    if (!detail || loadedProjectId === detail.project._id) return;
    const nextFiles = detail.files
      .map((file) => ({ path: file.path, content: file.content, language: file.language }))
      .sort((a, b) => a.path.localeCompare(b.path));
    const loadedId = detail.project._id;
    const loadedDescription = detail.project.description || "";
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setFiles(nextFiles.length ? nextFiles : starterProjectFiles);
      setActivePath(nextFiles.some((file) => file.path === "main.odo") ? "main.odo" : nextFiles[0]?.path || "main.odo");
      setDescription(loadedDescription);
      setLastSavedFilesJson(stableFilesJson(nextFiles));
      setLoadedProjectId(loadedId);
    });
    return () => {
      cancelled = true;
    };
  }, [detail, loadedProjectId]);

  const activeFile = files.find((file) => file.path === activePath) || files[0] || starterProjectFiles[0];
  const compileResult = useMemo(() => compileCodeProject(files), [files]);
  const localTestResult = useMemo(() => runCodeProjectTests(files), [files]);
  const activeDiagnostics = compileResult.diagnostics.filter((item) => item.filePath === activeFile.path);
  const latestSuite = detail?.testSuites?.[0];
  const hasErrors = compileResult.diagnostics.some((item) => item.severity === "error");
  const canPublish = Boolean(selectedProjectId && !hasErrors && latestSuite?.passed);
  const hasUnsavedChanges = stableFilesJson(files) !== lastSavedFilesJson;
  const savedFileContentByPath = useMemo(() => {
    const savedFiles = safeJson<CodeProjectFile[]>(lastSavedFilesJson, []);
    return new Map(savedFiles.map((file) => [file.path, file.content]));
  }, [lastSavedFilesJson]);
  const activeProjectName = selectedProjectId ? detail?.project?.name || "Loading project" : "Unsaved extension";
  const activeStatus = selectedProjectId ? detail?.project?.status || "draft" : "draft";
  const webhookBase = detail?.project?.webhookSlug ? `/api/code/webhooks/${detail.project.webhookSlug}` : "/api/code/webhooks/{projectSlug}";
  const activeFileDirty = savedFileContentByPath.get(activeFile.path) !== activeFile.content;

  const writeTerminal = (label: string, value?: unknown) => {
    const timestamp = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date());
    const body = value === undefined ? "" : typeof value === "string" ? value : JSON.stringify(value, null, 2);
    setTerminalOpen(true);
    setTerminalOutput((current) => `${current ? `${current}\n\n` : ""}[${timestamp}] ${label}${body ? `\n${body}` : ""}`);
  };

  const replaceActiveFile = (content: string) => {
    setFiles((current) => current.map((file) => (file.path === activeFile.path ? { ...file, content } : file)));
  };

  const onCreateProject = () => {
    void runAction(
      "code-project:create",
      async () => {
        const result = await createProject({ ...tenantScope, name: "ODOGWU Extension" });
        setSelectedProjectId(result.projectId);
        setLoadedProjectId(null);
        setFiles(result.files);
        setActivePath("main.odo");
        setLastSavedFilesJson(stableFilesJson(result.files));
      },
      { pendingLabel: "Creating project...", successMessage: "Project workspace created." },
    );
  };

  const onSave = () => {
    void runAction(
      "code-project:save",
      async () => {
        let projectId = selectedProjectId;
        if (!projectId) {
          const result = await createProject({ ...tenantScope, name: "ODOGWU Extension", description: description.trim() || undefined });
          projectId = result.projectId;
          setSelectedProjectId(projectId);
        }
        await saveProjectFiles({ ...tenantScope, projectId, files, description: description.trim() || undefined });
        setLastSavedFilesJson(stableFilesJson(files));
        writeTerminal("save", `${files.length} file(s) synced to Convex.`);
      },
      { pendingLabel: "Syncing files...", successMessage: "Project files saved to Convex." },
    );
  };

  const onRunTests = () => {
    void runAction(
      "code-project:test",
      async () => {
        const result = await runProjectTestsRemote({ ...tenantScope, projectId: selectedProjectId || undefined, files });
        setLocalTestJson(JSON.stringify(result, null, 2));
        writeTerminal("test", result);
      },
      { pendingLabel: "Running project tests...", successMessage: "Project tests completed." },
    );
  };

  const onPublish = () => {
    if (!selectedProjectId) return;
    void runAction(
      "code-project:publish",
      async () => {
        await publishProject({ ...tenantScope, projectId: selectedProjectId });
        writeTerminal("publish", "Published bundle activated for webhooks and worker hooks.");
      },
      { pendingLabel: "Publishing project bundle...", successMessage: "Project published. Webhooks and worker hooks are active." },
    );
  };

  const onDoneCoding = () => {
    void runAction(
      "code-project:done",
      async () => {
        let projectId = selectedProjectId;
        if (!projectId) {
          const created = await createProject({ ...tenantScope, name: "ODOGWU Extension", description: description.trim() || undefined });
          projectId = created.projectId;
          setSelectedProjectId(projectId);
        }
        await saveProjectFiles({ ...tenantScope, projectId, files, description: description.trim() || undefined });
        setLastSavedFilesJson(stableFilesJson(files));
        writeTerminal("save", `${files.length} file(s) synced to Convex.`);
        const tests = await runProjectTestsRemote({ ...tenantScope, projectId, files });
        setLocalTestJson(JSON.stringify(tests, null, 2));
        writeTerminal("test", tests);
        if (!tests.passed) throw new Error("Tests failed. Fix inline diagnostics before publishing.");
        await publishProject({ ...tenantScope, projectId });
        writeTerminal("publish", "Done coding flow completed.");
      },
      {
        pendingLabel: "Saving, compiling, testing, publishing...",
        successMessage: "Done coding flow complete. Published bundle is ready for webhooks and the local worker.",
      },
    );
  };

  const onFormat = () => replaceActiveFile(formatOdogwuSource(activeFile.content));

  const openFileDialog = (mode: FileDialogMode) => {
    if (mode === "rename" && activeFile.path === "main.odo") return;
    const nextPath =
      mode === "create" ? "workflows/new-file.odo" : mode === "duplicate" ? duplicatePath(activeFile.path, files) : activeFile.path;
    setFileDialog({ mode, path: nextPath, sourcePath: activeFile.path });
    setFileDialogError("");
  };

  const closeFileDialog = () => {
    setFileDialog(null);
    setFileDialogError("");
  };

  const onSubmitFileDialog = () => {
    if (!fileDialog) return;
    const nextPath = fileDialog.path.trim().replace(/^\/+/, "");
    const pathError = validateOdogwuPath(
      nextPath,
      files,
      fileDialog.mode === "rename" ? fileDialog.sourcePath : undefined,
    );
    if (pathError) {
      setFileDialogError(pathError);
      return;
    }

    if (fileDialog.mode === "create") {
      setFiles((current) => [...current, { path: nextPath, content: defaultFileTemplate(nextPath), language: "odogwu" }]);
      setActivePath(nextPath);
      closeFileDialog();
      return;
    }

    const sourcePath = fileDialog.sourcePath || activeFile.path;
    const sourceFile = files.find((file) => file.path === sourcePath);
    if (!sourceFile) {
      setFileDialogError("Source file is no longer available.");
      return;
    }

    if (fileDialog.mode === "duplicate") {
      setFiles((current) => [...current, { ...sourceFile, path: nextPath }]);
      setActivePath(nextPath);
      closeFileDialog();
      return;
    }

    if (activeFile.path === "main.odo") return;
    setFiles((current) => current.map((file) => (file.path === sourcePath ? { ...file, path: nextPath } : file)));
    setActivePath(nextPath);
    closeFileDialog();
  };

  const onDeleteFile = () => {
    if (activeFile.path === "main.odo" || files.length <= 1) return;
    if (!window.confirm(`Delete ${activeFile.path}?`)) return;
    setFiles((current) => current.filter((file) => file.path !== activeFile.path));
    setActivePath("main.odo");
  };

  const onRestoreVersion = (filesJson: string) => {
    const restored = safeJson<CodeProjectFile[]>(filesJson, files);
    setFiles(restored);
    setActivePath(restored.some((file) => file.path === "main.odo") ? "main.odo" : restored[0]?.path || "main.odo");
  };

  const onToggleEnabled = (enabled: boolean) => {
    if (!selectedProjectId) return;
    void runAction(
      `code-project:enabled:${enabled}`,
      async () => {
        await setProjectEnabled({ ...tenantScope, projectId: selectedProjectId, enabled });
      },
      { pendingLabel: enabled ? "Enabling..." : "Disabling...", successMessage: enabled ? "Project enabled." : "Project disabled." },
    );
  };

  const saveRecord = getRecord("code-project:save");
  const testRecord = getRecord("code-project:test");
  const publishRecord = getRecord("code-project:publish");
  const doneRecord = getRecord("code-project:done");
  const createRecord = getRecord("code-project:create");

  const onGenerateCanvas = () => {
    setCanvasPreview(buildCanvasPreview({ files, bundle: compileResult, projectName: activeProjectName, webhookBase }));
  };
  const canvasIsStale = Boolean(canvasPreview && canvasPreview.hash !== stableFilesJson(files));
  const outlineItems = [
    ...compileResult.manifest.handlers.map((item) => ({
      key: `${item.kind}:${item.name}:${item.filePath}`,
      label: `${item.kind} ${item.name}`,
      filePath: item.filePath,
      line: item.line,
    })),
    ...compileResult.manifest.functions.map((item) => ({
      key: `function:${item.name}:${item.filePath}`,
      label: `function ${item.name}`,
      filePath: item.filePath,
      line: item.line,
    })),
    ...compileResult.manifest.behaviorExtensions.map((item) => ({
      key: `${item.kind}:${item.name}:${item.filePath}`,
      label: `${item.kind} ${item.name}`,
      filePath: item.filePath,
      line: item.line,
    })),
  ];

  return (
    <section className="code-lab-shell">
      <header className="code-lab-topbar">
        <div className="code-lab-window-controls">
          <button className="btn btn-ghost" type="button" onClick={() => router.back()}>
            Back
          </button>
          <div>
            <h2>Code Lab</h2>
            <p>{activeProjectName} · {activeStatus} · {activeFile.path}</p>
          </div>
        </div>
        <div className="code-lab-actions">
          <button className="btn btn-ghost" type="button" onClick={() => router.push("/code/docs")}>
            Docs
          </button>
          <button className="btn btn-ghost" type="button" onClick={() => {
            setFiles(starterProjectFiles);
            setActivePath("main.odo");
            writeTerminal("starter", "Starter project loaded into the workspace.");
          }}>
            Starter
          </button>
          <button className="btn btn-ghost" type="button" onClick={onFormat}>
            Format
          </button>
          <button className="btn btn-secondary" type="button" onClick={onRunTests} disabled={testRecord.pending}>
            {testRecord.pending ? "Testing..." : "Run tests"}
          </button>
          <button className="btn btn-secondary" type="button" onClick={onSave} disabled={saveRecord.pending}>
            {saveRecord.pending ? "Saving..." : "Save all"}
          </button>
          <button className="btn btn-primary" type="button" onClick={onPublish} disabled={!canPublish || publishRecord.pending}>
            {publishRecord.pending ? "Publishing..." : "Publish"}
          </button>
          <button className="btn btn-primary" type="button" onClick={onDoneCoding} disabled={doneRecord.pending}>
            {doneRecord.pending ? "Finishing..." : "Done coding"}
          </button>
        </div>
      </header>

      <ActionNotices notices={notices} onDismiss={dismissNotice} />

      <div className="code-lab-grid">
        <aside className="code-lab-sidebar">
          <div className="code-lab-sidebar-head">
            <span className="queue-meta">Workspace</span>
            {projects === undefined ? <LoadingIndicator label="Loading..." /> : null}
          </div>
          <button className="btn btn-secondary code-lab-wide-button" type="button" onClick={onCreateProject} disabled={createRecord.pending}>
            {createRecord.pending ? "Creating..." : "New project"}
          </button>

          <div className="code-lab-sidebar-section">Projects</div>
          {(projects || []).map((project) => (
            <button
              className={`code-program-row ${selectedProjectId === project._id ? "code-program-row-active" : ""}`}
              key={project._id}
              type="button"
              onClick={() => {
                setSelectedProjectId(project._id);
                setLoadedProjectId(null);
              }}
            >
              <strong>{project.name}</strong>
              <span>{project.status} · {formatDate(project.updatedAt)}</span>
            </button>
          ))}

          <div className="code-lab-sidebar-section">Files</div>
          <div className="code-file-actions">
            <button type="button" onClick={() => openFileDialog("create")}>New</button>
            <button type="button" onClick={() => openFileDialog("rename")} disabled={activeFile.path === "main.odo"}>Rename</button>
            <button type="button" onClick={() => openFileDialog("duplicate")}>Copy</button>
            <button type="button" onClick={onDeleteFile} disabled={activeFile.path === "main.odo"}>Delete</button>
          </div>
          {[...files].sort((a, b) => (a.path === "main.odo" ? -1 : b.path === "main.odo" ? 1 : a.path.localeCompare(b.path))).map((file) => (
            <button
              className={`code-file-row ${activeFile.path === file.path ? "code-file-row-active" : ""}`}
              key={file.path}
              type="button"
              onClick={() => setActivePath(file.path)}
            >
              <strong>{file.path}</strong>
              <span>
                {file.path === "main.odo" ? "entry" : "module"} · {savedFileContentByPath.get(file.path) === file.content ? "saved" : "modified"}
              </span>
            </button>
          ))}
        </aside>

        <main className="code-lab-main">
          <div className="code-lab-menu-bar" role="toolbar" aria-label="Code editor menu">
            <div className="code-lab-menu-group">
              <span>File</span>
              <button type="button" onClick={() => openFileDialog("create")}>New</button>
              <button type="button" onClick={onSave} disabled={saveRecord.pending}>{saveRecord.pending ? "Saving" : "Save"}</button>
              <button type="button" onClick={() => openFileDialog("rename")} disabled={activeFile.path === "main.odo"}>Rename</button>
              <button type="button" onClick={() => openFileDialog("duplicate")}>Duplicate</button>
            </div>
            <div className="code-lab-menu-group">
              <span>Edit</span>
              <button type="button" onClick={onFormat}>Format</button>
              <button type="button" onClick={() => {
                setFiles(starterProjectFiles);
                setActivePath("main.odo");
                writeTerminal("starter", "Starter project loaded into the workspace.");
              }}>Starter</button>
              <button type="button" onClick={onGenerateCanvas}>Canvas</button>
              <button type="button" onClick={() => router.push("/code/docs")}>Docs</button>
            </div>
            <div className="code-lab-menu-group">
              <span>Run</span>
              <button type="button" onClick={onRunTests} disabled={testRecord.pending}>{testRecord.pending ? "Testing" : "Tests"}</button>
              <button type="button" onClick={onPublish} disabled={!canPublish || publishRecord.pending}>{publishRecord.pending ? "Publishing" : "Publish"}</button>
              <button type="button" onClick={onDoneCoding} disabled={doneRecord.pending}>{doneRecord.pending ? "Running" : "Done"}</button>
            </div>
            <div className="code-lab-menu-group code-lab-menu-group-terminal">
              <span>Terminal</span>
              <button type="button" onClick={() => {
                setLocalTestJson(JSON.stringify(localTestResult, null, 2));
                writeTerminal("preview", localTestResult);
              }}>Preview</button>
              <button type="button" onClick={() => setTerminalOpen((open) => !open)}>{terminalOpen ? "Hide" : "Show"}</button>
              <button type="button" onClick={() => {
                setLocalTestJson("");
                setTerminalOutput("");
              }} disabled={!localTestJson && !terminalOutput}>Clear</button>
            </div>
          </div>
          <div className="code-lab-editor-tabbar">
            <span>{activeFile.path}</span>
            <em>{activeFileDirty ? "modified" : "synced"} · {hasErrors ? `${compileResult.diagnostics.length} diagnostics` : "compiled bundle ready"}</em>
          </div>
          <CodeEditor
            value={activeFile.content}
            diagnostics={activeDiagnostics}
            filePaths={files.map((file) => file.path).filter((path) => path !== activeFile.path)}
            onChange={replaceActiveFile}
            onSave={onSave}
            onRunTests={onRunTests}
            onPublish={onPublish}
            onFormat={onFormat}
          />
          {terminalOpen ? (
            <div className="code-terminal-panel" aria-label="Code Lab terminal">
              <header>
                <strong>Terminal</strong>
                <div>
                  <button type="button" onClick={() => setTerminalOutput("")} disabled={!terminalOutput}>Clear</button>
                  <button type="button" onClick={() => setTerminalOpen(false)}>Close</button>
                </div>
              </header>
              <pre>{terminalOutput || "No output."}</pre>
            </div>
          ) : null}
        </main>

        <aside className="code-lab-inspector">
          {compileResult.diagnostics.length ? (
            <section>
              <h3>Problems</h3>
              <pre className="tool-json-output">{compileResult.diagnostics.map(diagnosticLine).join("\n")}</pre>
            </section>
          ) : null}

          {compileResult.manifest.webhooks.length ? (
            <section>
              <h3>Endpoints</h3>
              <div className="code-webhook-list">
                {compileResult.manifest.webhooks.map((webhook) => (
                  <button key={webhook.name} type="button" onClick={() => setActivePath(webhook.filePath)}>
                    <strong>POST {webhookBase}/{webhook.name}</strong>
                    <span>{webhook.filePath}:{webhook.line}</span>
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          {outlineItems.length ? (
            <section>
              <h3>Outline</h3>
              <div className="code-outline-list">
                {outlineItems.map((item) => (
                  <button key={item.key} type="button" onClick={() => setActivePath(item.filePath)}>
                    <strong>{item.label}</strong>
                    <span>{item.filePath}:{item.line}</span>
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          <section>
            <h3>Canvas</h3>
            <button className="btn btn-secondary code-lab-wide-button" type="button" onClick={onGenerateCanvas}>
              {canvasPreview ? "Regenerate canvas" : "Generate canvas"}
            </button>
            {canvasPreview ? (
              <div className={`code-generated-canvas ${canvasIsStale ? "code-generated-canvas-stale" : ""}`}>
                <div className="code-generated-canvas-head">
                  <strong>{canvasPreview.title}</strong>
                  <span>{canvasIsStale ? "stale" : "current"}</span>
                </div>
                <ul className="code-canvas-summary">
                  {canvasPreview.summary.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
                <div className="code-canvas-lanes">
                  {canvasPreview.lanes.map((lane) => (
                    <article key={lane.title}>
                      <h4>{lane.title}</h4>
                      {lane.items.length ? (
                        lane.items.slice(0, 10).map((item) => (
                          <button key={`${lane.title}:${item.label}:${item.detail}`} type="button" onClick={() => item.filePath && setActivePath(item.filePath)}>
                            <strong>{item.label}</strong>
                            <span>{item.detail}</span>
                          </button>
                        ))
                      ) : (
                        <p>None</p>
                      )}
                    </article>
                  ))}
                </div>
                <details className="code-mermaid-source">
                  <summary>Mermaid source</summary>
                  <pre>{canvasPreview.mermaid}</pre>
                </details>
              </div>
            ) : null}
          </section>

          {detail?.versions?.length ? (
            <section>
              <h3>Snapshots</h3>
              <div className="code-version-list">
                {detail.versions.slice(0, 6).map((version) => (
                  <button key={version._id} type="button" onClick={() => onRestoreVersion(version.filesJson)}>
                    <strong>{version.status} · {formatDate(version.createdAt)}</strong>
                    <span>{version.versionLabel}</span>
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          <section>
            <h3>Runs</h3>
            {detail?.project?.status === "published" ? (
              <button className="btn btn-ghost" type="button" onClick={() => onToggleEnabled(false)}>Disable</button>
            ) : selectedProjectId ? (
              <button className="btn btn-ghost" type="button" onClick={() => onToggleEnabled(true)} disabled={!detail?.project?.activeVersionId}>Enable</button>
            ) : null}
            <div className="code-lab-run-list">
              {(detail?.runs || []).slice(0, 6).map((run) => (
                <p key={run._id}>{run.status} · {run.handlerName || run.eventName} · {formatDate(run.createdAt)}</p>
              ))}
            </div>
          </section>

        </aside>
      </div>

      <footer className="code-lab-statusbar">
        <span>ODOGWU DSL project</span>
        <span>{files.length} files</span>
        <span>{activeFile.content.split("\n").length} lines active</span>
        <span>{compileResult.manifest.webhooks.length} webhooks</span>
        <span>{compileResult.manifest.behaviorExtensions.length} behavior overlays</span>
        <span>{compileResult.manifest.sdkCalls.length} SDK calls</span>
        <span>{hasUnsavedChanges ? "modified" : "saved"}</span>
        <span>{localTestResult.passed ? "tests ok" : "tests failing"}</span>
        <span>{terminalOpen ? "terminal open" : "terminal hidden"}</span>
      </footer>

      <UIModal
        open={Boolean(fileDialog)}
        onClose={closeFileDialog}
        title={
          fileDialog?.mode === "create"
            ? "New File"
            : fileDialog?.mode === "duplicate"
              ? "Duplicate File"
              : "Rename File"
        }
      >
        <form
          className="code-file-dialog"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmitFileDialog();
          }}
        >
          <label>
            <span>Path</span>
            <input
              autoFocus
              value={fileDialog?.path || ""}
              onChange={(event) => {
                setFileDialog((current) => (current ? { ...current, path: event.target.value } : current));
                setFileDialogError("");
              }}
              placeholder="workflows/reply-router.odo"
            />
          </label>
          {fileDialogError ? <p className="code-file-dialog-error">{fileDialogError}</p> : null}
          <div className="code-file-dialog-actions">
            <button className="btn btn-ghost" type="button" onClick={closeFileDialog}>
              Cancel
            </button>
            <button className="btn btn-primary" type="submit">
              {fileDialog?.mode === "create" ? "Create" : fileDialog?.mode === "duplicate" ? "Duplicate" : "Rename"}
            </button>
          </div>
        </form>
      </UIModal>
    </section>
  );
}
