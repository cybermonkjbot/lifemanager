# ODOGWU Programming Language Docs

ODOGWU DSL is the owner-programmable language for ODOGWU HQ. It lets a tenant write multi-file extensions that shape AI behavior, message flows, follow-ups, webhook integrations, worker hooks, heuristics, lexicons, and prompt derivation.

## Project Shape

Projects use `main.odo` as the entry file. Other files can be imported by relative path. Comments start with `#`.

```odogwu
# Lead Desk keeps paid consults, inbound leads, and personal replies sane.
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
```

## Comments

Use `#` for full-line or trailing comments.

```odogwu
# Keep DMs review-first until this project has enough test coverage.
export rule DirectMessageTriage
on message.received as msg
when msg.thread.kind == "direct" # Only direct chats
do
  account.behavior.set("review_first")
  ai.set_confidence_floor(0.78)
end
```

## Exports

```odogwu
export rule DirectMessageTriage
export webhook paidConsultation
export function draftPaidConsultReply(payload)
export heuristic PaidConsultIntent
export lexicon ClientLanguage
export prompt ConsultationReplyStyle
```

- `rule`: reacts to account, message, or local worker events.
- `webhook`: creates a published HTTP endpoint.
- `function`: reusable ODOGWU logic.
- `heuristic`: tenant-owned pattern and routing overlays.
- `lexicon`: tenant-specific language, slang, aliases, and domain terms.
- `prompt`: bounded prompt derivation overlays.

## SDK Modules

- `chat`: inspect message and thread context.
- `ai`: shape AI reply behavior.
- `followups`: create and manage reminders.
- `memory`: read and write bounded contact facts.
- `settings`: inspect safe runtime settings.
- `outreach`: trigger approved outreach flows.
- `runtime`: pause, resume, or inspect local runtime state.
- `time`: use clock helpers.
- `http`: make audited outbound API calls.
- `webhook`: verify inbound secrets and reply to webhook requests.
- `orchestrator`: ask account-scoped AI or run approved tools.
- `messages`: send, draft, or preview messages.
- `account`: patch account behavior/settings.
- `worker`: extend the local worker through approved hooks.
- `heuristics`: add tenant-scoped pattern rules.
- `lexicon`: add tenant language knowledge.
- `prompts`: add bounded prompt derivation rules.

## Webhooks

Published webhook exports are available at:

```text
POST /api/code/webhooks/{projectSlug}/{handlerName}
```

Example:

```odogwu
# Paystack posts here after a consultation checkout succeeds.
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
end
```

## Tenant Behavior Overlays

```odogwu
# Tenant-specific behavior overlays used by prompt and worker systems.
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
end
```

Published overlays are tenant-scoped. They can be loaded by worker and prompt systems through the Code Lab behavior extension manifest.

## Done Coding

The publish path is:

1. Save all files to Convex.
2. Compile the project graph.
3. Run tests and diagnostics.
4. Generate a canvas preview if needed.
5. Publish an immutable bundle.
6. Activate webhook routes and local worker hooks for the tenant.

## Safety

ODOGWU code does not execute as arbitrary JavaScript. It compiles into a restricted manifest. Network access is only through `http.*`; local machine access is only through approved worker adapters; secrets are referenced by key, not raw value.
