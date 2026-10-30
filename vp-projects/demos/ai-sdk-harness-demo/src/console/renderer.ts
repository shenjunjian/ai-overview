import type { TextStreamPart, ToolSet } from 'ai';

const colorEnabled = process.stdout.isTTY === true && process.env['NO_COLOR'] == null;

const codes = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
} as const;

type ColorName = keyof typeof codes;

function paint(color: ColorName, text: string): string {
  return colorEnabled ? `${codes[color]}${text}${codes.reset}` : text;
}

function truncate(text: string, max: number): string {
  const normalized = text.replace(/\s+$/, '');
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max)} … (+${normalized.length - max} chars)`;
}

function stringify(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.stack ?? `${value.name}: ${value.message}`;
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

export type ConsoleRendererOptions = {
  readonly showReasoning?: boolean;
  readonly maxToolOutputChars?: number;
  readonly maxToolInputChars?: number;
};

/**
 * Plain-stdout renderer for one `HarnessAgent` turn. No TUI dependency: the
 * assistant text streams straight to the process output and every tool call,
 * tool result and file change gets one labelled line.
 */
export class ConsoleRenderer {
  private readonly showReasoning: boolean;
  private readonly maxToolOutputChars: number;
  private readonly maxToolInputChars: number;
  private readonly deferredNotices: string[] = [];
  private inText = false;
  private inReasoning = false;

  constructor(options: ConsoleRendererOptions = {}) {
    this.showReasoning = options.showReasoning ?? false;
    this.maxToolOutputChars = options.maxToolOutputChars ?? 900;
    this.maxToolInputChars = options.maxToolInputChars ?? 400;
  }

  notice(message: string): void {
    this.closeStreams();
    process.stdout.write(`${paint('dim', `[harness] ${message}`)}\n`);
  }

  /**
   * Harness notices arrive on a direct callback, so they overtake the stream
   * parts the renderer is still draining. Queueing them keeps the transcript in
   * turn order; they are released just before the turn's `finish` line.
   */
  queueNotice(message: string): void {
    this.deferredNotices.push(message);
  }

  flushNotices(): void {
    for (const message of this.deferredNotices.splice(0)) this.notice(message);
  }

  error(message: string): void {
    this.closeStreams();
    process.stdout.write(`\n${paint('red', `\u2716 ${message}`)}\n`);
  }

  info(message: string): void {
    this.closeStreams();
    process.stdout.write(`${paint('cyan', '•')} ${message}\n`);
  }

  handlePart<TOOLS extends ToolSet>(part: TextStreamPart<TOOLS>): void {
    switch (part.type) {
      case 'text-delta':
        if (!this.inText) {
          this.closeReasoning();
          process.stdout.write(`\n${paint('green', paint('bold', 'assistant'))} `);
          this.inText = true;
        }
        process.stdout.write(part.text);
        return;

      case 'reasoning-delta':
        if (!this.showReasoning) return;
        if (!this.inReasoning) {
          this.closeText();
          process.stdout.write(`\n${paint('magenta', 'thinking')} `);
          this.inReasoning = true;
        }
        process.stdout.write(paint('dim', part.text));
        return;

      case 'tool-call': {
        this.closeStreams();
        if (part.toolName === 'fileChange') {
          const payload = part.input as { event?: string; path?: string };
          process.stdout.write(
            `\n${paint('yellow', '✎')} ${paint('yellow', payload.event ?? 'change')} ${paint('bold', payload.path ?? '')}\n`,
          );
          return;
        }
        if (part.toolName === 'compaction') return;
        const args = truncate(stringify(part.input), this.maxToolInputChars);
        const label = part.providerExecuted === true ? 'sandbox' : 'host';
        process.stdout.write(
          `\n${paint('cyan', '⚙')} ${paint('bold', part.toolName)} ${paint('dim', `(${label})`)}\n${paint('dim', args.split('\n').map(line => `    ${line}`).join('\n'))}\n`,
        );
        return;
      }

      case 'tool-result': {
        if (part.toolName === 'fileChange' || part.toolName === 'compaction') return;
        const output = truncate(stringify(part.output), this.maxToolOutputChars);
        process.stdout.write(
          `${paint('dim', '  ↳ ')}${paint('dim', output.split('\n').join('\n  '))}\n`,
        );
        return;
      }

      case 'tool-error':
        this.closeStreams();
        process.stdout.write(
          `${paint('red', '  ↳ error ')}${paint('red', truncate(stringify(part.error), this.maxToolOutputChars))}\n`,
        );
        return;

      case 'error':
        this.closeStreams();
        process.stdout.write(
          `\n${paint('red', '✖ turn failed: ')}${paint('red', truncate(stringify(part.error), 2000))}\n`,
        );
        return;

      case 'finish':
        this.flushNotices();
        this.closeStreams();
        process.stdout.write(
          `\n${paint('dim', `— done (${part.finishReason}, ${formatUsage(part.totalUsage)})`)}\n`,
        );
        return;

      default:
        return;
    }
  }

  endTurn(): void {
    this.flushNotices();
    this.closeStreams();
  }

  private closeStreams(): void {
    this.closeText();
    this.closeReasoning();
  }

  private closeText(): void {
    if (!this.inText) return;
    this.inText = false;
    process.stdout.write('\n');
  }

  private closeReasoning(): void {
    if (!this.inReasoning) return;
    this.inReasoning = false;
    process.stdout.write('\n');
  }
}

function formatUsage(usage: unknown): string {
  if (usage == null || typeof usage !== 'object') return 'usage n/a';
  const value = usage as {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  const input = value.inputTokens ?? 0;
  const output = value.outputTokens ?? 0;
  if (value.inputTokens == null && value.outputTokens == null) return 'usage n/a';
  return `in ${input} tok, out ${output} tok, total ${value.totalTokens ?? input + output} tok`;
}

export { paint };