import { expect, test } from "vite-plus/test";

import { openingFen } from "../src/lib/xiangqi/position.ts";
import { playMove, scoreRows, sideInCheck } from "../src/lib/xiangqi/play.ts";

function play(fen: string, from: string, to: string) {
  const result = playMove(fen, from, to);
  if (!result.ok) throw new Error(`${from}${to} ${result.fault}`);
  return result.move;
}

test("opening moves alternate and record one round per two plies", () => {
  const cannon = play(openingFen, "h3", "e3");
  const horse = play(cannon.fen, "b10", "c8");
  const redHorse = play(horse.fen, "h1", "g3");
  const blackCannon = play(cannon.fen, "b8", "e8");

  expect([cannon, horse, redHorse, blackCannon].map((move) => move.notation)).toEqual([
    "炮二平五",
    "马二进三",
    "马二进三",
    "炮二平五",
  ]);
  expect(cannon.fen.endsWith(" b")).toBe(true);
  expect(horse.fen.endsWith(" w")).toBe(true);
  expect(
    scoreRows([
      { side: cannon.side, notation: cannon.notation },
      { side: horse.side, notation: horse.notation },
      { side: redHorse.side, notation: redHorse.notation },
      { side: blackCannon.side, notation: blackCannon.notation },
    ]),
  ).toEqual([
    { round: 1, red: "炮二平五", black: "马二进三" },
    { round: 2, red: "马二进三", black: "炮二平五" },
  ]);
});

test("the same side cannot move twice", () => {
  const cannon = play(openingFen, "h3", "e3");
  expect(playMove(cannon.fen, "h1", "g3")).toEqual({ ok: false, fault: "turn" });
  expect(playMove(openingFen, "b10", "c8")).toEqual({ ok: false, fault: "turn" });
});

test("piece rules reject blocked and irregular moves", () => {
  expect(playMove(openingFen, "a4", "b4")).toEqual({ ok: false, fault: "illegal" });
  expect(play(openingFen, "a4", "a5").notation).toBe("兵九进一");
  expect(play(openingFen, "g1", "e3").notation).toBe("相三进五");
  expect(playMove("4k4/9/9/9/9/9/9/9/5P3/4K1B2 w", "g1", "e3")).toEqual({
    ok: false,
    fault: "illegal",
  });
  expect(playMove("4k4/9/9/9/9/9/9/9/7P1/4K2N1 w", "h1", "g3")).toEqual({
    ok: false,
    fault: "illegal",
  });
  expect(play("3k5/9/9/9/9/9/9/9/9/4K2N1 w", "h1", "g3").notation).toBe("马二进三");
  expect(playMove("4k4/9/9/4p4/9/9/9/9/9/4C4 w", "e1", "e7")).toEqual({
    ok: false,
    fault: "illegal",
  });
  expect(play("4k4/9/9/4p4/9/9/4P4/9/9/4C4 w", "e1", "e7").notation).toBe("炮五进六");
  expect(playMove("3k5/9/9/9/9/9/9/9/9/4K4 w", "e1", "d2")).toEqual({
    ok: false,
    fault: "illegal",
  });
  expect(play("3k5/9/9/9/9/9/9/9/9/4K4 w", "e1", "f1").notation).toBe("帅五平四");
});

test("moving into check or exposing the king is rejected", () => {
  expect(playMove("3r5/9/9/9/9/9/9/9/9/4K4 w", "e1", "d1")).toEqual({
    ok: false,
    fault: "check",
  });
  expect(playMove("4k4/4r4/9/9/9/9/9/9/4R4/4K4 w", "e2", "d2")).toEqual({
    ok: false,
    fault: "check",
  });
  expect(sideInCheck("3r5/9/9/9/9/9/9/9/9/3K5 w")).toBe(true);
  expect(sideInCheck(openingFen)).toBe(false);
});

test("pieces on the same file use front and rear", () => {
  const front = play("4k4/9/9/9/4P4/9/4P4/9/9/4K4 w", "e6", "e7");
  expect(front.notation).toBe("前兵进一");
  expect(play("4k4/9/9/9/4P4/9/4P4/9/9/4K4 w", "e6", "d6").notation).toBe("前兵平六");
  expect(play("4k4/9/9/9/4P4/9/4P4/9/9/4K4 w", "e4", "e5").notation).toBe("后兵进一");
  expect(playMove("4k4/9/9/9/4P4/9/4P4/9/9/4K4 w", "e4", "d4")).toEqual({
    ok: false,
    fault: "illegal",
  });
  expect(play("4k4/9/9/9/9/9/4R4/9/4R4/4K4 w", "e4", "e5").notation).toBe("前车进一");
});

test("black numbers files from its own right", () => {
  expect(play("3k5/9/9/p8/9/9/9/9/9/4K4 b", "a7", "a6").notation).toBe("卒一进一");
  expect(playMove("3k5/9/9/p8/9/9/9/9/9/4K4 b", "a7", "b7")).toEqual({
    ok: false,
    fault: "illegal",
  });
});
