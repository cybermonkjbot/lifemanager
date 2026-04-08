import { hasPidginRecallCue } from "../../shared/pidgin-lexicon";

type MessageSnapshot = {
  messageAt?: number;
};

export type OlderContextDecision = {
  allowOlderContext: boolean;
  explicitRecallCue: boolean;
  staleThread: boolean;
  gapMs?: number;
  reason: "explicit_recall_cue" | "active_thread" | "stale_thread_without_cue" | "insufficient_history";
};

const EXPLICIT_RECALL_PATTERNS = [
  /\b(as discussed|as we discussed|as promised|like we said|you said|we said)\b/i,
  /\b(last time|earlier|before|previously|previous conversation)\b/i,
  /\b(from yesterday|from last night|from last week|from the other day)\b/i,
  /\b(follow(?: |-)?up|following up|continue|continue from|pick up where we left off)\b/i,
  /\b(circle back on (?:this|that)|follow up on (?:this|that))\b/i,
  /\b(update on|any update|any upd8|what happened to|did you get a chance)\b/i,
  /\b(did you send|did you share|did u send|did u share|can you resend|resend that|resend dat)\b/i,
  /\b(still on for|we still on|still good for|same plan)\b/i,
  /\b(we still dey on(?: for)?|still dey on for|still dey on)\b/i,
  /\b(still down for|you still down for)\b/i,
  /\b(you said you(?:'|’)d|you said you would|you were gonna|you never sent)\b/i,
  /\b(you (?:talk|said?) say you (?:go|gonna|would) send)\b/i,
  /\b(you don (?:send|share) am|you fit resend am|fit resend am)\b/i,
  /\b(abeg (?:update me|give me update)|abeg any update)\b/i,
  /\b(abeg remind me|fit remind me)\b/i,
  /\b(fit send am again|send am again)\b/i,
  /\b(wetin happen to (?:that|the) (?:plan|thing|one)|wetin sup with (?:that|the) (?:plan|thing|one))\b/i,
  /\b(how far with (?:that|the) (?:plan|thing|one)|how far with this|hw far wit (?:that|the) (?:plan|thing|one))\b/i,
  /\b(still (?:on|available|happening|need|waiting)|again)\b/i,
];

function hasExplicitRecallCue(text: string) {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }
  return EXPLICIT_RECALL_PATTERNS.some((pattern) => pattern.test(trimmed)) || hasPidginRecallCue(trimmed);
}

function extractSortedTimestamps(messages: MessageSnapshot[]) {
  return messages
    .map((message) => Number(message.messageAt))
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((left, right) => left - right);
}

export function decideOlderContextUsage(args: {
  inboundText: string;
  messages: MessageSnapshot[];
  activeThreadGapMs?: number;
  staleThreadGapMs?: number;
}): OlderContextDecision {
  const explicitRecallCue = hasExplicitRecallCue(args.inboundText);
  const activeThreadGapMs = Math.max(5 * 60_000, args.activeThreadGapMs ?? 6 * 60 * 60 * 1000);
  const staleThreadGapMs = Math.max(activeThreadGapMs, args.staleThreadGapMs ?? 24 * 60 * 60 * 1000);
  const timeline = extractSortedTimestamps(args.messages || []);

  if (timeline.length < 2) {
    return {
      allowOlderContext: explicitRecallCue,
      explicitRecallCue,
      staleThread: false,
      reason: explicitRecallCue ? "explicit_recall_cue" : "insufficient_history",
    };
  }

  const latestAt = timeline[timeline.length - 1];
  const previousAt = timeline[timeline.length - 2];
  const gapMs = Math.max(0, latestAt - previousAt);
  const staleThread = gapMs >= staleThreadGapMs;
  const activeThread = gapMs <= activeThreadGapMs;

  if (explicitRecallCue) {
    return {
      allowOlderContext: true,
      explicitRecallCue,
      staleThread,
      gapMs,
      reason: "explicit_recall_cue",
    };
  }

  if (activeThread) {
    return {
      allowOlderContext: true,
      explicitRecallCue,
      staleThread,
      gapMs,
      reason: "active_thread",
    };
  }

  return {
    allowOlderContext: false,
    explicitRecallCue,
    staleThread,
    gapMs,
    reason: "stale_thread_without_cue",
  };
}
