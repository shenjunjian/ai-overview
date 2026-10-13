export type AnalysisScore = { type: "cp" | "mate"; value: number };

export type AnalysisWdl = { win: number; draw: number; loss: number };

export type Analysis = {
  bestMove: string;
  score: AnalysisScore;
  pv: string[];
  wdl?: AnalysisWdl;
  depth: number;
};

export type UciInfo = {
  kind: "info";
  depth: number;
  multipv: number;
  score: AnalysisScore;
  pv: string[];
  wdl?: AnalysisWdl;
};

export type UciEvent =
  | UciInfo
  | { kind: "bestmove"; bestMove: string; ponder?: string }
  | { kind: "critical"; message: string }
  | { kind: "ignore" };

const valuedTokens = new Set([
  "depth",
  "seldepth",
  "multipv",
  "nodes",
  "nps",
  "hashfull",
  "tbhits",
  "time",
  "currmove",
  "currmovenumber",
]);

function integerAt(tokens: string[], index: number): number | undefined {
  const value = Number(tokens[index]);
  return Number.isInteger(value) ? value : undefined;
}

export function parseUciLine(line: string): UciEvent {
  const trimmed = line.trim();
  if (trimmed.length === 0) return { kind: "ignore" };
  if (trimmed.includes("CRITICAL ERROR")) {
    return { kind: "critical", message: trimmed.replace(/^info string\s+/, "") };
  }

  const tokens = trimmed.split(/\s+/);
  if (tokens[0] === "bestmove") {
    const bestMove = tokens[1];
    if (!bestMove) return { kind: "ignore" };
    const ponderAt = tokens.indexOf("ponder");
    const ponder = ponderAt >= 0 ? tokens[ponderAt + 1] : undefined;
    return ponder ? { kind: "bestmove", bestMove, ponder } : { kind: "bestmove", bestMove };
  }
  if (tokens[0] !== "info") return { kind: "ignore" };

  let depth: number | undefined;
  let multipv = 1;
  let score: AnalysisScore | undefined;
  let wdl: AnalysisWdl | undefined;
  let pv: string[] | undefined;

  let index = 1;
  while (index < tokens.length) {
    const token = tokens[index];
    if (token === "pv") {
      pv = tokens.slice(index + 1);
      break;
    }
    if (token === "string") return { kind: "ignore" };
    if (token === "score") {
      const type = tokens[index + 1];
      const value = integerAt(tokens, index + 2);
      if ((type === "cp" || type === "mate") && value != null) score = { type, value };
      index += 3;
      if (tokens[index] === "lowerbound" || tokens[index] === "upperbound") index += 1;
      continue;
    }
    if (token === "wdl") {
      const win = integerAt(tokens, index + 1);
      const draw = integerAt(tokens, index + 2);
      const loss = integerAt(tokens, index + 3);
      if (win != null && draw != null && loss != null) wdl = { win, draw, loss };
      index += 4;
      continue;
    }
    if (token != null && valuedTokens.has(token)) {
      if (token === "depth") depth = integerAt(tokens, index + 1);
      if (token === "multipv") {
        const value = integerAt(tokens, index + 1);
        if (value != null) multipv = value;
      }
      index += 2;
      continue;
    }
    index += 1;
  }

  if (!score || depth == null) return { kind: "ignore" };
  const info: UciInfo = { kind: "info", depth, multipv, score, pv: pv ?? [] };
  if (wdl) info.wdl = wdl;
  return info;
}

export function finishSearch(lines: string[]): Analysis {
  let latest: UciInfo | undefined;
  for (const line of lines) {
    const event = parseUciLine(line);
    if (event.kind === "critical") {
      throw new Error(`皮卡鱼无法分析这个局面：${event.message}`);
    }
    if (event.kind === "info" && event.multipv === 1) latest = event;
    if (event.kind === "bestmove") {
      if (!latest) throw new Error("皮卡鱼没有返回评分。");
      const analysis: Analysis = {
        bestMove: event.bestMove,
        score: latest.score,
        pv: latest.pv,
        depth: latest.depth,
      };
      if (latest.wdl) analysis.wdl = latest.wdl;
      return analysis;
    }
  }
  throw new Error("皮卡鱼没有返回 bestmove。");
}

export function positionCommand(fen: string, moves?: string[]): string {
  if (!moves || moves.length === 0) return `position fen ${fen}`;
  return `position fen ${fen} moves ${moves.join(" ")}`;
}

export function goCommand(input: { movetimeMs: number; depth?: number }): string {
  if (input.depth != null) return `go depth ${input.depth}`;
  return `go movetime ${input.movetimeMs}`;
}
