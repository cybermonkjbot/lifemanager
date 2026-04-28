import { createConvexClient } from "@/lib/convex-server";
import { convexRefs } from "@/lib/convex-refs";
import { readLocalInstanceConfig } from "@/lib/instance-config";
import { requireInstanceApiAccess } from "@/lib/instance-guard";
import { getManagedAiRuntimeOverrides } from "@/lib/managed-secrets-server";
import { rateLimitJsonResponse } from "@/lib/rate-limit";
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
  quietHoursEnabled?: boolean;
  quietHoursStartHour?: number;
  quietHoursEndHour?: number;
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
  | "current_artifact_context"
  | "campaign_plan"
  | "cohort_scan"
  | "stale_threads_scan"
  | "stalled_talking_stage_scan"
  | "memory_recall_search"
  | "communication_plan_preview";

type ManagerArtifact =
  | {
      kind: "people_list";
      title: string;
      description: string;
      display?: {
        showGender?: boolean;
        showRomanticFit?: boolean;
        showMatchFactors?: boolean;
        showConfidence?: boolean;
        showLastSeen?: boolean;
        showProvider?: boolean;
      };
      people: Array<{
        threadId?: string;
        title: string;
        provider?: string;
        lastMessageAt?: number;
        reason: string;
        confidence?: number;
        matchFactors?: string[];
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
    }
  | {
      kind: "campaign_plan";
      title: string;
      description: string;
      objective: string;
      audienceSummary: string;
      estimatedRecipients: number;
      contentType: "text" | "meme" | "status" | "mixed";
      channels: string[];
      steps: Array<{
        label: string;
        detail: string;
        status: "ready" | "needs_review" | "blocked";
      }>;
      safetyNotes: string[];
      nextPrompts: string[];
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

function normalizeHour(value: unknown, fallback: number) {
  const numberValue = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : fallback;
  return Math.max(0, Math.min(23, numberValue));
}

function isWithinHourWindow(nowHour: number, startHour: number, endHour: number) {
  if (startHour === endHour) {
    return false;
  }
  if (startHour < endHour) {
    return nowHour >= startHour && nowHour < endHour;
  }
  return nowHour >= startHour || nowHour < endHour;
}

function nextHourWindowEndMs(nowMs: number, startHour: number, endHour: number) {
  const now = new Date(nowMs);
  const end = new Date(nowMs);
  end.setHours(endHour, 0, 0, 0);
  if (startHour > endHour && now.getHours() >= startHour) {
    end.setDate(end.getDate() + 1);
  }
  if (end.getTime() <= nowMs) {
    end.setDate(end.getDate() + 1);
  }
  return end.getTime();
}

function formatQuietHoursPolicy(settings: RuntimeSettings | null) {
  const now = Date.now();
  const startHour = normalizeHour(settings?.quietHoursStartHour, 23);
  const endHour = normalizeHour(settings?.quietHoursEndHour, 7);
  const enabled = settings?.quietHoursEnabled === true;
  const active = enabled && isWithinHourWindow(new Date(now).getHours(), startHour, endHour);
  const nextAllowedAt = active ? nextHourWindowEndMs(now, startHour, endHour) : null;
  if (!enabled) {
    return "QUIET HOURS POLICY: disabled.";
  }
  return `QUIET HOURS POLICY: ${active ? "active" : "inactive"} (${startHour}:00-${endHour}:00).${
    active && nextAllowedAt ? ` For send actions, tell the user quiet hours are active and the UI will let them either ignore quiet hours or schedule after ${new Date(nextAllowedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.` : ""
  }`;
}
type CampaignPlanArtifact = Extract<ManagerArtifact, { kind: "campaign_plan" }>;
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

function normalizeManagerArtifacts(value: unknown): ManagerArtifact[] {
  const normalized: ManagerArtifact[] = [];
  for (const artifact of asArray(value)) {
    const row = asRecord(artifact);
    const kind = readString(row.kind);
    if (kind === "people_list") {
      const people: ArtifactPerson[] = [];
      for (const person of asArray(row.people)) {
        const personRow = asRecord(person);
        const title = readString(personRow.title);
        if (!title) {
          continue;
        }
        const threadId = readString(personRow.threadId);
        const provider = readString(personRow.provider);
        const lastMessageAt = readNumber(personRow.lastMessageAt);
        const confidence = readNumber(personRow.confidence);
        const genderConfidence = readNumber(personRow.genderConfidence);
        const matchFactors = asArray(personRow.matchFactors)
          .map((item) => readString(item))
          .filter(Boolean)
          .slice(0, 5);
        const genderCue =
          personRow.genderCue === "male" ||
          personRow.genderCue === "female" ||
          personRow.genderCue === "nonbinary" ||
          personRow.genderCue === "unknown"
            ? personRow.genderCue
            : undefined;
        const romanticFit =
          personRow.romanticFit === "likely" || personRow.romanticFit === "unlikely" || personRow.romanticFit === "unknown"
            ? personRow.romanticFit
            : undefined;
        people.push({
          ...(threadId ? { threadId } : {}),
          title,
          ...(provider ? { provider } : {}),
          ...(lastMessageAt ? { lastMessageAt } : {}),
          reason: compactText(readString(personRow.reason, "Visible result from the current Home chat."), 180),
          ...(confidence ? { confidence } : {}),
          ...(matchFactors.length ? { matchFactors } : {}),
          ...(genderCue ? { genderCue } : {}),
          ...(genderConfidence ? { genderConfidence } : {}),
          ...(romanticFit ? { romanticFit } : {}),
          ...(readString(personRow.romanticFitReason) ? { romanticFitReason: readString(personRow.romanticFitReason) } : {}),
        });
      }
      normalized.push({
        kind: "people_list",
        title: compactText(readString(row.title, "Previous visible list"), 80),
        description: compactText(readString(row.description, "Result carried forward from the current Home chat."), 220),
        display: asRecord(row.display) as PeopleListArtifact["display"],
        people: people.slice(0, 24),
      });
    }
    if (kind === "communication_preview") {
      const previews: CommunicationPreviewArtifact["previews"] = [];
      for (const preview of asArray(row.previews)) {
        const previewRow = asRecord(preview);
        const title = readString(previewRow.title);
        const previewText = readString(previewRow.previewText);
        if (!title || !previewText) {
          continue;
        }
        const threadId = readString(previewRow.threadId);
        previews.push({
          ...(threadId ? { threadId } : {}),
          title,
          messageIntent: compactText(readString(previewRow.messageIntent, "follow-up from the visible preview"), 140),
          previewText: compactText(previewText, 260),
          requiresConfirmation: true,
        });
      }
      normalized.push({
        kind: "communication_preview",
        title: compactText(readString(row.title, "Previous visible previews"), 80),
        description: compactText(readString(row.description, "Previews carried forward from the current Home chat."), 220),
        previews: previews.slice(0, 16),
      });
    }
  }
  return normalized;
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
    "about",
    "and",
    "are",
    "based",
    "been",
    "can",
    "conversation",
    "conversations",
    "did",
    "didnt",
    "do",
    "exactly",
    "factor",
    "factors",
    "find",
    "for",
    "from",
    "group",
    "groups",
    "have",
    "haven",
    "havent",
    "histories",
    "history",
    "in",
    "me",
    "old",
    "people",
    "person",
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
    "type",
    "types",
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

function expandCohortKeywords(message: string) {
  const keywords = new Set(getUsefulKeywords(message));
  const normalized = message.toLowerCase();
  const expansions: Array<[RegExp, string[]]> = [
    [/\b(classmate|school|course|university|college|campus|secondary|department)\b/i, ["classmate", "school", "course", "university", "college", "campus", "department"]],
    [/\b(work|professional|client|customer|vendor|business|office|colleague|coworker)\b/i, ["work", "client", "business", "office", "colleague", "professional", "vendor"]],
    [/\b(family|sibling|brother|sister|cousin|mum|mom|dad|aunt|uncle)\b/i, ["family", "brother", "sister", "cousin", "mum", "mom", "dad", "aunt", "uncle"]],
    [/\b(church|mosque|faith|pastor|imam|fellowship)\b/i, ["church", "mosque", "faith", "pastor", "imam", "fellowship"]],
    [/\b(gym|fitness|workout|sport|football|basketball)\b/i, ["gym", "fitness", "workout", "sport", "football", "basketball"]],
    [/\b(money|finance|investment|invest)\b/i, ["money", "finance", "invest", "investment"]],
    [/\b(forex|crypto|trading)\b/i, ["forex", "crypto", "trading", "broker", "market"]],
    [/\b(creative|music|artist|design|photo|video|content)\b/i, ["creative", "music", "artist", "design", "photo", "video", "content"]],
  ];
  for (const [pattern, words] of expansions) {
    if (pattern.test(normalized)) {
      for (const word of words) {
        keywords.add(word);
      }
    }
  }
  return [...keywords].slice(0, 28);
}

function scoreKeywordText(text: string, keywords: string[], weight: number) {
  const normalized = text.toLowerCase();
  let score = 0;
  const matched: string[] = [];
  for (const keyword of keywords) {
    if (normalized.includes(keyword)) {
      score += weight;
      matched.push(keyword);
    }
  }
  return { score, matched };
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
  "dorcas",
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
  "ebrahim",
  "eebraheem",
  "emeka",
  "emmanuel",
  "geoffrey",
  "ibraheem",
  "ibrahim",
  "isaac",
  "james",
  "john",
  "joshua",
  "kelvin",
  "mamman",
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
  const compact = title
    .toLowerCase()
    .split(/\s+/)[0]
    ?.replace(/[^a-z]/g, "");
  return compact && compact.length > 1 ? compact : undefined;
}

function isLikelyOrganizationTitle(title: string) {
  return /\b(ltd|limited|llc|inc|company|co\.?|homes|global|properties|realty|ventures|enterprise|studio|beauty|touch|salon|store|shop|services|foundation|school|church|mosque|ministry|official|support|customer|vendor|animal|abattoir)\b/i.test(
    title,
  );
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

function genderCueFromManualOverride(value: string): GenderInference["gender"] | null {
  const normalized = ` ${value.toLowerCase()} `;
  if (/\b(unknown|unsure|not sure|do not infer|don't infer)\b/.test(normalized)) {
    return "unknown";
  }
  if (/\b(nonbinary|non-binary|genderfluid|they\/them)\b/.test(normalized)) {
    return "nonbinary";
  }
  if (/\b(female|woman|girl|lady|she\/her)\b/.test(normalized)) {
    return "female";
  }
  if (/\b(male|man|guy|boy|he\/him)\b/.test(normalized)) {
    return "male";
  }
  return null;
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
    if (key === "profile_gender_override" || key === "gender_override") {
      const overrideGender = genderCueFromManualOverride(value);
      if (overrideGender) {
        return {
          gender: overrideGender,
          confidence: overrideGender === "unknown" ? 1 : Math.max(0.85, readNumber(row.confidence, 0.99)),
          reason:
            overrideGender === "unknown"
              ? "Manual correction in conversation settings says gender is unknown."
              : "Manual correction in conversation settings.",
          evidence: compactText(value, 90),
        };
      }
    }
    if (!/(gender|pronoun|inferred)/i.test(`${key} ${value}`)) {
      continue;
    }
    const score = scoreTextForGender(`${key} ${value}`);
    const factWeight = key === "inferred_gender" ? 0.9 : 3;
    female += score.female * factWeight;
    male += score.male * factWeight;
    nonbinary += score.nonbinary * factWeight;
    evidence.push(`saved fact: ${compactText(value, 70)}`);
  }

  const token = firstTitleToken(title);
  if (token && FEMALE_NAME_CUES.has(token)) {
    female += 2.2;
    evidence.push(`name cue: ${token}`);
  }
  if (token && MALE_NAME_CUES.has(token)) {
    male += 2.2;
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
  const normalized = message.toLowerCase();
  if (/\b(talking stage|talking stages|romantic|date|dating|crush|fizzled|ghosted|relationship)\b/i.test(normalized)) {
    return true;
  }
  return /\b(failed|stalled|didn'?t work|didnt work)\b/i.test(normalized) && /\b(talking stage|date|dating|romantic|crush|relationship)\b/i.test(normalized);
}

function targetGendersFromRequest(message: string): GenderInference["gender"][] {
  const text = ` ${message.toLowerCase()} `;
  const targets = new Set<GenderInference["gender"]>();
  if (/\b(women|woman|female|girls|ladies|girlfriend|she\/her)\b/.test(text)) {
    targets.add("female");
  }
  if (/\b(men|man|male|guys|boys|boyfriend|he\/him)\b/.test(text)) {
    targets.add("male");
  }
  if (/\b(nonbinary|non-binary|genderfluid|they\/them)\b/.test(text)) {
    targets.add("nonbinary");
  }
  return [...targets];
}

function isGenderCueRequest(message: string) {
  return targetGendersFromRequest(message).length > 0 || /\b(gender|pronoun|pronouns|identity)\b/i.test(message);
}

function isCurrentArtifactFollowupRequest(message: string) {
  const normalized = message.toLowerCase();
  const referencesVisibleThing = /\b(this|these|those|them|that|it|list|result|results|people|contacts|matches|previews|drafts|strongest|same)\b/i.test(
    normalized,
  );
  const wantsFollowupAction =
    /\b(filter|narrow|sort|rank|draft|rewrite|send|message|dm|text|remind|reminder|follow[\s-]?up|task|todo|explain|evidence|context|more|stronger|safest|warmest|review)\b/i.test(
      normalized,
    );
  return referencesVisibleThing && wantsFollowupAction;
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

function withPeopleListDisplay(results: ToolResult[], display: NonNullable<PeopleListArtifact["display"]>) {
  return results.map((result) => ({
    ...result,
    artifacts: (result.artifacts || []).map((artifact) => (artifact.kind === "people_list" ? { ...artifact, display } : artifact)),
  }));
}

function buildCurrentArtifactContextResult(artifacts: ManagerArtifact[]): ToolResult | null {
  if (!artifacts.length) {
    return null;
  }
  const peopleCount = artifacts.reduce((sum, artifact) => (artifact.kind === "people_list" ? sum + artifact.people.length : sum), 0);
  const previewCount = artifacts.reduce((sum, artifact) => (artifact.kind === "communication_preview" ? sum + artifact.previews.length : sum), 0);
  return {
    tool: "current_artifact_context",
    status: "success",
    summary: `Carried forward the current visible result context: ${peopleCount} people and ${previewCount} previews. Use this as the target for follow-up wording like this, these, them, the list, or the results.`,
    artifacts,
  };
}

function getThreadLabel(value: unknown) {
  const item = asRecord(value);
  const thread = asRecord(item.thread);
  return readString(thread.title, readString(thread.jid, "Unknown thread"));
}

function getPromptTools(message: string): OrchestratorTool[] {
  const normalized = message.toLowerCase();
  const tools = new Set<OrchestratorTool>();
  const queueFocusedIntent = isQueueFocusedRequest(message);
  const campaignIntent = isCampaignRequest(message);
  const cohortIntent =
    /\b(group|groups|type|types|factor|factors|based on|conversation histor|talked with|talked about|messages with|people i|contacts who|classmates|school|work|family|church|gym|forex|crypto|trading)\b/i.test(
      message,
    );

  if (/\b(attention|priority|prioritize|what.*do|what.*now|today|overview|summary|stuck|blocked)\b/i.test(message)) {
    tools.add("queue_snapshot");
    tools.add("followups_snapshot");
    tools.add("system_health");
  }
  if (queueFocusedIntent) {
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
  if (campaignIntent) {
    tools.add("campaign_plan");
    tools.add("contacts_snapshot");
  }
  if (!queueFocusedIntent && !cohortIntent && /\b(find|search|scan|look for|who|people|person|classmate|school|friend|contact|talking stage|talking stages|stalled)\b/i.test(message)) {
    tools.add("people_search");
  }
  if (!queueFocusedIntent && (cohortIntent || /\b(find|search|scan|look for|show|list|group|people|contacts|classmate|school|work|family|church|gym|forex|crypto|music|history|messages|talked about)\b/i.test(message))) {
    tools.add("cohort_scan");
  }
  if (/\b(old|while|long time|haven't talked|havent talked|dormant|stale|inactive|reconnect|reach back)\b/i.test(message)) {
    tools.add("stale_threads_scan");
  }
  if (isRomanticFilteringRequest(message)) {
    tools.add("stalled_talking_stage_scan");
  }
  if (/\b(find things|remember|mentioned|talked about|discussed|search chats|chat history|messages)\b/i.test(message)) {
    tools.add("memory_recall_search");
  }
  if (/\b(settings|config|configuration|autonomy|temperature|model|persona)\b/i.test(message)) {
    tools.add("settings_snapshot");
  }
  if (isCommunicationPreviewRequest(message)) {
    tools.add("communication_plan_preview");
  }
  if (/\b(run|start|trigger|execute)\b[\s\S]{0,40}\boutreach\b/i.test(message) || normalized === "outreach run") {
    tools.add("outreach_run");
  }

  return [...tools].slice(0, 8);
}

function formatQueueSnapshot(snapshot: unknown) {
  const data = asRecord(snapshot);
  const needsReply = asArray(data.needsReply);
  const followups = asArray(data.followupConfirmations);
  const todos = asArray(data.todoCandidates);
  const guardrails = asArray(data.guardrailFlags);
  const topDrafts = needsReply.slice(0, 3).map((item, index) => `${index + 1}. ${getThreadLabel(item)}`);
  return [
    `Review: ${needsReply.length} replies, ${followups.length} follow-up confirmations, ${todos.length} task suggestions, ${guardrails.length} safety flags.`,
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
    )}. Open safety flags: ${readNumber(metrics.openGuardrails)}. Follow-up overdue: ${readNumber(metrics.followupOverdueCount)}.`,
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

function isAttentionOverviewRequest(message: string) {
  return /\b(attention|priority|prioritize|what.*do|what.*now|today|overview|summary|look into|handle|urgent)\b/i.test(message);
}

function isQueueFocusedRequest(message: string) {
  return /\b(queue|reply|replies|approval|approve|guardrail|pending|risky|riskiest)\b/i.test(message);
}

function isCommunicationPreviewRequest(message: string) {
  return /\b(send|message|dm|text|draft|rewrite|preview|reach out|follow[\s-]?up|remind|set a reminder|start new task|new task)\b/i.test(message);
}

function isCampaignRequest(message: string) {
  return /\b(campaign|marketing|mass|bulk|blast|broadcast|everyone|everybody|all contacts|all my|many people|send .{0,80}(everyone|everybody|all|list)|meme|memes|status|story|promo|promotion|announce|announcement)\b/i.test(
    message,
  );
}

function topFollowupLines(rows: unknown[], limit: number) {
  return rows.slice(0, limit).map((item, index) => {
    const row = asRecord(item);
    const dueAt = readNumber(row.dueAt);
    const dueText = dueAt ? ` due ${daysSince(dueAt) === 0 ? "today" : formatRelativeDays(dueAt)}` : "";
    return `${index + 1}. ${getThreadLabel(item)}: ${compactText(readString(row.reason, "No reason captured."), 95)}${dueText}`;
  });
}

function formatRelativeDays(timestamp: number) {
  const diffDays = Math.round((Date.now() - timestamp) / (24 * 60 * 60 * 1000));
  if (diffDays > 0) {
    return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
  }
  if (diffDays < 0) {
    const ahead = Math.abs(diffDays);
    return `in ${ahead} day${ahead === 1 ? "" : "s"}`;
  }
  return "today";
}

function buildAttentionOverviewReply(toolResults: ToolResult[]) {
  const queue = asRecord(toolResults.find((result) => result.tool === "queue_snapshot")?.data);
  const followups = asArray(toolResults.find((result) => result.tool === "followups_snapshot")?.data);
  const health = asRecord(toolResults.find((result) => result.tool === "system_health")?.data);
  const metrics = asRecord(health.metrics);
  const alerts = asArray(health.alerts).map((item) => String(item));

  const needsReply = asArray(queue.needsReply);
  const followupConfirmations = asArray(queue.followupConfirmations);
  const todoCandidates = asArray(queue.todoCandidates);
  const guardrails = asArray(queue.guardrailFlags);
  const now = Date.now();
  const overdueFollowups = followups.filter((item) => {
    const row = asRecord(item);
    const dueAt = readNumber(row.dueAt);
    return dueAt > 0 && dueAt < now;
  });
  const suggestedFollowups = followups.filter((item) => readString(asRecord(item).status) === "suggested");
  const providerErrors = readNumber(metrics.providerErrors);
  const openSafetyFlags = readNumber(metrics.openGuardrails) + guardrails.length;

  const priorities: string[] = [];
  if (overdueFollowups.length > 0) {
    priorities.push(`${overdueFollowups.length} overdue follow-up${overdueFollowups.length === 1 ? "" : "s"} need review.`);
  }
  if (suggestedFollowups.length > 0) {
    priorities.push(`${suggestedFollowups.length} suggested follow-up${suggestedFollowups.length === 1 ? "" : "s"} need a decision.`);
  }
  if (needsReply.length > 0) {
    priorities.push(`${needsReply.length} reply draft${needsReply.length === 1 ? "" : "s"} are waiting.`);
  }
  if (followupConfirmations.length > 0) {
    priorities.push(`${followupConfirmations.length} follow-up confirmation${followupConfirmations.length === 1 ? "" : "s"} are in the queue.`);
  }
  if (todoCandidates.length > 0) {
    priorities.push(`${todoCandidates.length} task suggestion${todoCandidates.length === 1 ? "" : "s"} need review.`);
  }
  if (openSafetyFlags > 0) {
    priorities.push(`${openSafetyFlags} safety flag${openSafetyFlags === 1 ? "" : "s"} need attention.`);
  }
  if (alerts.length > 0) {
    priorities.push(`${alerts.length} system alert${alerts.length === 1 ? "" : "s"} are active.`);
  }

  const lines = priorities.length
    ? ["You do have things to look into:", ...priorities.map((item) => `- ${item}`)]
    : ["Nothing is currently waiting in queue, follow-ups, task suggestions, safety flags, or system alerts."];

  const topOverdue = topFollowupLines(overdueFollowups, 4);
  if (topOverdue.length) {
    lines.push("", "Start with overdue follow-ups:", ...topOverdue.map((item) => `- ${item}`));
  }

  if (providerErrors > 0 && alerts.length === 0) {
    lines.push("", `System note: provider errors were observed (${providerErrors}), but there are no active system alerts right now.`);
  }

  return lines.join("\n");
}

function scoreToolResultForReturn(result: ToolResult, message: string) {
  const normalized = message.toLowerCase();
  const summary = result.summary.toLowerCase();
  let score = result.status === "error" ? 10000 : 0;

  if (isQueueFocusedRequest(message) && result.tool === "queue_snapshot") score += 800;
  if (/\b(follow[\s-]?up|reminder|check in|reach out|overdue)\b/i.test(normalized) && result.tool === "followups_snapshot") score += 800;
  if (/\b(system|health|runtime|worker|provider|error|latency|outbox|stuck)\b/i.test(normalized) && result.tool === "system_health") score += 800;
  if (/\b(todo|task|candidate|agenda)\b/i.test(normalized) && result.tool === "todos_snapshot") score += 800;
  if (/\b(people|person|contact|classmate|group|cohort|talked about|history|messages)\b/i.test(normalized)) {
    if (result.tool === "cohort_scan") score += 760;
    if (result.tool === "people_search") score += 700;
    if (result.tool === "memory_recall_search") score += 680;
  }
  if (isCampaignRequest(message) && result.tool === "campaign_plan") score += 1500;
  if (isCommunicationPreviewRequest(message) && result.tool === "communication_plan_preview") score += 1400;
  if (result.tool === "current_artifact_context") score += 620;

  const data = result.data;
  if (result.tool === "followups_snapshot") {
    const rows = asArray(data);
    const now = Date.now();
    const overdue = rows.filter((item) => readNumber(asRecord(item).dueAt) > 0 && readNumber(asRecord(item).dueAt) < now).length;
    const suggested = rows.filter((item) => readString(asRecord(item).status) === "suggested").length;
    score += overdue * 120 + suggested * 80 + rows.length;
  }
  if (result.tool === "queue_snapshot") {
    const row = asRecord(data);
    score += asArray(row.needsReply).length * 140;
    score += asArray(row.guardrailFlags).length * 130;
    score += asArray(row.followupConfirmations).length * 80;
    score += asArray(row.todoCandidates).length * 60;
  }
  if (result.tool === "system_health") {
    const row = asRecord(data);
    const metrics = asRecord(row.metrics);
    score += asArray(row.alerts).length * 140;
    score += readNumber(metrics.openGuardrails) * 120;
    score += Math.min(readNumber(metrics.providerErrors), 100);
  }

  if (summary.includes("overdue")) score += 120;
  if (summary.includes("needing review")) score += 90;
  if (summary.includes("safety")) score += 80;
  if (summary.includes("failed") || summary.includes("error")) score += 120;
  if (result.artifacts?.some((artifact) => artifact.kind === "communication_preview" && artifact.previews.length > 0)) score += 1200;
  score += (result.artifacts?.length || 0) * 20;
  return score;
}

function selectMostImportantToolResultForReturn(toolResults: ToolResult[], message: string) {
  if (!toolResults.length) {
    return null;
  }
  return [...toolResults]
    .map((result, index) => ({ result, index, score: scoreToolResultForReturn(result, message) }))
    .sort((left, right) => right.score - left.score || left.index - right.index)[0]?.result || null;
}

function buildQueueToolReply(result: ToolResult) {
  const data = asRecord(result.data);
  const needsReply = asArray(data.needsReply);
  const confirmations = asArray(data.followupConfirmations);
  const todos = asArray(data.todoCandidates);
  const guardrails = asArray(data.guardrailFlags);
  const lines: string[] = [];

  if (!needsReply.length && !confirmations.length && !todos.length && !guardrails.length) {
    return "No pending reply drafts, queue follow-up confirmations, task suggestions, or safety flags are waiting right now.";
  }

  if (guardrails.length) {
    lines.push(`${guardrails.length} safety flag${guardrails.length === 1 ? "" : "s"} should be reviewed first.`);
  }
  if (needsReply.length) {
    lines.push(`${needsReply.length} pending repl${needsReply.length === 1 ? "y" : "ies"} need review.`);
    lines.push(...needsReply.slice(0, 3).map((item, index) => `${index + 1}. ${getThreadLabel(item)}`));
  }
  if (confirmations.length) {
    lines.push(`${confirmations.length} follow-up confirmation${confirmations.length === 1 ? "" : "s"} are waiting in the queue.`);
  }
  if (todos.length) {
    lines.push(`${todos.length} task suggestion${todos.length === 1 ? "" : "s"} need review.`);
  }
  return lines.join("\n");
}

function buildFollowupsToolReply(result: ToolResult) {
  const rows = asArray(result.data);
  const now = Date.now();
  const overdue = rows.filter((item) => {
    const dueAt = readNumber(asRecord(item).dueAt);
    return dueAt > 0 && dueAt < now;
  });
  const suggested = rows.filter((item) => readString(asRecord(item).status) === "suggested");
  if (!rows.length) {
    return "No follow-ups are visible right now.";
  }
  const lines = [
    `${rows.length} follow-up${rows.length === 1 ? "" : "s"} are visible: ${overdue.length} overdue, ${suggested.length} needing review.`,
  ];
  const top = topFollowupLines(overdue.length ? overdue : rows, 4);
  if (top.length) {
    lines.push("", overdue.length ? "Start with overdue:" : "Next follow-ups:", ...top.map((item) => `- ${item}`));
  }
  return lines.join("\n");
}

function buildSystemToolReply(result: ToolResult) {
  const data = asRecord(result.data);
  const metrics = asRecord(data.metrics);
  const alerts = asArray(data.alerts).map((item) => String(item));
  if (!alerts.length) {
    return `System has no active alerts. Provider errors: ${readNumber(metrics.providerErrors)}/${readNumber(
      metrics.providerRunsWindow,
    )}; due outbox: ${readNumber(metrics.dueOutbox)}; open safety flags: ${readNumber(metrics.openGuardrails)}.`;
  }
  return [`${alerts.length} system alert${alerts.length === 1 ? "" : "s"} need attention:`, ...alerts.slice(0, 4).map((alert) => `- ${alert}`)].join(
    "\n",
  );
}

function buildArtifactToolReply(result: ToolResult) {
  const campaignPlan = (result.artifacts || []).find(
    (artifact): artifact is CampaignPlanArtifact => artifact.kind === "campaign_plan",
  );
  if (campaignPlan) {
    return `${campaignPlan.title}: ${campaignPlan.estimatedRecipients} estimated recipient${campaignPlan.estimatedRecipients === 1 ? "" : "s"}. The campaign plan is ready below; draft and approve before anything is sent.`;
  }

  const communicationPreview = (result.artifacts || []).find(
    (artifact): artifact is CommunicationPreviewArtifact => artifact.kind === "communication_preview" && artifact.previews.length > 0,
  );
  if (communicationPreview) {
    return `${communicationPreview.previews.length} draft preview${communicationPreview.previews.length === 1 ? "" : "s"} are ready below. Nothing was sent; review before approving.`;
  }

  const peopleList = (result.artifacts || []).find(
    (artifact): artifact is PeopleListArtifact => artifact.kind === "people_list",
  );
  if (peopleList) {
    return peopleList.people.length
      ? `${peopleList.title}: ${peopleList.people.length} match${peopleList.people.length === 1 ? "" : "es"} found. The list is shown below.`
      : `${peopleList.title}: no matches found.`;
  }

  return null;
}

function buildPrimaryToolReply(message: string, primaryResult: ToolResult | null, toolResults: ToolResult[], fallbackText: string) {
  if (!primaryResult) {
    return fallbackText;
  }
  if (isAttentionOverviewRequest(message)) {
    return buildAttentionOverviewReply(toolResults);
  }
  const artifactReply = buildArtifactToolReply(primaryResult);
  if (artifactReply) {
    return artifactReply;
  }
  if (primaryResult.tool === "queue_snapshot") {
    return buildQueueToolReply(primaryResult);
  }
  if (primaryResult.tool === "followups_snapshot") {
    return buildFollowupsToolReply(primaryResult);
  }
  if (primaryResult.tool === "system_health") {
    return buildSystemToolReply(primaryResult);
  }
  if (primaryResult.tool === "communication_plan_preview") {
    return "I need a visible recipient list before I can prepare useful draft previews. Ask me to find the people first, then say what to draft for them.";
  }
  return primaryResult.summary || fallbackText;
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

async function buildCohortScanArtifact(
  convex: ReturnType<typeof createConvexClient>,
  message: string,
  contactsData: unknown,
): Promise<PeopleListArtifact> {
  const keywords = expandCohortKeywords(message);
  const contacts = asArray(contactsData)
    .filter((contact) => {
      const row = asRecord(contact);
      return !Boolean(row.isIgnored) && !Boolean(row.isArchived) && readString(row._id);
    })
    .slice(0, 64);

  if (!keywords.length) {
    return {
      kind: "people_list",
      title: "Cohort scan",
      description: "Tell me the traits, context, or conversation topics to search for and I can build the group.",
      people: [],
    };
  }

  const details = await Promise.all(
    contacts.map(async (contact) => {
      const row = asRecord(contact);
      const threadId = readString(row._id);
      const [threadData, factsData] = await Promise.all([
        convex.query(convexRefs.threadGet, {
          threadId,
          includeStatusMessages: false,
        }),
        convex
          .query(convexRefs.chatContactMemoryFactsList, {
            threadId,
            limit: 80,
          })
          .catch(() => null),
      ]);
      return { contact, threadData, factsData };
    }),
  );

  const scored = details
    .map(({ contact, threadData, factsData }) => {
      const contactRow = asRecord(contact);
      const threadDataRow = asRecord(threadData);
      const thread = asRecord(threadDataRow.thread);
      const title = readString(thread.title, getContactTitle(contact));
      const messages = asArray(threadDataRow.messages);
      const facts = asArray(asRecord(factsData).facts);
      const memory = asRecord(threadDataRow.memory);
      const factors: string[] = [];
      let score = 0;

      const titleScore = scoreKeywordText(`${title} ${readString(thread.jid)} ${readString(thread.provider)}`, keywords, 5);
      if (titleScore.score) {
        score += titleScore.score;
        factors.push(`name/contact matched: ${titleScore.matched.slice(0, 3).join(", ")}`);
      }

      for (const fact of facts.slice(0, 40)) {
        const row = asRecord(fact);
        const text = `${readString(row.factKey)} ${readString(row.factValue)} ${readString(row.sourceExcerpt)}`;
        const factScore = scoreKeywordText(text, keywords, 4);
        if (factScore.score) {
          score += factScore.score;
          factors.push(`saved fact matched: ${compactText(readString(row.factValue, text), 80)}`);
        }
      }

      const memoryText = `${readString(memory.summary)} ${asArray(memory.styleNotes).join(" ")}`;
      const memoryScore = scoreKeywordText(memoryText, keywords, 3);
      if (memoryScore.score) {
        score += memoryScore.score;
        factors.push(`memory matched: ${compactText(memoryText, 90)}`);
      }

      for (const messageRow of messages.slice(-60)) {
        const row = asRecord(messageRow);
        const text = readString(row.text);
        const messageScore = scoreKeywordText(text, keywords, 1.5);
        if (messageScore.score) {
          score += messageScore.score;
          factors.push(`message history matched: ${compactText(text, 90)}`);
        }
      }

      if (/\b(old|stale|inactive|haven'?t talked|havent talked|long time|while)\b/i.test(message)) {
        const staleDays = daysSince(readNumber(thread.lastMessageAt) || readNumber(contactRow.lastMessageAt));
        if (staleDays !== null) {
          score += Math.min(staleDays / 20, 8);
          if (staleDays >= 30) {
            factors.push(`stale: last message ${staleDays} days ago`);
          }
        }
      }

      if (isLikelyOrganizationTitle(title) && /\b(friend|classmate|talking stage|romantic|date|dating)\b/i.test(message)) {
        score -= 20;
        factors.push("possible organization, down-ranked for this request");
      }

      return {
        person: {
          ...threadPerson(
            {
              ...contactRow,
              _id: readString(thread._id, readString(contactRow._id)),
              title,
              provider: readString(thread.provider, readString(contactRow.provider)),
              lastMessageAt: readNumber(thread.lastMessageAt) || readNumber(contactRow.lastMessageAt),
            },
            factors.slice(0, 3).join(" | ") || "Matched the requested cohort factors.",
            Math.min(0.95, Math.max(0.35, score / 18)),
          ),
          matchFactors: factors.slice(0, 5),
        } satisfies ArtifactPerson,
        score,
      };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  const people = uniquePeople(
    scored.map((item) => item.person),
    16,
  );
  return {
    kind: "people_list",
    title: "Cohort scan",
    description: people.length
      ? `Matched contacts using ${keywords.slice(0, 8).join(", ")} across names, facts, memory, and message history.`
      : `No contacts matched ${keywords.slice(0, 8).join(", ")} across the scanned conversation history.`,
    people,
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

function campaignContentType(message: string): CampaignPlanArtifact["contentType"] {
  if (/\b(meme|memes)\b/i.test(message)) return "meme";
  if (/\b(status|story|stories)\b/i.test(message)) return "status";
  if (/\b(text|dm|message|follow[\s-]?up)\b/i.test(message)) return "text";
  return "mixed";
}

function campaignObjective(message: string) {
  const cleaned = compactText(
    message
      .replace(/\b(run|start|create|build|plan|send|make)\b/gi, "")
      .replace(/\s+/g, " ")
      .trim(),
    160,
  );
  if (cleaned.length >= 16) {
    return cleaned;
  }
  if (/\b(meme|memes)\b/i.test(message)) return "Send a personalized meme-led outreach campaign.";
  if (/\b(marketing|promo|promotion|announce)\b/i.test(message)) return "Run a careful marketing outreach campaign.";
  return "Run a personalized mass communication campaign.";
}

function campaignAudienceSummary(message: string, peopleCount: number) {
  if (/\b(everyone|everybody|all contacts|all my)\b/i.test(message)) {
    return `All currently eligible direct contacts found in the local contact graph (${peopleCount} previewed).`;
  }
  if (/\b(classmate|school)\b/i.test(message)) return `Classmate/school-related contacts from conversation history (${peopleCount} previewed).`;
  if (/\b(old|stale|haven'?t talked|havent talked|long time)\b/i.test(message)) return `Dormant contacts who may need a low-pressure reconnect (${peopleCount} previewed).`;
  if (/\b(customer|client|lead|prospect|marketing|promo)\b/i.test(message)) return `Marketing-style audience inferred from the request (${peopleCount} previewed).`;
  return `People matching this campaign request (${peopleCount} previewed).`;
}

function buildCampaignPlanArtifacts(message: string, contactsData: unknown): { campaign: CampaignPlanArtifact; audience: PeopleListArtifact } {
  const contentType = campaignContentType(message);
  const candidates = asArray(contactsData)
    .filter((contact) => {
      const row = asRecord(contact);
      return !Boolean(row.isIgnored) && !Boolean(row.isArchived) && readString(row._id);
    })
    .sort((a, b) => readNumber(asRecord(b).lastMessageAt) - readNumber(asRecord(a).lastMessageAt));
  const previewAudience = uniquePeople(
    candidates.slice(0, 24).map((contact) =>
      threadPerson(
        contact,
        "Eligible direct contact for campaign review. Confirm audience before drafting or sending.",
        0.55,
      ),
    ),
    24,
  );
  const contentLabel =
    contentType === "meme"
      ? "Meme plus personalized text"
      : contentType === "status"
        ? "Status/story post with optional audience controls"
        : contentType === "text"
          ? "Personalized text"
          : "Mixed media and personalized text";
  const campaign: CampaignPlanArtifact = {
    kind: "campaign_plan",
    title: contentType === "meme" ? "Meme Campaign Plan" : contentType === "status" ? "Status Campaign Plan" : "Campaign Plan",
    description: "In-chat operation plan. Build audience, draft previews, approve, then queue with progress.",
    objective: campaignObjective(message),
    audienceSummary: campaignAudienceSummary(message, previewAudience.length),
    estimatedRecipients: previewAudience.length,
    contentType,
    channels: contentType === "status" ? ["WhatsApp status"] : ["WhatsApp", "Instagram where available"],
    steps: [
      {
        label: "1. Confirm audience",
        detail: "Review the people list, remove risky matches, and narrow by relationship/context before drafting.",
        status: previewAudience.length ? "ready" : "needs_review",
      },
      {
        label: "2. Generate personalized creative",
        detail: `${contentLabel} should be adapted per recipient using thread context and your style profile.`,
        status: "needs_review",
      },
      {
        label: "3. Preview and tune",
        detail: "Show every message/media preview inline with warmer, shorter, safer, funnier, and more-me controls.",
        status: "needs_review",
      },
      {
        label: "4. Approve and queue",
        detail: "Nothing sends until approved. Once approved, queue with visible progress and per-recipient status.",
        status: "blocked",
      },
      {
        label: "5. Monitor replies",
        detail: "Track sent, failed, replied, and follow-up-needed states after the campaign runs.",
        status: "needs_review",
      },
    ],
    safetyNotes: [
      "Bulk sends need explicit review before dispatch.",
      "Exclude ignored, archived, professional, sensitive, or low-confidence contacts before queueing.",
      "For memes, verify the media is appropriate for each relationship context.",
    ],
    nextPrompts: [
      "Build the editable audience for this campaign here.",
      "Draft personalized campaign previews for this audience.",
      "Find suitable memes from my media library for this campaign.",
      "Run a safety check on this campaign before drafting.",
    ],
  };
  const audience: PeopleListArtifact = {
    kind: "people_list",
    title: "Campaign audience preview",
    description: previewAudience.length
      ? "Initial recipients for review. This is not approved yet."
      : "No eligible audience found yet. Refine who the campaign is for.",
    display: {
      showProvider: true,
      showLastSeen: true,
      showConfidence: true,
      showMatchFactors: true,
      showGender: false,
      showRomanticFit: false,
    },
    people: previewAudience.map((person) => ({
      ...person,
      matchFactors: ["eligible direct contact", person.provider ? `${person.provider} thread` : "known thread"],
    })),
  };
  return { campaign, audience };
}

function extractCommunicationIntent(message: string) {
  const match = message.match(/\b(?:send|message|dm|text|draft|rewrite)\s+(?:them|him|her|people|contacts|these|those|this list)?\s*(?:that|saying|about|to)?\s*([\s\S]{0,220})/i);
  const raw = (match?.[1] || "").trim().replace(/^[:,-]\s*/, "").replace(/[?.!]+$/g, "").trim();
  const isEmptyTarget =
    !raw ||
    /^(them|him|her|it|people|contacts|these|those|this|that|this list|the list|these people|those people)$/i.test(raw) ||
    /^(for|to|about)\s+(them|him|her|people|contacts|these|those|this list)$/i.test(raw);
  if (raw && !isEmptyTarget) {
    return compactText(raw, 180);
  }
  if (/\b(reminder|remind|set a reminder)\b/i.test(message)) {
    return "set a reminder or follow-up task";
  }
  if (/\b(reconnect|check in|reach out|haven'?t talked|havent talked)\b/i.test(message)) {
    return "gentle reconnect check-in";
  }
  return "careful check-in";
}

function firstName(title: string) {
  return title.split(/\s+/)[0]?.replace(/[^\p{L}\p{N}'-]/gu, "") || title;
}

function previewTextForIntent(person: ArtifactPerson, intent: string) {
  const name = firstName(person.title);
  if (intent === "gentle reconnect check-in" || intent === "careful check-in") {
    return `Hey ${name}, been a while. Hope you've been good. Wanted to check in and see how you're doing.`;
  }
  if (intent === "set a reminder or follow-up task") {
    return `Reminder: follow up with ${person.title} with a light check-in.`;
  }
  return `Hey ${name}, hope you're doing well. Wanted to reach out about ${intent}.`;
}

function sanitizeDraftPreviewText(value: string, fallback: string) {
  const cleaned = value
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/^(draft|message|preview)\s*[:,-]\s*/i, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!cleaned || /^sure[,.! ]/i.test(cleaned) || cleaned.length < 8) {
    return fallback;
  }
  return compactText(cleaned, 360);
}

function runtimeForPreviewGeneration(settings: RuntimeSettings | null): Parameters<typeof generateReplyWithFallback>[0]["runtime"] {
  return {
    temperature: Math.min(settings?.aiTemperature ?? 0.45, 0.65),
    maxOutputTokens: Math.min(settings?.aiMaxOutputTokens ?? 180, 220),
    maxReplyChars: 360,
    fallbackMode: settings?.aiFallbackMode,
    modelFirstEnabled: settings?.aiModelFirstEnabled,
    deterministicModes: settings?.aiDeterministicModes,
    ackRoutingEnabled: false,
    qualityGateMode: settings?.qualityGateMode,
    qualityGateThreshold: settings?.qualityGateThreshold,
    soulModeEnabled: settings?.soulModeEnabled,
    selfRoastModeEnabled: settings?.selfRoastModeEnabled,
    systemInstruction: [
      "You draft one outbound message for the user.",
      "Use the contact-specific thread context and the user's request.",
      "Return only the message text. No explanation, labels, markdown, quotes, or alternatives.",
      "Be natural, specific where context supports it, and low-pressure. Do not invent facts.",
    ].join("\n"),
  };
}

async function getPreviewThreadContext(convex: ReturnType<typeof createConvexClient>, person: ArtifactPerson) {
  if (!person.threadId) {
    return { historyLines: [] as string[], styleHints: [] as string[] };
  }
  const [threadData, factsData] = await Promise.all([
    convex
      .query(convexRefs.threadGet, {
        threadId: person.threadId,
        includeStatusMessages: false,
      })
      .catch(() => null),
    convex
      .query(convexRefs.chatContactMemoryFactsList, {
        threadId: person.threadId,
        limit: 20,
      })
      .catch(() => null),
  ]);
  const messages = asArray(asRecord(threadData).messages)
    .slice(-18)
    .map((message) => {
      const row = asRecord(message);
      const text = compactText(readString(row.text), 240);
      if (!text) {
        return "";
      }
      return `${readString(row.direction) === "outbound" ? "Me" : person.title}: ${text}`;
    })
    .filter(Boolean);
  const facts = asArray(asRecord(factsData).facts)
    .slice(0, 10)
    .map((fact) => {
      const row = asRecord(fact);
      return `${readString(row.factKey, "fact")}: ${readString(row.factValue)}`;
    })
    .filter((line) => line.trim().length > 6);
  return {
    historyLines: messages,
    styleHints: facts.length ? [`Contact facts:\n${facts.join("\n")}`] : [],
  };
}

function fineTuneInstruction(message: string) {
  if (/\bwarmer|warm\b/i.test(message)) return "Make the message warmer while keeping it natural.";
  if (/\bshorter|concise|brief\b/i.test(message)) return "Make the message shorter and easier to send.";
  if (/\bsafer|low[-\s]?pressure|gentle\b/i.test(message)) return "Make the message safer, gentler, and lower-pressure.";
  if (/\bmore me|my style|usual style|like me\b/i.test(message)) return "Make the message sound more like the user's usual style.";
  return "";
}

async function generatePersonalizedPreviewText(args: {
  convex: ReturnType<typeof createConvexClient>;
  person: ArtifactPerson;
  request: string;
  intent: string;
  runtimeSettings: RuntimeSettings | null;
  previousPreview?: string;
}) {
  const fallback = args.previousPreview || previewTextForIntent(args.person, args.intent);
  const context = await getPreviewThreadContext(args.convex, args.person);
  const tuning = fineTuneInstruction(args.request);
  const inboundText = [
    `User request: ${args.request}`,
    `Contact: ${args.person.title}`,
    `Draft intent: ${args.intent}`,
    args.previousPreview ? `Previous preview to refine: ${args.previousPreview}` : "",
    tuning ? `Fine-tuning instruction: ${tuning}` : "",
    "Write one personalized outbound draft for this contact.",
  ]
    .filter(Boolean)
    .join("\n");
  const result = await generateReplyWithFallback({
    inboundText,
    historyLines: context.historyLines,
    styleHints: context.styleHints,
    grounding: { theirName: firstName(args.person.title) },
    runtime: {
      ...(await getManagedAiRuntimeOverrides()),
      ...runtimeForPreviewGeneration(args.runtimeSettings),
    },
  }).catch(() => null);
  if (!result || result.guardrailBlocked) {
    return fallback;
  }
  return sanitizeDraftPreviewText(result.text, fallback);
}

function isPreviewEligiblePerson(person: ArtifactPerson, romanticRequest: boolean) {
  if (/^(thread memory|matched person or thread)$/i.test(person.title.trim())) {
    return false;
  }
  if (!romanticRequest) {
    return true;
  }
  if (isLikelyOrganizationTitle(person.title)) {
    return false;
  }
  return person.romanticFit !== "unlikely";
}

function scorePreviewPerson(person: ArtifactPerson, artifact: PeopleListArtifact, romanticRequest: boolean) {
  let score = 0;
  const title = artifact.title.toLowerCase();
  if (romanticRequest && title.includes("talking-stage")) {
    score += 120;
  }
  if (romanticRequest && person.romanticFit === "likely") {
    score += 70;
  }
  if (person.genderCue && person.genderCue !== "unknown") {
    score += 18;
  }
  if (person.confidence) {
    score += person.confidence * 12;
  }
  if (person.genderConfidence) {
    score += person.genderConfidence * 10;
  }
  if (person.lastMessageAt) {
    const staleDays = daysSince(person.lastMessageAt) || 0;
    score += Math.min(staleDays / 30, 8);
  }
  if (romanticRequest && person.romanticFit === "unknown") {
    score -= 16;
  }
  if (isLikelyOrganizationTitle(person.title)) {
    score -= 80;
  }
  return score;
}

function selectPreviewCandidates(message: string, results: ToolResult[]) {
  const romanticRequest = isRomanticFilteringRequest(message);
  const scored = results.flatMap((result) =>
    (result.artifacts || []).flatMap((artifact) => {
      if (artifact.kind !== "people_list") {
        return [];
      }
      return artifact.people
        .filter((person) => isPreviewEligiblePerson(person, romanticRequest))
        .map((person) => ({
          person,
          score: scorePreviewPerson(person, artifact, romanticRequest),
        }));
    }),
  );

  if (romanticRequest) {
    const primary = scored
      .filter((item) => item.score >= 100 || item.person.romanticFit === "likely")
      .sort((a, b) => b.score - a.score)
      .map((item) => item.person);
    if (primary.length) {
      return uniquePeople(primary, 8);
    }
  }

  return uniquePeople(
    scored
      .sort((a, b) => b.score - a.score)
      .map((item) => item.person),
    8,
  );
}

function selectExistingPreviewCandidates(results: ToolResult[]) {
  return uniquePeople(
    results.flatMap((result) =>
      (result.artifacts || []).flatMap((artifact) => {
        if (artifact.kind !== "communication_preview") {
          return [];
        }
        return artifact.previews.map((preview) => ({
          threadId: preview.threadId,
          title: preview.title,
          reason: preview.messageIntent,
          confidence: 0.7,
          previousPreview: preview.previewText,
        }));
      }),
    ),
    8,
  ) as Array<ArtifactPerson & { previousPreview?: string }>;
}

async function buildCommunicationPreview(
  convex: ReturnType<typeof createConvexClient>,
  message: string,
  results: ToolResult[],
  runtimeSettings: RuntimeSettings | null,
): Promise<CommunicationPreviewArtifact | null> {
  const candidates = selectPreviewCandidates(message, results);
  const existingPreviewCandidates = candidates.length ? [] : selectExistingPreviewCandidates(results);
  const selectedCandidates = (candidates.length ? candidates : existingPreviewCandidates).slice(0, 8);
  if (!selectedCandidates.length) {
    return null;
  }
  const intent = extractCommunicationIntent(message);
  const previews = await Promise.all(
    selectedCandidates.map(async (person) => {
      const previousPreview = (person as { previousPreview?: unknown }).previousPreview;
      return {
        threadId: person.threadId,
        title: person.title,
        messageIntent: intent,
        previewText: await generatePersonalizedPreviewText({
          convex,
          person,
          request: message,
          intent,
          runtimeSettings,
          previousPreview: typeof previousPreview === "string" ? previousPreview : undefined,
        }),
        requiresConfirmation: true as const,
      };
    }),
  );
  return {
    kind: "communication_preview",
    title: "Communication preview",
    description: "Personalized draft-only previews from each contact's thread context. Review and approve before anything is sent.",
    previews,
  };
}

async function attachCommunicationPreview(
  convex: ReturnType<typeof createConvexClient>,
  message: string,
  results: ToolResult[],
  runtimeSettings: RuntimeSettings | null,
) {
  const preview = await buildCommunicationPreview(convex, message, results, runtimeSettings);
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
  const shouldFilterRomantic = isRomanticFilteringRequest(message);
  const requestedGenderTargets = targetGendersFromRequest(message);
  const shouldUseGenderCue = shouldFilterRomantic || isGenderCueRequest(message);
  const defaultContext = {
    ownGender: "unknown",
    romanticTargets: [],
    source: "fallback",
    summary: "No romantic filter was requested.",
  } satisfies UserRomanticContext;
  const defaultDisplay = {
    showGender: false,
    showRomanticFit: false,
    showMatchFactors: true,
    showConfidence: true,
    showLastSeen: true,
    showProvider: true,
  };

  if (!shouldUseGenderCue) {
    return { results: withPeopleListDisplay(results, defaultDisplay), context: defaultContext, filteredCount: 0 };
  }

  if (!people.length) {
    return {
      results: withPeopleListDisplay(results, {
        ...defaultDisplay,
        showGender: true,
        showRomanticFit: shouldFilterRomantic,
      }),
      context: shouldFilterRomantic ? await getUserRomanticContext(message) : defaultContext,
      filteredCount: 0,
    };
  }

  const convex = createConvexClient();
  const context = shouldFilterRomantic ? await getUserRomanticContext(message) : defaultContext;
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
      const genderOnly = {
        ...person,
        title: details.title,
        lastMessageAt: details.lastMessageAt,
        genderCue: details.inference.gender,
        genderConfidence: details.inference.confidence,
      } satisfies ArtifactPerson;
      enrichedByKey.set(person.threadId || person.title.toLowerCase(), shouldFilterRomantic ? enriched : genderOnly);
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
          if (shouldFilterRomantic) {
            if (person.romanticFit !== "unlikely" && !isLikelyOrganizationTitle(person.title)) {
              return true;
            }
            filteredCount += 1;
            return false;
          }
          if (!requestedGenderTargets.length || person.genderCue === "unknown") {
            return true;
          }
          if (requestedGenderTargets.includes(person.genderCue || "unknown")) {
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
        display: {
          ...defaultDisplay,
          showGender: true,
          showRomanticFit: shouldFilterRomantic,
        },
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
          : !shouldFilterRomantic && requestedGenderTargets.length && removedForResult
            ? `${result.summary} Filtered ${removedForResult} known non-matching gender cue${removedForResult === 1 ? "" : "s"}.`
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
    if (tool === "campaign_plan") {
      const data = await convex.query(convexRefs.threadsListContacts, {
        limit: 500,
        provider: "all",
      });
      const { campaign, audience } = buildCampaignPlanArtifacts(message, data);
      return {
        tool,
        status: "success",
        summary: `${campaign.title} prepared: ${campaign.estimatedRecipients} recipient${campaign.estimatedRecipients === 1 ? "" : "s"} previewed, content=${campaign.contentType}, approval required before sending.`,
        data: {
          estimatedRecipients: campaign.estimatedRecipients,
          contentType: campaign.contentType,
          channels: campaign.channels,
        },
        artifacts: [campaign, audience],
      };
    }
    if (tool === "cohort_scan") {
      const data = await convex.query(convexRefs.threadsListContacts, {
        limit: 220,
        provider: "all",
      });
      const artifact = await buildCohortScanArtifact(convex, message, data);
      return {
        tool,
        status: "success",
        summary: `Cohort scan found ${artifact.people.length} contact${artifact.people.length === 1 ? "" : "s"} using names, facts, memory, and message history.`,
        data: { scanned: Math.min(asArray(data).length, 64) },
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
  return history.map((item) => `${item.role === "user" ? "User" : "Odogwu HQ"}: ${item.text}`);
}

const managerInstruction = [
  "You are the Odogwu HQ dashboard orchestrator manager.",
  "The user is chatting with you directly from the Home screen to inspect state, plan work, and trigger safe app actions.",
  "Use TOOL RESULTS as authoritative current state. Never claim an action happened unless a tool result says it succeeded.",
  "When visible UI artifacts are available, tell the user the results are already shown in the chat instead of sending them to another page.",
  "When current_artifact_context is present, treat it as the active thing the user's follow-up refers to; do not restart the search unless the user asks for a new search.",
  "When a romantic filter context is present, respect the user's romantic preferences. Treat gender as an inferred cue with confidence, not a certainty.",
  "For communication requests, treat listed recipients and draft previews as plans that still need explicit user approval before any external send.",
  "When quiet hours are active and a send action is relevant, explicitly mention that the Home send flow will ask whether to ignore quiet hours or schedule after they end.",
  "Be concise, operational, and specific. Prefer bullets only when they make the next action clearer.",
  "When the user asks you to do something outside available tools, explain what you can do now and which page or next step is needed.",
].join("\n");

export async function POST(request: Request) {
  const unauthorized = await requireInstanceApiAccess(request);
  if (unauthorized) {
    return unauthorized;
  }
  const limited = await rateLimitJsonResponse(request, {
    scope: "ai.orchestrator_chat",
    identity: request.headers.get("cookie") || "",
    limit: 20,
    windowMs: 60 * 60 * 1000,
    penaltyMs: 10 * 60 * 1000,
  });
  if (limited) {
    return limited;
  }

  let body: { message?: unknown; history?: unknown; currentArtifacts?: unknown };
  try {
    body = (await request.json()) as { message?: unknown; history?: unknown; currentArtifacts?: unknown };
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
  const convex = createConvexClient();
  const runtimeSettings = (await convex.query(convexRefs.settingsGet, {}).catch(() => null)) as RuntimeSettings | null;
  const managedAiRuntime = await getManagedAiRuntimeOverrides();
  const currentArtifacts = normalizeManagerArtifacts(body.currentArtifacts);
  const currentArtifactResult =
    currentArtifacts.length && isCurrentArtifactFollowupRequest(message) ? buildCurrentArtifactContextResult(currentArtifacts) : null;
  const rawToolResults = [
    ...(currentArtifactResult ? [currentArtifactResult] : []),
    ...(await Promise.all(requestedTools.map((tool) => runTool(tool, message)))),
  ];
  const enriched = await enrichPeopleWithGenderAndPreference(message, rawToolResults);
  const toolResults = await attachCommunicationPreview(convex, message, enriched.results, runtimeSettings);
  const artifacts = toolResults.flatMap((result) => result.artifacts || []);
  const artifactContext = artifacts.length
    ? [
        `VISIBLE UI ARTIFACTS (${artifacts.length})`,
	        ...artifacts.map((artifact) =>
	          artifact.kind === "people_list"
	            ? `- ${artifact.title}: ${artifact.people.length} people shown in chat.`
	            : artifact.kind === "communication_preview"
	              ? `- ${artifact.title}: ${artifact.previews.length} draft previews shown in chat; approval required before sending.`
	              : `- ${artifact.title}: campaign plan with ${artifact.estimatedRecipients} estimated recipients; approval required before sending.`,
	        ),
      ].join("\n")
    : "";
  const toolContext = toolResults.length
    ? [
        formatQuietHoursPolicy(runtimeSettings),
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
    : `${formatQuietHoursPolicy(runtimeSettings)}\nNo direct dashboard tool matched. Treat this as a planning/chat request.`;

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
        ...managedAiRuntime,
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
    const primaryToolResult = selectMostImportantToolResultForReturn(toolResults, message);
    const finalReplyText = !aiResult.guardrailBlocked
      ? buildPrimaryToolReply(message, primaryToolResult, toolResults, aiResult.text)
      : aiResult.text;
    const returnedToolResults = primaryToolResult ? [primaryToolResult] : [];
    const returnedArtifacts = returnedToolResults.flatMap((result) => result.artifacts || []);

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
      replyText: finalReplyText,
      guardrailBlocked: aiResult.guardrailBlocked,
      guardrailReason: aiResult.guardrailReason,
      latencyMs: Date.now() - startedAt,
      provider: aiResult.provider,
      model: aiResult.model,
      manager: {
        toolsRequested: requestedTools,
        toolResults: returnedToolResults.map((result) => ({
          tool: result.tool,
          status: result.status,
          summary: result.summary,
          artifactCount: result.artifacts?.length || 0,
        })),
        artifacts: returnedArtifacts,
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
