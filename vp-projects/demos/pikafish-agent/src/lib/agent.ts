import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { HarnessAgent, HarnessError } from "@ai-sdk/harness/agent";
import { createOpenCode } from "@ai-sdk/harness-opencode";

import { findPackageRoot } from "./pikafish/binary-path";
import { analyzePosition } from "./tools/analyze-position";

const deepSeekBaseUrl = "https://api.deepseek.com";
const modelId = "deepseek-v4-flash";

const instructions = [
  "你是中国象棋分析助手。FEN 是局面的唯一事实来源。",
  "用户问着法、好坏或评估时，先调用 analyzePosition，再按 xiangqi-analysis 里的读法用中文解释。",
  "没有这次工具返回的 bestMove、score 和 pv 时，不要给出着法或评分。",
  "cp 是行棋方的普通评分，mate 是胜负步数；正数有利于行棋方。",
  "fen 用当前局面。局面带有从这张 FEN 起算的历史着法时，把它们放进 moves。",
].join("\n");

export function requireDeepSeekApiKey(env: NodeJS.ProcessEnv = process.env): string {
  const apiKey = env.MY_DS?.trim();
  if (!apiKey) {
    throw new HarnessError({
      message: "未配置 MY_DS。把 DeepSeek API key 写到 .env.local 后再分析。",
    });
  }
  return apiKey;
}

function readSkill(packageRoot: string): { name: string; description: string; content: string } {
  const relativePath = path.join("skills", "xiangqi-analysis.md");
  let raw: string;
  try {
    raw = readFileSync(path.join(packageRoot, relativePath), "utf8");
  } catch {
    throw new HarnessError({ message: "找不到 skills/xiangqi-analysis.md。" });
  }
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(raw);
  const frontmatter = match?.[1];
  const content = match?.[2]?.trim();
  const name = frontmatter ? /^name:\s*(\S+)\s*$/m.exec(frontmatter)?.[1] : undefined;
  const description = frontmatter ? /^description:\s*(.+)\s*$/m.exec(frontmatter)?.[1] : undefined;
  if (!name || !description || !content) {
    throw new HarnessError({
      message: "skills/xiangqi-analysis.md 需要 name、description 和正文。",
    });
  }
  return { name, description, content };
}

function createXiangqiAgent(apiKey: string) {
  const packageRoot = findPackageRoot(path.dirname(fileURLToPath(import.meta.url)));
  return new HarnessAgent({
    id: "xiangqi-analysis",
    harness: createOpenCode({
      auth: {
        OPENAI_API_KEY: apiKey,
        OPENAI_BASE_URL: deepSeekBaseUrl,
      },
      provider: "openai",
    }),
    model: modelId,
    instructions,
    skills: [readSkill(packageRoot)],
    tools: { analyzePosition },
    inactiveTools: ["bash", "write"],
  });
}

export type XiangqiAgent = ReturnType<typeof createXiangqiAgent>;

let xiangqiAgent: XiangqiAgent | undefined;

export function getXiangqiAgent(): XiangqiAgent {
  const apiKey = requireDeepSeekApiKey();
  xiangqiAgent ??= createXiangqiAgent(apiKey);
  return xiangqiAgent;
}
