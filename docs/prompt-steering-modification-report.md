# Prompt Steering & Modification Volume by Request Type

Generated: 2026-04-10

## Scope
This report is a code-level static analysis of outbound AI prompt construction in:
- `src/worker/ai.ts`
- `src/worker/index.ts`

"Request type" here maps to the worker pipelines and AI sub-requests used at runtime.

## Request Type Map
- `reply` -> `generateReplyWithFallback` + `buildPrompt`
- `outreach` -> same prompt engine as `reply` (`generateReplyWithFallback` + `buildPrompt`)
- `status_builder` -> same prompt engine as `reply` (`generateReplyWithFallback` + `buildPrompt`)
- `ack_router` -> `routeAckResponseChannel` + `buildAckRoutingPrompt`
- `humor_judge` (sub-request inside quality gate) -> `buildHumorJudgePrompt`
- `image_analysis` -> `describeInboundImageWithFallback` + `buildImageAnalysisPrompt`
- `meme_generation` -> `generateMemeImageWithAzure` + `buildMemeImagePrompt`

## Quantitative Breakdown

| Request type | Prompt template volume | Steering/modification behavior | Max model call amplification |
|---|---:|---|---:|
| `reply` / `outreach` / `status_builder` | `buildPrompt` has **69 blocks** total: **25 fixed literals (~679 tokens)** + **18 identifier-driven blocks** + **24 conditionals** + 2 dynamic templates. Also includes model system instruction (default ~27 tokens). | Main steering-heavy path. Includes steering mode instruction (`hard_stop`, `pause`, `wrap_up`, `loop`, `anti_beggi_beggi`, `anti_sales_pitch`, `anti_puppet`, `anti_dry_joke`) with per-mode instruction size ~28-53 tokens. Includes additional style/persona/context steering, quality rewrites, copy-risk rewrite, humor gating, and blocked-refusal reprompts. | **Up to ~16 model prompts** in worst-case path (reprompts + fallback + rewrites + humor judge passes). |
| `ack_router` | `buildAckRoutingPrompt` has **10 blocks**: **8 fixed literals (~119 tokens)** + inbound template + optional recent history. | Classification-only steering (JSON routing constraints), no conversation-style steering stack. | **2** (Azure then Codex fallback). |
| `humor_judge` (sub-request) | `buildHumorJudgePrompt` has **7 blocks**: fixed literals (~78 tokens) + system classifier instruction (~43 tokens) + inbound/candidate/history context. | Strict binary judgment steering (`isJokeAttempt`, `isFunny`, `confidence`, `reason`). | **2 per invocation** (Azure then Codex fallback). Up to **2 invocations** during one main reply flow. |
| `image_analysis` | `buildImageAnalysisPrompt` has **4 blocks**: **3 fixed literals (~44 tokens)** + caption line. | Minimal steering; descriptive extraction only. | **1** (Azure only; otherwise heuristic fallback, no second model). |
| `meme_generation` | `buildMemeImagePrompt` has **8 blocks**: **4 fixed literals (~70 tokens)** + thread label/inbound + optional history/hints. | Creative constraints steering (tone/safety/layout) but no conversational steering stack. | **1** (Azure image generation). |

## Steering Intensity Details (Main Reply Engine)

### 1) Deterministic steering bypass can reduce prompt-out to zero
When steering mode is in deterministic bypass set, system returns heuristic response without model prompt.
- Legacy/default bypass modes: `hard_stop`, `anti_beggi_beggi`, `anti_sales_pitch`, `anti_puppet`, `anti_dry_joke`, `pause`, `loop`, `wrap_up`.
- If bypass triggers, outbound model prompt count for that request is **0**.

### 2) Context window controls cap outgoing prompt size
For the main reply engine:
- Default `maxContextTokens`: **8192**
- Default reserved output tokens: **220**
- Approx max prompt budget before trim: **7972 tokens**

So actual outgoing prompt size is bounded by context-window detection/trim even if many optional steering blocks are enabled.

### 3) Prompt modification paths that increase outbound volume
For `reply`/`outreach`/`status_builder`, modification is additive:
- Blocked-refusal reprompt loop: base prompt + up to **2** retries.
- Quality rewrite (`auto_rewrite_once`): up to **1** rewrite pass.
- Copy-risk rewrite: up to **1** rewrite pass when triggered.
- Humor-guardrail rewrite: up to **1** rewrite pass when triggered.
- Humor judge may run pre- and post-rewrite.
- Provider fallback can duplicate each pass (Azure -> Codex).

## Practical Summary
- Highest steering/modification volume is in `reply`-class requests (`reply`, `outreach`, `status_builder`).
- `ack_router`, `image_analysis`, and `meme_generation` are much lighter and narrower in steering scope.
- In deterministic steering cases, `reply`-class requests can send **no model prompt at all**.
