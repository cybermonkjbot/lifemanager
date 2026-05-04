"use client";

import { ActionNotices } from "@/components/action-notices";
import { confirmAppDialog } from "@/components/app-confirm-dialog";
import { LoadingIndicator } from "@/components/loading-state";
import { useTenantScopeArgs } from "@/components/tenant-scope-provider";
import { UIModal } from "@/components/ui-modal";
import {
  CODE_SDK_REGISTRY,
  compileCodeProject,
  runCodeProjectTests,
  type CodeProjectBundle,
  type CodeProjectFile,
  type CodeProjectTestResult,
  type ProjectDiagnostic,
} from "@/code-runtime";
import { useActionStateRegistry } from "@/lib/ui/action-state";
import { autocompletion, CompletionContext } from "@codemirror/autocomplete";
import { defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { linter } from "@codemirror/lint";
import { EditorState, RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, hoverTooltip, keymap, lineNumbers, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useAction, useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import type { ButtonHTMLAttributes, MouseEvent, MutableRefObject, ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

type FileDialogMode = "create" | "rename" | "duplicate";
type FileDialogState = {
  mode: FileDialogMode;
  path: string;
  sourcePath?: string;
} | null;

type ProjectContextMenuState = {
  projectId: Id<"codeProjects">;
  x: number;
  y: number;
} | null;

type CodeIconName =
  | "arrowLeft"
  | "bookOpen"
  | "check"
  | "copy"
  | "diagram"
  | "eye"
  | "eyeOff"
  | "filePlus"
  | "format"
  | "play"
  | "rename"
  | "save"
  | "spark"
  | "terminal"
  | "trash"
  | "upload"
  | "wand"
  | "x";

function CodeIcon({ name }: { name: CodeIconName }) {
  const common = {
    "aria-hidden": true,
    fill: "none",
    focusable: false,
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 1.8,
    viewBox: "0 0 24 24",
  };

  switch (name) {
    case "arrowLeft":
      return (
        <svg {...common}>
          <path d="M19 12H5" />
          <path d="m12 19-7-7 7-7" />
        </svg>
      );
    case "bookOpen":
      return (
        <svg {...common}>
          <path d="M12 6.5A5.5 5.5 0 0 0 6.5 4H4v15h2.5A5.5 5.5 0 0 1 12 21" />
          <path d="M12 6.5A5.5 5.5 0 0 1 17.5 4H20v15h-2.5A5.5 5.5 0 0 0 12 21" />
          <path d="M12 6.5V21" />
        </svg>
      );
    case "check":
      return (
        <svg {...common}>
          <path d="m5 13 4 4L19 7" />
        </svg>
      );
    case "copy":
      return (
        <svg {...common}>
          <rect x="8" y="8" width="11" height="11" rx="2" />
          <path d="M5 16H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      );
    case "diagram":
      return (
        <svg {...common}>
          <rect x="4" y="4" width="6" height="5" rx="1.4" />
          <rect x="14" y="15" width="6" height="5" rx="1.4" />
          <path d="M10 6.5h3a3 3 0 0 1 3 3V15" />
          <path d="M7 9v3a3 3 0 0 0 3 3h4" />
        </svg>
      );
    case "eye":
      return (
        <svg {...common}>
          <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
          <circle cx="12" cy="12" r="2.5" />
        </svg>
      );
    case "eyeOff":
      return (
        <svg {...common}>
          <path d="m3 3 18 18" />
          <path d="M10.6 10.6a2.5 2.5 0 0 0 2.8 2.8" />
          <path d="M7.1 7.6C4.2 9.2 2.5 12 2.5 12s3.5 6 9.5 6c1.5 0 2.8-.4 4-1" />
          <path d="M20.2 15.2c.8-.8 1.3-1.6 1.3-1.6S18 6 12 6c-.8 0-1.6.1-2.3.3" />
        </svg>
      );
    case "filePlus":
      return (
        <svg {...common}>
          <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
          <path d="M14 3v5h5" />
          <path d="M12 11v6" />
          <path d="M9 14h6" />
        </svg>
      );
    case "format":
      return (
        <svg {...common}>
          <path d="M4 6h16" />
          <path d="M4 12h10" />
          <path d="M4 18h7" />
          <path d="m16 16 2 2 3-4" />
        </svg>
      );
    case "play":
      return (
        <svg {...common}>
          <path d="M7 5v14l12-7Z" />
        </svg>
      );
    case "rename":
      return (
        <svg {...common}>
          <path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17Z" />
          <path d="m14 8 3 3" />
        </svg>
      );
    case "save":
      return (
        <svg {...common}>
          <path d="M5 4h12l2 2v14H5Z" />
          <path d="M8 4v6h8V4" />
          <path d="M8 20v-6h8v6" />
        </svg>
      );
    case "spark":
      return (
        <svg {...common}>
          <path d="M12 3 10.4 8.4 5 10l5.4 1.6L12 17l1.6-5.4L19 10l-5.4-1.6Z" />
          <path d="M5 16.5 4.3 19 2 19.7 4.3 20.4 5 23l.7-2.6L8 19.7 5.7 19Z" />
        </svg>
      );
    case "terminal":
      return (
        <svg {...common}>
          <path d="m4 7 5 5-5 5" />
          <path d="M11 17h9" />
        </svg>
      );
    case "trash":
      return (
        <svg {...common}>
          <path d="M4 7h16" />
          <path d="M10 11v6" />
          <path d="M14 11v6" />
          <path d="M6 7l1 14h10l1-14" />
          <path d="M9 7V4h6v3" />
        </svg>
      );
    case "upload":
      return (
        <svg {...common}>
          <path d="M12 16V4" />
          <path d="m7 9 5-5 5 5" />
          <path d="M5 20h14" />
        </svg>
      );
    case "wand":
      return (
        <svg {...common}>
          <path d="m4 20 12-12" />
          <path d="m14 6 4 4" />
          <path d="M6 4v3" />
          <path d="M4.5 5.5h3" />
          <path d="M19 14v3" />
          <path d="M17.5 15.5h3" />
        </svg>
      );
    case "x":
      return (
        <svg {...common}>
          <path d="M18 6 6 18" />
          <path d="m6 6 12 12" />
        </svg>
      );
  }
}

type CodeIconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: CodeIconName;
  label: string;
  children?: ReactNode;
};

function CodeIconButton({ icon, label, children, className, title, ...buttonProps }: CodeIconButtonProps) {
  const resolvedClassName = ["code-icon-button", children ? "code-icon-button-with-label" : "", className]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      {...buttonProps}
      aria-label={buttonProps["aria-label"] || label}
      className={resolvedClassName}
      title={title || label}
      type={buttonProps.type || "button"}
    >
      <CodeIcon name={icon} />
      {children ? <span>{children}</span> : <span className="sr-only">{label}</span>}
    </button>
  );
}

function cleanProjectFiles(name = "ODOGWU Extension"): CodeProjectFile[] {
  const projectName = name.replace(/[^A-Za-z0-9_]/g, "") || "ODOGWUExtension";
  return [
    {
      path: "main.odo",
      language: "odogwu",
      content: `project ${projectName} version "1.0"\n\n`,
    },
  ];
}

const starterProjectFiles: CodeProjectFile[] = [
  {
    path: "main.odo",
    language: "odogwu",
    content: `# Lead Desk keeps paid consults, inbound leads, and personal replies sane.
project LeadDesk version "1.0"

import "./messages.odo"
import "./webhooks/paystack.odo"
import "./automations/cross-platform.odo"
import "./behavior/language.odo"

use webhook
use http
use ai
use followups
use messages
use platform
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
    path: "automations/cross-platform.odo",
    language: "odogwu",
    content: `# Cross-platform reactions and routing stay reviewable by default.
export rule AnyPlatformFanout
on message.received as msg
do
  platform.broadcast(
    targets: "all",
    text: "Mirror this event everywhere connected."
  )
  platform.relay(targets: "all")
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
  "whatsapp.message.received": "Event fired when a connected WhatsApp account receives a message.",
  "instagram.message.received": "Event fired when a connected Instagram account receives a message.",
  "imessage.message.received": "Event fired when a connected iMessage account receives a message.",
  "telegram.message.received": "Event fired when a connected Telegram account receives a message.",
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
  platform: "SDK module for cross-platform sends, drafts, reactions, mirrors, and routing.",
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
  "platform.send": "Queue a message through a specific connected platform.",
  "platform.draft": "Create a reviewable draft for a specific connected platform.",
  "platform.preview": "Preview a cross-platform message without queueing.",
  "platform.react": "React through a target platform adapter.",
  "platform.mirror": "Mirror the current event into another platform workflow.",
  "platform.route": "Route the current event into a cross-platform workflow.",
  "platform.broadcast": "Fan out the current event or message to multiple connected platforms.",
  "platform.relay": "Relay the current event from its source platform to one or more target platforms.",
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

const hoverDocLinks: Record<string, string> = {
  project: "/code/docs#language",
  program: "/code/docs#language",
  import: "/code/docs#language",
  export: "/code/docs#exports",
  rule: "/code/docs#exports",
  webhook: "/code/docs#webhooks",
  function: "/code/docs#exports",
  heuristic: "/code/docs#behavior",
  lexicon: "/code/docs#behavior",
  prompt: "/code/docs#behavior",
  version: "/code/docs#language",
  use: "/code/docs#sdk",
  on: "/code/docs#events",
  when: "/code/docs#language",
  and: "/code/docs#language",
  between: "/code/docs#language",
  do: "/code/docs#language",
  end: "/code/docs#language",
  test: "/code/docs#publish",
  given: "/code/docs#publish",
  expect: "/code/docs#publish",
  "message.received": "/code/docs#events-message-received",
  "webhook.received": "/code/docs#events-webhook-received",
  chat: "/code/docs#sdk",
  ai: "/code/docs#sdk",
  followups: "/code/docs#sdk",
  memory: "/code/docs#sdk",
  settings: "/code/docs#sdk",
  outreach: "/code/docs#sdk",
  runtime: "/code/docs#sdk",
  time: "/code/docs#sdk",
  http: "/code/docs#sdk",
  orchestrator: "/code/docs#sdk",
  messages: "/code/docs#sdk-messages",
  platform: "/code/docs#cross-platform",
  account: "/code/docs#sdk",
  worker: "/code/docs#sdk",
  heuristics: "/code/docs#behavior",
  prompts: "/code/docs#behavior",
  "whatsapp.message.received": "/code/docs#events-platform-message-received",
  "instagram.message.received": "/code/docs#events-platform-message-received",
  "imessage.message.received": "/code/docs#events-platform-message-received",
  "telegram.message.received": "/code/docs#events-platform-message-received",
  "http.post": "/code/docs#safety",
  "http.get": "/code/docs#safety",
  "http.fetch": "/code/docs#safety",
  "http.request": "/code/docs#safety",
  "webhook.reply": "/code/docs#webhooks",
  "webhook.verify_secret": "/code/docs#webhooks",
  "orchestrator.ask": "/code/docs#sdk",
  "orchestrator.run_tool": "/code/docs#sdk",
  "messages.send": "/code/docs#sdk-messages",
  "messages.draft": "/code/docs#sdk-messages",
  "messages.preview": "/code/docs#sdk-messages",
  "platform.send": "/code/docs#cross-platform",
  "platform.draft": "/code/docs#cross-platform",
  "platform.preview": "/code/docs#cross-platform",
  "platform.react": "/code/docs#cross-platform",
  "platform.mirror": "/code/docs#cross-platform",
  "platform.route": "/code/docs#cross-platform",
  "platform.broadcast": "/code/docs#cross-platform",
  "platform.relay": "/code/docs#cross-platform",
  "account.settings.patch": "/code/docs#sdk",
  "account.behavior.set": "/code/docs#sdk",
  "account.behavior_set": "/code/docs#sdk",
  "worker.extend": "/code/docs#sdk",
  "worker.schedule": "/code/docs#sdk",
  "worker.run_local": "/code/docs#safety",
  "heuristics.pattern": "/code/docs#behavior",
  "heuristics.score": "/code/docs#behavior",
  "heuristics.mark_intent": "/code/docs#behavior",
  "heuristics.block": "/code/docs#behavior",
  "lexicon.term": "/code/docs#behavior",
  "lexicon.phrase": "/code/docs#behavior",
  "lexicon.alias": "/code/docs#behavior",
  "prompts.append": "/code/docs#behavior",
  "prompts.prepend": "/code/docs#behavior",
  "prompts.derive": "/code/docs#behavior",
  "prompts.set_context": "/code/docs#behavior",
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
const eventSet = new Set([
  "message.received",
  "webhook.received",
  "whatsapp.message.received",
  "instagram.message.received",
  "imessage.message.received",
  "telegram.message.received",
]);
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
  "platform",
  "account",
  "worker",
  "heuristics",
  "lexicon",
  "prompts",
]);
const sdkCallSet = new Set(Object.keys(hoverDocs).filter((key) => key.includes(".")));
const tokenPattern = /#[^\n]*|"(?:[^"\\]|\\.)*"|\b\d+(?:\.\d+)?\b|==|[A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)*/g;

function sdkTypeDoc(token: string) {
  const [moduleName, ...operationParts] = token.split(".");
  const operationName = operationParts.join(".");
  const operation = CODE_SDK_REGISTRY[moduleName]?.operations[operationName];
  if (!operation) return "";
  const args = operation.requiredArgs?.length ? `Args: ${operation.requiredArgs.join(", ")}` : "Args: none";
  return `${args}. Effect: ${operation.danger}.`;
}

function moduleTypeDoc(token: string) {
  const moduleSpec = CODE_SDK_REGISTRY[token];
  if (!moduleSpec) return "";
  const operations = Object.keys(moduleSpec.operations);
  return operations.length ? `Operations: ${operations.slice(0, 10).join(", ")}.` : "No direct operations.";
}

function tokenClass(token: string) {
  if (token.startsWith("#")) return "cm-odogwu-comment";
  if (token.startsWith('"')) return "cm-odogwu-string";
  if (/^\d/.test(token)) return "cm-odogwu-number";
  if (token === "==") return "cm-odogwu-operator";
  if (keywordSet.has(token)) return "cm-odogwu-keyword";
  if (eventSet.has(token)) return "cm-odogwu-event";
  if (sdkCallSet.has(token)) return "cm-odogwu-call";
  if (sdkModuleSet.has(token)) return "cm-odogwu-module";
  if (/^(msg|hook|payload|thread|text|kind|at|title|due|value|phone|sourceHash|provider|platform|via|to|emoji|contact|targets)$/.test(token)) return "cm-odogwu-property";
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
  const typeDoc = sdkTypeDoc(token) || moduleTypeDoc(token);
  const docLink = hoverDocLinks[token];
  if (!doc && !typeDoc) return null;
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
      body.textContent = doc || "ODOGWU symbol.";
      dom.append(title, body);
      if (typeDoc) {
        const type = document.createElement("p");
        type.className = "code-hover-type";
        type.textContent = typeDoc;
        dom.append(type);
      }
      if (docLink) {
        const link = document.createElement("a");
        link.href = docLink;
        link.textContent = "Open docs";
        link.className = "code-hover-doc-link";
        dom.append(link);
      }
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
  generatedByAi: boolean;
  lanes: Array<{
    title: string;
    items: Array<{ label: string; detail: string; filePath?: string }>;
  }>;
};

function buildCanvasPreview(args: {
  files: CodeProjectFile[];
  bundle: CodeProjectBundle;
  projectName: string;
  webhookBase: string;
  aiCanvas: {
    title?: string;
    summary?: string[];
    mermaid: string;
    generatedByAi?: boolean;
  };
}): GeneratedCanvasPreview {
  const { files, bundle, webhookBase, aiCanvas } = args;
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
    ...bundle.manifest.platformActions.map((call) => ({
      label: call.call,
      detail: `${call.crossPlatform ? "cross-platform" : "platform"} ${call.targetProvider || ""}`.trim() || `${call.filePath}:${call.line}`,
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
    `${bundle.manifest.webhooks.length} webhook endpoint(s), ${bundle.manifest.outboundHttp.length} outbound API call(s), ${bundle.manifest.messageSends.length} message operation(s), ${bundle.manifest.crossPlatformActions.length} cross-platform action(s).`,
    `${bundle.manifest.behaviorExtensions.length} tenant behavior overlay(s) can influence heuristics, lexicons, and prompt derivation after publish.`,
  ];

  return {
    hash: stableFilesJson(files),
    title: aiCanvas.title || "AI canvas",
    summary: aiCanvas.summary?.length ? aiCanvas.summary : summary,
    mermaid: aiCanvas.mermaid,
    generatedByAi: Boolean(aiCanvas.generatedByAi),
    lanes,
  };
}

function diagnosticLine(diagnostic: ProjectDiagnostic) {
  return `${diagnostic.filePath}:${diagnostic.line}:${diagnostic.column} ${diagnostic.severity} ${diagnostic.message}`;
}

function formatProjectTestOutput(result: CodeProjectTestResult & { testSuiteId?: string }) {
  const lines = [
    result.passed ? "Code Lab tests passed." : "Code Lab tests failed.",
    `${result.bundle.files.length} file(s) checked, ${result.bundle.manifest.handlers.length} handler(s), ${result.bundle.manifest.sdkCalls.length} SDK call(s).`,
  ];

  if (result.testSuiteId) lines.push(`suite ${result.testSuiteId}`);

  if (result.diagnostics.length) {
    lines.push("");
    lines.push(...result.diagnostics.map(diagnosticLine));
  } else {
    lines.push("No diagnostics.");
  }

  if (result.trace.length) {
    lines.push("");
    lines.push("Trace:");
    lines.push(...result.trace.map((item) => `${item.status.toUpperCase()} ${item.summary}`));
  }

  return lines.join("\n");
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

type InlineAiSuggestion = { text: string; from: number } | null;

const setInlineAiSuggestionEffect = StateEffect.define<InlineAiSuggestion>();

class InlineAiSuggestionWidget extends WidgetType {
  constructor(
    readonly suggestion: string,
    readonly onAccept: () => void,
    readonly onDismiss: () => void,
  ) {
    super();
  }

  toDOM() {
    const wrap = document.createElement("span");
    wrap.className = "code-ai-inline-suggestion";
    const text = document.createElement("span");
    text.textContent = this.suggestion.replace(/\n/g, " ");
    const accept = document.createElement("button");
    accept.type = "button";
    accept.textContent = "Tab";
    accept.title = "Accept AI suggestion";
    accept.addEventListener("mousedown", (event) => {
      event.preventDefault();
      this.onAccept();
    });
    const dismiss = document.createElement("button");
    dismiss.type = "button";
    dismiss.textContent = "Esc";
    dismiss.title = "Dismiss AI suggestion";
    dismiss.addEventListener("mousedown", (event) => {
      event.preventDefault();
      this.onDismiss();
    });
    wrap.append(text, accept, dismiss);
    return wrap;
  }

  ignoreEvent() {
    return false;
  }
}

function inlineAiSuggestionExtension(args: {
  acceptRef: MutableRefObject<() => boolean>;
  dismissRef: MutableRefObject<() => boolean>;
}) {
  return StateField.define<InlineAiSuggestion>({
    create: () => null,
    update(value, transaction) {
      for (const effect of transaction.effects) {
        if (effect.is(setInlineAiSuggestionEffect)) return effect.value;
      }
      if (transaction.docChanged) return null;
      return value;
    },
    provide: (field) =>
      EditorView.decorations.from(field, (suggestion) => {
        if (!suggestion?.text) return Decoration.none;
        return Decoration.set([
          Decoration.widget({
            widget: new InlineAiSuggestionWidget(
              suggestion.text,
              () => args.acceptRef.current(),
              () => args.dismissRef.current(),
            ),
            side: 1,
          }).range(suggestion.from),
        ]);
      }),
  });
}

type CodeEditorProps = {
  value: string;
  diagnostics: ProjectDiagnostic[];
  filePaths: string[];
  aiSuggestion: string | null;
  onChange: (next: string) => void;
  onSave: () => void;
  onRunTests: () => void;
  onPublish: () => void;
  onFormat: () => void;
  onCursorChange: (offset: number) => void;
  onAcceptAiSuggestion: () => boolean;
  onDismissAiSuggestion: () => boolean;
};

function CodeEditor({
  value,
  diagnostics,
  filePaths,
  aiSuggestion,
  onChange,
  onSave,
  onRunTests,
  onPublish,
  onFormat,
  onCursorChange,
  onAcceptAiSuggestion,
  onDismissAiSuggestion,
}: CodeEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  const onRunTestsRef = useRef(onRunTests);
  const onPublishRef = useRef(onPublish);
  const onFormatRef = useRef(onFormat);
  const onCursorChangeRef = useRef(onCursorChange);
  const acceptAiSuggestionRef = useRef(onAcceptAiSuggestion);
  const dismissAiSuggestionRef = useRef(onDismissAiSuggestion);
  const diagnosticsRef = useRef(diagnostics);
  const filePathsRef = useRef(filePaths);
  const initialValueRef = useRef(value);

  useEffect(() => {
    onChangeRef.current = onChange;
    onSaveRef.current = onSave;
    onRunTestsRef.current = onRunTests;
    onPublishRef.current = onPublish;
    onFormatRef.current = onFormat;
    onCursorChangeRef.current = onCursorChange;
    acceptAiSuggestionRef.current = onAcceptAiSuggestion;
    dismissAiSuggestionRef.current = onDismissAiSuggestion;
    diagnosticsRef.current = diagnostics;
    filePathsRef.current = filePaths;
  }, [diagnostics, filePaths, onAcceptAiSuggestion, onChange, onCursorChange, onDismissAiSuggestion, onFormat, onPublish, onRunTests, onSave]);

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
            { key: "Tab", run: () => acceptAiSuggestionRef.current() },
            { key: "Escape", run: () => dismissAiSuggestionRef.current() },
          ]),
          syntaxHighlighting(defaultHighlightStyle),
          odogwuSyntaxHighlighter,
          hoverTooltip(odogwuHoverTooltip),
          inlineAiSuggestionExtension({
            acceptRef: acceptAiSuggestionRef,
            dismissRef: dismissAiSuggestionRef,
          }),
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
            if (update.selectionSet || update.docChanged) onCursorChangeRef.current(update.state.selection.main.head);
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

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: setInlineAiSuggestionEffect.of(
        aiSuggestion ? { text: aiSuggestion, from: view.state.selection.main.head } : null,
      ),
    });
  }, [aiSuggestion]);

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
  const renameProject = useMutation(api.code.renameProject);
  const deleteProject = useMutation(api.code.deleteProject);
  const saveProjectFiles = useMutation(api.code.saveProjectFiles);
  const publishProject = useMutation(api.code.publishProject);
  const setProjectEnabled = useMutation(api.code.setProjectEnabled);
  const runProjectTestsRemote = useAction(api.code.runProjectTests);
  const { runAction, getRecord, notices, dismissNotice } = useActionStateRegistry();

  const [selectedProjectId, setSelectedProjectId] = useState<Id<"codeProjects"> | null>(null);
  const [loadedProjectId, setLoadedProjectId] = useState<Id<"codeProjects"> | null>(null);
  const [files, setFiles] = useState<CodeProjectFile[]>(() => cleanProjectFiles());
  const [activePath, setActivePath] = useState("main.odo");
  const [editingProjectId, setEditingProjectId] = useState<Id<"codeProjects"> | null>(null);
  const [editingProjectName, setEditingProjectName] = useState("");
  const [lastSavedFilesJson, setLastSavedFilesJson] = useState("");
  const [description, setDescription] = useState("");
  const [localTestJson, setLocalTestJson] = useState("");
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [terminalOutput, setTerminalOutput] = useState("");
  const [fileDialog, setFileDialog] = useState<FileDialogState>(null);
  const [fileDialogError, setFileDialogError] = useState("");
  const [canvasPreview, setCanvasPreview] = useState<GeneratedCanvasPreview | null>(null);
  const [cursorOffset, setCursorOffset] = useState(0);
  const [aiSuggestion, setAiSuggestion] = useState<string | null>(null);
  const [projectContextMenu, setProjectContextMenu] = useState<ProjectContextMenuState>(null);
  const detail = useQuery(
    api.code.getProject,
    selectedProjectId ? { ...tenantScope, projectId: selectedProjectId, runLimit: 20 } : "skip",
  ) as CodeProjectDetail | undefined;

  const selectActivePath = (path: string) => {
    setActivePath(path);
    setCursorOffset(0);
    setAiSuggestion(null);
  };

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
      setFiles(nextFiles.length ? nextFiles : cleanProjectFiles(detail.project.name));
      setActivePath(nextFiles.some((file) => file.path === "main.odo") ? "main.odo" : nextFiles[0]?.path || "main.odo");
      setCursorOffset(0);
      setAiSuggestion(null);
      setDescription(loadedDescription);
      setLastSavedFilesJson(stableFilesJson(nextFiles));
      setLoadedProjectId(loadedId);
    });
    return () => {
      cancelled = true;
    };
  }, [detail, loadedProjectId]);

  useEffect(() => {
    if (!projectContextMenu) return;
    const close = () => setProjectContextMenu(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("click", close);
    window.addEventListener("contextmenu", close);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("contextmenu", close);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [projectContextMenu]);

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
  const contextProject = projects?.find((project) => project._id === projectContextMenu?.projectId) || null;

  const writeTerminal = (label: string, value?: unknown) => {
    const timestamp = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date());
    const body = value === undefined ? "" : typeof value === "string" ? value : JSON.stringify(value, null, 2);
    setTerminalOpen(true);
    setTerminalOutput((current) => `${current ? `${current}\n\n` : ""}[${timestamp}] ${label}${body ? `\n${body}` : ""}`);
  };

  const replaceActiveFile = (content: string) => {
    setFiles((current) => current.map((file) => (file.path === activeFile.path ? { ...file, content } : file)));
    setAiSuggestion(null);
  };

  const insertAtCursor = (snippet: string) => {
    const offset = Math.max(0, Math.min(activeFile.content.length, cursorOffset));
    replaceActiveFile(`${activeFile.content.slice(0, offset)}${snippet}${activeFile.content.slice(offset)}`);
    setCursorOffset(offset + snippet.length);
  };

  const startProjectRename = (project: CodeProjectRow) => {
    setProjectContextMenu(null);
    setEditingProjectId(project._id);
    setEditingProjectName(project.name);
  };

  const cancelProjectRename = () => {
    setEditingProjectId(null);
    setEditingProjectName("");
  };

  const commitProjectRename = (project: CodeProjectRow) => {
    const nextName = editingProjectName.trim();
    if (!nextName || nextName === project.name) {
      cancelProjectRename();
      return;
    }
    void runAction(
      "code-project:rename",
      async () => {
        await renameProject({ ...tenantScope, projectId: project._id, name: nextName });
        if (project._id === selectedProjectId) writeTerminal("rename", `Project renamed to ${nextName}.`);
      },
      { pendingLabel: "Renaming project...", successMessage: "Project renamed." },
    );
    cancelProjectRename();
  };

  const openProjectContextMenu = (event: MouseEvent, project: CodeProjectRow) => {
    event.preventDefault();
    event.stopPropagation();
    setSelectedProjectId(project._id);
    setLoadedProjectId(null);
    setProjectContextMenu({
      projectId: project._id,
      x: Math.min(event.clientX, window.innerWidth - 220),
      y: Math.min(event.clientY, window.innerHeight - 156),
    });
  };

  const onDeleteProject = async (project: CodeProjectRow) => {
    setProjectContextMenu(null);
    const confirmed = await confirmAppDialog({
      title: "Delete project?",
      message: `${project.name} and its files, test runs, and versions will be removed.`,
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!confirmed) return;

    void runAction(
      "code-project:delete",
      async () => {
        await deleteProject({ ...tenantScope, projectId: project._id });
        if (selectedProjectId === project._id) {
          setSelectedProjectId(null);
          setLoadedProjectId(null);
          setFiles(cleanProjectFiles());
          selectActivePath("main.odo");
          setLastSavedFilesJson("");
          setDescription("");
        }
        writeTerminal("delete", `${project.name} deleted.`);
      },
      { pendingLabel: "Deleting project...", successMessage: "Project deleted." },
    );
  };

  const onCreateProject = () => {
    void runAction(
      "code-project:create",
      async () => {
        const result = await createProject({ ...tenantScope, name: "ODOGWU Extension" });
        setSelectedProjectId(result.projectId);
        setLoadedProjectId(null);
        setFiles(result.files);
        selectActivePath("main.odo");
        setLastSavedFilesJson(stableFilesJson(result.files));
      },
      { pendingLabel: "Creating project...", successMessage: "Project account created." },
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
        writeTerminal("test", formatProjectTestOutput(result));
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
        writeTerminal("test", formatProjectTestOutput(tests));
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
      selectActivePath(nextPath);
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
      selectActivePath(nextPath);
      closeFileDialog();
      return;
    }

    if (activeFile.path === "main.odo") return;
    setFiles((current) => current.map((file) => (file.path === sourcePath ? { ...file, path: nextPath } : file)));
    selectActivePath(nextPath);
    closeFileDialog();
  };

  const onDeleteFile = async () => {
    if (activeFile.path === "main.odo" || files.length <= 1) return;
    const confirmed = await confirmAppDialog({
      title: "Delete file?",
      message: activeFile.path,
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!confirmed) return;
    setFiles((current) => current.filter((file) => file.path !== activeFile.path));
    selectActivePath("main.odo");
  };

  const onRestoreVersion = (filesJson: string) => {
    const restored = safeJson<CodeProjectFile[]>(filesJson, files);
    setFiles(restored);
    selectActivePath(restored.some((file) => file.path === "main.odo") ? "main.odo" : restored[0]?.path || "main.odo");
  };

  const onToggleProjectEnabled = (projectId: Id<"codeProjects">, enabled: boolean) => {
    setProjectContextMenu(null);
    void runAction(
      `code-project:enabled:${enabled}`,
      async () => {
        await setProjectEnabled({ ...tenantScope, projectId, enabled });
      },
      { pendingLabel: enabled ? "Enabling..." : "Disabling...", successMessage: enabled ? "Project enabled." : "Project disabled." },
    );
  };

  const onToggleEnabled = (enabled: boolean) => {
    if (!selectedProjectId) return;
    onToggleProjectEnabled(selectedProjectId, enabled);
  };

  const saveRecord = getRecord("code-project:save");
  const testRecord = getRecord("code-project:test");
  const publishRecord = getRecord("code-project:publish");
  const doneRecord = getRecord("code-project:done");
  const createRecord = getRecord("code-project:create");
  const canvasRecord = getRecord("code-project:canvas");
  const suggestRecord = getRecord("code-project:suggest");
  const renameRecord = getRecord("code-project:rename");

  const onSuggestCode = () => {
    void runAction(
      "code-project:suggest",
      async () => {
        const response = await fetch("/api/code/suggest", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            files,
            activePath: activeFile.path,
            cursorOffset,
          }),
        });
        const payload = (await response.json().catch(() => ({}))) as { suggestion?: string; error?: string };
        if (!response.ok) throw new Error(payload.error || `AI suggestion failed (${response.status}).`);
        const suggestion = payload.suggestion?.trim() || "";
        if (!suggestion) throw new Error("AI did not find a useful suggestion here.");
        setAiSuggestion(suggestion);
      },
      { pendingLabel: "Getting a small AI code suggestion...", successMessage: "AI suggestion ready. Press Tab to accept." },
    );
  };

  const onAcceptAiSuggestion = () => {
    if (!aiSuggestion) return false;
    insertAtCursor(aiSuggestion);
    setAiSuggestion(null);
    return true;
  };

  const onDismissAiSuggestion = () => {
    if (!aiSuggestion) return false;
    setAiSuggestion(null);
    return true;
  };

  const onGenerateCanvas = () => {
    void runAction(
      "code-project:canvas",
      async () => {
        const response = await fetch("/api/code/canvas", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            files,
            projectName: activeProjectName,
            webhookBase,
          }),
        });
        const payload = (await response.json().catch(() => ({}))) as {
          title?: string;
          summary?: string[];
          mermaid?: string;
          generatedByAi?: boolean;
          error?: string;
        };
        if (!response.ok || !payload.mermaid) {
          throw new Error(payload.error || `Canvas generation failed (${response.status}).`);
        }
        setCanvasPreview(
          buildCanvasPreview({
            files,
            bundle: compileResult,
            projectName: activeProjectName,
            webhookBase,
            aiCanvas: {
              title: payload.title,
              summary: payload.summary,
              mermaid: payload.mermaid,
              generatedByAi: payload.generatedByAi,
            },
          }),
        );
      },
      { pendingLabel: "Asking AI for a Mermaid canvas...", successMessage: "AI Mermaid canvas generated." },
    );
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
          <CodeIconButton className="btn btn-ghost" icon="arrowLeft" label="Back" onClick={() => router.back()}>
            Back
          </CodeIconButton>
          <div>
            <h2>Code Lab</h2>
            <p>{activeProjectName} · {activeStatus} · {activeFile.path}</p>
          </div>
        </div>
        <div className="code-lab-actions">
          <CodeIconButton className="btn btn-ghost" icon="bookOpen" label="Docs" onClick={() => router.push("/code/docs")}>
            Docs
          </CodeIconButton>
          <CodeIconButton className="btn btn-ghost" icon="spark" label="Load starter project" onClick={() => {
            setFiles(starterProjectFiles);
            selectActivePath("main.odo");
            writeTerminal("starter", "Starter project loaded into the account.");
          }}>
            Starter
          </CodeIconButton>
          <CodeIconButton className="btn btn-ghost" icon="format" label="Format code" onClick={onFormat}>
            Format
          </CodeIconButton>
          <CodeIconButton className="btn btn-secondary" icon="play" label="Run tests" onClick={onRunTests} disabled={testRecord.pending}>
            {testRecord.pending ? "Testing..." : "Run tests"}
          </CodeIconButton>
          <CodeIconButton className="btn btn-secondary" icon="save" label="Save all" onClick={onSave} disabled={saveRecord.pending}>
            {saveRecord.pending ? "Saving..." : "Save all"}
          </CodeIconButton>
          <CodeIconButton className="btn btn-primary" icon="upload" label="Publish" onClick={onPublish} disabled={!canPublish || publishRecord.pending}>
            {publishRecord.pending ? "Publishing..." : "Publish"}
          </CodeIconButton>
          <CodeIconButton className="btn btn-primary" icon="check" label="Done coding" onClick={onDoneCoding} disabled={doneRecord.pending}>
            {doneRecord.pending ? "Finishing..." : "Done coding"}
          </CodeIconButton>
        </div>
      </header>

      <ActionNotices notices={notices} onDismiss={dismissNotice} />

      <div className="code-lab-grid">
        <aside className="code-lab-sidebar">
          <div className="code-lab-sidebar-head">
            <span className="queue-meta">Account</span>
            {projects === undefined ? <LoadingIndicator label="Loading..." /> : null}
          </div>
          <button className="btn btn-secondary code-lab-wide-button" type="button" onClick={onCreateProject} disabled={createRecord.pending}>
            {createRecord.pending ? "Creating..." : "New project"}
          </button>

          <div className="code-lab-sidebar-section">Projects</div>
          {(projects || []).map((project) => (
            <div
              className={`code-program-row ${selectedProjectId === project._id ? "code-program-row-active" : ""}`}
              key={project._id}
              onClick={() => {
                setSelectedProjectId(project._id);
                setLoadedProjectId(null);
              }}
              onContextMenu={(event) => openProjectContextMenu(event, project)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                setSelectedProjectId(project._id);
                setLoadedProjectId(null);
              }}
              role="button"
              tabIndex={0}
            >
              {editingProjectId === project._id ? (
                <input
                  aria-label="Project name"
                  className="code-project-name-input"
                  disabled={renameRecord.pending}
                  onBlur={() => commitProjectRename(project)}
                  onChange={(event) => setEditingProjectName(event.target.value)}
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.key === "Enter") event.currentTarget.blur();
                    if (event.key === "Escape") cancelProjectRename();
                  }}
                  value={editingProjectName}
                  autoFocus
                />
              ) : (
                <button
                  aria-label={`Rename ${project.name}`}
                  className="code-project-name-button"
                  onClick={(event) => {
                    event.stopPropagation();
                    startProjectRename(project);
                  }}
                  title="Rename project"
                  type="button"
                >
                  <strong>{project.name}</strong>
                </button>
              )}
              <span>{project.status} · {formatDate(project.updatedAt)}</span>
            </div>
          ))}
          {contextProject ? (
            <div
              className="code-project-context-menu"
              role="menu"
              style={{ left: projectContextMenu?.x, top: projectContextMenu?.y }}
              onClick={(event) => event.stopPropagation()}
              onContextMenu={(event) => event.preventDefault()}
            >
              <button type="button" role="menuitem" onClick={() => startProjectRename(contextProject)}>
                Rename
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => onToggleProjectEnabled(contextProject._id, contextProject.status !== "published")}
              >
                {contextProject.status === "published" ? "Disable" : "Enable"}
              </button>
              <button className="danger" type="button" role="menuitem" onClick={() => void onDeleteProject(contextProject)}>
                Delete
              </button>
            </div>
          ) : null}

          <div className="code-lab-sidebar-section">Files</div>
          <div className="code-file-actions">
            <CodeIconButton icon="filePlus" label="New file" onClick={() => openFileDialog("create")} />
            <CodeIconButton icon="rename" label="Rename file" onClick={() => openFileDialog("rename")} disabled={activeFile.path === "main.odo"} />
            <CodeIconButton icon="copy" label="Copy file" onClick={() => openFileDialog("duplicate")} />
            <CodeIconButton icon="trash" label="Delete file" onClick={onDeleteFile} disabled={activeFile.path === "main.odo"} />
          </div>
          {[...files].sort((a, b) => (a.path === "main.odo" ? -1 : b.path === "main.odo" ? 1 : a.path.localeCompare(b.path))).map((file) => (
            <button
              className={`code-file-row ${activeFile.path === file.path ? "code-file-row-active" : ""}`}
              key={file.path}
              type="button"
              onClick={() => selectActivePath(file.path)}
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
              <CodeIconButton icon="filePlus" label="New file" onClick={() => openFileDialog("create")} />
              <CodeIconButton icon="save" label={saveRecord.pending ? "Saving" : "Save"} onClick={onSave} disabled={saveRecord.pending} />
              <CodeIconButton icon="rename" label="Rename file" onClick={() => openFileDialog("rename")} disabled={activeFile.path === "main.odo"} />
              <CodeIconButton icon="copy" label="Duplicate file" onClick={() => openFileDialog("duplicate")} />
            </div>
            <div className="code-lab-menu-group">
              <span>Edit</span>
              <CodeIconButton icon="format" label="Format code" onClick={onFormat} />
              <CodeIconButton icon="spark" label="Load starter project" onClick={() => {
                setFiles(starterProjectFiles);
                selectActivePath("main.odo");
                writeTerminal("starter", "Starter project loaded into the account.");
              }} />
              <CodeIconButton icon="diagram" label={canvasRecord.pending ? "Drawing canvas" : "Generate canvas"} onClick={onGenerateCanvas} disabled={canvasRecord.pending} />
              <CodeIconButton icon="wand" label={suggestRecord.pending ? "Thinking" : "Suggest code"} onClick={onSuggestCode} disabled={suggestRecord.pending} />
              <CodeIconButton icon="bookOpen" label="Docs" onClick={() => router.push("/code/docs")} />
            </div>
            <div className="code-lab-menu-group">
              <span>Run</span>
              <CodeIconButton icon="play" label={testRecord.pending ? "Testing" : "Run tests"} onClick={onRunTests} disabled={testRecord.pending} />
              <CodeIconButton icon="upload" label={publishRecord.pending ? "Publishing" : "Publish"} onClick={onPublish} disabled={!canPublish || publishRecord.pending} />
              <CodeIconButton icon="check" label={doneRecord.pending ? "Running" : "Done coding"} onClick={onDoneCoding} disabled={doneRecord.pending} />
            </div>
            <div className="code-lab-menu-group code-lab-menu-group-terminal">
              <span>Terminal</span>
              <CodeIconButton icon="terminal" label="Preview terminal output" onClick={() => {
                setLocalTestJson(JSON.stringify(localTestResult, null, 2));
                writeTerminal("preview", formatProjectTestOutput(localTestResult));
              }} />
              <CodeIconButton icon={terminalOpen ? "eyeOff" : "eye"} label={terminalOpen ? "Hide terminal" : "Show terminal"} onClick={() => setTerminalOpen((open) => !open)} />
              <CodeIconButton icon="trash" label="Clear terminal" onClick={() => {
                setLocalTestJson("");
                setTerminalOutput("");
              }} disabled={!localTestJson && !terminalOutput} />
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
            aiSuggestion={aiSuggestion}
            onChange={replaceActiveFile}
            onSave={onSave}
            onRunTests={onRunTests}
            onPublish={onPublish}
            onFormat={onFormat}
            onCursorChange={setCursorOffset}
            onAcceptAiSuggestion={onAcceptAiSuggestion}
            onDismissAiSuggestion={onDismissAiSuggestion}
          />
          {terminalOpen ? (
            <div className="code-terminal-panel" aria-label="Code Lab terminal">
              <header>
                <strong>Terminal</strong>
                <div>
                  <CodeIconButton icon="trash" label="Clear terminal" onClick={() => setTerminalOutput("")} disabled={!terminalOutput} />
                  <CodeIconButton icon="x" label="Close terminal" onClick={() => setTerminalOpen(false)} />
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
                  <button key={webhook.name} type="button" onClick={() => selectActivePath(webhook.filePath)}>
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
                  <button key={item.key} type="button" onClick={() => selectActivePath(item.filePath)}>
                    <strong>{item.label}</strong>
                    <span>{item.filePath}:{item.line}</span>
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          <section>
            <h3>Canvas</h3>
            <button className="btn btn-secondary code-lab-wide-button" type="button" onClick={onGenerateCanvas} disabled={canvasRecord.pending}>
              {canvasRecord.pending ? "Generating AI canvas..." : canvasPreview ? "Regenerate AI canvas" : "Generate AI canvas"}
            </button>
            {canvasPreview ? (
              <div className={`code-generated-canvas ${canvasIsStale ? "code-generated-canvas-stale" : ""}`}>
                <div className="code-generated-canvas-head">
                  <strong>{canvasPreview.title}</strong>
                  <span>{canvasIsStale ? "stale" : canvasPreview.generatedByAi ? "AI" : "current"}</span>
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
                          <button key={`${lane.title}:${item.label}:${item.detail}`} type="button" onClick={() => item.filePath && selectActivePath(item.filePath)}>
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
