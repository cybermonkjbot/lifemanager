export type PidginIntent = "hard_stop" | "pause" | "wrap_up" | "recall" | "style" | "casual";

export type PidginDetection = {
  isPidgin: boolean;
  score: number;
  threshold: number;
  tokenHits: string[];
  multiwordHits: string[];
  grammarHits: string[];
  intents: Record<PidginIntent, boolean>;
};

export type PidginCandidateBucket = "strong" | "weak" | "extended" | "unknown";
export type PidginCandidateSafety = "safe" | "review" | "blocked";

export type CandidateAssessment = {
  score: number;
  bucket: PidginCandidateBucket;
  reasons: string[];
  safety: PidginCandidateSafety;
};

export type CandidateClassificationInput =
  | string
  | {
      term: string;
      sourceCategories?: string[];
    };

export const PIDGIN_STRONG_TOKENS = [
  "abeg",
  "abi",
  "commot",
  "comot",
  "dey",
  "dem",
  "don",
  "enta",
  "fit",
  "gats",
  "gist",
  "gree",
  "howfar",
  "japa",
  "kasala",
  "moni",
  "naija",
  "nawa",
  "oya",
  "padi",
  "pesin",
  "pickin",
  "pikin",
  "sabi",
  "sef",
  "sha",
  "shey",
  "tori",
  "una",
  "wahala",
  "waka",
  "wetin",
  "yarn",
  "yawa",
] as const;

export const PIDGIN_WEAK_TOKENS = [
  "bros",
  "madam",
  "mama",
  "oga",
  "omo",
  "papa",
  "sista",
  "bobo",
  "broda",
  "gud",
  "laik",
  "mek",
  "neva",
  "oda",
  "ova",
  "wan",
  "wen",
  "wey",
  "wok",
  "won",
  "yu",
] as const;

export const PIDGIN_EXTENDED_TOKENS = [
  "afta",
  "ajebota",
  "aks",
  "anoda",
  "anytin",
  "awa",
  "becos",
  "beta",
  "bifo",
  "bifor",
  "bigin",
  "bin",
  "boku",
  "chop",
  "confam",
  "dat",
  "deh",
  "demsef",
  "demself",
  "den",
  "dia",
  "diasef",
  "dis",
  "domot",
  "ehn",
  "fada",
  "gbege",
  "gbese",
  "gidigba",
  "ginger",
  "gofment",
  "goment",
  "govment",
  "happun",
  "hyar",
  "jaguda",
  "kain",
  "komot",
  "kontri",
  "kuku",
  "kwanta",
  "kpai",
  "kpatakpata",
  "kpeme",
  "moto",
  "na",
  "nack",
  "nem",
  "nyam",
  "notin",
  "ogbonge",
  "olodo",
  "onyibo",
  "ontop",
  "oshey",
  "oyibo",
  "oyinbo",
  "patapata",
  "pipo",
  "pipul",
  "plenti",
  "sama",
  "sapa",
  "shakara",
  "sotay",
  "sup",
  "swit",
  "tif",
  "tin",
  "tink",
  "tok",
  "tokunbo",
  "troway",
  "tufiakwa",
  "tri",
  "weda",
  "weti",
  "weting",
  "wia",
  "wit",
  "yakpa",
  "yan",
  "yankee",
  "yeye",
] as const;

const PIDGIN_STYLE_MARKERS = ["abeg", "no vex", "how far", "wetin", "no wahala", "dey"] as const;

const TOKEN_ALIASES: Record<string, string> = {
  "how far": "howfar",
  gatz: "gats",
  komot: "commot",
  weti: "wetin",
  weting: "wetin",
  ting: "tin",
  onyibo: "oyinbo",
  oyibo: "oyinbo",
  demself: "demsef",
  diasef: "demsef",
  yansh: "yansh",
};

const PIDGIN_MULTIWORD_PATTERNS: Array<{ id: string; pattern: RegExp; weight: number }> = [
  { id: "how_far", pattern: /\bhow far\b/i, weight: 1.0 },
  { id: "how_now", pattern: /\bhow now\b/i, weight: 1.0 },
  { id: "no_vex", pattern: /\bno vex\b/i, weight: 1.0 },
  { id: "no_wahala", pattern: /\bno wahala\b/i, weight: 1.1 },
  { id: "make_we", pattern: /\bmake we\b/i, weight: 1.0 },
  { id: "make_i", pattern: /\bmake i\b/i, weight: 0.8 },
  { id: "i_dey_waka", pattern: /\bi dey waka\b/i, weight: 1.0 },
  { id: "wetin_dey_sup", pattern: /\bwetin(?:\s+dey)?(?:\s+sup)?\b/i, weight: 1.1 },
  { id: "wetin_happen", pattern: /\bwetin happen\b/i, weight: 1.1 },
  { id: "i_no_sabi", pattern: /\bi no sabi\b/i, weight: 1.1 },
  { id: "small_small", pattern: /\bsmall[-\s]small\b/i, weight: 0.8 },
  { id: "before_before", pattern: /\bbefore\s+before\b/i, weight: 0.8 },
  { id: "na_wa_o", pattern: /\bna\s+wa\s+o\b/i, weight: 0.9 },
  { id: "na_so", pattern: /\bna so\b/i, weight: 0.8 },
];

const PIDGIN_GRAMMAR_PATTERNS: Array<{ id: string; pattern: RegExp; weight: number }> = [
  { id: "pronoun_modal", pattern: /\b(i|you|we|una|dem|e)\s+(dey|don|go|fit)\b/i, weight: 0.9 },
  { id: "plural_dey", pattern: /\b(una|dem)\s+dey\b/i, weight: 0.8 },
  { id: "negation_form", pattern: /\b(i|you|we|dem)\s+no\s+[a-z]{2,}\b/i, weight: 0.8 },
];

const PIDGIN_CASUAL_PATTERN =
  /\b(no wahala|abeg|gist|wahala|omo|how far|wetin|dey|sabi|padi|tori|comot|commot|japa|kasala|yawa|na wa o|sapa|naija)\b/i;

const PIDGIN_RECALL_PATTERNS = [
  /\b(we still dey on(?: for)?|still dey on for|still dey on)\b/i,
  /\b(you (?:talk|said?) say you (?:go|gonna|would) send)\b/i,
  /\b(you don (?:send|share) am|you fit resend am|fit resend am)\b/i,
  /\b(abeg (?:update me|give me update)|abeg any update)\b/i,
  /\b(abeg remind me|fit remind me)\b/i,
  /\b(fit send am again|send am again)\b/i,
  /\b(wetin happen to (?:that|the) (?:plan|thing|one)|wetin sup with (?:that|the) (?:plan|thing|one))\b/i,
  /\b(how far with (?:that|the) (?:plan|thing|one)|how far with this|hw far wit (?:that|the) (?:plan|thing|one))\b/i,
];

const PIDGIN_STYLE_HINT_PATTERN = /\b(pidgin|naija|naija slang|talk pidgin|speak pidgin)\b/i;

const PIDGIN_HARD_STOP_PATTERNS = [
  /\b(?:abeg\s+)?no text me again\b/i,
  /\b(?:abeg\s+)?no message me again\b/i,
  /\b(?:abeg\s+)?no call me again\b/i,
  /\b(?:abeg\s+)?no disturb me again\b/i,
  /\bleave me alone\b/i,
  /\bno contact\b/i,
];

const PIDGIN_PAUSE_PATTERNS = [
  /\bmake we continue later\b/i,
  /\bwe go continue later\b/i,
  /\bmake i (?:call|text|ping) you later\b/i,
  /\bi go (?:call|text|ping) you later\b/i,
  /\bi dey (?:road|class|work|traffic|wrk|trafic) rn\b/i,
  /\bi dey waka now\b/i,
  /\bmake we yarn later\b/i,
];

const PIDGIN_WRAP_UP_PATTERNS = [
  /^\s*(?:no wahala|nwahala|sharp|sharp sharp|na so|ehen|safe|we move|copy o|all good sha|we good abeg|na wa o)\s*[.!]*\s*$/i,
  /^\s*(?:thanks o|thank you o+|thx abeg)\s*[.!]*\s*$/i,
];

const CANDIDATE_STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "from",
  "with",
  "that",
  "this",
  "where",
  "which",
  "whose",
  "about",
  "one",
  "send",
]);

const SENSITIVE_CATEGORY_PATTERN = /\b(offensive|derogatory)\b/i;
const TRADEMARK_CATEGORY_PATTERN = /\btrademark\b/i;

type CandidateBucket = PidginCandidateBucket;

const STRONG_SET = new Set<string>(PIDGIN_STRONG_TOKENS as readonly string[]);
const WEAK_SET = new Set<string>(PIDGIN_WEAK_TOKENS as readonly string[]);
const EXTENDED_SET = new Set<string>(PIDGIN_EXTENDED_TOKENS as readonly string[]);

const TOKEN_WEIGHTS: Array<[Set<string>, number]> = [
  [STRONG_SET, 0.7],
  [EXTENDED_SET, 0.45],
  [WEAK_SET, 0.3],
];

function tokenize(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function normalizeWhitespace(text: string) {
  return text.trim().replace(/\s+/g, " ");
}

function canonicalizeToken(token: string, tokenBag?: Set<string>) {
  if (!token) {
    return token;
  }
  if (token === "how" && tokenBag?.has("far")) {
    return "howfar";
  }
  return TOKEN_ALIASES[token] || token;
}

function scoreToken(token: string) {
  for (const [set, weight] of TOKEN_WEIGHTS) {
    if (set.has(token)) {
      return weight;
    }
  }
  return 0;
}

function hitPatterns(text: string, patterns: Array<{ id: string; pattern: RegExp; weight: number }>) {
  const hits: string[] = [];
  let score = 0;
  for (const { id, pattern, weight } of patterns) {
    if (pattern.test(text)) {
      hits.push(id);
      score += weight;
    }
  }
  return { hits, score };
}

function detectIntents(text: string) {
  return {
    hard_stop: PIDGIN_HARD_STOP_PATTERNS.some((pattern) => pattern.test(text)),
    pause: PIDGIN_PAUSE_PATTERNS.some((pattern) => pattern.test(text)),
    wrap_up: PIDGIN_WRAP_UP_PATTERNS.some((pattern) => pattern.test(text)),
    recall: PIDGIN_RECALL_PATTERNS.some((pattern) => pattern.test(text)),
    style: PIDGIN_STYLE_HINT_PATTERN.test(text),
    casual: PIDGIN_CASUAL_PATTERN.test(text),
  } satisfies Record<PidginIntent, boolean>;
}

function parseCandidateInput(input: CandidateClassificationInput) {
  if (typeof input === "string") {
    return {
      term: input,
      sourceCategories: [] as string[],
    };
  }
  return {
    term: input.term,
    sourceCategories: (input.sourceCategories || []).map((entry) => entry.toLowerCase()),
  };
}

export function computePidginSignalScore(sample: string) {
  const normalized = normalizeWhitespace(sample);
  if (!normalized) {
    return 0;
  }

  const tokens = tokenize(normalized);
  const uniqueTokens = new Set(tokens);
  let tokenScore = 0;
  const tokenHits: string[] = [];

  for (const token of uniqueTokens) {
    const normalizedToken = canonicalizeToken(token, uniqueTokens);
    const weight = scoreToken(normalizedToken);
    if (weight > 0) {
      tokenScore += weight;
      tokenHits.push(normalizedToken);
    }
  }

  const multiword = hitPatterns(normalized, PIDGIN_MULTIWORD_PATTERNS);
  const grammar = hitPatterns(normalized, PIDGIN_GRAMMAR_PATTERNS);
  const intents = detectIntents(normalized);
  const intentBoost =
    (intents.recall ? 0.35 : 0) +
    (intents.pause ? 0.35 : 0) +
    (intents.hard_stop ? 0.35 : 0) +
    (intents.wrap_up ? 0.2 : 0) +
    (intents.style ? 0.2 : 0) +
    (intents.casual ? 0.2 : 0);

  const repetitionHits = tokens.filter((token) => scoreToken(canonicalizeToken(token, uniqueTokens)) > 0).length;
  const repetitionBoost = repetitionHits >= 4 ? 0.25 : repetitionHits >= 2 ? 0.1 : 0;

  const score = tokenScore + multiword.score + grammar.score + intentBoost + repetitionBoost;
  return Number(score.toFixed(3));
}

export function detectPidginContext(args: {
  inboundText: string;
  historyLines?: string[];
  threshold?: number;
  historyWeight?: number;
}): PidginDetection {
  const threshold = Number.isFinite(args.threshold) ? Number(args.threshold) : 1.2;
  const historyWeight = Number.isFinite(args.historyWeight) ? Math.max(0, Math.min(1, Number(args.historyWeight))) : 0.4;
  const inbound = normalizeWhitespace(args.inboundText || "");
  const historySample = normalizeWhitespace(
    (args.historyLines || [])
      .slice(-8)
      .map((line) => line.replace(/^(Me|Them):\s*/i, ""))
      .join(" "),
  );

  const inboundScore = computePidginSignalScore(inbound);
  const historyScore = historySample ? computePidginSignalScore(historySample) : 0;
  const score = Number((inboundScore + historyScore * historyWeight).toFixed(3));

  const featureText = normalizeWhitespace([inbound, historySample].filter(Boolean).join(" "));
  const featureTokens = new Set(tokenize(featureText));
  const tokenHits = [
    ...new Set(
      tokenize(featureText)
        .map((token) => canonicalizeToken(token, featureTokens))
        .filter((token) => scoreToken(token) > 0),
    ),
  ];
  const multiwordHits = hitPatterns(featureText, PIDGIN_MULTIWORD_PATTERNS).hits;
  const grammarHits = hitPatterns(featureText, PIDGIN_GRAMMAR_PATTERNS).hits;
  const intents = detectIntents(featureText);

  return {
    isPidgin: score >= threshold,
    score,
    threshold,
    tokenHits,
    multiwordHits,
    grammarHits,
    intents,
  };
}

export function hasPidginSignal(args: { inboundText: string; historyLines?: string[]; threshold?: number }) {
  return detectPidginContext({
    inboundText: args.inboundText,
    historyLines: args.historyLines,
    threshold: args.threshold,
  }).isPidgin;
}

export function hasPidginCasualSignal(text: string) {
  return detectIntents(normalizeWhitespace(text)).casual;
}

export function hasPidginRecallCue(text: string) {
  return detectIntents(normalizeWhitespace(text)).recall;
}

export function hasPidginStyleCue(text: string) {
  const intents = detectIntents(normalizeWhitespace(text));
  return intents.style || intents.casual;
}

export function hasPidginHardStopCue(text: string) {
  return detectIntents(normalizeWhitespace(text)).hard_stop;
}

export function hasPidginPauseCue(text: string) {
  return detectIntents(normalizeWhitespace(text)).pause;
}

export function hasPidginWrapUpCue(text: string) {
  return detectIntents(normalizeWhitespace(text)).wrap_up;
}

export function normalizePidginFamilyTerms(text: string) {
  return text
    .replace(/\b(mom|mum|mommy|mummy|mother)\b/gi, "Mama")
    .replace(/\b(dad|daddy|father|pops)\b/gi, "Papa");
}

export function buildPidginReplyInstruction(pidginMode: boolean) {
  if (pidginMode) {
    return `Pidgin/Naija mode is active from this chat. Mirror naturally with Nigerian Pidgin where it fits, keep it readable, and avoid forced slang. Prefer common local markers only when context fits (e.g., ${PIDGIN_STYLE_MARKERS.join(", ")}). If you mention parents, use 'Mama' and 'Papa' (not 'mum' or 'dad'). Avoid offensive slurs even if present in history.`;
  }
  return "Use standard conversational English unless the contact clearly uses Pidgin/Naija slang.";
}

export function classifyPidginCandidateTerm(input: CandidateClassificationInput): CandidateAssessment {
  const parsed = parseCandidateInput(input);
  const term = normalizeWhitespace(parsed.term.toLowerCase());
  const sourceCategories = parsed.sourceCategories;
  if (!term) {
    return { score: 0, bucket: "unknown", reasons: ["empty"], safety: "review" };
  }

  const compact = term.replace(/\s+/g, "");
  if (STRONG_SET.has(term) || STRONG_SET.has(compact)) {
    return { score: 1, bucket: "strong", reasons: ["already-strong"], safety: "safe" };
  }
  if (WEAK_SET.has(term) || WEAK_SET.has(compact)) {
    return { score: 0.7, bucket: "weak", reasons: ["already-weak"], safety: "safe" };
  }
  if (EXTENDED_SET.has(term) || EXTENDED_SET.has(compact)) {
    return { score: 0.55, bucket: "extended", reasons: ["already-extended"], safety: "safe" };
  }

  let score = 0;
  const reasons: string[] = [];

  if (/[kg]b|kp|sh|ny|wah|wet|dey|don|abi|abeg|japa|kasala|yawa|sapa/.test(term)) {
    score += 0.45;
    reasons.push("pidgin-phonology");
  }
  if (term.includes("-")) {
    score += 0.15;
    reasons.push("hyphenated-colloquial");
  }
  if (/\s/.test(term)) {
    score += 0.1;
    reasons.push("multiword-colloquial");
  }
  if (/[^aeiou]{3,}/.test(term)) {
    score += 0.1;
    reasons.push("compressed-spelling");
  }
  if (sourceCategories.some((category) => /\bnigerian pidgin\b/.test(category))) {
    score += 0.25;
    reasons.push("wiktionary-pcm-category");
  }
  if (sourceCategories.some((category) => /\b(interjections|slang|multiword terms|verbs|nouns)\b/.test(category))) {
    score += 0.15;
    reasons.push("high-yield-pos-category");
  }
  if (sourceCategories.some((category) => TRADEMARK_CATEGORY_PATTERN.test(category))) {
    score -= 0.25;
    reasons.push("trademark-category");
  }
  if (CANDIDATE_STOPWORDS.has(term)) {
    score -= 0.5;
    reasons.push("plain-english-stopword");
  }
  if (term.length < 3 || term.length > 24) {
    score -= 0.4;
    reasons.push("length-outlier");
  }

  const normalizedScore = Number(Math.max(0, Math.min(1, score)).toFixed(3));
  const bucket: CandidateBucket =
    normalizedScore >= 0.78 ? "strong" : normalizedScore >= 0.55 ? "extended" : normalizedScore >= 0.35 ? "weak" : "unknown";

  let safety: PidginCandidateSafety = "safe";
  if (sourceCategories.some((category) => SENSITIVE_CATEGORY_PATTERN.test(category))) {
    safety = "blocked";
  } else if (/\b(ashawo|yansh)\b/.test(term)) {
    safety = "review";
  }

  return {
    score: normalizedScore,
    bucket,
    reasons,
    safety,
  };
}
