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
  "continue"?: {
    cmcontinue?: string;
  };
};

type CliArgs = {
  write: boolean;
  out: string;
  minScore: number;
};

const API_BASE = "https://en.wiktionary.org/w/api.php";
const CATEGORIES = [
  "Category:Nigerian_Pidgin_lemmas",
  "Category:Nigerian_Pidgin_verbs",
  "Category:Nigerian_Pidgin_nouns",
];

function parseArgs(argv: string[]): CliArgs {
  let write = false;
  let out = "data/pidgin-lexicon-candidates.json";
  let minScore = 0.35;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--write") {
      write = true;
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
    throw new Error(`Unknown argument: ${arg}`);
  }
  return { write, out, minScore };
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
  if (term.startsWith("category ")) {
    return false;
  }
  const words = term.split(" ").filter(Boolean);
  if (words.length > 3) {
    return false;
  }
  return words.some((word) => /[a-z]/.test(word));
}

async function fetchCategory(category: string) {
  const terms: string[] = [];
  let cmcontinue: string | undefined;
  do {
    const url = new URL(API_BASE);
    url.searchParams.set("action", "query");
    url.searchParams.set("list", "categorymembers");
    url.searchParams.set("format", "json");
    url.searchParams.set("cmtitle", category);
    url.searchParams.set("cmlimit", "500");
    if (cmcontinue) {
      url.searchParams.set("cmcontinue", cmcontinue);
    }

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch ${category}: ${response.status}`);
    }
    const payload = (await response.json()) as WikiCategoryResponse;
    for (const row of payload.query?.categorymembers || []) {
      terms.push(row.title);
    }
    cmcontinue = payload.continue?.cmcontinue;
  } while (cmcontinue);

  return terms;
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const known = new Set<string>([...PIDGIN_STRONG_TOKENS, ...PIDGIN_WEAK_TOKENS, ...PIDGIN_EXTENDED_TOKENS].map((token) => token.toLowerCase()));
  const rawTitles = (
    await Promise.all(CATEGORIES.map((category) => fetchCategory(category)))
  ).flat();

  const normalized = [...new Set(rawTitles.map(normalizeTerm).filter(isUsefulCandidate))].sort((a, b) => a.localeCompare(b));
  const classified = normalized
    .filter((term) => !known.has(term.replace(/\s+/g, "")) && !known.has(term))
    .map((term) => {
      const assessment = classifyPidginCandidateTerm(term);
      return {
        term,
        ...assessment,
      };
    })
    .filter((entry) => entry.score >= args.minScore)
    .sort((left, right) => right.score - left.score || left.term.localeCompare(right.term));

  const highConfidence = classified.filter((entry) => entry.bucket === "strong");
  const reviewQueue = classified.filter((entry) => entry.bucket === "extended");
  const lowConfidence = classified.filter((entry) => entry.bucket === "weak");
  const candidates = classified.map((entry) => entry.term);

  const report = {
    generatedAt: new Date().toISOString(),
    source: "en.wiktionary.org categorymembers API",
    categories: CATEGORIES,
    totals: {
      rawTitles: rawTitles.length,
      normalizedUnique: normalized.length,
      knownSeedCount: known.size,
      candidateCount: candidates.length,
      highConfidenceCount: highConfidence.length,
      reviewQueueCount: reviewQueue.length,
      lowConfidenceCount: lowConfidence.length,
    },
    highConfidence,
    reviewQueue,
    lowConfidence,
    candidates,
  };

  if (args.write) {
    const outPath = resolve(process.cwd(), args.out);
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(`Wrote ${candidates.length} candidates to ${outPath}`);
  } else {
    console.log(
      `Found ${candidates.length} candidate terms (high=${highConfidence.length}, review=${reviewQueue.length}, low=${lowConfidence.length}).`,
    );
    console.log(candidates.slice(0, 80).join(", "));
    console.log("Run with --write to save JSON output.");
  }
}

void run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
