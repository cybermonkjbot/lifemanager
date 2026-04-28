import { createConvexClient } from "@/lib/convex-server";
import { convexRefs } from "@/lib/convex-refs";
import type { CodeBehaviorExtension } from "@/code-runtime";

export type TenantBehaviorExtensionBundle = {
  projectId: string;
  projectName: string;
  projectSlug: string;
  versionId: string;
  versionLabel: string;
  publishedAt?: number;
  behaviorExtensions: CodeBehaviorExtension[];
  heuristicPatterns: CodeBehaviorExtension[];
  lexiconEntries: CodeBehaviorExtension[];
  promptDerivations: CodeBehaviorExtension[];
};

export type CompiledTenantBehaviorContext = {
  promptBlocks: string[];
  styleHints: string[];
  lexiconHints: string[];
  heuristicTargets: string[];
  sourceProjects: string[];
};

function matchesCorpus(extension: CodeBehaviorExtension, corpus: string) {
  if (extension.patterns.length === 0 && extension.terms.length === 0 && extension.targets.length === 0) return true;
  const lowered = corpus.toLowerCase();
  return (
    extension.patterns.some((pattern) => lowered.includes(pattern.toLowerCase())) ||
    extension.terms.some((term) => lowered.includes(term.token.toLowerCase())) ||
    extension.targets.some((target) => lowered.includes(target.toLowerCase()))
  );
}

export async function loadTenantBehaviorExtensions(args: {
  tenantId?: string;
  connectorTokenHash?: string;
  limit?: number;
}): Promise<TenantBehaviorExtensionBundle[]> {
  const client = createConvexClient();
  return (await client.query(convexRefs.codeListActiveBehaviorExtensions, {
    tenantId: args.tenantId,
    connectorTokenHash: args.connectorTokenHash,
    limit: args.limit,
  })) as TenantBehaviorExtensionBundle[];
}

export function deriveTenantBehaviorContext(args: {
  bundles: TenantBehaviorExtensionBundle[];
  inboundText?: string;
  historyLines?: string[];
  intent?: string;
}): CompiledTenantBehaviorContext {
  const corpus = [args.inboundText || "", args.intent || "", ...(args.historyLines || [])].join("\n");
  const extensions = args.bundles
    .flatMap((bundle) => bundle.behaviorExtensions.map((extension) => ({ ...extension, projectName: bundle.projectName })))
    .filter((extension) => matchesCorpus(extension, corpus))
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 24);

  return {
    promptBlocks: extensions.flatMap((extension) => extension.promptAdds).slice(0, 12),
    styleHints: extensions
      .filter((extension) => extension.kind === "heuristic" || extension.kind === "prompt")
      .flatMap((extension) => [
        ...extension.targets.map((target) => `Code Lab target ${target} matched from ${extension.name}.`),
        ...extension.patterns.map((pattern) => `Code Lab pattern "${pattern}" matched from ${extension.name}.`),
      ])
      .slice(0, 16),
    lexiconHints: extensions
      .flatMap((extension) => extension.terms.map((term) => `${term.token}: ${term.meaning}${term.tags.length ? ` (${term.tags.join(", ")})` : ""}`))
      .slice(0, 20),
    heuristicTargets: Array.from(new Set(extensions.flatMap((extension) => extension.targets))).slice(0, 20),
    sourceProjects: Array.from(new Set(extensions.map((extension) => extension.projectName))).slice(0, 12),
  };
}
