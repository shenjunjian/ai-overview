import { expect, test } from "vite-plus/test";

import {
  boardFen,
  formatScore,
  openingFen,
  pvToArrows,
  questionWithPosition,
  readAnalysis,
} from "../src/lib/xiangqi/position.ts";

const searched = {
  fen: openingFen,
  bestMove: "h2e2",
  score: { type: "cp" as const, value: 18 },
  pv: ["h2e2", "h9g7"],
  depth: 12,
};

test("board fen keeps placement and side, and drops clock fields", () => {
  expect(boardFen(`${openingFen} - - 0 1`)).toBe(openingFen);
  expect(boardFen("rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR b")).toBe(
    "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR b",
  );
  expect(boardFen("8/8/8/8/8/8/8/8 w")).toBeUndefined();
  expect(boardFen("not a fen")).toBeUndefined();
});

test("pv arrows use board ranks and mark the first move", () => {
  expect(pvToArrows(["h2e2", "h9g7", "b0c2", "nope", "h2h2"])).toEqual([
    ["h3", "e3", "rgb(185, 28, 28)"],
    ["h10", "g8", "rgb(37, 99, 235)"],
    ["b1", "c3", "rgb(37, 99, 235)"],
  ]);
});

test("analysis display reads one engine result", () => {
  expect(
    readAnalysis({
      ...searched,
      moves: ["h2e2"],
      wdl: { win: 512, draw: 401, loss: 87 },
    }),
  ).toEqual({
    ...searched,
    moves: ["h2e2"],
    wdl: { win: 512, draw: 401, loss: 87 },
  });
  expect(readAnalysis({ ...searched, pv: ["h2e2", 1] })).toBeUndefined();
  expect(formatScore({ type: "cp", value: 18 })).toBe("cp +18");
  expect(formatScore({ type: "cp", value: -4 })).toBe("cp -4");
  expect(formatScore({ type: "mate", value: 3 })).toBe("mate 胜 3");
  expect(formatScore({ type: "mate", value: -2 })).toBe("mate 负 2");
  expect(questionWithPosition(openingFen, "评估这个局面")).toBe(
    `局面 FEN：${openingFen}\n评估这个局面`,
  );
});
