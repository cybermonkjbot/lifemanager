import type {
  CodeActionArgAst,
  CodeActionAst,
  CodeConditionAst,
  CodeDiagnostic,
  CodeExpectationAst,
  CodeHandlerAst,
  CodeParseResult,
  CodeProgramAst,
  CodeTestAst,
  LiteralValue,
} from "./types";

function diagnostic(message: string, line: number, column = 1): CodeDiagnostic {
  return { severity: "error", message, line, column };
}

function stripComment(line: string) {
  return line.replace(/(^|\s)#.*$/, "");
}

function parseLiteral(raw: string): LiteralValue | null {
  const value = raw.trim().replace(/,$/, "");
  const quoted = value.match(/^"([\s\S]*)"$/);
  if (quoted) return quoted[1] || "";
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  return null;
}

function parseValue(raw: string): CodeActionArgAst["value"] | null {
  const literal = parseLiteral(raw);
  if (literal !== null) return literal;

  const call = raw.trim().match(/^([a-z][\w]*(?:\.[a-z][\w]*)*)\((.*)\)$/);
  if (call) {
    const args = call[2]?.trim()
      ? call[2].split(",").map((item) => parseLiteral(item.trim())).filter((item): item is LiteralValue => item !== null)
      : [];
    return { call: call[1] || "", args };
  }

  if (/^[a-z][\w]*(?:\.[a-z][\w]*)*$/.test(raw.trim())) {
    return { ref: raw.trim() };
  }

  return null;
}

function parseCondition(raw: string, line: number): CodeConditionAst | null {
  const text = raw.replace(/^\s*(when|and)\s+/, "").trim();
  const between = text.match(/^([a-z][\w]*(?:\.[a-z][\w]*)*)\s+between\s+"([^"]+)"\s+and\s+"([^"]+)"$/);
  if (between) {
    return {
      kind: "betweenTime",
      left: between[1] || "",
      start: between[2] || "",
      end: between[3] || "",
      line,
    };
  }

  const equals = text.match(/^([a-z][\w]*(?:\.[a-z][\w]*)*)\s*==\s*(.+)$/);
  if (equals) {
    const right = parseLiteral(equals[2] || "");
    if (right !== null) {
      return {
        kind: "equals",
        left: equals[1] || "",
        right,
        line,
      };
    }
  }

  return null;
}

function collectCall(lines: string[], startIndex: number) {
  const parts: string[] = [];
  let depth = 0;
  let index = startIndex;
  for (; index < lines.length; index += 1) {
    const text = stripComment(lines[index] || "").trim();
    if (!text) continue;
    parts.push(text);
    depth += (text.match(/\(/g) || []).length;
    depth -= (text.match(/\)/g) || []).length;
    if (depth <= 0 && text.includes(")")) break;
  }
  return { raw: parts.join(" "), endIndex: index };
}

function parseAction(raw: string, line: number): CodeActionAst | null {
  const match = raw.trim().match(/^([a-z][\w]*)\.([a-z][\w]*)\(([\s\S]*)\)$/);
  if (!match) return null;
  const argsRaw = (match[3] || "").trim();
  const args: CodeActionArgAst[] = [];

  if (argsRaw && !argsRaw.includes(":")) {
    const value = parseValue(argsRaw);
    if (value === null) return null;
    args.push({ key: "value", value });
  } else if (argsRaw) {
    for (const segment of argsRaw.split(/,(?![^(]*\))/)) {
      const arg = segment.trim();
      if (!arg) continue;
      const argMatch = arg.match(/^([a-z][\w]*)\s*:\s*([\s\S]+)$/);
      if (!argMatch) return null;
      const value = parseValue(argMatch[2] || "");
      if (value === null) return null;
      args.push({ key: argMatch[1] || "", value });
    }
  }

  return {
    module: match[1] || "",
    operation: match[2] || "",
    args,
    line,
  };
}

function parseGivenBlock(lines: string[], startIndex: number, diagnostics: CodeDiagnostic[]) {
  const given: Record<string, LiteralValue> = {};
  let index = startIndex;
  for (; index < lines.length; index += 1) {
    const raw = stripComment(lines[index] || "").trim();
    if (!raw) continue;
    if (raw === "}") break;
    const match = raw.match(/^([a-z][\w]*(?:\.[a-z][\w]*)*)\s*:\s*(.+?)(?:,)?$/);
    if (!match) {
      diagnostics.push(diagnostic("Expected given field like `thread.kind: \"direct\"`.", index + 1));
      continue;
    }
    const value = parseLiteral(match[2] || "");
    if (value === null) {
      diagnostics.push(diagnostic("Given fields must use string, number, or boolean literals.", index + 1));
      continue;
    }
    given[match[1] || ""] = value;
  }
  return { given, endIndex: index };
}

function parseExpectation(raw: string, line: number): CodeExpectationAst | null {
  const match = raw.trim().match(/^expect\s+([a-z][\w]*(?:\.[a-z][\w]*)*)\s*==\s*(.+)$/);
  if (!match) return null;
  const right = parseLiteral(match[2] || "");
  if (right === null) return null;
  return { left: match[1] || "", right, line };
}

export function parseCodeProgram(source: string): CodeParseResult {
  const diagnostics: CodeDiagnostic[] = [];
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const headerIndex = lines.findIndex((line) => stripComment(line).trim().length > 0);
  const header = headerIndex >= 0 ? stripComment(lines[headerIndex] || "").trim() : "";
  const headerMatch = header.match(/^program\s+([A-Z][A-Za-z0-9_]*)\s+version\s+"([^"]+)"$/);

  if (!headerMatch) {
    return {
      ast: null,
      diagnostics: [diagnostic('Expected `program Name version "1.0"` as the first statement.', Math.max(1, headerIndex + 1))],
    };
  }

  const ast: CodeProgramAst = {
    kind: "program",
    name: headerMatch[1] || "Program",
    version: headerMatch[2] || "1.0",
    uses: [],
    handlers: [],
    tests: [],
  };

  for (let index = headerIndex + 1; index < lines.length; index += 1) {
    const raw = stripComment(lines[index] || "").trim();
    if (!raw) continue;

    const useMatch = raw.match(/^use\s+([a-z][\w]*)$/);
    if (useMatch) {
      ast.uses.push(useMatch[1] || "");
      continue;
    }

    const onMatch = raw.match(/^on\s+([a-z][\w]*(?:\.[a-z][\w]*)*)\s+as\s+([a-z][\w]*)$/);
    if (onMatch) {
      const handler: CodeHandlerAst = {
        event: onMatch[1] || "",
        alias: onMatch[2] || "event",
        conditions: [],
        actions: [],
        line: index + 1,
      };
      index += 1;

      for (; index < lines.length; index += 1) {
        const line = stripComment(lines[index] || "").trim();
        if (!line) continue;
        if (line === "do") break;
        if (/^(when|and)\s+/.test(line)) {
          const condition = parseCondition(line, index + 1);
          if (condition) handler.conditions.push(condition);
          else diagnostics.push(diagnostic("Could not parse condition.", index + 1));
          continue;
        }
        diagnostics.push(diagnostic("Expected `when`, `and`, or `do` inside handler.", index + 1));
      }

      for (index += 1; index < lines.length; index += 1) {
        const line = stripComment(lines[index] || "").trim();
        if (!line) continue;
        if (line === "end") break;
        const call = collectCall(lines, index);
        const action = parseAction(call.raw, index + 1);
        if (action) handler.actions.push(action);
        else diagnostics.push(diagnostic("Could not parse SDK action.", index + 1));
        index = call.endIndex;
      }

      ast.handlers.push(handler);
      continue;
    }

    const testMatch = raw.match(/^test\s+"([^"]+)"$/);
    if (testMatch) {
      const test: CodeTestAst = {
        name: testMatch[1] || "unnamed test",
        event: "",
        given: {},
        expectations: [],
        line: index + 1,
      };

      index += 1;
      const givenLine = stripComment(lines[index] || "").trim();
      const givenMatch = givenLine.match(/^given\s+([a-z][\w]*(?:\.[a-z][\w]*)*)\s+\{$/);
      if (!givenMatch) {
        diagnostics.push(diagnostic("Expected `given event.name {` after test name.", index + 1));
      } else {
        test.event = givenMatch[1] || "";
        const block = parseGivenBlock(lines, index + 1, diagnostics);
        test.given = block.given;
        index = block.endIndex;
      }

      for (index += 1; index < lines.length; index += 1) {
        const line = stripComment(lines[index] || "").trim();
        if (!line) continue;
        if (/^(test|on|use|program)\b/.test(line)) {
          index -= 1;
          break;
        }
        const expectation = parseExpectation(line, index + 1);
        if (expectation) test.expectations.push(expectation);
        else diagnostics.push(diagnostic("Expected assertion like `expect ai.mode == \"review_first\"`.", index + 1));
      }

      ast.tests.push(test);
      continue;
    }

    diagnostics.push(diagnostic("Unknown top-level statement.", index + 1));
  }

  return { ast, diagnostics };
}
