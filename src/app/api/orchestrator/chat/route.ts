import { createConvexClient } from "@/lib/convex-server";
import { convexRefs } from "@/lib/convex-refs";
import { readLocalInstanceConfig } from "@/lib/instance-config";
import { requireInstanceApiAccess } from "@/lib/instance-guard";
import { generateReplyWithFallback } from "@/worker/ai";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const MAX_MESSAGE_CHARS = 8000;
const MAX_HISTORY_MESSAGES = 18;

type ChatHistoryItem = {
  role: "assistant" | "user";
  text: string;
};

type RuntimeSettings = {
  aiTemperature?: number;
  aiMaxOutputTokens?: number;
  aiMaxReplyChars?: number;
  aiHistoryLineLimit?: number;
  aiFallbackMode?: "all" | "azure_only";
  aiModelFirstEnabled?: boolean;
  aiDeterministicModes?: string[];
  aiAckRoutingEnabled?: boolean;
  aiReplyPolicy?: string;
  aiSystemInstruction?: string;
  activePersonaPackId?: string;
  activePersonaPackIdsByProfile?: Record<string, string>;
  qualityGateMode?: "auto_rewrite_once" | "manual_review" | "log_only";
  qualityGateThreshold?: number;
  soulModeEnabled?: boolean;
  selfRoastModeEnabled?: boolean;
  funnyStatusKeywords?: string[];
  funnyStatusEmojis?: string[];
  humanDelayMinMs?: number;
  humanDelayMaxMs?: number;
  humanTypingMinMs?: number;
  humanTypingMaxMs?: number;
};

type UserRomanticContext = {
  ownGender: "male" | "female" | "nonbinary" | "unknown";
  romanticTargets: Array<"male" | "female" | "nonbinary">;
  source: "soul_profile" | "message" | "fallback";
  summary: string;
};

type GenderInference = {
  gender: "male" | "female" | "nonbinary" | "unknown";
  confidence: number;
  reason: string;
  evidence?: string;
};

type OrchestratorTool =
  | "queue_snapshot"
  | "followups_snapshot"
  | "system_health"
  | "todos_snapshot"
  | "contacts_snapshot"
  | "settings_snapshot"
  | "outreach_run"
  | "people_search"
  | "stale_threads_scan"
  | "stalled_talking_stage_scan"
  | "memory_recall_search"
  | "communication_plan_preview";

type ManagerArtifact =
  | {
      kind: "people_list";
      title: string;
      description: string;
      people: Array<{
        threadId?: string;
        title: string;
        provider?: string;
        lastMessageAt?: number;
        reason: string;
        confidence?: number;
        genderCue?: GenderInference["gender"];
        genderConfidence?: number;
        romanticFit?: "likely" | "unlikely" | "unknown";
        romanticFitReason?: string;
      }>;
    }
  | {
      kind: "communication_preview";
      title: string;
      description: string;
      previews: Array<{
        threadId?: string;
        title: string;
        messageIntent: string;
        previewText: string;
        requiresConfirmation: true;
      }>;
    };

type ToolResult = {
  tool: OrchestratorTool;
  status: "success" | "error";
  summary: string;
  data?: unknown;
  artifacts?: ManagerArtifact[];
};

type PeopleListArtifact = Extract<ManagerArtifact, { kind: "people_list" }>;
type CommunicationPreviewArtifact = Extract<ManagerArtifact, { kind: "communication_preview" }>;
type ArtifactPerson = PeopleListArtifact["people"][number];

function compactText(value: string, maxChars: number) {
  const trimmed = value.trim();
  if (trimmed.length <= maxChars) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxChars - 3)}...`;
}

function readString(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function readNumber(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function daysSince(ms: unknown) {
  const value = readNumber(ms);
  if (!value) {
    return null;
  }
  return Math.max(0, Math.round((Date.now() - value) / (24 * 60 * 60 * 1000)));
}

function threadPerson(value: unknown, reason: string, confidence?: number) {
  const row = asRecord(value);
  const provider = readString(row.provider);
  return {
    threadId: readString(row._id),
    title: readString(row.title, readString(row.jid, "Unknown contact")),
    ...(provider ? { provider } : {}),
    lastMessageAt: readNumber(row.lastMessageAt) || undefined,
    reason,
    ...(typeof confidence === "number" ? { confidence } : {}),
  };
}

function getUsefulKeywords(value: string) {
  const stopwords = new Set([
    "and",
    "are",
    "based",
    "been",
    "can",
    "did",
    "didnt",
    "do",
    "exactly",
    "find",
    "for",
    "from",
    "have",
    "haven",
    "havent",
    "in",
    "me",
    "old",
    "say",
    "send",
    "set",
    "stage",
    "stages",
    "talked",
    "talking",
    "that",
    "the",
    "them",
    "to",
    "what",
    "while",
    "who",
    "with",
    "work",
    "worked",
    "out",
  ]);
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 3 && !stopwords.has(word));
}

function uniquePeople(people: ArtifactPerson[], limit: number) {
  const seen = new Set<string>();
  const result: ArtifactPerson[] = [];
  for (const person of people) {
    const key = person.threadId || person.title.toLowerCase();
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(person);
    if (result.length >= limit) {
      break;
    }
  }
  return result;
}

const FEMALE_NAME_CUES = new Set([
  "abigail",
  "ada",
  "adanna",
  "adeola",
  "aisha",
  "amara",
  "amina",
  "angela",
  "anna",
  "annabel",
  "anita",
  "blessing",
  "christabel",
  "chiamaka",
  "chioma",
  "deborah",
  "divine",
  "elizabeth",
  "ella",
  "esther",
  "faith",
  "favour",
  "grace",
  "hannah",
  "ifeoma",
  "joy",
  "joyce",
  "jessica",
  "kemi",
  "mary",
  "mercy",
  "miracle",
  "ngozi",
  "peace",
  "precious",
  "princess",
  "rachael",
  "rachel",
  "rebecca",
  "ruth",
  "sarah",
  "sophia",
  "tolu",
  "victoria",
]);

const MALE_NAME_CUES = new Set([
  "abdul",
  "ade",
  "ayo",
  "daniel",
  "david",
  "emeka",
  "emmanuel",
  "geoffrey",
  "isaac",
  "james",
  "john",
  "joshua",
  "kelvin",
  "michael",
  "moses",
  "paul",
  "peter",
  "samuel",
  "solomon",
  "stephen",
  "tobi",
  "victor",
]);

function firstTitleToken(title: string) {
  return title
    .toLowerCase()
    .split(/\s+/)[0]
    ?.replace(/[^a-z]/g, "");
}

function scoreTextForGender(text: string) {
  const normalized = ` ${text.toLowerCase()} `;
  let female = 0;
  let male = 0;
  let nonbinary = 0;
  const femaleMatches = normalized.match(
    /\b(she|her|hers|woman|girl|girlfriend|babe|baby girl|beautiful|pretty|gorgeous|queen|princess|sis|sister|madam|ma)\b/g,
  );
  const maleMatches = normalized.match(/\b(he|him|his|man|guy|boy|boyfriend|bro|brother|boss|chief|king|sir|handsome|oga)\b/g);
  const nonbinaryMatches = normalized.match(/\b(nonbinary|non-binary|they\/them|their pronouns|genderfluid)\b/g);
  female += femaleMatches?.length || 0;
  male += maleMatches?.length || 0;
  nonbinary += nonbinaryMatches?.length || 0;
  return { female, male, nonbinary };
}

function inferGenderFromText(title: string, facts: unknown[], messages: unknown[]): GenderInference {
  const evidence: string[] = [];
  let female = 0;
  let male = 0;
  let nonbinary = 0;

  for (const fact of facts) {
    const row = asRecord(fact);
    const key = readString(row.factKey).toLowerCase();
    const value = readString(row.factValue).toLowerCase();
    if (!/(gender|pronoun|inferred)/i.test(`${key} ${value}`)) {
      continue;
    }
    const score = scoreTextForGender(`${key} ${value}`);
    female += score.female * 3;
    male += score.male * 3;
    nonbinary += score.nonbinary * 3;
    evidence.push(`saved fact: ${compactText(value, 70)}`);
  }

  const token = firstTitleToken(title);
  if (token && FEMALE_NAME_CUES.has(token)) {
    female += 1.6;
    evidence.push(`name cue: ${token}`);
  }
  if (token && MALE_NAME_CUES.has(token)) {
    male += 1.6;
    evidence.push(`name cue: ${token}`);
  }

  for (const message of messages.slice(-60)) {
    const row = asRecord(message);
    const text = readString(row.text);
    if (!text) {
      continue;
    }
    const direction = readString(row.direction);
    const weight = direction === "outbound" ? 1.25 : 0.8;
    const score = scoreTextForGender(text);
    female += score.female * weight;
    male += score.male * weight;
    nonbinary += score.nonbinary * weight;
    if (score.female || score.male || score.nonbinary) {
      evidence.push(compactText(text, 90));
    }
  }

  const scores = [
    ["female", female],
    ["male", male],
    ["nonbinary", nonbinary],
  ] as const;
  const [gender, score] = [...scores].sort((a, b) => b[1] - a[1])[0] || ["unknown", 0];
  const total = female + male + nonbinary;
  if (!score || total <= 0) {
    return { gender: "unknown", confidence: 0, reason: "No reliable gender cues found." };
  }
  const confidence = Math.min(0.95, Math.max(0.35, score / Math.max(total, 1)));
  return {
    gender,
    confidence,
    reason: `Inferred from ${evidence.length ? "saved facts, name, and chat language" : "weak cues"}.`,
    evidence: evidence[0],
  };
}

function normalizeGenderFromText(value: string): UserRomanticContext["ownGender"] {
  const text = value.toLowerCase();
  if (/\b(nonbinary|non-binary|genderfluid|they\/them)\b/.test(text)) {
    return "nonbinary";
  }
  if (/\b(woman|female|girl|lady|she\/her)\b/.test(text)) {
    return "female";
  }
  if (/\b(man|male|guy|boy|he\/him)\b/.test(text)) {
    return "male";
  }
  return "unknown";
}

function romanticTargetsFromText(value: string, ownGender: UserRomanticContext["ownGender"]) {
  const text = value.toLowerCase();
  const targets = new Set<"male" | "female" | "nonbinary">();
  if (/\b(women|woman|female|girls|ladies|girlfriend)\b/.test(text)) {
    targets.add("female");
  }
  if (/\b(men|man|male|guys|boys|boyfriend)\b/.test(text)) {
    targets.add("male");
  }
  if (/\b(nonbinary|non-binary|all genders|any gender|pan|pansexual|bisexual|bi)\b/.test(text)) {
    targets.add("male");
    targets.add("female");
    targets.add("nonbinary");
  }
  if (/\bstraight\b/.test(text)) {
    if (ownGender === "male") {
      targets.add("female");
    }
    if (ownGender === "female") {
      targets.add("male");
    }
  }
  return [...targets];
}

async function getUserRomanticContext(message: string): Promise<UserRomanticContext> {
  const config = await readLocalInstanceConfig().catch(() => null);
  const soul = config?.preferences?.soulProfile;
  const identityText = [soul?.genderIdentity, soul?.pronouns].filter(Boolean).join(" ");
  const preferenceText = [soul?.romanticPreference, soul?.relationshipStatus, soul?.romanticInterests].filter(Boolean).join(" ");
  const profileText = [identityText, preferenceText].filter(Boolean).join(" ");
  const messageGender = normalizeGenderFromText(message);
  const profileGender = normalizeGenderFromText(identityText);
  const ownGender = profileGender !== "unknown" ? profileGender : messageGender;
  const romanticTargets = romanticTargetsFromText(preferenceText, ownGender);
  const messageTargets = romanticTargetsFromText(message, ownGender);
  const targets = messageTargets.length ? messageTargets : romanticTargets;

  return {
    ownGender,
    romanticTargets: targets,
    source: profileText.trim() ? "soul_profile" : messageTargets.length || messageGender !== "unknown" ? "message" : "fallback",
    summary: profileText.trim() ? compactText(profileText, 180) : "No saved romantic preference profile found.",
  };
}

function isRomanticFilteringRequest(message: string) {
  return /\b(talking stage|talking stages|romantic|date|dating|crush|failed|fizzled|ghosted|relationship)\b/i.test(message);
}

function applyRomanticFit(person: ArtifactPerson, inference: GenderInference, context: UserRomanticContext) {
  const targetSet = new Set(context.romanticTargets);
  const hasTargets = targetSet.size > 0;
  const romanticFit =
    !hasTargets || inference.gender === "unknown" || inference.confidence < 0.5
      ? "unknown"
      : targetSet.has(inference.gender)
        ? "likely"
        : "unlikely";
  return {
    ...person,
    genderCue: inference.gender,
    genderConfidence: inference.confidence,
    romanticFit,
    romanticFitReason:
      romanticFit === "unlikely"
        ? `Filtered out by romantic preference (${context.romanticTargets.join(", ") || "not configured"}).`
        : romanticFit === "likely"
          ? `Matches romantic preference (${context.romanticTargets.join(", ")}).`
          : "Gender/preference fit is not confident enough to decide.",
  } satisfies ArtifactPerson;
}

function getThreadLabel(value: unknown) {
  const item = asRecord(value);
  const thread = asRecord(item.thread);
  return readString(thread.title, readString(thread.jid, "Unknown thread"));
}

function getPromptTools(message: string): OrchestratorTool[] {
  const normalized = message.toLowerCase();
  const tools = new Set<OrchestratorTool>();

  if (/\b(attention|priority|prioritize|what.*do|what.*now|today|overview|summary|stuck|blocked)\b/i.test(message)) {
    tools.add("queue_snapshot");
    tools.add("followups_snapshot");
    tools.add("system_health");
  }
  if (/\b(queue|draft|reply|approval|approve|guardrail|pending)\b/i.test(message)) {
    tools.add("queue_snapshot");
  }
  if (/\b(follow[\s-]?up|reminder|outreach due|check in|reach out)\b/i.test(message)) {
    tools.add("followups_snapshot");
  }
  if (/\b(system|health|runtime|worker|provider|error|latency|outbox|stuck)\b/i.test(message)) {
    tools.add("system_health");
  }
  if (/\b(todo|task|candidate|agenda)\b/i.test(message)) {
    tools.add("todos_snapshot");
  }
  if (/\b(contact|contacts|people|person|recent chat|recent thread|threads)\b/i.test(message)) {
    tools.add("contacts_snapshot");
  }
  if (/\b(find|search|scan|look for|who|people|person|classmate|school|friend|contact|talking stage|talking stages|stalled)\b/i.test(message)) {
    tools.add("people_search");
  }
  if (/\b(old|while|long time|haven't talked|havent talked|dormant|stale|inactive|reconnect|reach back)\b/i.test(message)) {
    tools.add("stale_threads_scan");
  }
  if (/\b(talking stage|talking stages|romantic|date|dating|stalled|didn'?t work|didnt work|fizzled|ghosted)\b/i.test(message)) {
    tools.add("stalled_talking_stage_scan");
  }
  if (/\b(find things|remember|mentioned|talked about|discussed|search chats|chat history|messages)\b/i.test(message)) {
    tools.add("memory_recall_search");
  }
  if (/\b(settings|config|configuration|autonomy|temperature|model|persona)\b/i.test(message)) {
    tools.add("settings_snapshot");
  }
  if (/\b(send|message|dm|text|reach out|follow up|remind|set a reminder|start new task|new task)\b/i.test(message)) {
    tools.add("communication_plan_preview");
  }
  if (/\b(run|start|trigger|execute)\b[\s\S]{0,40}\boutreach\b/i.test(message) || normalized === "outreach run") {
    tools.add("outreach_run");
  }

  return [...tools].slice(0, 7);
}

function formatQueueSnapshot(snapshot: unknown) {
  const data = asRecord(snapshot);
  const needsReply = asArray(data.needsReply);
  const followups = asArray(data.followupConfirmations);
  const todos = asArray(data.todoCandidates);
  const guardrails = asArray(data.guardrailFlags);
  const topDrafts = needsReply.slice(0, 3).map((item, index) => `${index + 1}. ${getThreadLabel(item)}`);
  return [
    `Queue: ${needsReply.length} replies, ${followups.length} follow-up confirmations, ${todos.length} todo candidates, ${guardrails.length} guardrails.`,
    topDrafts.length ? `Top reply threads:\n${topDrafts.join("\n")}` : "No reply drafts are currently waiting.",
  ].join("\n");
}

function formatFollowupsSnapshot(rows: unknown) {
  const items = asArray(rows);
  const now = Date.now();
  const overdue = items.filter((item) => readNumber(asRecord(item).dueAt) < now).length;
  const suggested = items.filter((item) => readString(asRecord(item).status) === "suggested").length;
  const top = items.slice(0, 4).map((item, index) => {
    const row = asRecord(item);
    return `${index + 1}. ${getThreadLabel(item)}: ${compactText(readString(row.reason, "No reason provided."), 90)}`;
  });
  return [
    `Follow-ups: ${items.length} visible, ${overdue} overdue, ${suggested} needing review.`,
    top.length ? `Soonest items:\n${top.join("\n")}` : "No follow-ups found.",
  ].join("\n");
}

function formatSystemHealth(health: unknown) {
  const data = asRecord(health);
  const metrics = asRecord(data.metrics);
  const alerts = asArray(data.alerts).map((item) => String(item));
  return [
    `System: ${alerts.length ? `${alerts.length} alert(s)` : "no active alerts"}.`,
    `Provider errors: ${readNumber(metrics.providerErrors)}/${readNumber(metrics.providerRunsWindow)}. Due outbox: ${readNumber(
      metrics.dueOutbox,
    )}. Open guardrails: ${readNumber(metrics.openGuardrails)}. Follow-up overdue: ${readNumber(metrics.followupOverdueCount)}.`,
    alerts.length ? `Alerts:\n${alerts.slice(0, 4).map((alert, index) => `${index + 1}. ${alert}`).join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function formatTodosSnapshot(snapshot: unknown) {
  const data = asRecord(snapshot);
  const todos = asArray(data.todos);
  const candidates = asArray(data.candidates);
  return `Todos: ${todos.length} open, ${candidates.length} suggested candidates.`;
}

function formatContactsSnapshot(rows: unknown) {
  const contacts = asArray(rows);
  const top = contacts.slice(0, 6).map((item, index) => {
    const row = asRecord(item);
    return `${index + 1}. ${readString(row.title, readString(row.jid, "Unknown contact"))} (${readString(row.provider, "provider")})`;
  });
  return [`Contacts: ${contacts.length} recent direct contacts.`, top.length ? top.join("\n") : ""].filter(Boolean).join("\n");
}

function formatSettingsSnapshot(settings: unknown) {
  const data = asRecord(settings);
  return [
    `Settings: autonomyPaused=${Boolean(data.autonomyPaused)}, outreachEnabled=${Boolean(data.outreachEnabled)}.`,
    `AI: modelFirst=${Boolean(data.aiModelFirstEnabled)}, fallback=${readString(data.aiFallbackMode, "default")}, qualityGate=${readString(
      data.qualityGateMode,
      "default",
    )}.`,
  ].join("\n");
}

function getContactTitle(value: unknown) {
  const row = asRecord(value);
  return readString(row.title, readString(row.jid, "Unknown contact"));
}

function buildPeopleSearchArtifact(message: string, connectorData: unknown, contactsData: unknown): PeopleListArtifact {
  const contacts = asArray(contactsData);
  const contactsById = new Map(
    contacts
      .map((contact) => [readString(asRecord(contact)._id), contact] as const)
      .filter(([id]) => id),
  );
  const hits = asArray(asRecord(connectorData).hits);
  const people: ArtifactPerson[] = [];

  for (const hit of hits) {
    const row = asRecord(hit);
    const threadId = readString(row.threadId);
    const contact = threadId ? contactsById.get(threadId) : undefined;
    const provider = contact ? readString(asRecord(contact).provider) : "";
    const source = readString(row.source, "memory");
    const snippet = compactText(readString(row.snippet, readString(row.title, "Matched stored context.")), 110);
    people.push({
      threadId: threadId || undefined,
      title: contact ? getContactTitle(contact) : readString(row.title, "Matched person or thread"),
      provider: provider || undefined,
      lastMessageAt: contact ? readNumber(asRecord(contact).lastMessageAt) || undefined : readNumber(row.updatedAt) || undefined,
      reason: `${source.replace(/_/g, " ")}: ${snippet}`,
      confidence: readNumber(row.score),
    });
  }

  const keywords = getUsefulKeywords(message);
  for (const contact of contacts) {
    const title = getContactTitle(contact);
    const haystack = `${title} ${readString(asRecord(contact).jid)} ${readString(asRecord(contact).provider)}`.toLowerCase();
    if (!keywords.length || !keywords.some((keyword) => haystack.includes(keyword))) {
      continue;
    }
    people.push(threadPerson(contact, "Contact name or provider matched the search.", 0.4));
  }

  const unique = uniquePeople(people, 14);
  return {
    kind: "people_list",
    title: "People found",
    description: unique.length
      ? "Possible matches from contacts, follow-ups, tasks, and remembered context."
      : "No confident people matches were found for this search yet.",
    people: unique,
  };
}

function buildStaleThreadsArtifact(contactsData: unknown): PeopleListArtifact {
  const people = asArray(contactsData)
    .filter((contact) => {
      const row = asRecord(contact);
      return !Boolean(row.isIgnored) && !Boolean(row.isArchived) && readNumber(row.lastMessageAt) > 0;
    })
    .sort((a, b) => readNumber(asRecord(a).lastMessageAt) - readNumber(asRecord(b).lastMessageAt))
    .slice(0, 12)
    .map((contact) => {
      const staleDays = daysSince(asRecord(contact).lastMessageAt);
      return threadPerson(contact, staleDays === null ? "No recent message timestamp." : `Last message was ${staleDays} day${staleDays === 1 ? "" : "s"} ago.`, 0.65);
    });

  return {
    kind: "people_list",
    title: "Dormant contacts",
    description: people.length ? "Direct contacts sorted by longest time since the last message." : "No dormant direct contacts found.",
    people,
  };
}

function buildStalledTalkingStagesArtifact(relationshipData: unknown, contactsData: unknown): PeopleListArtifact {
  const contactsById = new Map(
    asArray(contactsData)
      .map((contact) => [readString(asRecord(contact)._id), contact] as const)
      .filter(([id]) => id),
  );
  const rows = asArray(relationshipData);
  const scored = rows
    .map((state) => {
      const row = asRecord(state);
      const threadId = readString(row.threadId);
      const contact = contactsById.get(threadId);
      const reasons = [
        readNumber(row.warmthTrend, 1) <= 0 ? "warmth is flat or cooling" : "",
        Boolean(row.responsivenessMismatch) ? "response rhythm looks mismatched" : "",
        Boolean(row.repairNeeded) ? "repair may be needed" : "",
        Boolean(row.conflictFlag) ? "recent conflict signal" : "",
        readNumber(row.trustScore, 1) < 0.45 ? "low trust score" : "",
      ].filter(Boolean);
      const staleDays = daysSince(readNumber(row.lastInboundAt) || readNumber(row.updatedAt));
      if (staleDays !== null && staleDays >= 14) {
        reasons.push(`no strong recent inbound signal for ${staleDays} days`);
      }
      return {
        state,
        contact,
        threadId,
        score: reasons.length + (staleDays !== null ? Math.min(staleDays / 30, 2) : 0),
        reason: reasons.length ? reasons.join(", ") : readString(row.lastReason, "Romantic thread with no obvious blocker signal."),
      };
    })
    .filter((item) => item.score > 0 || rows.length <= 8)
    .sort((a, b) => b.score - a.score);

  const people = scored.slice(0, 12).map((item) => {
    const state = asRecord(item.state);
    if (item.contact) {
      return threadPerson(item.contact, item.reason, Math.min(0.95, 0.45 + item.score / 8));
    }
    return {
      threadId: item.threadId || undefined,
      title: item.threadId ? `Thread ${item.threadId.slice(-6)}` : "Romantic thread",
      lastMessageAt: readNumber(state.lastInboundAt) || readNumber(state.updatedAt) || undefined,
      reason: item.reason,
      confidence: Math.min(0.95, 0.45 + item.score / 8),
    };
  });

  return {
    kind: "people_list",
    title: "Stalled talking-stage candidates",
    description: people.length
      ? "Romantic-priority threads with stale, cooling, mismatch, or repair signals."
      : "No stalled romantic-priority threads were found.",
    people: uniquePeople(people, 12),
  };
}

function buildMemoryRecallArtifact(data: unknown): PeopleListArtifact {
  const people = uniquePeople(
    asArray(asRecord(data).evidence).map((evidence) => {
      const row = asRecord(evidence);
      return {
        threadId: readString(row.threadId) || undefined,
        title: readString(row.threadTitle, readString(row.threadJid, "Matched thread")),
        lastMessageAt: readNumber(row.messageAt) || undefined,
        reason: `${readString(row.speaker, "Evidence")}: ${compactText(readString(row.text, "Matched message."), 120)}`,
        confidence: readNumber(row.score),
      };
    }),
    8,
  );
  return {
    kind: "people_list",
    title: "Chat evidence",
    description: people.length ? "Threads with message evidence related to the request." : "No chat evidence was found for this request.",
    people,
  };
}

function extractCommunicationIntent(message: string) {
  const match = message.match(/\b(?:send|message|dm|text)\s+(?:them|him|her|people|contacts)?\s*(?:that|saying|about|to)?\s*([\s\S]{4,220})/i);
  const raw = match?.[1]?.trim();
  if (raw) {
    return compactText(raw.replace(/^[:,-]\s*/, ""), 180);
  }
  if (/\b(reminder|remind|set a reminder)\b/i.test(message)) {
    return "set a reminder or follow-up task";
  }
  if (/\b(reconnect|check in|reach out|haven'?t talked|havent talked)\b/i.test(message)) {
    return "gentle reconnect check-in";
  }
  return "draft a careful outreach message";
}

function firstName(title: string) {
  return title.split(/\s+/)[0]?.replace(/[^\p{L}\p{N}'-]/gu, "") || title;
}

function buildCommunicationPreview(message: string, results: ToolResult[]): CommunicationPreviewArtifact | null {
  const candidates = uniquePeople(
    results.flatMap((result) =>
      (result.artifacts || []).flatMap((artifact) => (artifact.kind === "people_list" ? artifact.people : [])),
    ),
    8,
  ).filter((person) => !/^(thread memory|matched person or thread)$/i.test(person.title.trim()));
  if (!candidates.length) {
    return null;
  }
  const intent = extractCommunicationIntent(message);
  return {
    kind: "communication_preview",
    title: "Communication preview",
    description: "Draft-only preview. These messages still need explicit review and approval before anything is sent.",
    previews: candidates.map((person) => ({
      threadId: person.threadId,
      title: person.title,
      messageIntent: intent,
      previewText:
        intent === "gentle reconnect check-in"
          ? `Hey ${firstName(person.title)}, been a while. Hope you've been good. Wanted to check in and see how you're doing.`
          : `Hey ${firstName(person.title)}, wanted to reach out about this: ${intent}`,
      requiresConfirmation: true,
    })),
  };
}

function attachCommunicationPreview(message: string, results: ToolResult[]) {
  const preview = buildCommunicationPreview(message, results);
  if (!preview) {
    return results;
  }
  return results.map((result) =>
    result.tool === "communication_plan_preview"
      ? {
          ...result,
          summary: `${preview.previews.length} draft communication preview${preview.previews.length === 1 ? "" : "s"} prepared for review. Nothing was sent.`,
          artifacts: [...(result.artifacts || []), preview],
        }
      : result,
  );
}

async function inferAndSaveGenderCue(convex: ReturnType<typeof createConvexClient>, person: ArtifactPerson) {
  if (!person.threadId) {
    return {
      inference: { gender: "unknown", confidence: 0, reason: "No thread available for gender inference." } satisfies GenderInference,
      title: person.title,
      lastMessageAt: person.lastMessageAt,
    };
  }

  const [threadData, factsData] = await Promise.all([
    convex.query(convexRefs.threadGet, {
      threadId: person.threadId,
      includeStatusMessages: false,
    }),
    convex
      .query(convexRefs.chatContactMemoryFactsList, {
        threadId: person.threadId,
        factType: "profile",
        limit: 40,
      })
      .catch(() => null),
  ]);
  const thread = asRecord(asRecord(threadData).thread);
  const messages = asArray(asRecord(threadData).messages);
  const facts = asArray(asRecord(factsData).facts);
  const title = readString(thread.title, person.title);
  const inference = inferGenderFromText(title, facts, messages);

  if (inference.gender !== "unknown" && inference.confidence >= 0.48) {
    await convex
      .mutation(convexRefs.chatUpsertContactMemoryFact, {
        threadId: person.threadId,
        factKey: "inferred_gender",
        factValue: `${inference.gender}; confidence ${Math.round(inference.confidence * 100)}%; ${inference.reason}`,
        factType: "profile",
        confidence: inference.confidence,
        sourceExcerpt: inference.evidence || inference.reason,
      })
      .catch(() => undefined);
  }

  return {
    inference,
    title,
    lastMessageAt: readNumber(thread.lastMessageAt) || person.lastMessageAt,
  };
}

async function enrichPeopleWithGenderAndPreference(message: string, results: ToolResult[]) {
  const people = uniquePeople(
    results.flatMap((result) =>
      (result.artifacts || []).flatMap((artifact) => (artifact.kind === "people_list" ? artifact.people : [])),
    ),
    32,
  ).filter((person) => person.threadId);
  if (!people.length) {
    return { results, context: await getUserRomanticContext(message), filteredCount: 0 };
  }

  const convex = createConvexClient();
  const context = await getUserRomanticContext(message);
  const shouldFilterRomantic = isRomanticFilteringRequest(message);
  const enrichedByKey = new Map<string, ArtifactPerson>();
  let filteredCount = 0;

  await Promise.all(
    people.map(async (person) => {
      const details = await inferAndSaveGenderCue(convex, person).catch(() => ({
        inference: { gender: "unknown", confidence: 0, reason: "Gender inference failed." } satisfies GenderInference,
        title: person.title,
        lastMessageAt: person.lastMessageAt,
      }));
      const enriched = applyRomanticFit(
        {
          ...person,
          title: details.title,
          lastMessageAt: details.lastMessageAt,
        },
        details.inference,
        context,
      );
      enrichedByKey.set(person.threadId || person.title.toLowerCase(), enriched);
    }),
  );

  const nextResults = results.map((result) => {
    const nextArtifacts = (result.artifacts || []).map((artifact) => {
      if (artifact.kind !== "people_list") {
        return artifact;
      }
      const nextPeople = artifact.people
        .map((person) => enrichedByKey.get(person.threadId || person.title.toLowerCase()) || person)
        .filter((person) => {
          if (!shouldFilterRomantic || person.romanticFit !== "unlikely") {
            return true;
          }
          filteredCount += 1;
          return false;
        });
      return {
        ...artifact,
        description:
          shouldFilterRomantic && context.romanticTargets.length
            ? `${artifact.description} Filtered for romantic preference: ${context.romanticTargets.join(", ")}.`
            : artifact.description,
        people: nextPeople,
      };
    });
    const removedForResult = (result.artifacts || []).reduce((sum, artifact, index) => {
      if (artifact.kind !== "people_list") {
        return sum;
      }
      const nextArtifact = nextArtifacts[index];
      return nextArtifact?.kind === "people_list" ? sum + Math.max(0, artifact.people.length - nextArtifact.people.length) : sum;
    }, 0);
    return {
      ...result,
      summary:
        shouldFilterRomantic && removedForResult
          ? `${result.summary} Filtered ${removedForResult} likely non-matching romantic candidate${removedForResult === 1 ? "" : "s"}.`
          : result.summary,
      artifacts: nextArtifacts,
    };
  });

  return { results: nextResults, context, filteredCount };
}

async function runTool(tool: OrchestratorTool, message: string): Promise<ToolResult> {
  const convex = createConvexClient();
  try {
    if (tool === "queue_snapshot") {
      const data = await convex.query(convexRefs.queueList, {
        draftLimit: 20,
        followupLimit: 20,
        todoLimit: 20,
        guardrailLimit: 20,
      });
      return { tool, status: "success", summary: formatQueueSnapshot(data), data };
    }
    if (tool === "followups_snapshot") {
      const data = await convex.query(convexRefs.followupsList, {
        limit: 40,
        status: "all",
        sort: "due_asc",
      });
      return { tool, status: "success", summary: formatFollowupsSnapshot(data), data };
    }
    if (tool === "system_health") {
      const data = await convex.query(convexRefs.systemHealth, {});
      return { tool, status: "success", summary: formatSystemHealth(data), data };
    }
    if (tool === "todos_snapshot") {
      const data = await convex.query(convexRefs.todosList, {
        todoLimit: 80,
        candidateLimit: 40,
      });
      return { tool, status: "success", summary: formatTodosSnapshot(data), data };
    }
    if (tool === "contacts_snapshot") {
      const data = await convex.query(convexRefs.threadsListContacts, {
        limit: 20,
        provider: "all",
      });
      return { tool, status: "success", summary: formatContactsSnapshot(data), data };
    }
    if (tool === "people_search") {
      const [connectorData, contactsData] = await Promise.all([
        convex.query(convexRefs.chatPersonalConnectorsInternalSearch, {
          query: message,
          maxResults: 20,
        }),
        convex.query(convexRefs.threadsListContacts, {
          limit: 500,
          provider: "all",
        }),
      ]);
      const artifact = buildPeopleSearchArtifact(message, connectorData, contactsData);
      return {
        tool,
        status: "success",
        summary: `People search found ${artifact.people.length} possible match${artifact.people.length === 1 ? "" : "es"}.`,
        data: connectorData,
        artifacts: [artifact],
      };
    }
    if (tool === "stale_threads_scan") {
      const data = await convex.query(convexRefs.threadsListContacts, {
        limit: 200,
        provider: "all",
      });
      const artifact = buildStaleThreadsArtifact(data);
      return {
        tool,
        status: "success",
        summary: `Stale-thread scan found ${artifact.people.length} dormant direct contact${artifact.people.length === 1 ? "" : "s"}.`,
        data,
        artifacts: [artifact],
      };
    }
    if (tool === "stalled_talking_stage_scan") {
      const [relationshipData, contactsData] = await Promise.all([
        convex.query(convexRefs.relationshipStateListByPriorityTier, {
          priorityTier: "romantic",
          limit: 80,
        }),
        convex.query(convexRefs.threadsListContacts, {
          limit: 220,
          provider: "all",
        }),
      ]);
      const artifact = buildStalledTalkingStagesArtifact(relationshipData, contactsData);
      return {
        tool,
        status: "success",
        summary: `Talking-stage scan found ${artifact.people.length} candidate${artifact.people.length === 1 ? "" : "s"} to review.`,
        data: relationshipData,
        artifacts: [artifact],
      };
    }
    if (tool === "memory_recall_search") {
      const data = await convex.query(convexRefs.chatConversationRecallQuery, {
        query: message,
        limit: 8,
      });
      const artifact = buildMemoryRecallArtifact(data);
      const answer = readString(asRecord(data).answer, "Conversation recall completed.");
      return {
        tool,
        status: "success",
        summary: `${answer} Evidence threads: ${artifact.people.length}.`,
        data,
        artifacts: [artifact],
      };
    }
    if (tool === "communication_plan_preview") {
      return {
        tool,
        status: "success",
        summary: "Communication preview staged. Waiting for scan results to choose recipients. Nothing was sent.",
        data: { requiresConfirmation: true },
      };
    }
    if (tool === "settings_snapshot") {
      const data = await convex.query(convexRefs.settingsGet, {});
      return { tool, status: "success", summary: formatSettingsSnapshot(data), data };
    }
    if (tool === "outreach_run") {
      const data = await convex.mutation(convexRefs.outreachRunManual, {});
      const result = asRecord(data);
      return {
        tool,
        status: "success",
        summary: `Outreach run completed: queued=${readNumber(result.queued)}, eligible=${readNumber(
          result.eligibleCount,
        )}, configured=${readNumber(result.configuredCount)}, reason=${readString(result.reason, "n/a")}.`,
        data,
      };
    }
    return {
      tool,
      status: "error",
      summary: `${tool} is not wired to a safe manager action yet.`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      tool,
      status: "error",
      summary: `${tool} failed: ${compactText(message, 240)}`,
    };
  }
}

function normalizeHistory(value: unknown): ChatHistoryItem[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => {
      const row = asRecord(item);
      const role = row.role === "assistant" ? "assistant" : row.role === "user" ? "user" : null;
      const text = readString(row.text);
      if (!role || !text) {
        return null;
      }
      return { role, text: compactText(text, 1200) };
    })
    .filter((item): item is ChatHistoryItem => Boolean(item))
    .slice(-MAX_HISTORY_MESSAGES);
}

function buildHistoryLines(history: ChatHistoryItem[]) {
  return history.map((item) => `${item.role === "user" ? "User" : "Life Manager"}: ${item.text}`);
}

const managerInstruction = [
  "You are the Life Manager dashboard orchestrator manager.",
  "The user is chatting with you directly from the Home screen to inspect state, plan work, and trigger safe app actions.",
  "Use TOOL RESULTS as authoritative current state. Never claim an action happened unless a tool result says it succeeded.",
  "When visible UI artifacts are available, tell the user the results are already shown in the chat instead of sending them to another page.",
  "When a romantic filter context is present, respect the user's romantic preferences. Treat gender as an inferred cue with confidence, not a certainty.",
  "For communication requests, treat listed recipients and draft previews as plans that still need explicit user approval before any external send.",
  "Be concise, operational, and specific. Prefer bullets only when they make the next action clearer.",
  "When the user asks you to do something outside available tools, explain what you can do now and which page or next step is needed.",
].join("\n");

export async function POST(request: Request) {
  const unauthorized = await requireInstanceApiAccess(request);
  if (unauthorized) {
    return unauthorized;
  }

  let body: { message?: unknown; history?: unknown };
  try {
    body = (await request.json()) as { message?: unknown; history?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const message = readString(body.message);
  if (!message) {
    return NextResponse.json({ error: "Message is required." }, { status: 400 });
  }
  if (message.length > MAX_MESSAGE_CHARS) {
    return NextResponse.json({ error: `Message is too long. Keep it under ${MAX_MESSAGE_CHARS} characters.` }, { status: 400 });
  }

  const startedAt = Date.now();
  const history = normalizeHistory(body.history);
  const requestedTools = getPromptTools(message);
  const rawToolResults = await Promise.all(requestedTools.map((tool) => runTool(tool, message)));
  const enriched = await enrichPeopleWithGenderAndPreference(message, rawToolResults);
  const toolResults = attachCommunicationPreview(message, enriched.results);
  const artifacts = toolResults.flatMap((result) => result.artifacts || []);
  const artifactContext = artifacts.length
    ? [
        `VISIBLE UI ARTIFACTS (${artifacts.length})`,
        ...artifacts.map((artifact) =>
          artifact.kind === "people_list"
            ? `- ${artifact.title}: ${artifact.people.length} people shown in chat.`
            : `- ${artifact.title}: ${artifact.previews.length} draft previews shown in chat; approval required before sending.`,
        ),
      ].join("\n")
    : "";
  const toolContext = toolResults.length
    ? [
        `TOOL RESULTS (${toolResults.length})`,
        ...toolResults.map((result) => `- ${result.tool}: ${result.summary}`),
        isRomanticFilteringRequest(message)
          ? `ROMANTIC FILTER CONTEXT: ownGender=${enriched.context.ownGender}; targets=${
              enriched.context.romanticTargets.join(",") || "not configured"
            }; source=${enriched.context.source}; filtered=${enriched.filteredCount}.`
          : "",
        artifactContext,
      ]
        .filter(Boolean)
        .join("\n")
    : "No direct dashboard tool matched. Treat this as a planning/chat request.";

  const convex = createConvexClient();
  const runtimeSettings = (await convex.query(convexRefs.settingsGet, {}).catch(() => null)) as RuntimeSettings | null;

  await convex
    .mutation(convexRefs.systemRecordEvent, {
      source: "dashboard",
      eventType: "orchestrator.chat.requested",
      detail: compactText(`tools=${requestedTools.join(",") || "none"} message=${message}`, 260),
    })
    .catch(() => undefined);

  try {
    const aiResult = await generateReplyWithFallback({
      inboundText: message,
      historyLines: buildHistoryLines(history),
      styleHints: [toolContext],
      runtime: {
        temperature: runtimeSettings?.aiTemperature,
        maxOutputTokens: runtimeSettings?.aiMaxOutputTokens,
        maxReplyChars: runtimeSettings?.aiMaxReplyChars,
        historyLineLimit: runtimeSettings?.aiHistoryLineLimit,
        fallbackMode: runtimeSettings?.aiFallbackMode,
        modelFirstEnabled: runtimeSettings?.aiModelFirstEnabled,
        deterministicModes: runtimeSettings?.aiDeterministicModes,
        ackRoutingEnabled: runtimeSettings?.aiAckRoutingEnabled,
        replyPolicyInstruction: runtimeSettings?.aiReplyPolicy || "",
        systemInstruction: [runtimeSettings?.aiSystemInstruction || "", managerInstruction].filter(Boolean).join("\n\n"),
        activePersonaPackId: runtimeSettings?.activePersonaPackId || "",
        activePersonaPackIdsByProfile: runtimeSettings?.activePersonaPackIdsByProfile || {},
        qualityGateMode: runtimeSettings?.qualityGateMode,
        qualityGateThreshold: runtimeSettings?.qualityGateThreshold,
        soulModeEnabled: runtimeSettings?.soulModeEnabled,
        selfRoastModeEnabled: runtimeSettings?.selfRoastModeEnabled,
        funnyStatusKeywords: runtimeSettings?.funnyStatusKeywords,
        funnyStatusEmojis: runtimeSettings?.funnyStatusEmojis,
        delayMinMs: runtimeSettings?.humanDelayMinMs,
        delayMaxMs: runtimeSettings?.humanDelayMaxMs,
        typingMinMs: runtimeSettings?.humanTypingMinMs,
        typingMaxMs: runtimeSettings?.humanTypingMaxMs,
      },
    });

    await convex
      .mutation(convexRefs.systemRecordEvent, {
        source: "dashboard",
        eventType: aiResult.guardrailBlocked ? "orchestrator.chat.blocked" : "orchestrator.chat.completed",
        detail: aiResult.guardrailBlocked
          ? aiResult.guardrailReason || "Orchestrator chat blocked."
          : compactText(
              `provider=${aiResult.provider} model=${aiResult.model} latency=${aiResult.latencyMs}ms tools=${
                requestedTools.join(",") || "none"
              }`,
              260,
            ),
      })
      .catch(() => undefined);

    return NextResponse.json({
      replyText: aiResult.text,
      guardrailBlocked: aiResult.guardrailBlocked,
      guardrailReason: aiResult.guardrailReason,
      latencyMs: Date.now() - startedAt,
      provider: aiResult.provider,
      model: aiResult.model,
      manager: {
        toolsRequested: requestedTools,
        toolResults: toolResults.map((result) => ({
          tool: result.tool,
          status: result.status,
          summary: result.summary,
          artifactCount: result.artifacts?.length || 0,
        })),
        artifacts,
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Could not run orchestrator manager.";
    await convex
      .mutation(convexRefs.systemRecordEvent, {
        source: "dashboard",
        eventType: "orchestrator.chat.failed",
        detail: compactText(errorMessage, 260),
      })
      .catch(() => undefined);
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
