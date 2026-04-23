# Personal Autopilot Fact-Judge Edge Cases
Date: April 23, 2026

## Scope
This report covers risky edge cases for unattended personal conversations (especially girlfriend flows), with focus on:
- Fact memory correctness and freshness
- Good-morning/outreach personalization safety
- Missed-call fallback behavior recency

## Current Observations In Code
- Fact extraction is regex-based and permissive in [chatTools.ts](/Users/joshua/Documents/lifemanager/convex/chatTools.ts).
- Facts are upserted by `factKey` and can remain active without explicit contradiction handling.
- Good-morning/outreach generation consumes contact facts as prompt hints in [index.ts](/Users/joshua/Documents/lifemanager/src/worker/index.ts).
- Missed-call auto-decline fallback sends a message after rejecting an offer call in [index.ts](/Users/joshua/Documents/lifemanager/src/worker/index.ts).
- Reply stale suppression existed late in outbox send path; inbound stale filtering has now been strengthened in [inbound.ts](/Users/joshua/Documents/lifemanager/convex/inbound.ts).

## High-Risk Edge Cases (Personal + Unattended)
1. Location drift:
She moved from Abuja to another state, but `profile_location` remains old and outreach suggests local plans.

2. Time-zone mismatch:
Good-morning sent by your timezone while she is traveling internationally or on night shift.

3. Temporary schedule facts treated as permanent:
"I’m free after 7 this week" gets reused months later.

4. Mood/context reversal:
"I like surprise visits" from old context reused after boundary changes.

5. Sarcasm captured as literal fact:
"Yeah I love traffic and stress" parsed as preference.

6. Quoted/forwarded content misattributed:
Forwarded text becomes "her fact."

7. Multi-person ambiguity in group context:
Fact extracted from group chat assigned to wrong person/thread.

8. Contradiction without retirement:
New fact says "I’m in Lagos now" but old "Abuja" fact remains equally usable.

9. Event-date expiry not enforced:
Birthday plan reminders continue after event window is gone.

10. Relationship-state drift:
Tone/mode assumes intimacy level that changed after conflict/cooling period.

11. Rebound after manual user reply:
Autopilot uses outdated pending assumptions despite user manually resolving topic.

12. Message ownership confusion:
Voice transcription or OCR errors create wrong facts from low-quality media.

13. Hard-boundary violations:
Past consent for playful roasting reused after explicit "don’t joke about this."

14. Financial/safety sensitivity leakage:
Sensitive facts (health/legal/debt/family emergency) used in casual personalization.

15. Contact identity collision:
Two contacts share similar names; fact key collisions cause cross-contact contamination.

16. Recency-blind missed-call fallback:
Old replayed call offers trigger fresh fallback messages after downtime.

## Fact Judge Design (Recommended)
Introduce a `fact_judge` stage before writing/updating contact facts.

### Decision labels
- `accept` (store/use)
- `accept_with_ttl` (store but expires)
- `reject` (don’t store)
- `supersede` (new fact retires conflicting old fact)
- `quarantine` (low-confidence; never used for proactive outreach)

### Minimum judge checks
1. Source quality:
Only direct inbound user text gets high trust; OCR/transcription/forwarded text gets reduced trust.

2. Temporal semantics:
Detect transient phrases (`today`, `this week`, `for now`) and enforce TTL.

3. Contradiction handling:
Same semantic slot (location/work/schedule/preference) should keep newest + highest-confidence winner and retire older conflicting facts.

4. Sensitivity class:
Tag sensitive facts and block them from playful/proactive templates unless explicitly allowed.

5. Confidence decay:
Older facts lose utility over time even if not explicitly contradicted.

6. Reconfirm-before-use:
For high-impact facts (location/availability/relationship boundaries), require recent reconfirmation before autonomous outreach.

## Concrete Safeguards For Good-Morning Protocol
1. Location-aware gating:
Do not generate local meetup suggestions unless location fact is fresh and reconfirmed recently.

2. Availability-aware gating:
Do not imply immediate availability from stale schedule facts.

3. Boundary-aware gating:
If recent negative sentiment or direct boundary message exists, force safe neutral mode.

4. Freshness budget:
Require at least one recent (e.g., last 14 days) high-confidence fact before personalized proactive lines.

5. Fallback tone:
If fact confidence is low, send generic warm check-in without assumptions.

## Calls: Missed-Call Recency Requirement
Implemented in this pass:
- Added stale-offer recency gate in [index.ts](/Users/joshua/Documents/lifemanager/src/worker/index.ts) using:
  - `SLM_CALL_OFFER_RECENCY_MAX_MS` (default 10 minutes)
  - Helper in [call-fallback.ts](/Users/joshua/Documents/lifemanager/src/worker/call-fallback.ts)
- If offer is too old, worker logs `inbound.call.offer_stale.skipped` and does not run reject/fallback response behavior.

## Additional Implementation Backlog
1. Add `factStatus` lifecycle (`active`, `superseded`, `expired`, `quarantined`) in `contactMemoryFacts`.
2. Add `expiresAt` and `lastConfirmedAt` fields for fact usage policy.
3. Build `judgeFactCandidate(...)` in Convex mutation path before `contactMemoryFactsUpsert`.
4. Add fact conflict keys by semantic slot (`location.current`, `schedule.availability`, `relationship.boundary`).
5. Block proactive outreach personalization when required fact slots are stale or quarantined.
6. Add audit events for every fact judge decision (`fact.judge.accept`, `fact.judge.reject`, `fact.judge.supersede`).
7. Add simulation tests for contradiction chains and sarcasm/quoted-text rejection.

## Immediate Priority Order
1. Implement fact lifecycle + contradiction retirement.
2. Enforce high-impact reconfirmation before personalized outreach.
3. Add sensitive-fact policy guardrails for proactive/autonomous messages.
4. Keep call-offer recency gate enabled and tune threshold from production logs.
