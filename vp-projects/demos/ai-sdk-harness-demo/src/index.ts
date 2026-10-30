import path from 'node:path';
import { createInterface } from 'node:readline';
import type { ReadStream } from 'node:tty';
import { HarnessAgent, type HarnessAgentSession } from '@ai-sdk/harness/agent';
import type { HarnessV1Skill } from '@ai-sdk/harness';

import { loadEnvFile, parseArgs, USAGE } from './cli.ts';
import { ConsoleRenderer, paint } from './console/renderer.ts';
import { createDeepSeekHarness } from './harness/deepseek-harness.ts';
import { createFolderSandbox, type FolderSandbox } from './sandbox/folder-sandbox.ts';
import { loadSkillsFromDirectory } from './skills/load-skills.ts';
import { MOCK_TOOL_NAMES, mockTools, type MockTools } from './tools/mock-tools.ts';

type DemoAgent = HarnessAgent<ReturnType<typeof createDeepSeekHarness>, MockTools>;

const DEFAULT_INSTRUCTIONS = [
  'You are pair-programming with the user inside their own project folder.',
  'Explore before editing, keep diffs small, and verify your work with the bash tool when the project has a build or test command.',
  'Summarise what you changed at the end of the turn.',
].join(' ');

async function main(): Promise<void> {
  const demoRoot = path.dirname(import.meta.dirname);
  loadEnvFile(path.join(process.cwd(), '.env'));
  loadEnvFile(path.join(demoRoot, '.env'));

  const config = parseArgs(process.argv.slice(2));
  const renderer = new ConsoleRenderer({ showReasoning: config.showReasoning });
  const skillsDir = config.skillsDir ?? path.join(demoRoot, 'skills');
  const skills = await loadSkillsFromDirectory(skillsDir);

  const sandbox = await createFolderSandbox({ folder: config.folder });

  const agent: DemoAgent = new HarnessAgent({
    harness: createDeepSeekHarness({
      apiKeyEnvVar: config.apiKeyEnvVar,
      defaultModel: config.model,
      maxSteps: config.maxSteps,
      hostFolder: sandbox.hostFolder,
      sandboxNotes: sandbox.runtimeNotes,
      onNotice: notice => {
        if (notice.type === 'skills-materialized') {
          renderer.queueNotice(
            `沙箱内 skills 目录 ${notice.skillsDir}：${describeSkillSync(notice)}`,
          );
          return;
        }
        renderer.queueNotice(notice.message);
      },
    }),
    id: 'deepseek-folder-coder',
    model: config.model,
    instructions: [DEFAULT_INSTRUCTIONS, config.instructions ?? ''].filter(Boolean).join('\n'),
    skills,
    tools: mockTools,
    // '.' pins every session to the sandbox default working directory, which
    // is the mounted host folder itself.
    sandboxConfig: { workDir: '.' },
  });

  let session = await agent.createSession({ sandboxSession: sandbox.session });

  printBanner({ config, sandbox, skillsDir, skills, session });

  const abortController = new AbortController();
  process.on('SIGINT', () => {
    if (!abortController.signal.aborted) {
      renderer.notice('收到中断请求 —— 正在停止当前轮次');
      abortController.abort(new Error('用户中断'));
      return;
    }
    process.exit(130);
  });

  try {
    if (config.prompt != null) {
      await runTurn({ agent, session, prompt: config.prompt, renderer, abortController });
      return;
    }

    const lines = readStdinLines({
      input: process.stdin,
      prompt: `\n${paint('blue', paint('bold', '你'))} > `,
    });
    for (;;) {
      const line = await lines.next();
      if (line == null) break;
      const input = line.trim();
      if (input.length === 0) continue;

      if (input === '/exit' || input === '/quit') break;
      if (input === '/help') {
        process.stdout.write(`${USAGE}\n`);
        continue;
      }
      if (input === '/tools') {
        renderer.info(`宿主工具（模拟）：${MOCK_TOOL_NAMES.join(', ')}`);
        renderer.info('沙箱工具：bash、read、write、edit、grep、glob、ls');
        renderer.info('沙箱运行时：QuickJS（`node` / `js-exec`）—— 不在宿主执行，无网络');
        continue;
      }
      if (input === '/skills') {
        if (skills.length === 0) renderer.info(`在 ${skillsDir} 中没有找到任何 skill`);
        for (const skill of skills) renderer.info(`skill ${skill.name} —— ${skill.description}`);
        continue;
      }
      if (input === '/reset') {
        await destroyQuietly(session);
        session = await agent.createSession({ sandboxSession: sandbox.session });
        renderer.info(`对话已重置 —— 磁盘上的文件保持不变（session ${session.sessionId}）`);
        continue;
      }
      if (input.startsWith('/')) {
        renderer.info(`未知命令 ${input} —— 输入 /help 查看命令列表`);
        continue;
      }

      await runTurn({ agent, session, prompt: input, renderer, abortController });
    }
    lines.close();
  } finally {
    await destroyQuietly(session);
    try {
      await sandbox.session.destroy();
    } catch {
      // Nothing else to clean up.
    }
  }
}

type StdinLines = {
  /** Next input line, or `null` once stdin is exhausted. */
  next(): Promise<string | null>;
  close(): void;
};

/**
 * `readline/promises.question()` never settles once piped stdin reaches EOF, so
 * the REPL queues `line` events instead. That keeps interactive use and
 * `... | node src/index.ts` behaving the same.
 */
function readStdinLines(options: {
  readonly input: ReadStream;
  readonly prompt: string;
}): StdinLines {
  const interactive = options.input.isTTY === true;
  const readline = createInterface({
    input: options.input,
    output: process.stdout,
    terminal: interactive,
  });

  const buffered: string[] = [];
  const waiting: Array<(line: string | null) => void> = [];
  let closed = false;

  readline.on('line', line => {
    const resolve = waiting.shift();
    if (resolve != null) resolve(line);
    else buffered.push(line);
  });
  readline.on('close', () => {
    closed = true;
    for (const resolve of waiting.splice(0)) resolve(null);
  });

  // readline only echoes keystrokes on a TTY; echo piped lines ourselves.
  const echo = (line: string): void => {
    if (!interactive) process.stdout.write(`${line}\n`);
  };

  return {
    next(): Promise<string | null> {
      process.stdout.write(options.prompt);
      const queued = buffered.shift();
      if (queued !== undefined) {
        echo(queued);
        return Promise.resolve(queued);
      }
      if (closed) return Promise.resolve(null);
      return new Promise(resolve =>
        waiting.push(line => {
          if (line != null) echo(line);
          resolve(line);
        }),
      );
    },
    close(): void {
      readline.close();
    },
  };
}

type RunTurnOptions = {
  readonly agent: DemoAgent;
  readonly session: HarnessAgentSession;
  readonly prompt: string;
  readonly renderer: ConsoleRenderer;
  readonly abortController: AbortController;
};

async function runTurn(options: RunTurnOptions): Promise<void> {
  const { agent, session, prompt, renderer, abortController } = options;
  const result = await agent.stream({ session, prompt, abortSignal: abortController.signal });

  try {
    for await (const part of result.stream) {
      renderer.handlePart(part);
    }
  } catch (error) {
    if (abortController.signal.aborted) {
      renderer.notice('本轮已中止');
    } else {
      renderer.error(error instanceof Error ? error.message : String(error));
    }
  } finally {
    renderer.endTurn();
  }
}

async function destroyQuietly(session: HarnessAgentSession): Promise<void> {
  try {
    await session.destroy();
  } catch {
    // The sandbox is torn down by the caller either way.
  }
}

function printBanner(info: {
  readonly config: ReturnType<typeof parseArgs>;
  readonly sandbox: FolderSandbox;
  readonly skillsDir: string;
  readonly skills: ReadonlyArray<HarnessV1Skill>;
  readonly session: HarnessAgentSession;
}): void {
  const { config, sandbox, skillsDir, skills, session } = info;
  const lines = [
    paint('bold', 'ai-sdk-harness-demo'),
    `  ${padLabel('harness')}deepseek（宿主驱动的 HarnessV1 adapter）`,
    `  ${padLabel('模型')}${config.model}`,
    `  ${padLabel('密钥变量')}${config.apiKeyEnvVar}`,
    `  ${padLabel('宿主文件夹')}${sandbox.hostFolder}`,
    `  ${padLabel('沙箱挂载')}${sandbox.mountPoint} -> ${sandbox.hostFolder}`,
    `  ${padLabel('沙箱 HOME')}${sandbox.homeDir}（内存）`,
    `  ${padLabel('工作目录')}${sandbox.mountPoint}`,
    `  ${padLabel('JS 运行时')}QuickJS（沙箱内执行，\`node\` / \`js-exec\`）`,
    `  ${padLabel('会话')}${session.sessionId}`,
    `  ${padLabel('Skills')}${
      skills.length === 0
        ? `无（已查找 ${skillsDir}）`
        : skills.map(skill => skill.name).join(', ')
    }`,
    `  ${padLabel('宿主工具')}${MOCK_TOOL_NAMES.join(', ')}（模拟）`,
    '',
    '  输入需求开始对话，/help 查看命令，/exit 退出。',
  ];
  process.stdout.write(`${lines.join('\n')}\n`);
}

const WIDE_GLYPHS =
  /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]/;

/** CJK glyphs occupy two terminal cells, so pad by display width, not length. */
function padLabel(label: string, width = 13): string {
  let display = 0;
  for (const char of label) display += WIDE_GLYPHS.test(char) ? 2 : 1;
  return `${label}${' '.repeat(Math.max(1, width - display))}`;
}

function describeSkillSync(notice: {
  readonly written: string[];
  readonly removed: string[];
  readonly unchanged: string[];
}): string {
  const parts: string[] = [];
  if (notice.written.length > 0) parts.push(`已写入 ${notice.written.join(', ')}`);
  if (notice.removed.length > 0) parts.push(`已移除 ${notice.removed.join(', ')}`);
  if (notice.unchanged.length > 0) parts.push(`未变化 ${notice.unchanged.join(', ')}`);
  return parts.length === 0 ? '无' : parts.join('；');
}

main().catch(error => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`\n${paint('red', message)}\n`);
  process.exitCode = 1;
});