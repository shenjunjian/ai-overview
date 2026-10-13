import { expect, test } from "vite-plus/test";

import { finishSearch, goCommand, parseUciLine, positionCommand } from "../src/lib/pikafish/uci.ts";

const opening = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w";

test("parses cp, mate, wdl, and a bounded score without dropping pv", () => {
  expect(
    parseUciLine(
      "info depth 8 seldepth 12 multipv 1 score cp 34 wdl 512 401 87 nodes 12345 nps 200000 hashfull 12 tbhits 0 time 61 pv h2e2 h9g7 b0c2",
    ),
  ).toMatchObject({
    kind: "info",
    depth: 8,
    multipv: 1,
    score: { type: "cp", value: 34 },
    wdl: { win: 512, draw: 401, loss: 87 },
    pv: ["h2e2", "h9g7", "b0c2"],
  });

  expect(
    parseUciLine("info depth 6 seldepth 8 multipv 1 score mate -3 time 5 pv a0a1 b9c7"),
  ).toMatchObject({
    score: { type: "mate", value: -3 },
    pv: ["a0a1", "b9c7"],
    depth: 6,
  });

  expect(parseUciLine("info depth 4 score cp 15 lowerbound pv h2e2 h9g7")).toMatchObject({
    score: { type: "cp", value: 15 },
    pv: ["h2e2", "h9g7"],
  });
  expect(parseUciLine("info depth 7 score cp 40 upperbound nodes 10 nps 10 time 4")).toMatchObject({
    score: { type: "cp", value: 40 },
    pv: [],
    depth: 7,
  });
});

test("ignores currmove and info string, and keeps the latest multipv 1 line", () => {
  expect(parseUciLine("info depth 7 currmove h2e2 currmovenumber 3")).toEqual({ kind: "ignore" });
  expect(parseUciLine("info string NNUE loaded")).toEqual({ kind: "ignore" });
  expect(parseUciLine("uciok")).toEqual({ kind: "ignore" });
  expect(parseUciLine("readyok")).toEqual({ kind: "ignore" });

  const analysis = finishSearch([
    "info depth 1 score cp 10 pv a0a1",
    "info string NNUE loaded",
    "info depth 5 multipv 1 score cp 10 pv h2e2",
    "info depth 5 multipv 2 score cp 8 pv b0c2",
    "info depth 2 score cp 20 lowerbound pv b0c2",
    "info depth 2 score cp 18 pv h2e2 h9g7",
    "bestmove h2e2 ponder h9g7",
  ]);

  expect(analysis).toEqual({
    bestMove: "h2e2",
    score: { type: "cp", value: 18 },
    pv: ["h2e2", "h9g7"],
    depth: 2,
  });
  expect(parseUciLine("bestmove (none)")).toEqual({ kind: "bestmove", bestMove: "(none)" });
});

test("passes CRITICAL ERROR through and requires both score and bestmove", () => {
  const message =
    "info string CRITICAL ERROR: Command 'position fen bad' failed. Reason: Invalid FEN";
  expect(parseUciLine(message)).toEqual({
    kind: "critical",
    message: "CRITICAL ERROR: Command 'position fen bad' failed. Reason: Invalid FEN",
  });
  expect(() => finishSearch([message])).toThrow(/无法分析这个局面：CRITICAL ERROR: Command/);
  expect(() => finishSearch(["bestmove h2e2"])).toThrow(/没有返回评分/);
  expect(() => finishSearch(["info depth 1 score cp 3 pv h2e2"])).toThrow(/没有返回 bestmove/);
});

test("formats position history and prefers depth over movetime", () => {
  expect(positionCommand(opening)).toBe(`position fen ${opening}`);
  expect(positionCommand(opening, ["h2e2", "b9c7"])).toBe(
    `position fen ${opening} moves h2e2 b9c7`,
  );
  expect(positionCommand(opening, [])).toBe(`position fen ${opening}`);
  expect(goCommand({ movetimeMs: 200 })).toBe("go movetime 200");
  expect(goCommand({ movetimeMs: 200, depth: 6 })).toBe("go depth 6");
});
