"use client";

import { ActionNotices } from "@/components/action-notices";
import { LoadingIndicator } from "@/components/loading-state";
import { useActionStateRegistry } from "@/lib/ui/action-state";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useAction, useConvex, useMutation, useQuery } from "convex/react";
import { useState } from "react";

type KnownContact = {
  _id: string;
  jid: string;
  title?: string;
};

function toInt(value: string, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.round(Math.max(min, Math.min(max, parsed)));
}

function toFloat(value: string, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, parsed));
}

function parseAliases(value: string) {
  return [...new Set(value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean))];
}

function parseOptionalJid(value: string) {
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function jsonOutput(value: unknown) {
  return JSON.stringify(value, null, 2);
}

export function LiveTools() {
  const contacts = useQuery(api.threads.listContacts, { limit: 300 }) as KnownContact[] | undefined;
  const contactOptions = contacts || [];
  const contactsLoading = contacts === undefined;

  const convex = useConvex();
  const runToolRouterPlan = useAction(api.chatTools.toolRouterPlan);
  const runExternalWebSearch = useAction(api.chatTools.externalWebSearch);
  const runPersonalConnectorsSearch = useAction(api.chatTools.personalConnectorsSearch);
  const runHistoryBackfillImport = useAction(api.chatTools.historyBackfillImport);
  const rebuildThreadStyleProfile = useMutation(api.chatTools.rebuildThreadStyleProfile);
  const upsertContactMemoryFact = useMutation(api.chatTools.upsertContactMemoryFact);
  const extractContactMemoryFacts = useMutation(api.chatTools.extractContactMemoryFacts);

  const { runAction, getRecord, notices, dismissNotice } = useActionStateRegistry();

  const [selectedThreadId, setSelectedThreadId] = useState("none");
  const [contactJid, setContactJid] = useState("");
  const [task, setTask] = useState("");
  const [candidateReply, setCandidateReply] = useState("");
  const [maxResults, setMaxResults] = useState("8");
  const [routerExecute, setRouterExecute] = useState(false);
  const [factKey, setFactKey] = useState("preferred_name");
  const [factValue, setFactValue] = useState("");
  const [factType, setFactType] = useState("profile");
  const [factConfidence, setFactConfidence] = useState("0.7");
  const [lookbackMessages, setLookbackMessages] = useState("120");
  const [backfillThreadJid, setBackfillThreadJid] = useState("");
  const [backfillOwnerAliases, setBackfillOwnerAliases] = useState("me");
  const [backfillExportText, setBackfillExportText] = useState("");
  const [backfillMaxEntries, setBackfillMaxEntries] = useState("120");
  const [results, setResults] = useState<Record<string, unknown>>({});

  const selectedThreadRef = selectedThreadId !== "none" ? (selectedThreadId as Id<"threads">) : undefined;
  const activeContact = contactOptions.find((contact) => contact._id === selectedThreadId) || null;
  const effectiveContactJid = parseOptionalJid(contactJid) || activeContact?.jid;
  const defaultBackfillJid = parseOptionalJid(backfillThreadJid) || effectiveContactJid || "";
  const parsedMaxResults = toInt(maxResults, 8, 1, 30);
  const parsedLookbackMessages = toInt(lookbackMessages, 120, 20, 400);

  const setResult = (key: string, value: unknown) => {
    setResults((prev) => ({ ...prev, [key]: value }));
  };

  const ensureTask = () => {
    const normalized = task.trim();
    if (!normalized) {
      throw new Error("Enter a query or task first.");
    }
    return normalized;
  };

  const runMemorySearchTool = () => {
    void runAction(
      "tools:memory.search",
      async () => {
        const payload = await convex.query(api.chatTools.memorySearch, {
          query: ensureTask(),
          threadId: selectedThreadRef,
          contactJid: effectiveContactJid,
          limit: parsedMaxResults,
        });
        setResult("memory.search", payload);
      },
      {
        pendingLabel: "Running memory.search...",
        successMessage: "memory.search completed.",
      },
    );
  };

  const runConversationRecallTool = () => {
    void runAction(
      "tools:conversation_recall.query",
      async () => {
        const payload = await convex.query(api.chatTools.conversationRecallQuery, {
          query: ensureTask(),
          threadId: selectedThreadRef,
          contactJid: effectiveContactJid,
          limit: Math.max(1, Math.min(parsedMaxResults, 12)),
        });
        setResult("conversation_recall.query", payload);
      },
      {
        pendingLabel: "Running conversation_recall.query...",
        successMessage: "conversation_recall.query completed.",
      },
    );
  };

  const runThreadStyleProfileTool = () => {
    void runAction(
      "tools:thread_style.profile",
      async () => {
        const payload = await convex.query(api.chatTools.getThreadStyleProfile, {
          threadId: selectedThreadRef,
          contactJid: effectiveContactJid,
          fallbackToGlobal: true,
        });
        setResult("thread_style.profile", payload);
      },
      {
        pendingLabel: "Loading thread_style.profile...",
        successMessage: "thread_style.profile loaded.",
      },
    );
  };

  const runRebuildThreadStyleProfileTool = () => {
    void runAction(
      "tools:thread_style.rebuild",
      async () => {
        if (!selectedThreadRef) {
          throw new Error("Select a thread to rebuild style profile.");
        }
        const payload = await rebuildThreadStyleProfile({
          threadId: selectedThreadRef,
          lookbackMessages: parsedLookbackMessages,
        });
        setResult("thread_style.rebuild", payload);
      },
      {
        pendingLabel: "Rebuilding thread style profile...",
        successMessage: "Thread style profile rebuilt.",
      },
    );
  };

  const runContactFactsListTool = () => {
    void runAction(
      "tools:contact_memory.facts",
      async () => {
        const payload = await convex.query(api.chatTools.contactMemoryFactsList, {
          threadId: selectedThreadRef,
          contactJid: effectiveContactJid,
          limit: Math.max(1, Math.min(parsedMaxResults * 5, 200)),
        });
        setResult("contact_memory.facts", payload);
      },
      {
        pendingLabel: "Loading contact_memory.facts...",
        successMessage: "contact_memory.facts loaded.",
      },
    );
  };

  const runUpsertContactFactTool = () => {
    void runAction(
      "tools:contact_memory.upsert",
      async () => {
        if (!selectedThreadRef && !effectiveContactJid) {
          throw new Error("Select a thread or set a contact JID before saving a fact.");
        }
        const normalizedFactValue = factValue.trim();
        if (!normalizedFactValue) {
          throw new Error("Enter fact value.");
        }
        const payload = await upsertContactMemoryFact({
          threadId: selectedThreadRef,
          contactJid: effectiveContactJid,
          factKey: factKey.trim() || "fact",
          factValue: normalizedFactValue,
          factType: factType as "preference" | "profile" | "schedule" | "relationship" | "promise" | "other",
          confidence: toFloat(factConfidence, 0.7, 0, 1),
        });
        setResult("contact_memory.upsert", payload);
      },
      {
        pendingLabel: "Saving contact memory fact...",
        successMessage: "Contact memory fact saved.",
      },
    );
  };

  const runExtractContactFactsTool = () => {
    void runAction(
      "tools:contact_memory.extract",
      async () => {
        if (!selectedThreadRef) {
          throw new Error("Select a thread before extracting contact facts.");
        }
        const payload = await extractContactMemoryFacts({
          threadId: selectedThreadRef,
          lookbackMessages: parsedLookbackMessages,
        });
        setResult("contact_memory.extract", payload);
      },
      {
        pendingLabel: "Extracting contact facts...",
        successMessage: "Contact facts extracted.",
      },
    );
  };

  const runReplyStyleGuardrailTool = () => {
    void runAction(
      "tools:reply_style_guardrail.check",
      async () => {
        const draft = candidateReply.trim() || task.trim();
        if (!draft) {
          throw new Error("Enter a candidate reply or task text first.");
        }
        const payload = await convex.query(api.chatTools.replyStyleGuardrailCheck, {
          threadId: selectedThreadRef,
          candidateReply: draft,
          inboundText: task.trim() || undefined,
          strictness: "balanced",
        });
        setResult("reply_style_guardrail.check", payload);
      },
      {
        pendingLabel: "Running reply_style_guardrail.check...",
        successMessage: "reply_style_guardrail.check completed.",
      },
    );
  };

  const runExternalWebSearchTool = () => {
    void runAction(
      "tools:external_search.web",
      async () => {
        const payload = await runExternalWebSearch({
          query: ensureTask(),
          maxResults: Math.max(1, Math.min(parsedMaxResults, 10)),
        });
        setResult("external_search.web", payload);
      },
      {
        pendingLabel: "Running external_search.web...",
        successMessage: "external_search.web completed.",
      },
    );
  };

  const runPersonalConnectorsInternalTool = () => {
    void runAction(
      "tools:personal_connectors.internal",
      async () => {
        const payload = await convex.query(api.chatTools.personalConnectorsInternalSearch, {
          query: ensureTask(),
          maxResults: parsedMaxResults,
        });
        setResult("personal_connectors.internal", payload);
      },
      {
        pendingLabel: "Running personal_connectors.search (internal)...",
        successMessage: "Internal personal connector search completed.",
      },
    );
  };

  const runPersonalConnectorsSearchTool = () => {
    void runAction(
      "tools:personal_connectors.search",
      async () => {
        const payload = await runPersonalConnectorsSearch({
          query: ensureTask(),
          maxResults: parsedMaxResults,
        });
        setResult("personal_connectors.search", payload);
      },
      {
        pendingLabel: "Running personal_connectors.search...",
        successMessage: "personal_connectors.search completed.",
      },
    );
  };

  const runToolRouter = () => {
    void runAction(
      "tools:tool_router.plan",
      async () => {
        const payload = await runToolRouterPlan({
          task: ensureTask(),
          threadId: selectedThreadRef,
          contactJid: effectiveContactJid,
          candidateReply: candidateReply.trim() || undefined,
          execute: routerExecute,
        });
        setResult("tool_router.plan", payload);
      },
      {
        pendingLabel: routerExecute ? "Planning and executing tool router..." : "Planning tool router...",
        successMessage: routerExecute ? "tool_router.plan executed." : "tool_router.plan generated.",
      },
    );
  };

  const runHistoryBackfillTool = () => {
    void runAction(
      "tools:history_backfill.import",
      async () => {
        const threadJid = defaultBackfillJid.trim();
        if (!threadJid) {
          throw new Error("Enter a thread JID for history backfill import.");
        }
        if (!backfillExportText.trim()) {
          throw new Error("Paste WhatsApp export text before running backfill import.");
        }
        const payload = await runHistoryBackfillImport({
          threadJid,
          ownerAliases: parseAliases(backfillOwnerAliases),
          exportText: backfillExportText,
          maxEntries: toInt(backfillMaxEntries, 120, 1, 400),
        });
        setResult("history_backfill.import", payload);
      },
      {
        pendingLabel: "Running history_backfill.import...",
        successMessage: "history_backfill.import completed.",
      },
    );
  };

  const routerRecord = getRecord("tools:tool_router.plan");
  const memoryRecord = getRecord("tools:memory.search");
  const recallRecord = getRecord("tools:conversation_recall.query");
  const styleProfileRecord = getRecord("tools:thread_style.profile");
  const styleRebuildRecord = getRecord("tools:thread_style.rebuild");
  const factsRecord = getRecord("tools:contact_memory.facts");
  const upsertFactRecord = getRecord("tools:contact_memory.upsert");
  const extractFactsRecord = getRecord("tools:contact_memory.extract");
  const guardrailRecord = getRecord("tools:reply_style_guardrail.check");
  const webSearchRecord = getRecord("tools:external_search.web");
  const connectorsInternalRecord = getRecord("tools:personal_connectors.internal");
  const connectorsRecord = getRecord("tools:personal_connectors.search");
  const backfillRecord = getRecord("tools:history_backfill.import");

  return (
    <section className="panel-grid two-col">
      <article className="panel-card">
        <ActionNotices notices={notices} onDismiss={dismissNotice} />
        <h3>Shared Inputs</h3>
        <p className="queue-meta">Set common inputs once, then run any tool.</p>
        {contactsLoading ? <LoadingIndicator label="Loading contact threads…" /> : null}

        <div className="stack compact" style={{ marginTop: 10 }}>
          <label className="setup-input-group">
            <span className="queue-meta">Thread</span>
            <select
              value={selectedThreadId}
              onChange={(event) => {
                const nextThreadId = event.target.value;
                setSelectedThreadId(nextThreadId);
                const nextContact = contactOptions.find((contact) => contact._id === nextThreadId);
                if (nextContact) {
                  setContactJid(nextContact.jid);
                  setBackfillThreadJid(nextContact.jid);
                }
              }}
              disabled={contactsLoading}
              aria-disabled={contactsLoading}
            >
              <option value="none">No thread selected</option>
              {contactOptions.map((contact) => (
                <option key={contact._id} value={contact._id}>
                  {contact.title?.trim() || contact.jid}
                </option>
              ))}
            </select>
          </label>

          <label className="setup-input-group">
            <span className="queue-meta">Contact JID (optional)</span>
            <input type="text" value={contactJid} onChange={(event) => setContactJid(event.target.value)} placeholder="234xxxxxxxxxx@s.whatsapp.net" />
          </label>

          <label className="setup-input-group">
            <span className="queue-meta">Task / query</span>
            <textarea
              rows={3}
              value={task}
              onChange={(event) => setTask(event.target.value)}
              placeholder="What did we discuss before about travel plans?"
            />
          </label>

          <label className="setup-input-group">
            <span className="queue-meta">Candidate reply (for style guardrail / router)</span>
            <textarea
              rows={2}
              value={candidateReply}
              onChange={(event) => setCandidateReply(event.target.value)}
              placeholder="Sure, let’s lock Friday and I’ll send details tonight."
            />
          </label>

          <label className="setup-input-group">
            <span className="queue-meta">Max results</span>
            <input type="number" min={1} max={30} value={maxResults} onChange={(event) => setMaxResults(event.target.value)} />
          </label>

          <label className="setup-input-group inline" style={{ alignItems: "center", gap: 10 }}>
            <input
              type="checkbox"
              checked={routerExecute}
              onChange={(event) => setRouterExecute(event.target.checked)}
              style={{ width: "auto" }}
            />
            <span className="queue-meta">Execute `tool_router.plan` steps (not just plan)</span>
          </label>
        </div>
      </article>

      <article className="panel-card">
        <h3>Tool Router</h3>
        <p className="queue-meta">Plan tool usage for the current task and thread context.</p>
        <div className="queue-actions">
          <button type="button" className="btn btn-primary" onClick={runToolRouter} disabled={routerRecord.pending}>
            {routerRecord.pending ? "Running..." : "Run tool_router.plan"}
          </button>
        </div>
        {results["tool_router.plan"] ? <pre className="tool-json-output">{jsonOutput(results["tool_router.plan"])}</pre> : null}
      </article>

      <article className="panel-card">
        <h3>Recall + Memory</h3>
        <div className="queue-actions">
          <button type="button" className="btn btn-primary" onClick={runConversationRecallTool} disabled={recallRecord.pending}>
            {recallRecord.pending ? "Running..." : "Run conversation_recall.query"}
          </button>
          <button type="button" className="btn btn-ghost" onClick={runMemorySearchTool} disabled={memoryRecord.pending}>
            {memoryRecord.pending ? "Running..." : "Run memory.search"}
          </button>
        </div>
        {results["conversation_recall.query"] ? (
          <pre className="tool-json-output">{jsonOutput(results["conversation_recall.query"])}</pre>
        ) : null}
        {results["memory.search"] ? <pre className="tool-json-output">{jsonOutput(results["memory.search"])}</pre> : null}
      </article>

      <article className="panel-card">
        <h3>Style + Guardrail</h3>
        <label className="setup-input-group">
          <span className="queue-meta">Lookback messages</span>
          <input type="number" min={20} max={400} value={lookbackMessages} onChange={(event) => setLookbackMessages(event.target.value)} />
        </label>
        <div className="queue-actions">
          <button type="button" className="btn btn-primary" onClick={runThreadStyleProfileTool} disabled={styleProfileRecord.pending}>
            {styleProfileRecord.pending ? "Running..." : "Run thread_style.profile"}
          </button>
          <button type="button" className="btn btn-ghost" onClick={runRebuildThreadStyleProfileTool} disabled={styleRebuildRecord.pending}>
            {styleRebuildRecord.pending ? "Rebuilding..." : "Run rebuildThreadStyleProfile"}
          </button>
          <button type="button" className="btn btn-ghost" onClick={runReplyStyleGuardrailTool} disabled={guardrailRecord.pending}>
            {guardrailRecord.pending ? "Running..." : "Run reply_style_guardrail.check"}
          </button>
        </div>
        {results["thread_style.profile"] ? <pre className="tool-json-output">{jsonOutput(results["thread_style.profile"])}</pre> : null}
        {results["thread_style.rebuild"] ? <pre className="tool-json-output">{jsonOutput(results["thread_style.rebuild"])}</pre> : null}
        {results["reply_style_guardrail.check"] ? (
          <pre className="tool-json-output">{jsonOutput(results["reply_style_guardrail.check"])}</pre>
        ) : null}
      </article>

      <article className="panel-card">
        <h3>Contact Memory</h3>
        <label className="setup-input-group">
          <span className="queue-meta">Fact key</span>
          <input type="text" value={factKey} onChange={(event) => setFactKey(event.target.value)} />
        </label>
        <label className="setup-input-group">
          <span className="queue-meta">Fact value</span>
          <input type="text" value={factValue} onChange={(event) => setFactValue(event.target.value)} />
        </label>
        <label className="setup-input-group">
          <span className="queue-meta">Fact type</span>
          <select value={factType} onChange={(event) => setFactType(event.target.value)}>
            <option value="preference">preference</option>
            <option value="profile">profile</option>
            <option value="schedule">schedule</option>
            <option value="relationship">relationship</option>
            <option value="promise">promise</option>
            <option value="other">other</option>
          </select>
        </label>
        <label className="setup-input-group">
          <span className="queue-meta">Confidence (0-1)</span>
          <input type="number" min={0} max={1} step={0.01} value={factConfidence} onChange={(event) => setFactConfidence(event.target.value)} />
        </label>
        <div className="queue-actions">
          <button type="button" className="btn btn-primary" onClick={runContactFactsListTool} disabled={factsRecord.pending}>
            {factsRecord.pending ? "Running..." : "Run contact_memory.facts"}
          </button>
          <button type="button" className="btn btn-ghost" onClick={runUpsertContactFactTool} disabled={upsertFactRecord.pending}>
            {upsertFactRecord.pending ? "Saving..." : "Run upsertContactMemoryFact"}
          </button>
          <button type="button" className="btn btn-ghost" onClick={runExtractContactFactsTool} disabled={extractFactsRecord.pending}>
            {extractFactsRecord.pending ? "Extracting..." : "Run extractContactMemoryFacts"}
          </button>
        </div>
        {results["contact_memory.facts"] ? <pre className="tool-json-output">{jsonOutput(results["contact_memory.facts"])}</pre> : null}
        {results["contact_memory.upsert"] ? <pre className="tool-json-output">{jsonOutput(results["contact_memory.upsert"])}</pre> : null}
        {results["contact_memory.extract"] ? <pre className="tool-json-output">{jsonOutput(results["contact_memory.extract"])}</pre> : null}
      </article>

      <article className="panel-card">
        <h3>External + Connectors</h3>
        <div className="queue-actions">
          <button type="button" className="btn btn-primary" onClick={runExternalWebSearchTool} disabled={webSearchRecord.pending}>
            {webSearchRecord.pending ? "Running..." : "Run external_search.web"}
          </button>
          <button type="button" className="btn btn-ghost" onClick={runPersonalConnectorsInternalTool} disabled={connectorsInternalRecord.pending}>
            {connectorsInternalRecord.pending ? "Running..." : "Run personal_connectors.internal"}
          </button>
          <button type="button" className="btn btn-ghost" onClick={runPersonalConnectorsSearchTool} disabled={connectorsRecord.pending}>
            {connectorsRecord.pending ? "Running..." : "Run personal_connectors.search"}
          </button>
        </div>
        {results["external_search.web"] ? <pre className="tool-json-output">{jsonOutput(results["external_search.web"])}</pre> : null}
        {results["personal_connectors.internal"] ? (
          <pre className="tool-json-output">{jsonOutput(results["personal_connectors.internal"])}</pre>
        ) : null}
        {results["personal_connectors.search"] ? (
          <pre className="tool-json-output">{jsonOutput(results["personal_connectors.search"])}</pre>
        ) : null}
      </article>

      <article className="panel-card">
        <h3>History Backfill</h3>
        <p className="queue-meta">Import WhatsApp export text or preloaded history snippets.</p>

        <label className="setup-input-group">
          <span className="queue-meta">Thread JID</span>
          <input
            type="text"
            value={backfillThreadJid}
            onChange={(event) => setBackfillThreadJid(event.target.value)}
            placeholder="234xxxxxxxxxx@s.whatsapp.net"
          />
        </label>

        <label className="setup-input-group">
          <span className="queue-meta">Owner aliases (comma or newline separated)</span>
          <input type="text" value={backfillOwnerAliases} onChange={(event) => setBackfillOwnerAliases(event.target.value)} />
        </label>

        <label className="setup-input-group">
          <span className="queue-meta">Max entries</span>
          <input type="number" min={1} max={400} value={backfillMaxEntries} onChange={(event) => setBackfillMaxEntries(event.target.value)} />
        </label>

        <label className="setup-input-group">
          <span className="queue-meta">WhatsApp export text</span>
          <textarea
            rows={8}
            value={backfillExportText}
            onChange={(event) => setBackfillExportText(event.target.value)}
            placeholder="Paste raw WhatsApp export text here..."
          />
        </label>

        <div className="queue-actions">
          <button type="button" className="btn btn-primary" onClick={runHistoryBackfillTool} disabled={backfillRecord.pending}>
            {backfillRecord.pending ? "Running..." : "Run history_backfill.import"}
          </button>
        </div>
        {results["history_backfill.import"] ? (
          <pre className="tool-json-output">{jsonOutput(results["history_backfill.import"])}</pre>
        ) : null}
      </article>
    </section>
  );
}
