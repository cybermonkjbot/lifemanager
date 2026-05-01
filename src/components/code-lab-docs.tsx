"use client";

import { useRouter } from "next/navigation";

const sdkModules = [
  ["chat", "Inspect message and thread context."],
  ["ai", "Shape AI reply behavior."],
  ["followups", "Create and manage reminders."],
  ["memory", "Read and write bounded contact facts."],
  ["http", "Make audited outbound API calls."],
  ["webhook", "Verify inbound secrets and reply to webhook requests."],
  ["orchestrator", "Ask account-scoped AI or run approved tools."],
  ["messages", "Send, draft, or preview messages."],
  ["platform", "Bridge events, replies, reactions, and routing across connected platforms."],
  ["account", "Patch account behavior and settings."],
  ["worker", "Extend the local worker through approved hooks."],
  ["heuristics", "Add tenant-scoped pattern rules."],
  ["lexicon", "Add tenant-specific language knowledge."],
  ["prompts", "Add bounded prompt derivation rules."],
];

const exportKinds = [
  ["rule", "React to account, message, or local worker events."],
  ["webhook", "Create a published HTTP endpoint."],
  ["function", "Share reusable ODOGWU logic across files."],
  ["heuristic", "Add tenant-owned pattern and routing overlays."],
  ["lexicon", "Teach slang, aliases, relationship phrases, and domain language."],
  ["prompt", "Add bounded prompt derivation overlays."],
];

export function CodeLabDocs() {
  const router = useRouter();

  return (
    <section className="code-docs-shell">
      <header className="code-docs-topbar">
        <button className="btn btn-ghost" type="button" onClick={() => router.push("/code")}>
          Back to Code Lab
        </button>
        <div>
          <h1>ODOGWU Programming Language Docs</h1>
          <p>Language, SDK, HQ behavior overlays, webhooks, and publish flow.</p>
        </div>
      </header>

      <main className="code-docs-grid">
        <nav className="code-docs-nav" aria-label="Docs sections">
          <a href="#language">Language</a>
          <a href="#comments">Comments</a>
          <a href="#exports">Exports</a>
          <a href="#sdk">SDK</a>
          <a href="#events">Events</a>
          <a href="#webhooks">Webhooks</a>
          <a href="#cross-platform">Cross Platform</a>
          <a href="#behavior">Tenant Behavior</a>
          <a href="#publish">Done Coding</a>
          <a href="#safety">Safety</a>
        </nav>

        <article className="code-docs-content">
          <section id="language">
            <span>Language</span>
            <h2>Multi-file ODOGWU projects</h2>
            <p>Projects start from `main.odo`, import local files, and compile into a tenant-scoped execution manifest.</p>
            <pre>{`# Lead Desk keeps paid consults, inbound leads, and personal replies sane.
project LeadDesk version "1.0"

import "./messages.odo"
import "./webhooks/paystack.odo"
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
use prompts`}</pre>
          </section>

          <section id="comments">
            <span>Comments</span>
            <h2>Notes inside code</h2>
            <p>Use `#` for full-line or trailing comments.</p>
            <pre>{`# Keep DMs review-first until this project has enough test coverage.
export rule DirectMessageTriage
on message.received as msg
when msg.thread.kind == "direct" # Only direct chats
do
  account.behavior.set("review_first")
  ai.set_confidence_floor(0.78)
end`}</pre>
          </section>

          <section id="exports">
            <span>Exports</span>
            <h2>What files can expose</h2>
            <div className="code-docs-definition-list">
              {exportKinds.map(([name, detail]) => (
                <div key={name}>
                  <code>{name}</code>
                  <p>{detail}</p>
                </div>
              ))}
            </div>
          </section>

          <section id="sdk">
            <span>SDK</span>
            <h2>Approved ODOGWU HQ modules</h2>
            <div className="code-docs-sdk-grid">
              {sdkModules.map(([name, detail]) => (
                <div key={name} id={name === "messages" ? "sdk-messages" : undefined}>
                  <code>{name}</code>
                  <p>{detail}</p>
                </div>
              ))}
            </div>
          </section>

          <section id="events">
            <span>Events</span>
            <h2>Runtime triggers</h2>
            <p>Rules and webhooks subscribe with `on {"{event.name}"} as {"{alias}"}`. The alias becomes the event object used inside guards and action blocks.</p>
            <div className="code-docs-definition-list">
              <div id="events-message-received">
                <code>message.received</code>
                <p>Fires when ODOGWU receives a message from a connected account adapter. Use it for inbox triage, cross-platform reactions, draft generation, routing, follow-ups, worker handoffs, and review-first automations.</p>
              </div>
              <div id="events-platform-message-received">
                <code>{"{platform}"}.message.received</code>
                <p>Fires for a specific source adapter such as WhatsApp, Instagram, iMessage, or Telegram. Use the platform-scoped event when a rule should only react to one channel before relaying, mirroring, or broadcasting into other connected platforms.</p>
              </div>
              <div id="events-webhook-received">
                <code>webhook.received</code>
                <p>Fires inside an exported webhook handler when an external service posts to that handler. Use it for payment callbacks, form submissions, lead capture, external system updates, and audited HTTP replies.</p>
              </div>
            </div>
            <pre>{`export rule DirectMessageTriage
on message.received as msg
when msg.thread.kind == "direct"
do
  account.behavior.set("review_first")
  messages.preview(
    to: msg.contact,
    text: "I saw this and will reply properly shortly."
  )
end`}</pre>
          </section>

          <section id="webhooks">
            <span>Webhooks</span>
            <h2>Inbound platform events</h2>
            <p>Published webhook exports are available at `POST /api/code/webhooks/{"{projectSlug}"}/{"{handlerName}"}`.</p>
            <pre>{`# Paystack posts here after a consultation checkout succeeds.
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
end`}</pre>
          </section>

          <section id="cross-platform">
            <span>Cross Platform</span>
            <h2>Route any platform to any platform</h2>
            <p>`platform.*` actions target connected adapters, so events from WhatsApp, Instagram, iMessage, or Telegram can draft, react, mirror, relay, broadcast, or route work into any other connected platform.</p>
            <pre>{`export rule AnyPlatformFanout
on message.received as msg
do
  platform.broadcast(
    targets: "all",
    text: "Mirror this event everywhere connected."
  )
  platform.relay(targets: "all")
end`}</pre>
          </section>

          <section id="behavior">
            <span>Tenant Behavior</span>
            <h2>Heuristics, lexicons, and prompt derivation</h2>
            <p>Published overlays are tenant-scoped and can be consumed by worker and prompt systems.</p>
            <pre>{`# Tenant-specific behavior overlays used by prompt and worker systems.
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
end`}</pre>
          </section>

          <section id="publish">
            <span>Done Coding</span>
            <h2>Save, test, publish</h2>
            <ol>
              <li>Save all files to Convex.</li>
              <li>Compile the project graph.</li>
              <li>Run tests and diagnostics.</li>
              <li>Generate a canvas preview when useful.</li>
              <li>Publish an immutable bundle.</li>
              <li>Activate webhook routes and local worker hooks for the tenant.</li>
            </ol>
          </section>

          <section id="safety">
            <span>Safety</span>
            <h2>Restricted execution</h2>
            <p>ODOGWU code compiles into a restricted manifest. Network access is only through `http.*`; local machine access is only through approved worker adapters; secrets are referenced by key.</p>
          </section>
        </article>
      </main>
    </section>
  );
}
