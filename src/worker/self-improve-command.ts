export type SelfImproveCommand =
  | {
      action: "run";
      prompt: string;
      raw: string;
    }
  | {
      action: "status";
      raw: string;
    }
  | {
      action: "latest";
      raw: string;
    };

const COMMAND_PATTERN =
  /^(?:(?:\/?slm|!slm|runtime|\/runtime|cmd|command|codex)\s+)?(?:self-?improve|improve)(?:\s*[:\-])?\s*(.*)$/i;

export function parseSelfImproveCommand(text: string): SelfImproveCommand | null {
  const raw = (text || "").trim();
  if (!raw) {
    return null;
  }

  const match = raw.match(COMMAND_PATTERN);
  if (!match) {
    return null;
  }

  const tail = (match[1] || "").trim();
  if (!tail) {
    return null;
  }

  const normalizedTail = tail.toLowerCase();
  if (normalizedTail === "status") {
    return {
      action: "status",
      raw,
    };
  }
  if (normalizedTail === "latest" || normalizedTail === "report") {
    return {
      action: "latest",
      raw,
    };
  }

  return {
    action: "run",
    prompt: tail,
    raw,
  };
}
