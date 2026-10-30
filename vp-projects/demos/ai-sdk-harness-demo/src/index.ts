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
            `skills in sandbox ${notice.skillsDir}: ${describeSkillSync(notice)}`,
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
      renderer.notice('interrupt request received - stopping the current turn');
      abortController.abort(new Error('Interrupted by user'));
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
      prompt: `\n${paint('blue', paint('bold', 'you'))} > `,
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
        renderer.info(`host tools (simulated): ${MOCK_TOOL_NAMES.join(', ')}`);
        renderer.info('sandbox tools: bash, read, write, edit, grep, glob, ls');
        renderer.info('sandbox runtime: QuickJS via `node` / `js-exec` - no host execution, no network');
        continue;
      }
      if (input === '/skills') {
        if (skills.length === 0) renderer.info(`no skills found in ${skillsDir}`);
        for (const skill of skills) renderer.info(`skill ${skill.name} - ${skill.description}`);
        continue;
      }
      if (input === '/reset') {
        await destroyQuietly(session);
        session = await agent.createSession({ sandboxSession: sandbox.session });
        renderer.info(`conversation reset - files on disk untouched (session ${session.sessionId})`);
        continue;
      }
      if (input.startsWith('/')) {
        renderer.info(`unknown command ${input} - try /help`);
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
      renderer.notice('turn aborted');
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
    '  harness        deepseek (host-driven HarnessV1 adapter)',
    `  model          ${config.model}`,
    `  api key env    ${config.apiKeyEnvVar}`,
    `  host folder    ${sandbox.hostFolder}`,
    `  sandbox mount  ${sandbox.mountPoint} -> ${sandbox.hostFolder}`,
    `  sandbox home   ${sandbox.homeDir} (in memory)`,
    `  work dir       ${sandbox.mountPoint}`,
    '  js runtime     QuickJS (sandboxed, `node` / `js-exec`)',
    `  session        ${session.sessionId}`,
    `  skills         ${
      skills.length === 0
        ? `none (looked in ${skillsDir})`
        : skills.map(skill => skill.name).join(', ')
    }`,
    `  host tools     ${MOCK_TOOL_NAMES.join(', ')} (simulated)`,
    '',
    '  Type a request, /help for commands, /exit to quit.',
  ];
  process.stdout.write(`${lines.join('\n')}\n`);
}

function describeSkillSync(notice: {
  readonly written: string[];
  readonly removed: string[];
  readonly unchanged: string[];
}): string {
  const parts: string[] = [];
  if (notice.written.length > 0) parts.push(`written ${notice.written.join(', ')}`);
  if (notice.removed.length > 0) parts.push(`removed ${notice.removed.join(', ')}`);
  if (notice.unchanged.length > 0) parts.push(`unchanged ${notice.unchanged.join(', ')}`);
  return parts.length === 0 ? 'none' : parts.join('; ');
}

main().catch(error => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`\n${paint('red', message)}\n`);
  process.exitCode = 1;
});