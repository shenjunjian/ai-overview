import path from "node:path";
import { fileURLToPath } from "node:url";

import { tool } from "ai";
import { z } from "zod/v4";

import {
  engineAvailabilityError,
  PikafishEngine,
  type AnalyzeInput,
  type Analysis,
} from "../pikafish/engine";
import { findPackageRoot, resolveEnginePaths } from "../pikafish/binary-path";

type PositionEngine = {
  analyze(input: AnalyzeInput): Promise<Analysis>;
};

const analyzePositionDescription =
  "用皮卡鱼分析当前中国象棋局面。解释着法或评分之前调用。fen 是局面；moves 是从这张 FEN 开始的 UCI 历史着法，例如 h2e2；movetimeMs 是思考毫秒数。返回 bestMove、score（cp 或 mate）、pv 和 depth。";

export function createAnalyzePositionTool(engine: PositionEngine) {
  return tool({
    description: analyzePositionDescription,
    inputSchema: z.object({
      fen: z.string().describe("当前局面 FEN"),
      moves: z.array(z.string()).optional().describe("从这张 FEN 开始的 UCI 历史着法"),
      movetimeMs: z.number().int().positive().optional().describe("思考时间，毫秒"),
    }),
    execute: async ({ fen, moves, movetimeMs }) => {
      const analysis = await engine.analyze({
        fen,
        ...(moves && moves.length > 0 ? { moves } : {}),
        ...(movetimeMs != null ? { movetimeMs } : {}),
      });
      return {
        fen,
        ...(moves && moves.length > 0 ? { moves } : {}),
        ...analysis,
      };
    },
  });
}

let sharedEngine: PikafishEngine | undefined;

function engineForHostTool(): PikafishEngine {
  if (sharedEngine) return sharedEngine;
  const packageRoot = findPackageRoot(path.dirname(fileURLToPath(import.meta.url)));
  const paths = resolveEnginePaths(packageRoot);
  const problem = engineAvailabilityError(paths);
  if (problem) throw new Error(problem);
  const engine = new PikafishEngine();
  sharedEngine = engine;
  process.once("beforeExit", () => {
    void engine.close();
  });
  return engine;
}

export const analyzePosition = createAnalyzePositionTool({
  analyze: (input) => engineForHostTool().analyze(input),
});
