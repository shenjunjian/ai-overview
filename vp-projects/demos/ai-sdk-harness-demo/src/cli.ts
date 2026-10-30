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
ai-sdk-harness-demo — a console coding agent built on HarnessAgent

Usage
  pnpm start -- [options]
  pnpm start -- --folder D:/code/my-app --prompt "add a health endpoint"

Options
  -f, --folder <path>      Folder the agent may develop in (default: ${DEFAULTS.folder})
  -m, --model <id>         DeepSeek model id (default: ${DEFAULTS.model})
  -p, --prompt <text>      Run a single turn and exit instead of starting a REPL
      --instructions <t>   Extra instructions appended to the system prompt
      --skills-dir <path>  Directory of <name>/SKILL.md bundles to load
      --max-steps <n>      Model steps per turn (default: ${DEFAULTS.maxSteps})
      --reasoning          Print model reasoning deltas
      --api-key-env <name> Env var holding the DeepSeek key (default: ${DEFAULTS.apiKeyEnvVar})
  -h, --help               Show this help

REPL commands
  /help    show the command list      /tools   list host tools
  /skills  list loaded skills         /reset   start a fresh conversation
  /exit    leave the REPL
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
      throw new Error(`Option ${flag} expects a value.`);
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
        throw new Error(`Unknown option: ${arg}\n\n${USAGE}`);
    }
  }

  if (!Number.isFinite(config.maxSteps) || config.maxSteps < 1) {
    throw new Error('--max-steps must be a positive integer.');
  }
  return config;
}