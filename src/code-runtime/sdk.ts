export type CodeSdkOperation = {
  description: string;
  danger: "read" | "write" | "runtime" | "send";
  requiredArgs?: string[];
};

export type CodeSdkModule = {
  description: string;
  operations: Record<string, CodeSdkOperation>;
};

export const CODE_SDK_REGISTRY: Record<string, CodeSdkModule> = {
  chat: {
    description: "Inspect message and thread context.",
    operations: {
      read: { description: "Read the active message context.", danger: "read" },
    },
  },
  ai: {
    description: "Shape AI reply behavior for the current event.",
    operations: {
      set_mode: {
        description: "Set review_first or autopilot mode for the active event.",
        danger: "write",
        requiredArgs: ["value"],
      },
      set_instruction: {
        description: "Attach a temporary instruction overlay.",
        danger: "write",
        requiredArgs: ["value"],
      },
      set_confidence_floor: {
        description: "Raise the minimum confidence required before action.",
        danger: "write",
        requiredArgs: ["value"],
      },
    },
  },
  followups: {
    description: "Create and manage bounded conversation reminders.",
    operations: {
      create: {
        description: "Create a follow-up reminder.",
        danger: "write",
        requiredArgs: ["title", "thread", "due"],
      },
      snooze: {
        description: "Snooze an existing follow-up.",
        danger: "write",
        requiredArgs: ["id", "due"],
      },
      confirm: {
        description: "Confirm an existing follow-up.",
        danger: "write",
        requiredArgs: ["id"],
      },
    },
  },
  memory: {
    description: "Read and write bounded contact facts.",
    operations: {
      read: { description: "Read safe contact memory facts.", danger: "read" },
      remember: {
        description: "Store a bounded memory fact.",
        danger: "write",
        requiredArgs: ["key", "value"],
      },
    },
  },
  settings: {
    description: "Inspect safe runtime settings.",
    operations: {
      read: { description: "Read safe configuration values.", danger: "read" },
    },
  },
  outreach: {
    description: "Trigger approved outreach flows.",
    operations: {
      run: { description: "Run the approved outreach batch.", danger: "send" },
    },
  },
  runtime: {
    description: "Pause, resume, or inspect local runtime state.",
    operations: {
      pause: { description: "Pause worker/app automation.", danger: "runtime" },
      resume: { description: "Resume worker/app automation.", danger: "runtime" },
      status: { description: "Inspect runtime status.", danger: "read" },
    },
  },
  http: {
    description: "Perform outbound API requests through the audited runtime adapter.",
    operations: {
      fetch: { description: "Run an outbound HTTP request and record telemetry.", danger: "runtime", requiredArgs: ["url"] },
      get: { description: "Run an outbound GET request and record telemetry.", danger: "runtime", requiredArgs: ["url"] },
      post: { description: "Run an outbound POST request and record telemetry.", danger: "runtime", requiredArgs: ["url"] },
      request: { description: "Run an outbound request with an explicit method.", danger: "runtime", requiredArgs: ["url"] },
    },
  },
  webhook: {
    description: "Handle inbound webhook payloads safely.",
    operations: {
      reply: { description: "Return a JSON response from the webhook handler.", danger: "write" },
      verify_secret: { description: "Check the inbound webhook secret reference.", danger: "read", requiredArgs: ["secretKey"] },
    },
  },
  orchestrator: {
    description: "Ask the account-scoped orchestrator or route through approved tools.",
    operations: {
      ask: { description: "Ask the orchestrator to reason over the current event.", danger: "runtime", requiredArgs: ["prompt"] },
      run_tool: { description: "Call an approved account-scoped tool exposed to the orchestrator.", danger: "runtime", requiredArgs: ["tool"] },
    },
  },
  messages: {
    description: "Preview, draft, or send messages through account-scoped messaging adapters.",
    operations: {
      send: { description: "Queue a message send when the program is allowed to do so.", danger: "send", requiredArgs: ["to", "text"] },
      draft: { description: "Create a reviewable message draft.", danger: "write", requiredArgs: ["to", "text"] },
      preview: { description: "Render a send preview without queueing it.", danger: "read" },
    },
  },
  platform: {
    description: "Bridge events, replies, reactions, and routing across connected platforms.",
    operations: {
      send: {
        description: "Queue a message through a specific connected platform adapter.",
        danger: "send",
        requiredArgs: ["via", "to", "text"],
      },
      draft: {
        description: "Create a reviewable draft for a specific connected platform.",
        danger: "write",
        requiredArgs: ["via", "to", "text"],
      },
      preview: {
        description: "Preview a cross-platform message without queueing it.",
        danger: "read",
        requiredArgs: ["via"],
      },
      react: {
        description: "Queue or preview a reaction through a target platform adapter.",
        danger: "send",
        requiredArgs: ["via", "to", "emoji"],
      },
      mirror: {
        description: "Mirror the current event into another platform workflow.",
        danger: "runtime",
        requiredArgs: ["to"],
      },
      route: {
        description: "Route the current event into a named cross-platform workflow.",
        danger: "runtime",
        requiredArgs: ["to"],
      },
      broadcast: {
        description: "Fan out the current event or message to multiple connected platform adapters.",
        danger: "send",
        requiredArgs: ["targets", "text"],
      },
      relay: {
        description: "Relay the current event from its source platform to one or more target platforms.",
        danger: "runtime",
        requiredArgs: ["targets"],
      },
    },
  },
  account: {
    description: "Patch account settings and behavior through audited account adapters.",
    operations: {
      "settings.patch": { description: "Patch selected account settings.", danger: "runtime" },
      behavior_set: { description: "Set account behavior flags for the owner account.", danger: "runtime", requiredArgs: ["value"] },
      "behavior.set": { description: "Set account behavior flags for the owner account.", danger: "runtime", requiredArgs: ["value"] },
    },
  },
  worker: {
    description: "Extend the local worker through approved hooks, schedules, and local adapters.",
    operations: {
      extend: { description: "Register a worker extension hook from the published bundle.", danger: "runtime", requiredArgs: ["name"] },
      schedule: { description: "Schedule a handler on the local worker.", danger: "runtime", requiredArgs: ["handler"] },
      run_local: { description: "Run an approved local adapter without filesystem or shell access.", danger: "runtime", requiredArgs: ["adapter"] },
    },
  },
  heuristics: {
    description: "Extend tenant-scoped pattern matching and decision heuristics.",
    operations: {
      pattern: { description: "Register a text pattern for a named heuristic target.", danger: "runtime", requiredArgs: ["target", "value"] },
      score: { description: "Add or subtract score from a heuristic target.", danger: "runtime", requiredArgs: ["target", "value"] },
      mark_intent: { description: "Mark a detected intent for prompt and worker routing.", danger: "runtime", requiredArgs: ["intent"] },
      block: { description: "Block or review-first a matched heuristic case.", danger: "runtime", requiredArgs: ["reason"] },
    },
  },
  lexicon: {
    description: "Extend tenant-specific language, slang, aliases, and shortcut dictionaries.",
    operations: {
      term: { description: "Define a tenant-specific word or phrase meaning.", danger: "runtime", requiredArgs: ["token", "meaning"] },
      phrase: { description: "Define a phrase with tags for prompt derivation.", danger: "runtime", requiredArgs: ["token", "meaning"] },
      alias: { description: "Teach the system an alias for a person, object, or domain term.", danger: "runtime", requiredArgs: ["token", "meaning"] },
    },
  },
  prompts: {
    description: "Extend prompt derivation with tenant-specific instruction blocks.",
    operations: {
      append: { description: "Append a bounded instruction when a condition or target matches.", danger: "runtime", requiredArgs: ["text"] },
      prepend: { description: "Prepend a high-priority instruction when a condition or target matches.", danger: "runtime", requiredArgs: ["text"] },
      derive: { description: "Create a prompt derivation hook from detected heuristics or lexicon terms.", danger: "runtime", requiredArgs: ["target"] },
      set_context: { description: "Add a bounded context label for downstream prompt construction.", danger: "runtime", requiredArgs: ["key", "value"] },
    },
  },
  time: {
    description: "Use clock helpers in conditions and action arguments.",
    operations: {
      tomorrow_at: {
        description: "Resolve a local wall-clock time on the next day.",
        danger: "read",
        requiredArgs: ["value"],
      },
    },
  },
};

export const DEFAULT_CODE_LIMITS = {
  maxStepsPerRun: 20,
  maxRuntimeMs: 2000,
  maxFollowupsCreated: 3,
  maxSendsQueued: 0,
};

export function listCodeSdkDocs() {
  return Object.entries(CODE_SDK_REGISTRY).map(([name, module]) => ({
    name,
    description: module.description,
    operations: Object.entries(module.operations).map(([operation, spec]) => ({
      operation,
      ...spec,
    })),
  }));
}
