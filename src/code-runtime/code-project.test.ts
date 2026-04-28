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
