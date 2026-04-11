export type OpenClawCommand =
  | {
      action: "status";
      raw: string;
    }
  | {
      action: "help";
      raw: string;
    }
  | {
      action: "forward";
      input: string;
      raw: string;
    };

const COMMAND_PATTERN =
  /^(?:(?:\/?slm|!slm|runtime|\/runtime|cmd|command)\s+)?(?:@?openclaw|@?claw)(?:\s*[:\-])?\s*(.*)$/i;
const INLINE_MENTION_PATTERN = /(?<![a-z0-9_])@(?:openclaw|claw)\b/i;
const INLINE_WAKE_WORD_PATTERN = /(?<![a-z0-9_])(?:openclaw|claw)\s*[:\-]/i;

function parseTail(raw: string, tailRaw: string): OpenClawCommand {
  const tail = tailRaw.trim();
  if (!tail) {
    return {
      action: "status",
      raw,
    };
  }

  const normalizedTail = tail.toLowerCase();
  if (normalizedTail === "status" || normalizedTail === "health" || normalizedTail === "ping") {
    return {
      action: "status",
      raw,
    };
  }

  if (normalizedTail === "help") {
    return {
      action: "help",
      raw,
    };
  }

  return {
    action: "forward",
    input: tail,
    raw,
  };
}

export function parseOpenClawCommand(text: string): OpenClawCommand | null {
  const raw = (text || "").trim();
  if (!raw) {
    return null;
  }

  const commandMatch = raw.match(COMMAND_PATTERN);
  if (commandMatch) {
    return parseTail(raw, commandMatch[1] || "");
  }

  const mentionMatch = raw.match(INLINE_MENTION_PATTERN);
  if (mentionMatch && typeof mentionMatch.index === "number") {
    const afterMention = raw.slice(mentionMatch.index + mentionMatch[0].length).replace(/^[\s,.:;\-!?]+/, "");
    return parseTail(raw, afterMention);
  }

  const wakeWordMatch = raw.match(INLINE_WAKE_WORD_PATTERN);
  if (!wakeWordMatch || typeof wakeWordMatch.index !== "number") {
    return null;
  }

  const afterWakeWord = raw.slice(wakeWordMatch.index + wakeWordMatch[0].length).replace(/^[\s,.:;\-!?]+/, "");
  return parseTail(raw, afterWakeWord);
}
