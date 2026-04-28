import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { action, internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { compileCodeProgram, compileCodeProject, getCodeProjectHash, runCodeProjectTests, runCodeTests } from "../src/code-runtime";
import { assertTenantBillingActive } from "./lib/billingAccess";
import { assertTenantOwned, resolveTenantForMutation, resolveTenantForQuery } from "./lib/tenantSecurity";

const tenantScopeArgs = {
  tenantId: v.optional(v.id("tenantAccounts")),
  connectorTokenHash: v.optional(v.string()),
};

const recordTestSuiteRef = makeFunctionReference<"mutation">("code:recordTestSuite");
const recordProjectTestSuiteRef = makeFunctionReference<"mutation">("code:recordProjectTestSuite");

function slugify(value: string) {
  return (
    value
      .trim()
      .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "program"
  );
}

function sourceHash(source: string) {
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function compactJson(value: unknown, limit = 120_000) {
  return JSON.stringify(value).slice(0, limit);
}

const codeProjectFileValidator = v.object({
  path: v.string(),
  content: v.string(),
  language: v.optional(v.literal("odogwu")),
});

async function resolveTenantForOptionalMutation(
  ctx: MutationCtx,
  args: { tenantId?: Id<"tenantAccounts">; connectorTokenHash?: string },
) {
  if (args.connectorTokenHash) return await resolveTenantForMutation(ctx, args);
  await assertTenantBillingActive(ctx, args.tenantId);
  return args.tenantId;
}

async function getOwnedProgram(ctx: QueryCtx | MutationCtx, programId: Id<"codePrograms">, tenantId?: Id<"tenantAccounts">) {
  const program = await ctx.db.get(programId);
  if (!program) throw new Error("Code program not found.");
  assertTenantOwned(tenantId, program.tenantId);
  return program;
}

async function getOwnedProject(ctx: QueryCtx | MutationCtx, projectId: Id<"codeProjects">, tenantId?: Id<"tenantAccounts">) {
  const project = await ctx.db.get(projectId);
  if (!project) throw new Error("Code project not found.");
  assertTenantOwned(tenantId, project.tenantId);
  return project;
}

function defaultProjectFiles(name: string) {
  return [
    {
      path: "main.odo",
      content: `# Lead Desk keeps paid consults, inbound leads, and personal replies sane.
project ${name.replace(/[^A-Za-z0-9_]/g, "") || "LeadDesk"} version "1.0"

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
      language: "odogwu" as const,
    },
    {
      path: "messages.odo",
      content: `# Shared reply helpers for leads and payment events.
export function draftPaidConsultReply(payload)
do
  messages.draft(
    to: payload.phone,
    text: "Payment received. I will confirm a time and send the prep notes shortly."
  )
end`,
      language: "odogwu" as const,
    },
    {
      path: "webhooks/paystack.odo",
      content: `# Paystack posts here after a consultation checkout succeeds.
export webhook paidConsultation
on webhook.received as hook
do
  webhook.verify_secret("paystackWebhookSecret")
  http.post("https://example.com/ops/payments")
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
      language: "odogwu" as const,
    },
    {
      path: "behavior/language.odo",
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
      language: "odogwu" as const,
    },
  ];
}

function projectNameFromFiles(files: Array<{ path: string; content: string }>) {
  const main = files.find((file) => file.path === "main.odo")?.content || files[0]?.content || "";
  const match = main.match(/^\s*project\s+([A-Za-z_][\w]*)/m) || main.match(/^\s*program\s+([A-Za-z_][\w]*)/m);
  return match?.[1] || "ODOGWU Extension";
}

export const listPrograms = query({
  args: {
    ...tenantScopeArgs,
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const tenantId = await resolveTenantForQuery(ctx, args);
    const limit = Math.round(Math.max(1, Math.min(args.limit ?? 50, 100)));
    return tenantId
      ? await ctx.db
          .query("codePrograms")
          .withIndex("by_tenantId_and_updatedAt", (q) => q.eq("tenantId", tenantId))
          .order("desc")
          .take(limit)
      : await ctx.db.query("codePrograms").withIndex("by_tenantId_and_updatedAt").order("desc").take(limit);
  },
});

export const listProjects = query({
  args: {
    ...tenantScopeArgs,
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const tenantId = await resolveTenantForQuery(ctx, args);
    const limit = Math.round(Math.max(1, Math.min(args.limit ?? 50, 100)));
    return tenantId
      ? await ctx.db
          .query("codeProjects")
          .withIndex("by_tenantId_and_updatedAt", (q) => q.eq("tenantId", tenantId))
          .order("desc")
          .take(limit)
      : await ctx.db.query("codeProjects").withIndex("by_tenantId_and_updatedAt").order("desc").take(limit);
  },
});

export const getProject = query({
  args: {
    ...tenantScopeArgs,
    projectId: v.id("codeProjects"),
    runLimit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const tenantId = await resolveTenantForQuery(ctx, args);
    const project = await getOwnedProject(ctx, args.projectId, tenantId);
    const runLimit = Math.round(Math.max(1, Math.min(args.runLimit ?? 20, 80)));
    const files = await ctx.db
      .query("codeFiles")
      .withIndex("by_projectId_and_path", (q) => q.eq("projectId", args.projectId))
      .take(200);
    const versions = await ctx.db
      .query("codeProjectVersions")
      .withIndex("by_projectId_and_createdAt", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .take(20);
    const testSuites = await ctx.db
      .query("codeTestSuites")
      .withIndex("by_projectId_and_createdAt", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .take(10);
    const runs = await ctx.db
      .query("codeProjectRuns")
      .withIndex("by_projectId_and_createdAt", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .take(runLimit);
    return { project, files, versions, testSuites, runs };
  },
});

export const createProject = mutation({
  args: {
    ...tenantScopeArgs,
    name: v.optional(v.string()),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const tenantId = await resolveTenantForOptionalMutation(ctx, args);
    const now = Date.now();
    const name = args.name?.trim() || "ODOGWU Extension";
    const slug = slugify(name);
    const webhookSlug = `${slug}-${sourceHash(`${name}:${now}`).slice(0, 10)}`;
    const files = defaultProjectFiles(name);
    const bundle = compileCodeProject(files);
    const projectId = await ctx.db.insert("codeProjects", {
      tenantId,
      name,
      slug,
      description: args.description?.trim() || undefined,
      status: "draft",
      webhookSlug,
      createdAt: now,
      updatedAt: now,
    });
    for (const file of files) {
      await ctx.db.insert("codeFiles", {
        tenantId,
        projectId,
        path: file.path,
        content: file.content,
        language: "odogwu",
        createdAt: now,
        updatedAt: now,
      });
    }
    await ctx.db.insert("systemEvents", {
      tenantId,
      source: "dashboard",
      eventType: "code.project.created",
      detail: `${name} created with ${files.length} file(s).`,
      createdAt: now,
    });
    return { projectId, files, bundle };
  },
});

export const saveProjectFiles = mutation({
  args: {
    ...tenantScopeArgs,
    projectId: v.id("codeProjects"),
    files: v.array(codeProjectFileValidator),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const tenantId = await resolveTenantForOptionalMutation(ctx, args);
    const project = await getOwnedProject(ctx, args.projectId, tenantId);
    const files = args.files.slice(0, 200).map((file) => ({
      path: file.path.trim().replace(/^\/+/, "") || "main.odo",
      content: file.content,
      language: "odogwu" as const,
    }));
    const bundle = compileCodeProject(files);
    const now = Date.now();
    const name = projectNameFromFiles(files);

    for (const file of files) {
      const existing = await ctx.db
        .query("codeFiles")
        .withIndex("by_projectId_and_path", (q) => q.eq("projectId", project._id).eq("path", file.path))
        .unique();
      if (existing) {
        await ctx.db.patch(existing._id, {
          content: file.content,
          language: file.language,
          updatedAt: now,
        });
      } else {
        await ctx.db.insert("codeFiles", {
          tenantId,
          projectId: project._id,
          path: file.path,
          content: file.content,
          language: file.language,
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    const savedPaths = new Set(files.map((file) => file.path));
    const existingFiles = await ctx.db
      .query("codeFiles")
      .withIndex("by_projectId_and_updatedAt", (q) => q.eq("projectId", project._id))
      .take(250);
    for (const existing of existingFiles) {
      if (!savedPaths.has(existing.path)) await ctx.db.delete(existing._id);
    }

    const versionId = await ctx.db.insert("codeProjectVersions", {
      tenantId,
      projectId: project._id,
      versionLabel: `${name}@${now}`,
      filesJson: compactJson(files),
      bundleJson: compactJson(bundle),
      diagnosticsJson: compactJson(bundle.diagnostics),
      status: "draft",
      createdAt: now,
    });

    await ctx.db.patch(project._id, {
      name,
      slug: slugify(name),
      description: args.description?.trim() || project.description,
      updatedAt: now,
    });

    await ctx.db.insert("systemEvents", {
      tenantId,
      source: "dashboard",
      eventType: "code.project.saved",
      detail: `${name} saved with ${bundle.diagnostics.length} diagnostic(s).`,
      createdAt: now,
    });
    return { projectId: project._id, versionId, bundle, files };
  },
});

export const recordProjectTestSuite = internalMutation({
  args: {
    ...tenantScopeArgs,
    projectId: v.optional(v.id("codeProjects")),
    files: v.array(codeProjectFileValidator),
    resultJson: v.string(),
    diagnosticsJson: v.string(),
    passed: v.boolean(),
  },
  handler: async (ctx, args) => {
    const tenantId = await resolveTenantForOptionalMutation(ctx, args);
    if (args.projectId) await getOwnedProject(ctx, args.projectId, tenantId);
    const now = Date.now();
    const testSuiteId = await ctx.db.insert("codeTestSuites", {
      tenantId,
      projectId: args.projectId,
      sourceHash: getCodeProjectHash(args.files),
      passed: args.passed,
      diagnosticsJson: args.diagnosticsJson,
      resultJson: args.resultJson,
      createdAt: now,
    });
    if (args.projectId) {
      await ctx.db.patch(args.projectId, {
        lastTestSuiteId: testSuiteId,
        updatedAt: now,
      });
    }
    await ctx.db.insert("systemEvents", {
      tenantId,
      source: "dashboard",
      eventType: args.passed ? "code.project.tests.passed" : "code.project.tests.failed",
      detail: args.passed ? "Code Lab project tests passed." : "Code Lab project tests failed.",
      createdAt: now,
    });
    return testSuiteId;
  },
});

export const runProjectTests = action({
  args: {
    ...tenantScopeArgs,
    projectId: v.optional(v.id("codeProjects")),
    files: v.array(codeProjectFileValidator),
  },
  handler: async (ctx, args) => {
    const result = runCodeProjectTests(args.files);
    const testSuiteId: Id<"codeTestSuites"> = await ctx.runMutation(recordProjectTestSuiteRef, {
      tenantId: args.tenantId,
      connectorTokenHash: args.connectorTokenHash,
      projectId: args.projectId,
      files: args.files,
      resultJson: compactJson(result),
      diagnosticsJson: compactJson(result.diagnostics),
      passed: result.passed,
    });
    return { ...result, testSuiteId };
  },
});

export const publishProject = mutation({
  args: {
    ...tenantScopeArgs,
    projectId: v.id("codeProjects"),
  },
  handler: async (ctx, args) => {
    const tenantId = await resolveTenantForOptionalMutation(ctx, args);
    const project = await getOwnedProject(ctx, args.projectId, tenantId);
    const files = await ctx.db
      .query("codeFiles")
      .withIndex("by_projectId_and_path", (q) => q.eq("projectId", project._id))
      .take(200);
    const sourceFiles = files.map((file) => ({ path: file.path, content: file.content, language: file.language }));
    const bundle = compileCodeProject(sourceFiles);
    if (bundle.diagnostics.some((item) => item.severity === "error")) throw new Error("Fix diagnostics before publishing.");
    if (!project.lastTestSuiteId) throw new Error("Run tests before publishing.");
    const suite = await ctx.db.get(project.lastTestSuiteId);
    if (!suite || !suite.passed || suite.sourceHash !== getCodeProjectHash(sourceFiles)) {
      throw new Error("The latest test suite must pass for the current project files before publishing.");
    }
    const now = Date.now();
    const versionId = await ctx.db.insert("codeProjectVersions", {
      tenantId,
      projectId: project._id,
      versionLabel: `${project.name}@${now}`,
      filesJson: compactJson(sourceFiles),
      bundleJson: compactJson(bundle),
      diagnosticsJson: compactJson(bundle.diagnostics),
      status: "published",
      createdAt: now,
      publishedAt: now,
    });
    await ctx.db.patch(project._id, {
      status: "published",
      activeVersionId: versionId,
      publishedAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("systemEvents", {
      tenantId,
      source: "dashboard",
      eventType: "code.project.published",
      detail: `${project.name} published with ${bundle.manifest.webhooks.length} webhook(s).`,
      createdAt: now,
    });
    return versionId;
  },
});

export const setProjectEnabled = mutation({
  args: {
    ...tenantScopeArgs,
    projectId: v.id("codeProjects"),
    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    const tenantId = await resolveTenantForOptionalMutation(ctx, args);
    const project = await getOwnedProject(ctx, args.projectId, tenantId);
    const status = args.enabled ? "published" : "disabled";
    await ctx.db.patch(project._id, { status, updatedAt: Date.now() });
    return status;
  },
});

export const getPublishedWebhookProject = query({
  args: {
    projectSlug: v.string(),
    handlerName: v.string(),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db
      .query("codeProjects")
      .withIndex("by_webhookSlug", (q) => q.eq("webhookSlug", args.projectSlug))
      .unique();
    if (!project || project.status !== "published" || !project.activeVersionId) return null;
    const version = await ctx.db.get(project.activeVersionId);
    if (!version) return null;
    const bundle = JSON.parse(version.bundleJson) as ReturnType<typeof compileCodeProject>;
    const webhook = bundle.manifest.webhooks.find((item) => item.name === args.handlerName);
    if (!webhook) return null;
    return { project, version, webhook, bundleJson: version.bundleJson, filesJson: version.filesJson };
  },
});

export const listActiveBehaviorExtensions = query({
  args: {
    ...tenantScopeArgs,
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const tenantId = await resolveTenantForQuery(ctx, args);
    const limit = Math.round(Math.max(1, Math.min(args.limit ?? 40, 100)));
    const projects = tenantId
      ? await ctx.db
          .query("codeProjects")
          .withIndex("by_tenantId_and_updatedAt", (q) => q.eq("tenantId", tenantId))
          .order("desc")
          .take(limit)
      : await ctx.db.query("codeProjects").withIndex("by_status_and_updatedAt", (q) => q.eq("status", "published")).order("desc").take(limit);

    const rows = [];
    for (const project of projects) {
      if (project.status !== "published" || !project.activeVersionId) continue;
      const version = await ctx.db.get(project.activeVersionId);
      if (!version) continue;
      const bundle = JSON.parse(version.bundleJson) as ReturnType<typeof compileCodeProject>;
      const behaviorExtensions = bundle.manifest.behaviorExtensions || [];
      if (behaviorExtensions.length === 0) continue;
      rows.push({
        projectId: project._id,
        projectName: project.name,
        projectSlug: project.slug,
        versionId: version._id,
        versionLabel: version.versionLabel,
        publishedAt: version.publishedAt,
        behaviorExtensions,
        heuristicPatterns: bundle.manifest.heuristicPatterns || [],
        lexiconEntries: bundle.manifest.lexiconEntries || [],
        promptDerivations: bundle.manifest.promptDerivations || [],
      });
    }
    return rows;
  },
});

export const recordProjectRun = mutation({
  args: {
    projectId: v.id("codeProjects"),
    projectVersionId: v.optional(v.id("codeProjectVersions")),
    handlerName: v.string(),
    eventName: v.string(),
    status: v.union(v.literal("success"), v.literal("error"), v.literal("skipped")),
    errorMessage: v.optional(v.string()),
    steps: v.array(
      v.object({
        stepId: v.string(),
        toolName: v.string(),
        status: v.union(v.literal("success"), v.literal("error"), v.literal("skipped")),
        latencyMs: v.number(),
        outputSummary: v.optional(v.string()),
        errorMessage: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project) throw new Error("Code project not found.");
    const now = Date.now();
    const runId = await ctx.db.insert("codeProjectRuns", {
      tenantId: project.tenantId,
      projectId: project._id,
      projectVersionId: args.projectVersionId,
      handlerName: args.handlerName,
      eventName: args.eventName,
      status: args.status,
      startedAt: now,
      finishedAt: now,
      errorMessage: args.errorMessage,
      createdAt: now,
    });
    for (const step of args.steps.slice(0, 80)) {
      await ctx.db.insert("codeProjectRunSteps", {
        tenantId: project.tenantId,
        runId,
        projectId: project._id,
        stepId: step.stepId,
        toolName: step.toolName,
        status: step.status,
        latencyMs: step.latencyMs,
        outputSummary: step.outputSummary,
        errorMessage: step.errorMessage,
        createdAt: now,
      });
      await ctx.db.insert("toolRuns", {
        tenantId: project.tenantId,
        stepId: step.stepId,
        toolName: `code.${step.toolName}`,
        status: step.status,
        latencyMs: step.latencyMs,
        errorMessage: step.errorMessage,
        outputSummary: step.outputSummary,
        createdAt: now,
      });
    }
    await ctx.db.insert("systemEvents", {
      tenantId: project.tenantId,
      source: "worker",
      eventType: `code.project.run.${args.status}`,
      detail: `${project.name} handled ${args.handlerName} with ${args.steps.length} step(s).`,
      createdAt: now,
    });
    return runId;
  },
});

export const getProgram = query({
  args: {
    ...tenantScopeArgs,
    programId: v.id("codePrograms"),
    runLimit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const tenantId = await resolveTenantForQuery(ctx, args);
    const program = await getOwnedProgram(ctx, args.programId, tenantId);
    const runLimit = Math.round(Math.max(1, Math.min(args.runLimit ?? 20, 80)));
    const versions = await ctx.db
      .query("codeProgramVersions")
      .withIndex("by_programId_and_createdAt", (q) => q.eq("programId", args.programId))
      .order("desc")
      .take(20);
    const testSuites = await ctx.db
      .query("codeTestSuites")
      .withIndex("by_programId_and_createdAt", (q) => q.eq("programId", args.programId))
      .order("desc")
      .take(10);
    const runs = await ctx.db
      .query("codeRuns")
      .withIndex("by_programId_and_createdAt", (q) => q.eq("programId", args.programId))
      .order("desc")
      .take(runLimit);
    return { program, versions, testSuites, runs };
  },
});

export const saveProgram = mutation({
  args: {
    ...tenantScopeArgs,
    programId: v.optional(v.id("codePrograms")),
    source: v.string(),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const tenantId = await resolveTenantForOptionalMutation(ctx, args);
    const compiled = compileCodeProgram(args.source);
    const name = compiled.ast?.name || "Program";
    const version = compiled.ast?.version || "0.0";
    const now = Date.now();
    const payload = {
      tenantId,
      name,
      slug: slugify(name),
      description: args.description?.trim() || undefined,
      source: args.source,
      compiledPlanJson: compiled.plan ? compactJson(compiled.plan) : undefined,
      diagnosticsJson: compactJson(compiled.diagnostics),
      updatedAt: now,
    };

    let programId = args.programId;
    if (programId) {
      const existing = await getOwnedProgram(ctx, programId, tenantId);
      await ctx.db.patch(existing._id, payload);
    } else {
      programId = await ctx.db.insert("codePrograms", {
        ...payload,
        status: "draft",
        createdAt: now,
      });
    }

    const versionId = await ctx.db.insert("codeProgramVersions", {
      tenantId,
      programId,
      version,
      source: args.source,
      compiledPlanJson: compiled.plan ? compactJson(compiled.plan) : undefined,
      diagnosticsJson: compactJson(compiled.diagnostics),
      status: "draft",
      createdAt: now,
    });

    await ctx.db.insert("systemEvents", {
      tenantId,
      source: "dashboard",
      eventType: "code.program.saved",
      detail: `${name} saved with ${compiled.diagnostics.length} diagnostic(s).`,
      createdAt: now,
    });

    return {
      programId,
      versionId,
      diagnostics: compiled.diagnostics,
      plan: compiled.plan,
    };
  },
});

export const recordTestSuite = internalMutation({
  args: {
    ...tenantScopeArgs,
    programId: v.optional(v.id("codePrograms")),
    source: v.string(),
    resultJson: v.string(),
    diagnosticsJson: v.string(),
    passed: v.boolean(),
  },
  handler: async (ctx, args) => {
    const tenantId = await resolveTenantForOptionalMutation(ctx, args);
    if (args.programId) await getOwnedProgram(ctx, args.programId, tenantId);
    const now = Date.now();
    const testSuiteId = await ctx.db.insert("codeTestSuites", {
      tenantId,
      programId: args.programId,
      sourceHash: sourceHash(args.source),
      passed: args.passed,
      diagnosticsJson: args.diagnosticsJson,
      resultJson: args.resultJson,
      createdAt: now,
    });
    if (args.programId) {
      await ctx.db.patch(args.programId, {
        lastTestSuiteId: testSuiteId,
        updatedAt: now,
      });
    }
    await ctx.db.insert("systemEvents", {
      tenantId,
      source: "dashboard",
      eventType: args.passed ? "code.tests.passed" : "code.tests.failed",
      detail: args.passed ? "Code Lab test suite passed." : "Code Lab test suite failed.",
      createdAt: now,
    });
    return testSuiteId;
  },
});

export const runTests = action({
  args: {
    ...tenantScopeArgs,
    programId: v.optional(v.id("codePrograms")),
    source: v.string(),
  },
  handler: async (ctx, args) => {
    const result = runCodeTests(args.source);
    const testSuiteId: Id<"codeTestSuites"> = await ctx.runMutation(recordTestSuiteRef, {
      tenantId: args.tenantId,
      connectorTokenHash: args.connectorTokenHash,
      programId: args.programId,
      source: args.source,
      resultJson: compactJson(result),
      diagnosticsJson: compactJson(result.diagnostics),
      passed: result.passed,
    });
    return { ...result, testSuiteId };
  },
});

export const publishProgram = mutation({
  args: {
    ...tenantScopeArgs,
    programId: v.id("codePrograms"),
  },
  handler: async (ctx, args) => {
    const tenantId = await resolveTenantForOptionalMutation(ctx, args);
    const program = await getOwnedProgram(ctx, args.programId, tenantId);
    if (!program.compiledPlanJson) throw new Error("Fix diagnostics before publishing.");
    if (!program.lastTestSuiteId) throw new Error("Run tests before publishing.");
    const suite = await ctx.db.get(program.lastTestSuiteId);
    if (!suite || !suite.passed || suite.sourceHash !== sourceHash(program.source)) {
      throw new Error("The latest test suite must pass for the current source before publishing.");
    }
    const now = Date.now();
    const versionId = await ctx.db.insert("codeProgramVersions", {
      tenantId,
      programId: program._id,
      version: `${program.name}@${now}`,
      source: program.source,
      compiledPlanJson: program.compiledPlanJson,
      diagnosticsJson: program.diagnosticsJson,
      status: "published",
      createdAt: now,
      publishedAt: now,
    });
    await ctx.db.patch(program._id, {
      status: "published",
      activeVersionId: versionId,
      publishedAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("systemEvents", {
      tenantId,
      source: "dashboard",
      eventType: "code.program.published",
      detail: `${program.name} published.`,
      createdAt: now,
    });
    return versionId;
  },
});

export const setProgramEnabled = mutation({
  args: {
    ...tenantScopeArgs,
    programId: v.id("codePrograms"),
    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    const tenantId = await resolveTenantForOptionalMutation(ctx, args);
    const program = await getOwnedProgram(ctx, args.programId, tenantId);
    const status = args.enabled ? "published" : "disabled";
    await ctx.db.patch(program._id, {
      status,
      updatedAt: Date.now(),
    });
    return status;
  },
});

export const recordLocalRun = internalMutation({
  args: {
    ...tenantScopeArgs,
    programId: v.id("codePrograms"),
    versionId: v.optional(v.id("codeProgramVersions")),
    eventName: v.string(),
    status: v.union(v.literal("success"), v.literal("error"), v.literal("skipped")),
    errorMessage: v.optional(v.string()),
    steps: v.array(
      v.object({
        stepId: v.string(),
        toolName: v.string(),
        status: v.union(v.literal("success"), v.literal("error"), v.literal("skipped")),
        latencyMs: v.number(),
        outputSummary: v.optional(v.string()),
        errorMessage: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const tenantId = await resolveTenantForOptionalMutation(ctx, args);
    const program = await getOwnedProgram(ctx, args.programId, tenantId);
    const now = Date.now();
    const runId = await ctx.db.insert("codeRuns", {
      tenantId,
      programId: program._id,
      versionId: args.versionId,
      eventName: args.eventName,
      status: args.status,
      startedAt: now,
      finishedAt: now,
      errorMessage: args.errorMessage,
      createdAt: now,
    });
    for (const step of args.steps.slice(0, 50)) {
      await ctx.db.insert("codeRunSteps", {
        tenantId,
        runId,
        programId: program._id,
        stepId: step.stepId,
        toolName: step.toolName,
        status: step.status,
        latencyMs: step.latencyMs,
        outputSummary: step.outputSummary,
        errorMessage: step.errorMessage,
        createdAt: now,
      });
      await ctx.db.insert("toolRuns", {
        tenantId,
        stepId: step.stepId,
        toolName: `code.${step.toolName}`,
        status: step.status,
        latencyMs: step.latencyMs,
        errorMessage: step.errorMessage,
        outputSummary: step.outputSummary,
        createdAt: now,
      });
    }
    await ctx.db.insert("systemEvents", {
      tenantId,
      source: "worker",
      eventType: `code.run.${args.status}`,
      detail: `${program.name} handled ${args.eventName} with ${args.steps.length} step(s).`,
      createdAt: now,
    });
    return runId;
  },
});
