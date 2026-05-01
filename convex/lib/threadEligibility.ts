import type { Doc } from "../_generated/dataModel";

export type MessageProvider = "whatsapp" | "instagram" | "imessage" | "telegram";

export type ThreadKind = "direct" | "group" | "broadcast_or_system";
export type EligibilityReason = "group_ignored" | "archived" | "broadcast_or_system" | "explicit_ignore" | "temporary_ghost";

export type EligibilityResult =
  | {
      allowed: true;
    }
  | {
      allowed: false;
      reason: EligibilityReason;
    };

const BROADCAST_OR_SYSTEM_SUFFIXES = ["@broadcast", "@newsletter"];

export function isGroupJid(jid: string, provider: MessageProvider = "whatsapp") {
  if (provider === "instagram") {
    return false;
  }
  return jid.endsWith("@g.us");
}

export function isBroadcastOrSystemJid(jid: string, provider: MessageProvider = "whatsapp") {
  if (!jid) {
    return false;
  }
  if (provider === "instagram") {
    // Keep legacy alias plus current story broadcast jid.
    return jid === "instagram:story" || jid === "ig:story:broadcast";
  }
  if (jid === "status@broadcast") {
    return true;
  }
  if (jid.startsWith("status@")) {
    return true;
  }
  return BROADCAST_OR_SYSTEM_SUFFIXES.some((suffix) => jid.endsWith(suffix));
}

export function classifyThreadKind(args: { jid: string; isGroupHint?: boolean; provider?: MessageProvider }): ThreadKind {
  const provider = args.provider || "whatsapp";
  if (isBroadcastOrSystemJid(args.jid, provider)) {
    return "broadcast_or_system";
  }
  if (args.isGroupHint || isGroupJid(args.jid, provider)) {
    return "group";
  }
  return "direct";
}

export function directIgnoreRuleCandidates(args: { jid: string; provider?: MessageProvider }) {
  const provider = args.provider || "whatsapp";
  const trimmed = args.jid.trim();
  if (!trimmed) {
    return [];
  }

  const normalized = trimmed.toLowerCase();
  if (provider !== "whatsapp") {
    return [...new Set([trimmed, normalized])];
  }

  const [userAndDevice = ""] = normalized.split("@");
  const [bareUser = ""] = userAndDevice.split(":");
  if (!bareUser) {
    return [...new Set([trimmed, normalized])];
  }

  return [...new Set([trimmed, normalized, `${bareUser}@s.whatsapp.net`, `${bareUser}@lid`])];
}

export function directIgnoreContactKey(args: { jid: string; provider?: MessageProvider }) {
  const provider = args.provider || "whatsapp";
  const normalized = args.jid.trim().toLowerCase();
  if (!normalized) {
    return "";
  }
  if (provider !== "whatsapp") {
    return normalized;
  }

  const [userAndDevice = ""] = normalized.split("@");
  const [bareUser = ""] = userAndDevice.split(":");
  return bareUser || normalized;
}

export function resolveThreadEligibility(args: {
  thread: Pick<Doc<"threads">, "jid" | "isIgnored" | "isArchived" | "threadKind" | "ghostedUntil">;
  ignoreGroupsByDefault: boolean;
  explicitIgnoreEnabled: boolean;
  groupRuleEnabled?: boolean;
  nowMs?: number;
}): EligibilityResult {
  const nowMs = args.nowMs ?? Date.now();
  const threadKind = args.thread.threadKind || classifyThreadKind({ jid: args.thread.jid });

  if (threadKind === "broadcast_or_system") {
    return {
      allowed: false,
      reason: "broadcast_or_system",
    };
  }

  if (Boolean(args.thread.isArchived)) {
    return {
      allowed: false,
      reason: "archived",
    };
  }

  // Keep backwards compatibility for legacy thread-level ignores on direct chats.
  if (args.explicitIgnoreEnabled || (args.thread.isIgnored && threadKind !== "group")) {
    return {
      allowed: false,
      reason: "explicit_ignore",
    };
  }

  if (threadKind === "group") {
    if (args.groupRuleEnabled === true) {
      return {
        allowed: false,
        reason: "explicit_ignore",
      };
    }

    // A stored group rule with enabled=false is an explicit allow override.
    if (args.groupRuleEnabled !== false && args.ignoreGroupsByDefault) {
      return {
        allowed: false,
        reason: "group_ignored",
      };
    }
  }

  if ((args.thread.ghostedUntil || 0) > nowMs) {
    return {
      allowed: false,
      reason: "temporary_ghost",
    };
  }

  return {
    allowed: true,
  };
}

export function eligibilityReasonLabel(reason: EligibilityReason) {
  if (reason === "group_ignored") {
    return "group ignored by default";
  }
  if (reason === "archived") {
    return "thread is archived";
  }
  if (reason === "broadcast_or_system") {
    return "broadcast/system thread";
  }
  if (reason === "temporary_ghost") {
    return "temporary ghost mode active";
  }
  return "explicit ignore rule";
}
