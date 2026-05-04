import assert from "node:assert/strict";
import test from "node:test";
import { compileCodeProject, runCodeProjectTests } from "./project";

test("compileCodeProject resolves multi-file imports and exported webhook handlers", () => {
  const bundle = compileCodeProject([
    {
      path: "main.odo",
      content: `project LeadDesk version "1.0"
import "./helpers.odo"

export webhook newLead
on webhook.received as hook
do
  http.post("https://example.com/leads")
  messages.preview(to: hook.payload.phone, text: "Working on it")
end`,
    },
    {
      path: "helpers.odo",
      content: `export function normalizeLead(payload)
do
  orchestrator.ask("Normalize this lead")
end`,
    },
  ]);

  assert.equal(bundle.diagnostics.length, 0);
  assert.equal(bundle.manifest.webhooks[0]?.name, "newLead");
  assert.equal(bundle.manifest.outboundHttp[0]?.literalUrl, "https://example.com/leads");
  assert.equal(bundle.canvas.nodes.some((node) => node.kind === "message"), true);
});

test("compileCodeProject reports missing imports inline by file", () => {
  const bundle = compileCodeProject([{ path: "main.odo", content: `import "./missing.odo"` }]);

  assert.equal(bundle.diagnostics[0]?.filePath, "main.odo");
  assert.match(bundle.diagnostics[0]?.message || "", /missing file/);
});

test("compileCodeProject detects cyclic imports", () => {
  const bundle = compileCodeProject([
    { path: "main.odo", content: `import "./a.odo"` },
    { path: "a.odo", content: `import "./main.odo"` },
  ]);

  assert.equal(bundle.diagnostics.some((item) => item.message.includes("Cyclic import")), true);
});

test("runCodeProjectTests passes projects with exported handlers and no errors", () => {
  const result = runCodeProjectTests([
    {
      path: "main.odo",
      content: `export rule QuietHoursGuard
on message.received as msg
do
  account.behavior.set("review_first")
  worker.extend("quiet-hours")
end`,
    },
  ]);

  assert.equal(result.passed, true);
  assert.equal(result.bundle.manifest.accountMutations[0]?.call, "account.behavior.set");
  assert.equal(result.bundle.manifest.workerHooks[0]?.call, "worker.extend");
});

test("compileCodeProject extracts tenant behavior overlays for heuristics lexicons and prompts", () => {
  const bundle = compileCodeProject([
    {
      path: "main.odo",
      content: `export heuristic PaymentFollowup
pattern "sent receipt"
target "todo_candidate"
instruction "Treat receipts as follow-up evidence when money was discussed."
priority 80
end

export lexicon FamilyPidgin
term "abeg" "soft please" "pidgin,polite"
phrase "no wahala" "no problem"
end

export prompt RepairTone
target "intent:repair"
append "Prefer one calm repair-oriented line and avoid jokes."
priority 90
end`,
    },
  ]);

  assert.equal(bundle.manifest.heuristicPatterns[0]?.patterns[0], "sent receipt");
  assert.equal(bundle.manifest.lexiconEntries[0]?.terms[0]?.token, "abeg");
  assert.equal(bundle.manifest.promptDerivations[0]?.promptAdds[0], "Prefer one calm repair-oriented line and avoid jokes.");
  assert.equal(bundle.manifest.behaviorExtensions.length, 3);
});

test("compileCodeProject extracts cross-platform event bindings and actions", () => {
  const bundle = compileCodeProject([
    {
      path: "main.odo",
      content: `project CrossPlatformOps version "1.0"
use platform

export rule WhatsAppToIMessage
on message.received as msg
when msg.provider == "whatsapp"
do
  platform.react(
    via: "imessage",
    to: msg.contact,
    emoji: "+1"
  )
  platform.route(to: "telegram")
end`,
    },
  ]);

  assert.equal(bundle.diagnostics.length, 0);
  assert.equal(bundle.manifest.eventBindings[0]?.event, "message.received");
  assert.equal(bundle.manifest.platformActions.length, 2);
  assert.equal(bundle.manifest.crossPlatformActions[0]?.targetProvider, "imessage");
  assert.equal(bundle.manifest.platformRoutes.some((route) => route.sourceProvider === "whatsapp" && route.targetProvider === "telegram"), true);
  assert.equal(bundle.canvas.nodes.some((node) => node.kind === "platform"), true);
});

test("compileCodeProject expands all-platform fan-out routes", () => {
  const bundle = compileCodeProject([
    {
      path: "main.odo",
      content: `project AllPlatformBridge version "1.0"
use platform

export rule AnyPlatformToEveryOtherPlatform
on message.received as msg
do
  platform.broadcast(
    targets: "all",
    text: "Mirror this event everywhere connected."
  )
end`,
    },
  ]);

  assert.equal(bundle.diagnostics.length, 0);
  assert.equal(bundle.manifest.platformActions[0]?.sourceProvider, "all");
  assert.equal(bundle.manifest.platformActions[0]?.targetProvider, "all");
  assert.equal(bundle.manifest.platformRoutes.length, 12);
  assert.equal(bundle.manifest.platformRoutes.some((route) => route.sourceProvider === "instagram" && route.targetProvider === "telegram"), true);
  assert.equal(bundle.manifest.platformRoutes.some((route) => route.sourceProvider === "imessage" && route.targetProvider === "whatsapp"), true);
});

test("compileCodeProject type-checks project SDK calls", () => {
  const bundle = compileCodeProject([
    {
      path: "main.odo",
      content: `project BadTypes version "1.0"
use platform
use ai

export rule Broken
on message.received as msg
do
  platform.react(via: "slack", to: msg.contact)
  ai.set_confidence_floor("high")
  messages.send(to: msg.contact)
end`,
    },
  ]);

  assert.equal(bundle.diagnostics.some((item) => item.message.includes('unknown platform selector "slack"')), true);
  assert.equal(bundle.diagnostics.some((item) => item.message.includes('Missing required argument "emoji"')), true);
  assert.equal(bundle.diagnostics.some((item) => item.message.includes('argument "value" must be a number')), true);
  assert.equal(bundle.diagnostics.some((item) => item.message.includes('Missing required argument "text"')), true);
});

test("compileCodeProject accepts positional single-arg calls and managed secret HTTP URLs", () => {
  const bundle = compileCodeProject([
    {
      path: "main.odo",
      content: `project GoodTypes version "1.0"
export webhook paid
on webhook.received as hook
do
  webhook.verify_secret("paystackWebhookSecret")
  http.post(secret: "ops.paymentWebhookUrl")
end`,
    },
  ]);

  assert.equal(bundle.diagnostics.length, 0);
  assert.equal(bundle.manifest.sdkCalls[0]?.args[0]?.kind, "string");
  assert.equal(bundle.manifest.outboundHttp[0]?.secretUrlKey, "ops.paymentWebhookUrl");
});

test("compileCodeProject accepts time helper calls in project action arguments", () => {
  const bundle = compileCodeProject([
    {
      path: "main.odo",
      content: `project PaidConsults version "1.0"
export webhook paidConsultation
on webhook.received as hook
do
  followups.create(
    title: "Confirm paid consultation",
    thread: hook.payload.thread,
    due: time.tomorrow_at("09:00")
  )
end`,
    },
  ]);

  assert.equal(bundle.diagnostics.length, 0);
  assert.equal(bundle.manifest.sdkCalls.some((call) => call.call === "time.tomorrow_at"), true);
});
