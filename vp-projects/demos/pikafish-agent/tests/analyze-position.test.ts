import { expect, test } from "vite-plus/test";

import { createAnalyzePositionTool } from "../src/lib/tools/analyze-position.ts";
import type { Analysis, AnalyzeInput } from "../src/lib/pikafish/engine.ts";

const opening = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w";

const searched: Analysis = {
  bestMove: "h2e2",
  score: { type: "cp", value: 18 },
  pv: ["h2e2", "h9g7"],
  depth: 12,
};

test("analyzePosition returns the engine result for that fen", async () => {
  const calls: AnalyzeInput[] = [];
  const analyzePosition = createAnalyzePositionTool({
    async analyze(input) {
      calls.push(input);
      return searched;
    },
  });

  const result = await analyzePosition.execute?.(
    { fen: opening, moves: ["h2e2", "b7e7"] },
    { toolCallId: "analyze-1", messages: [] },
  );

  expect(calls).toEqual([{ fen: opening, moves: ["h2e2", "b7e7"] }]);
  expect(result).toEqual({
    fen: opening,
    moves: ["h2e2", "b7e7"],
    ...searched,
  });
});

test("analyzePosition surfaces a missing engine as the tool error", async () => {
  const analyzePosition = createAnalyzePositionTool({
    async analyze() {
      throw new Error("找不到皮卡鱼二进制：pikafish-engine/Pikafish-Windows-x86-64-universal.exe。");
    },
  });

  await expect(
    analyzePosition.execute?.({ fen: opening }, { toolCallId: "analyze-2", messages: [] }),
  ).rejects.toThrow(/找不到皮卡鱼二进制/);
});
