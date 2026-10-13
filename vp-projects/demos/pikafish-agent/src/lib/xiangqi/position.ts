export const openingFen =
  "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w";

const bestMoveArrow = "rgb(185, 28, 28)";
const continuationArrow = "rgb(37, 99, 235)";
const uciMove = /^[a-i][0-9][a-i][0-9]$/;
const pieceChar = /^[rnbakcpRNBAKCP]$/;

export type SideToMove = "w" | "b";

export type ShownAnalysis = {
  fen: string;
  bestMove: string;
  score: { type: "cp" | "mate"; value: number };
  pv: string[];
  depth: number;
  wdl?: { win: number; draw: number; loss: number };
  moves?: string[];
};

type Position = {
  rows: string[][];
  side: SideToMove;
};

function hasControlChar(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) < 32) return true;
  }
  return false;
}

function compressRank(cells: readonly string[]): string {
  let encoded = "";
  let empty = 0;
  for (const cell of cells) {
    if (cell === "") {
      empty += 1;
      continue;
    }
    if (empty > 0) {
      encoded += String(empty);
      empty = 0;
    }
    encoded += cell;
  }
  if (empty > 0) encoded += String(empty);
  return encoded;
}

function formatFen(position: Position): string {
  return `${position.rows.map(compressRank).join("/")} ${position.side}`;
}

function parseRank(rank: string): string[] | undefined {
  const cells: string[] = [];
  for (const char of rank) {
    if (char >= "1" && char <= "9") {
      const empty = Number(char);
      if (cells.length + empty > 9) return undefined;
      for (let index = 0; index < empty; index += 1) cells.push("");
      continue;
    }
    if (!pieceChar.test(char) || cells.length >= 9) return undefined;
    cells.push(char);
  }
  return cells.length === 9 ? cells : undefined;
}

function parsePosition(fen: string): Position | undefined {
  const trimmed = fen.trim();
  if (trimmed.length === 0 || hasControlChar(trimmed)) return undefined;
  const [placement, sideToken] = trimmed.split(/\s+/);
  if (!placement || (sideToken !== "w" && sideToken !== "b")) return undefined;
  const ranks = placement.split("/");
  if (ranks.length !== 10) return undefined;
  const rows: string[][] = [];
  for (const rank of ranks) {
    const cells = parseRank(rank);
    if (!cells) return undefined;
    rows.push(cells);
  }
  return { rows, side: sideToken };
}

function squareIndex(square: string): { row: number; col: number } | undefined {
  const match = /^([a-i])(10|[1-9])$/.exec(square);
  const file = match?.[1];
  const rankText = match?.[2];
  if (!file || !rankText) return undefined;
  const row = 10 - Number(rankText);
  const col = file.charCodeAt(0) - "a".charCodeAt(0);
  if (row < 0 || row > 9) return undefined;
  return { row, col };
}

function uciSquareToBoard(square: string): string | undefined {
  const file = square[0];
  const rank = square[1];
  if (!file || rank == null || file < "a" || file > "i") return undefined;
  const uciRank = Number(rank);
  if (!Number.isInteger(uciRank) || uciRank < 0 || uciRank > 9) return undefined;
  return `${file}${uciRank + 1}`;
}

export type Board = Position;
export type SquareCoords = { row: number; col: number };

export function readBoard(fen: string): Board | undefined {
  return parsePosition(fen);
}

export function writeBoard(board: Board): string {
  return formatFen(board);
}

export function squareCoords(square: string): SquareCoords | undefined {
  return squareIndex(square);
}

export function boardFen(fen: string): string | undefined {
  const position = parsePosition(fen);
  return position ? formatFen(position) : undefined;
}

export function sideToMove(fen: string): SideToMove | undefined {
  return parsePosition(fen)?.side;
}

export function pvToArrows(pv: readonly string[]): [string, string, string][] {
  const arrows: [string, string, string][] = [];
  for (const move of pv) {
    if (!uciMove.test(move)) continue;
    const from = uciSquareToBoard(move.slice(0, 2));
    const to = uciSquareToBoard(move.slice(2, 4));
    if (!from || !to || from === to) continue;
    arrows.push([from, to, arrows.length === 0 ? bestMoveArrow : continuationArrow]);
  }
  return arrows;
}

function readScore(value: unknown): ShownAnalysis["score"] | undefined {
  if (value == null || typeof value !== "object") return undefined;
  const score = value as { type?: unknown; value?: unknown };
  if (score.type !== "cp" && score.type !== "mate") return undefined;
  if (typeof score.value !== "number" || !Number.isFinite(score.value)) return undefined;
  return { type: score.type, value: score.value };
}

function readWdl(value: unknown): ShownAnalysis["wdl"] | undefined {
  if (value == null || typeof value !== "object") return undefined;
  const wdl = value as { win?: unknown; draw?: unknown; loss?: unknown };
  if (
    typeof wdl.win !== "number" ||
    typeof wdl.draw !== "number" ||
    typeof wdl.loss !== "number" ||
    ![wdl.win, wdl.draw, wdl.loss].every(Number.isFinite)
  ) {
    return undefined;
  }
  return { win: wdl.win, draw: wdl.draw, loss: wdl.loss };
}

function readMoves(value: unknown): string[] | undefined {
  if (value == null) return undefined;
  if (!Array.isArray(value) || value.some((move) => typeof move !== "string")) return undefined;
  return value;
}

export function readAnalysis(value: unknown): ShownAnalysis | undefined {
  if (value == null || typeof value !== "object") return undefined;
  const output = value as {
    fen?: unknown;
    bestMove?: unknown;
    score?: unknown;
    pv?: unknown;
    depth?: unknown;
    wdl?: unknown;
    moves?: unknown;
  };
  const score = readScore(output.score);
  if (typeof output.fen !== "string" || output.fen.trim().length === 0) return undefined;
  if (typeof output.bestMove !== "string" || output.bestMove.trim().length === 0) return undefined;
  if (!score || !Array.isArray(output.pv) || output.pv.some((move) => typeof move !== "string")) {
    return undefined;
  }
  if (typeof output.depth !== "number" || !Number.isInteger(output.depth) || output.depth < 0) {
    return undefined;
  }
  const moves = readMoves(output.moves);
  if (output.moves != null && !moves) return undefined;
  const wdl = output.wdl == null ? undefined : readWdl(output.wdl);
  return {
    fen: output.fen,
    bestMove: output.bestMove,
    score,
    pv: output.pv,
    depth: output.depth,
    ...(wdl ? { wdl } : {}),
    ...(moves && moves.length > 0 ? { moves } : {}),
  };
}

export function formatScore(score: ShownAnalysis["score"]): string {
  if (score.type === "cp") {
    return score.value > 0 ? `cp +${score.value}` : `cp ${score.value}`;
  }
  if (score.value > 0) return `mate 胜 ${score.value}`;
  if (score.value < 0) return `mate 负 ${Math.abs(score.value)}`;
  return "mate 0";
}

export function questionWithPosition(fen: string, question: string): string {
  return `局面 FEN：${fen}\n${question}`;
}
