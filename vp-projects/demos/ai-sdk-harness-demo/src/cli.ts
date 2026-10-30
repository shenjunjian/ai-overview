import { existsSync, readFileSync } from 'node:fs';

export type DemoConfig = {
  folder: string;
  model: string;
  prompt?: string;
  maxSteps: number;
  showReasoning: boolean;
  skillsDir?: string;
  instructions?: string;
  apiKeyEnvVar: string;
};

const DEFAULTS = {
  folder: './workspace',
  model: 'deepseek-v4-flash',
  maxSteps: 24,
  apiKeyEnvVar: 'MY_DS',
} as const;

export const USAGE = `
ai-sdk-harness-demo —— 基于 HarnessAgent 的控制台编码 agent

用法
  pnpm start -- [选项]
  pnpm start -- --folder D:/code/my-app --prompt "加一个 health 接口"

选项
  -f, --folder <path>      允许 agent 开发的文件夹（默认：${DEFAULTS.folder}）
  -m, --model <id>         DeepSeek 模型 id（默认：${DEFAULTS.model}）
  -p, --prompt <text>      只跑一轮然后退出，不进入 REPL
      --instructions <t>   追加到系统提示词末尾的额外指令
      --skills-dir <path>  存放 <name>/SKILL.md 指令包的目录
      --max-steps <n>      每轮对话允许的模型步数（默认：${DEFAULTS.maxSteps}）
      --reasoning          同时打印模型的推理增量
      --api-key-env <name> 存放 DeepSeek key 的环境变量（默认：${DEFAULTS.apiKeyEnvVar}）
  -h, --help               显示本帮助

REPL 命令
  /help    显示命令列表             /tools   列出宿主工具
  /skills  列出已加载的 skills      /reset   开启全新对话
  /exit    退出 REPL
`.trim();

/** Reads `KEY=VALUE` lines without overriding variables already set. */
export function loadEnvFile(filePath: string): void {
  if (!existsSync(filePath)) return;
  for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    if (key.length === 0) continue;
    let value = trimmed.slice(separator + 1).trim();
    const quoted =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"));
    if (quoted) value = value.slice(1, -1);
    if (process.env[key] == null) process.env[key] = value;
  }
}

export function parseArgs(argv: ReadonlyArray<string>): DemoConfig {
  const config: DemoConfig = {
    folder: DEFAULTS.folder,
    model: DEFAULTS.model,
    maxSteps: DEFAULTS.maxSteps,
    showReasoning: false,
    apiKeyEnvVar: DEFAULTS.apiKeyEnvVar,
  };

  const takeValue = (flag: string, index: number): string => {
    const value = argv[index + 1];
    if (value == null || value.startsWith('-')) {
      throw new Error(`选项 ${flag} 需要一个值。`);
    }
    return value;
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] as string;
    switch (arg) {
      // `pnpm start -- --folder x` forwards the separator; it carries no meaning here.
      case '--':
        break;
      case '-h':
      case '--help':
        process.stdout.write(`${USAGE}\n`);
        process.exit(0);
        break;
      case '-f':
      case '--folder':
        config.folder = takeValue(arg, index);
        index += 1;
        break;
      case '-m':
      case '--model':
        config.model = takeValue(arg, index);
        index += 1;
        break;
      case '-p':
      case '--prompt':
        config.prompt = takeValue(arg, index);
        index += 1;
        break;
      case '--instructions':
        config.instructions = takeValue(arg, index);
        index += 1;
        break;
      case '--skills-dir':
        config.skillsDir = takeValue(arg, index);
        index += 1;
        break;
      case '--max-steps':
        config.maxSteps = Number.parseInt(takeValue(arg, index), 10);
        index += 1;
        break;
      case '--api-key-env':
        config.apiKeyEnvVar = takeValue(arg, index);
        index += 1;
        break;
      case '--reasoning':
        config.showReasoning = true;
        break;
      default:
        throw new Error(`未知选项：${arg}\n\n${USAGE}`);
    }
  }

  if (!Number.isFinite(config.maxSteps) || config.maxSteps < 1) {
    throw new Error('--max-steps 必须是正整数。');
  }
  return config;
}