import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  PIDGIN_EXTENDED_TOKENS,
  PIDGIN_STRONG_TOKENS,
  PIDGIN_WEAK_TOKENS,
  classifyPidginCandidateTerm,
} from "../shared/pidgin-lexicon";

type WikiCategoryResponse = {
  query?: {
    categorymembers?: Array<{ title: string }>;
  };
  continue?: {
    cmcontinue?: string;
  };
};

type CliArgs = {
  write: boolean;
  out: string;
  minScore: number;
  maxDepth: number;
  includeSensitive: boolean;
};

const API_BASE = "https://en.wiktionary.org/w/api.php";
const ROOT_CATEGORIES = [
  "Category:Nigerian_Pidgin_lemmas",
  "Category:Nigerian_Pidgin_terms_by_usage",
] as const;

const DIRECT_CATEGORIES = [
  "Category:Nigerian_Pidgin_adjectives",
  "Category:Nigerian_Pidgin_adverbs",
  "Category:Nigerian_Pidgin_conjunctions",
  "Category:Nigerian_Pidgin_determiners",
  "Category:Nigerian_Pidgin_interjections",
  "Category:Nigerian_Pidgin_multiword_terms",
  "Category:Nigerian_Pidgin_nouns",
  "Category:Nigerian_Pidgin_numerals",
  "Category:Nigerian_Pidgin_particles",
  "Category:Nigerian_Pidgin_prepositions",
  "Category:Nigerian_Pidgin_pronouns",
  "Category:Nigerian_Pidgin_slang",
  "Category:Nigerian_Pidgin_verbs",
] as const;

const SUBCATEGORY_EXCLUDE_PATTERNS = [
  /entry maintenance/i,
  /templates/i,
  /all topics/i,
  /non-lemma/i,
  /terms by etymology/i,
  /terms by lexical property/i,
  /terms derived from/i,
  /user /i,
];

const SENSITIVE_CATEGORY_PATTERN = /\b(offensive|derogatory)\b/i;

function parseArgs(argv: string[]): CliArgs {
  let write = false;
  let out = "data/pidgin-lexicon-candidates.json";
  let minScore = 0.35;
  let maxDepth = 1;
  let includeSensitive = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--write") {
      write = true;
      continue;
    }
    if (arg === "--include-sensitive") {
      includeSensitive = true;
      continue;
    }
    if (arg === "--out") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --out");
      }
      out = value;
      index += 1;
      continue;
    }
    if (arg === "--min-score") {
      const value = Number(argv[index + 1]);
      if (!Number.isFinite(value) || value < 0 || value > 1) {
        throw new Error("--min-score must be between 0 and 1");
      }
      minScore = value;
      index += 1;
      continue;
    }
    if (arg === "--max-depth") {
      const value = Number(argv[index + 1]);
      if (!Number.isInteger(value) || value < 0 || value > 3) {
        throw new Error("--max-depth must be an integer between 0 and 3");
      }
      maxDepth = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return { write, out, minScore, maxDepth, includeSensitive };
}

function normalizeTerm(input: string) {
  return input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/^category:/i, "")
    .replace(/[_/]+/g, " ")
    .replace(/[^a-z0-9'\-\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCategory(input: string) {
  return input.replace(/_/g, " ").replace(/^Category:/i, "Category:").trim();
}

function isUsefulCandidate(term: string) {
  if (!term) {
    return false;
  }
  if (term.length < 3 || term.length > 32) {
    return false;
  }
  if (/^\d+$/.test(term)) {
    return false;
  }
  const words = term.split(" ").filter(Boolean);
  if (words.length > 4) {
    return false;
  }
  return words.some((word) => /[a-z]/.test(word));
}

function shouldExcludeSubcategory(name: string) {
  return SUBCATEGORY_EXCLUDE_PATTERNS.some((pattern) => pattern.test(name));
}

async function fetchCategoryMembers(category: string, cmtype: "page" | "subcat") {
  const titles: string[] = [];
  let cmcontinue: string | undefined;

  do {
    const url = new URL(API_BASE);
    url.searchParams.set("action", "query");
    url.searchParams.set("list", "categorymembers");
    url.searchParams.set("format", "json");
    url.searchParams.set("cmtitle", category);
    url.searchParams.set("cmlimit", "500");
    url.searchParams.set("cmtype", cmtype);
    if (cmcontinue) {
      url.searchParams.set("cmcontinue", cmcontinue);
    }

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch ${category}: ${response.status}`);
    }
    const payload = (await response.json()) as WikiCategoryResponse;
    for (const row of payload.query?.categorymembers || []) {
      titles.push(row.title);
    }
    cmcontinue = payload.continue?.cmcontinue;
  } while (cmcontinue);

  return titles;
}

async function discoverCategories(maxDepth: number) {
  const visited = new Set<string>();
  const discovered = new Set<string>(DIRECT_CATEGORIES.map(normalizeCategory));
  let frontier = new Set<string>(ROOT_CATEGORIES.map(normalizeCategory));

  for (let depth = 0; depth <= maxDepth; depth += 1) {
    if (frontier.size === 0) {
      break;
    }

    const nextFrontier = new Set<string>();
    await Promise.all(
      [...frontier].map(async (category) => {
        if (visited.has(category)) {
          return;
        }
        visited.add(category);
        discovered.add(category);

        const subcategories = await fetchCategoryMembers(category, "subcat");
        for (const rawName of subcategories) {
          const normalized = normalizeCategory(rawName);
          if (!/\bNigerian Pidgin\b/i.test(normalized) || shouldExcludeSubcategory(normalized)) {
            continue;
          }
          discovered.add(normalized);
          if (depth < maxDepth) {
            nextFrontier.add(normalized);
          }
        }
      }),
    );
    frontier = nextFrontier;
  }

  return [...discovered].sort((a, b) => a.localeCompare(b));
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const known = new Set<string>(
    [...PIDGIN_STRONG_TOKENS, ...PIDGIN_WEAK_TOKENS, ...PIDGIN_EXTENDED_TOKENS].map((token) => token.toLowerCase()),
  );

  const categories = await discoverCategories(args.maxDepth);
  const termSources = new Map<string, Set<string>>();
  let totalRawPages = 0;

  await Promise.all(
    categories.map(async (category) => {
      const titles = await fetchCategoryMembers(category, "page");
      totalRawPages += titles.length;
      for (const title of titles) {
        const normalizedTerm = normalizeTerm(title);
        if (!isUsefulCandidate(normalizedTerm)) {
          continue;
        }
        const sourceSet = termSources.get(normalizedTerm) || new Set<string>();
        sourceSet.add(category);
        termSources.set(normalizedTerm, sourceSet);
      }
    }),
  );

  const normalized = [...termSources.keys()].sort((a, b) => a.localeCompare(b));
  const classified = normalized
    .filter((term) => !known.has(term.replace(/\s+/g, "")) && !known.has(term))
    .map((term) => {
      const sourceCategories = [...(termSources.get(term) || new Set<string>())].sort((a, b) => a.localeCompare(b));
      const assessment = classifyPidginCandidateTerm({ term, sourceCategories });
      return {
        term,
        sourceCategories,
        ...assessment,
      };
    })
    .filter((entry) => entry.score >= args.minScore)
    .filter((entry) => args.includeSensitive || entry.safety !== "blocked")
    .sort((left, right) => right.score - left.score || left.term.localeCompare(right.term));

  const highConfidence = classified.filter((entry) => entry.bucket === "strong" && entry.safety === "safe");
  const reviewQueue = classified.filter(
    (entry) => entry.bucket === "extended" || entry.safety === "review" || entry.safety === "blocked",
  );
  const lowConfidence = classified.filter((entry) => entry.bucket === "weak" && entry.safety === "safe");
  const blocked = classified.filter((entry) => entry.safety === "blocked");
  const candidates = classified.map((entry) => entry.term);

  const report = {
    generatedAt: new Date().toISOString(),
    source: "en.wiktionary.org categorymembers API",
    query: {
      roots: ROOT_CATEGORIES,
      direct: DIRECT_CATEGORIES,
      maxDepth: args.maxDepth,
      includeSensitive: args.includeSensitive,
    },
    categories,
    totals: {
      categoriesScanned: categories.length,
      rawPageTitles: totalRawPages,
      normalizedUnique: normalized.length,
      knownSeedCount: known.size,
      candidateCount: candidates.length,
      highConfidenceCount: highConfidence.length,
      reviewQueueCount: reviewQueue.length,
      lowConfidenceCount: lowConfidence.length,
      blockedCount: blocked.length,
    },
    highConfidence,
    reviewQueue,
    lowConfidence,
    blocked,
    candidates,
  };

  if (args.write) {
    const outPath = resolve(process.cwd(), args.out);
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(`Wrote ${candidates.length} candidates to ${outPath}`);
  } else {
    const sensitiveScanned = categories.filter((category) => SENSITIVE_CATEGORY_PATTERN.test(category)).length;
    console.log(
      `Found ${candidates.length} candidates (high=${highConfidence.length}, review=${reviewQueue.length}, low=${lowConfidence.length}, blocked=${blocked.length}).`,
    );
    console.log(`Scanned ${categories.length} categories (${sensitiveScanned} sensitive categories detected).`);
    console.log(candidates.slice(0, 120).join(", "));
    console.log("Run with --write to save JSON output.");
  }
}

void run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
