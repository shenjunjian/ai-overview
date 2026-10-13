import {
  readBoard,
  squareCoords,
  writeBoard,
  type SideToMove,
  type SquareCoords,
} from "./position";

const numerals = ["一", "二", "三", "四", "五", "六", "七", "八", "九"] as const;
const fileTarget = new Set(["N", "A", "B"]);
const redNames: Record<string, string> = {
  K: "帅",
  A: "仕",
  B: "相",
  N: "马",
  R: "车",
  C: "炮",
  P: "兵",
};
const blackNames: Record<string, string> = {
  K: "将",
  A: "士",
  B: "象",
  N: "马",
  R: "车",
  C: "炮",
  P: "卒",
};

export type MoveFault = "turn" | "illegal" | "check";

export type PlayedMove = {
  fen: string;
  notation: string;
  side: SideToMove;
};

export type ScoreEntry = {
  side: SideToMove;
  notation: string;
};

export type ScoreRow = {
  round: number;
  red: string;
  black: string;
};

function pieceSide(piece: string): SideToMove {
  return piece === piece.toUpperCase() ? "w" : "b";
}

function inPalace(row: number, col: number, side: SideToMove): boolean {
  if (col < 3 || col > 5) return false;
  return side === "w" ? row >= 7 && row <= 9 : row >= 0 && row <= 2;
}

function onOwnHalf(row: number, side: SideToMove): boolean {
  return side === "w" ? row >= 5 : row <= 4;
}

function betweenCount(
  rows: string[][],
  from: SquareCoords,
  to: SquareCoords,
): number | undefined {
  if (from.row !== to.row && from.col !== to.col) return undefined;
  if (from.row === to.row && from.col === to.col) return undefined;
  const stepRow = Math.sign(to.row - from.row);
  const stepCol = Math.sign(to.col - from.col);
  let count = 0;
  let row = from.row + stepRow;
  let col = from.col + stepCol;
  while (row !== to.row || col !== to.col) {
    if (rows[row]?.[col]) count += 1;
    row += stepRow;
    col += stepCol;
  }
  return count;
}

function reaches(rows: string[][], piece: string, from: SquareCoords, to: SquareCoords): boolean {
  const side = pieceSide(piece);
  const type = piece.toUpperCase();
  const dr = to.row - from.row;
  const dc = to.col - from.col;
  const absRow = Math.abs(dr);
  const absCol = Math.abs(dc);

  if (type === "K") {
    return inPalace(from.row, from.col, side) && inPalace(to.row, to.col, side) && absRow + absCol === 1;
  }
  if (type === "A") {
    return (
      inPalace(from.row, from.col, side) &&
      inPalace(to.row, to.col, side) &&
      absRow === 1 &&
      absCol === 1
    );
  }
  if (type === "B") {
    if (absRow !== 2 || absCol !== 2) return false;
    if (!onOwnHalf(from.row, side) || !onOwnHalf(to.row, side)) return false;
    return rows[(from.row + to.row) / 2]?.[(from.col + to.col) / 2] === "";
  }
  if (type === "N") {
    if (!((absRow === 2 && absCol === 1) || (absRow === 1 && absCol === 2))) return false;
    const legRow = from.row + (absRow === 2 ? Math.sign(dr) : 0);
    const legCol = from.col + (absCol === 2 ? Math.sign(dc) : 0);
    return rows[legRow]?.[legCol] === "";
  }
  if (type === "P") {
    if (absRow + absCol !== 1) return false;
    const forward = side === "w" ? -1 : 1;
    if (dr === forward && dc === 0) return true;
    const crossed = side === "w" ? from.row <= 4 : from.row >= 5;
    return dr === 0 && crossed;
  }

  const blockers = betweenCount(rows, from, to);
  if (blockers == null) return false;
  if (type === "R") return blockers === 0;
  if (type === "C") {
    const target = rows[to.row]?.[to.col] ?? "";
    return target === "" ? blockers === 0 : blockers === 1;
  }
  return false;
}

function findPiece(rows: string[][], piece: string): SquareCoords | undefined {
  for (let row = 0; row < rows.length; row += 1) {
    const col = rows[row]?.indexOf(piece) ?? -1;
    if (col >= 0) return { row, col };
  }
  return undefined;
}

function kingsFace(rows: string[][]): boolean {
  const red = findPiece(rows, "K");
  const black = findPiece(rows, "k");
  if (!red || !black || red.col !== black.col) return false;
  const start = Math.min(red.row, black.row) + 1;
  const end = Math.max(red.row, black.row);
  for (let row = start; row < end; row += 1) {
    if (rows[row]?.[red.col]) return false;
  }
  return true;
}

function inCheck(rows: string[][], side: SideToMove): boolean {
  const king = findPiece(rows, side === "w" ? "K" : "k");
  if (!king) return false;
  if (kingsFace(rows)) return true;
  for (let row = 0; row < rows.length; row += 1) {
    const rank = rows[row] ?? [];
    for (let col = 0; col < rank.length; col += 1) {
      const piece = rank[col] ?? "";
      if (!piece || pieceSide(piece) === side) continue;
      if (reaches(rows, piece, { row, col }, king)) return true;
    }
  }
  return false;
}

function fileLabel(col: number, side: SideToMove): string {
  const index = side === "w" ? 8 - col : col;
  return numerals[index] ?? "";
}

function companions(rows: string[][], piece: string, col: number): number[] {
  const found: number[] = [];
  for (let row = 0; row < rows.length; row += 1) {
    if (rows[row]?.[col] === piece) found.push(row);
  }
  const side = pieceSide(piece);
  found.sort((left, right) => (side === "w" ? left - right : right - left));
  return found;
}

function locator(index: number, count: number): string | undefined {
  if (count <= 1) return undefined;
  if (count === 2) return index === 0 ? "前" : "后";
  if (count === 3) return ["前", "中", "后"][index];
  if (index === 0) return "前";
  if (index === count - 1) return "后";
  return numerals[index];
}

function notation(rows: string[][], piece: string, from: SquareCoords, to: SquareCoords): string {
  const side = pieceSide(piece);
  const type = piece.toUpperCase();
  const name = (side === "w" ? redNames : blackNames)[type] ?? "";
  const mates = companions(rows, piece, from.col);
  const mark = locator(mates.indexOf(from.row), mates.length);
  const forward = side === "w" ? to.row < from.row : to.row > from.row;
  const action = from.row === to.row ? "平" : forward ? "进" : "退";
  const target =
    action === "平" || fileTarget.has(type)
      ? fileLabel(to.col, side)
      : (numerals[Math.abs(to.row - from.row) - 1] ?? "");
  return mark ? `${mark}${name}${action}${target}` : `${name}${fileLabel(from.col, side)}${action}${target}`;
}

export function playMove(
  fen: string,
  from: string,
  to: string,
): { ok: true; move: PlayedMove } | { ok: false; fault: MoveFault } {
  const board = readBoard(fen);
  const source = squareCoords(from);
  const target = squareCoords(to);
  if (!board || !source || !target) return { ok: false, fault: "illegal" };
  if (source.row === target.row && source.col === target.col) return { ok: false, fault: "illegal" };
  const piece = board.rows[source.row]?.[source.col] ?? "";
  if (!piece) return { ok: false, fault: "illegal" };
  if (pieceSide(piece) !== board.side) return { ok: false, fault: "turn" };
  const occupant = board.rows[target.row]?.[target.col] ?? "";
  if ((occupant && pieceSide(occupant) === board.side) || !reaches(board.rows, piece, source, target)) {
    return { ok: false, fault: "illegal" };
  }
  const rows = board.rows.map((row) => row.slice());
  const sourceRow = rows[source.row];
  const targetRow = rows[target.row];
  if (!sourceRow || !targetRow) return { ok: false, fault: "illegal" };
  sourceRow[source.col] = "";
  targetRow[target.col] = piece;
  if (inCheck(rows, board.side)) return { ok: false, fault: "check" };
  const text = notation(board.rows, piece, source, target);
  const side = board.side;
  return {
    ok: true,
    move: {
      fen: writeBoard({ rows, side: side === "w" ? "b" : "w" }),
      notation: text,
      side,
    },
  };
}

export function sideInCheck(fen: string): boolean {
  const board = readBoard(fen);
  return board ? inCheck(board.rows, board.side) : false;
}

export function scoreRows(entries: readonly ScoreEntry[]): ScoreRow[] {
  const rows: ScoreRow[] = [];
  for (let index = 0; index < entries.length; index += 2) {
    const red = entries[index];
    const black = entries[index + 1];
    rows.push({
      round: rows.length + 1,
      red: red?.side === "w" ? red.notation : "",
      black: black?.side === "b" ? black.notation : "",
    });
  }
  return rows;
}
