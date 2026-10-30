import { posix } from 'node:path';
import {
  jsonSchema,
  stepCountIs,
  streamText,
  tool,
  type AssistantContent,
  type ModelMessage,
  type ToolResultPart,
  type ToolSet,
} from 'ai';
import type {
  JSONSchema7,
  JSONValue,
  LanguageModelV4,
  LanguageModelV4FinishReason,
  LanguageModelV4Usage,
} from '@ai-sdk/provider';
import type {
  Experimental_SandboxSession as SandboxSession,
  FlexibleSchema,
} from '@ai-sdk/provider-utils';
import {
  HarnessCapabilityUnsupportedError,
  harnessStateDirectoryPath,
  isHarnessV1BuiltinToolIncluded,
  type HarnessV1BuiltinToolFiltering,
  type HarnessV1ContinueTurnOptions,
  type HarnessV1ContinueTurnState,
  type HarnessV1Prompt,
  type HarnessV1PromptControl,
  type HarnessV1PromptTurnOptions,
  type HarnessV1ResponseFormat,
  type HarnessV1ResumeSessionState,
  type HarnessV1Session,
  type HarnessV1Skill,
  type HarnessV1StartOptions,
  type HarnessV1StreamPart,
  type HarnessV1ToolSpec,
} from '@ai-sdk/harness';
import { writeSkills } from '@ai-sdk/harness/utils';
import { z } from 'zod';

import { deepSeekBuiltinTools } from './builtin-tools.ts';
import { executeBuiltinTool } from './execute-builtin-tool.ts';
import { buildSystemPrompt } from './system-prompt.ts';
import {
  DEEPSEEK_HARNESS_ID,
  type DeepSeekLifecycleData,
  type DeepSeekModelResolver,
  type DeepSeekNoticeListener,
} from './types.ts';

type PendingHostToolResult = (result: {
  output: unknown;
  isError?: boolean;
}) => void;

type ActiveTurn = {
  readonly abortController: AbortController;
  readonly pendingHostToolResults: Map<string, PendingHostToolResult>;
  suspendRequested: boolean;
  readonly settled: Promise<void>;
  readonly settle: (error?: unknown) => void;
};

type TurnRequest = {
  readonly model?: string;
  readonly instructions?: string;
  readonly skills: ReadonlyArray<HarnessV1Skill>;
  readonly tools: ReadonlyArray<HarnessV1ToolSpec>;
  readonly responseFormat?: HarnessV1ResponseFormat;
  readonly abortSignal?: AbortSignal;
  readonly emit: (event: HarnessV1StreamPart) => void;
};

type ModelToolCall = {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly input: unknown;
};

type ModelStepOutcome = {
  readonly assistantContent: AssistantContent;
  readonly toolCalls: ReadonlyArray<ModelToolCall>;
  readonly usage: LanguageModelV4Usage;
  readonly finishReason: string;
};

export type DeepSeekHarnessSessionOptions = {
  readonly startOptions: HarnessV1StartOptions;
  readonly sandbox: SandboxSession;
  readonly homeDir: string;
  readonly hostFolder: string;
  readonly resolveModel: DeepSeekModelResolver;
  readonly maxSteps: number;
  /** Appended to the sandbox description in the system prompt. */
  readonly sandboxNotes?: string;
  readonly onNotice?: DeepSeekNoticeListener;
};

/**
 * Host-driven `HarnessV1Session`: the model loop runs in this Node process and
 * uses the sandbox purely as a remote filesystem plus shell, so no bridge has
 * to be installed inside the sandbox.
 */
export class DeepSeekHarnessSession implements HarnessV1Session {
  readonly sessionId: string;
  readonly isResume: boolean;

  private readonly sandbox: SandboxSession;
  private readonly workDir: string;
  private readonly hostFolder: string;
  private readonly resolveModel: DeepSeekModelResolver;
  private readonly maxSteps: number;
  private readonly sandboxNotes: string | undefined;
  private readonly onNotice: DeepSeekNoticeListener | undefined;
  private readonly builtinToolFiltering: HarnessV1BuiltinToolFiltering | undefined;
  private readonly skillsDir: string;

  private history: ModelMessage[] = [];
  private activeTurn: ActiveTurn | undefined;
  private closed = false;
  private materializedSkillFingerprint: string | undefined;

  constructor(options: DeepSeekHarnessSessionOptions) {
    const { startOptions } = options;
    this.sessionId = startOptions.sessionId;
    this.isResume = startOptions.resumeFrom != null || startOptions.continueFrom != null;
    this.sandbox = options.sandbox;
    this.workDir = startOptions.sessionWorkDir;
    this.hostFolder = options.hostFolder;
    this.resolveModel = options.resolveModel;
    this.maxSteps = options.maxSteps;
    this.sandboxNotes = options.sandboxNotes;
    this.onNotice = options.onNotice;
    this.builtinToolFiltering = startOptions.builtinToolFiltering;
    this.skillsDir = posix.join(
      harnessStateDirectoryPath({ sandboxHomeDir: options.homeDir }),
      'skills',
    );
    this.history = restoreHistory(
      startOptions.resumeFrom?.data ?? startOptions.continueFrom?.data,
    );
  }

  async doPromptTurn(options: HarnessV1PromptTurnOptions): Promise<HarnessV1PromptControl> {
    this.assertOpen();
    await this.materializeSkills(options.skills, options.abortSignal);
    this.history.push({ role: 'user', content: promptToText(options.prompt) });
    return this.beginTurn(options);
  }

  async doContinueTurn(options: HarnessV1ContinueTurnOptions): Promise<HarnessV1PromptControl> {
    this.assertOpen();
    await this.materializeSkills(options.skills, options.abortSignal);
    // Host-resident runtime: the previous process is gone, so the turn is
    // re-driven from the persisted conversation. Lossy by design.
    return this.beginTurn(options);
  }

  async doCompact(): Promise<void> {
    throw new HarnessCapabilityUnsupportedError({
      harnessId: DEEPSEEK_HARNESS_ID,
      message:
        'The DeepSeek harness does not implement context compaction; trim the conversation by starting a new session instead.',
    });
  }

  async doSuspendTurn(): Promise<HarnessV1ContinueTurnState> {
    const turn = this.activeTurn;
    if (turn != null) {
      turn.suspendRequested = true;
      turn.abortController.abort(new Error('Turn suspended by host.'));
      await turn.settled.catch(() => {});
    }
    return this.continueTurnState();
  }

  async doDetach(): Promise<HarnessV1ResumeSessionState> {
    await this.settleActiveTurn();
    return this.resumeSessionState();
  }

  async doStop(): Promise<HarnessV1ResumeSessionState> {
    await this.settleActiveTurn();
    this.closed = true;
    return this.resumeSessionState();
  }

  async doDestroy(): Promise<void> {
    await this.settleActiveTurn();
    this.closed = true;
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new Error(
        `Harness session '${this.sessionId}' is closed and cannot run another turn.`,
      );
    }
    if (this.activeTurn != null) {
      throw new Error(
        `Harness session '${this.sessionId}' already has a turn in flight.`,
      );
    }
  }

  private async settleActiveTurn(): Promise<void> {
    const turn = this.activeTurn;
    if (turn == null) return;
    turn.suspendRequested = true;
    turn.abortController.abort(new Error('Harness session closed.'));
    await turn.settled.catch(() => {});
  }

  private beginTurn(request: TurnRequest): Promise<HarnessV1PromptControl> {
    if (request.responseFormat?.type === 'json') {
      throw new HarnessCapabilityUnsupportedError({
        harnessId: DEEPSEEK_HARNESS_ID,
        message: 'The DeepSeek harness does not support structured JSON output.',
      });
    }

    const abortController = new AbortController();
    const pendingHostToolResults = new Map<string, PendingHostToolResult>();
    let settle!: (error?: unknown) => void;
    const settled = new Promise<void>((resolve, reject) => {
      settle = (error?: unknown) => {
        if (error == null) resolve();
        else reject(error);
      };
    });
    const turn: ActiveTurn = {
      abortController,
      pendingHostToolResults,
      suspendRequested: false,
      settled,
      settle,
    };
    this.activeTurn = turn;

    if (request.abortSignal != null) {
      if (request.abortSignal.aborted) {
        abortController.abort(request.abortSignal.reason);
      } else {
        request.abortSignal.addEventListener(
          'abort',
          () => abortController.abort(request.abortSignal?.reason),
          { once: true },
        );
      }
    }

    void this.driveTurn(request, turn).then(
      () => {
        this.clearTurn(turn);
        turn.settle();
      },
      (error: unknown) => {
        this.clearTurn(turn);
        // A host-requested suspension ends the turn cleanly; the framework
        // keeps consuming the events already emitted.
        turn.settle(turn.suspendRequested ? undefined : error);
      },
    );

    return Promise.resolve({
      submitToolResult: async ({ toolCallId, output, isError }) => {
        const pending = pendingHostToolResults.get(toolCallId);
        if (pending == null) return;
        pendingHostToolResults.delete(toolCallId);
        pending({ output, isError });
      },
      done: settled,
    });
  }

  private clearTurn(turn: ActiveTurn): void {
    if (this.activeTurn === turn) this.activeTurn = undefined;
  }

  private async driveTurn(request: TurnRequest, turn: ActiveTurn): Promise<void> {
    const { emit } = request;
    const model = this.resolveModel(request.model);
    const instructions = buildSystemPrompt({
      workDir: this.workDir,
      hostFolder: this.hostFolder,
      skillsDir: this.skillsDir,
      skills: request.skills.map(skill => ({
        name: skill.name,
        description: skill.description,
      })),
      builtinToolNames: this.activeBuiltinToolNames(),
      hostToolNames: request.tools.map(spec => spec.name),
      sandboxDescription: joinNonEmpty(this.sandbox.description, this.sandboxNotes),
      instructions: request.instructions,
    });
    const tools = this.buildToolSet(request.tools);
    let totalUsage = createZeroUsage();

    emit({ type: 'stream-start', modelId: model.modelId });

    for (let step = 0; step < this.maxSteps; step += 1) {
      throwIfAborted(turn);
      const outcome = await this.runModelStep({
        emit,
        model,
        instructions,
        tools,
        signal: turn.abortController.signal,
      });
      totalUsage = addUsage(totalUsage, outcome.usage);

      if (outcome.toolCalls.length === 0) {
        const finishReason = toHarnessFinishReason(outcome.finishReason);
        emit({ type: 'finish-step', finishReason, usage: outcome.usage });
        emit({ type: 'finish', finishReason, totalUsage });
        return;
      }

      const toolResultParts: ToolResultPart[] = [];
      for (const call of outcome.toolCalls) {
        toolResultParts.push(
          await this.dispatchToolCall({ call, turn, emit }),
        );
      }

      this.history.push({ role: 'assistant', content: outcome.assistantContent });
      this.history.push({ role: 'tool', content: toolResultParts });

      emit({
        type: 'finish-step',
        finishReason: { unified: 'tool-calls', raw: outcome.finishReason },
        usage: outcome.usage,
      });

      if (turn.suspendRequested) {
        emit({
          type: 'finish',
          finishReason: { unified: 'other', raw: 'suspended' },
          totalUsage,
        });
        return;
      }
    }

    // The harness `finish` part only carries the unified reason, so say why the
    // turn stopped as well - `length` alone reads like a truncated response.
    this.onNotice?.({
      type: 'warning',
      message: `step limit (${this.maxSteps}) reached before the model stopped on its own; raise --max-steps or narrow the request`,
    });
    emit({
      type: 'finish',
      finishReason: { unified: 'length', raw: `step limit (${this.maxSteps}) reached` },
      totalUsage,
    });
  }

  private async runModelStep(params: {
    readonly emit: (event: HarnessV1StreamPart) => void;
    readonly model: LanguageModelV4;
    readonly instructions: string;
    readonly tools: ToolSet;
    readonly signal: AbortSignal;
  }): Promise<ModelStepOutcome> {
    const { emit, signal } = params;
    const result = streamText({
      model: params.model,
      // ai@7 rejects `system` messages in `messages`; the system prompt goes
      // through `instructions` instead.
      instructions: params.instructions,
      messages: this.history,
      tools: params.tools,
      stopWhen: stepCountIs(1),
      abortSignal: signal,
    });

    const assistantContent: AssistantContent = [];
    const toolCalls: ModelToolCall[] = [];
    let text = '';
    let reasoning = '';
    let usage = createZeroUsage();
    let finishReason = 'stop';

    for await (const part of result.stream) {
      switch (part.type) {
        case 'text-start':
          emit({ type: 'text-start', id: part.id });
          break;
        case 'text-delta':
          text += part.text;
          emit({ type: 'text-delta', id: part.id, delta: part.text });
          break;
        case 'text-end':
          if (text.length > 0) assistantContent.push({ type: 'text', text });
          text = '';
          emit({ type: 'text-end', id: part.id });
          break;
        case 'reasoning-start':
          emit({ type: 'reasoning-start', id: part.id });
          break;
        case 'reasoning-delta':
          reasoning += part.text;
          emit({ type: 'reasoning-delta', id: part.id, delta: part.text });
          break;
        case 'reasoning-end':
          if (reasoning.length > 0) {
            assistantContent.push({ type: 'reasoning', text: reasoning });
          }
          reasoning = '';
          emit({ type: 'reasoning-end', id: part.id });
          break;
        case 'tool-input-start':
          emit({ type: 'tool-input-start', id: part.id, toolName: part.toolName });
          break;
        case 'tool-input-delta':
          emit({ type: 'tool-input-delta', id: part.id, delta: part.delta });
          break;
        case 'tool-input-end':
          emit({ type: 'tool-input-end', id: part.id });
          break;
        case 'tool-call':
          toolCalls.push({
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            input: part.input,
          });
          assistantContent.push({
            type: 'tool-call',
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            input: part.input,
          });
          break;
        case 'finish-step':
          usage = toHarnessUsage(part.usage);
          finishReason = part.finishReason;
          break;
        case 'error':
          throw part.error;
        default:
          break;
      }
    }

    if (text.length > 0) assistantContent.push({ type: 'text', text });
    if (reasoning.length > 0) assistantContent.push({ type: 'reasoning', text: reasoning });

    return { assistantContent, toolCalls, usage, finishReason };
  }

  private async dispatchToolCall(params: {
    readonly call: ModelToolCall;
    readonly turn: ActiveTurn;
    readonly emit: (event: HarnessV1StreamPart) => void;
  }): Promise<ToolResultPart> {
    const { call, turn, emit } = params;
    const rawInput = JSON.stringify(call.input ?? {});
    const isBuiltin = this.isBuiltinToolActive(call.toolName);

    if (isBuiltin) {
      emit({
        type: 'tool-call',
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        input: rawInput,
        providerExecuted: true,
      });
      const outcome = await executeBuiltinTool({
        name: call.toolName,
        input: asRecord(call.input),
        sandbox: this.sandbox,
        workDir: this.workDir,
        readOnlyRoots: [this.skillsDir],
        abortSignal: turn.abortController.signal,
      });
      if (outcome.fileChange != null) {
        emit({
          type: 'file-change',
          event: outcome.fileChange.event,
          path: outcome.fileChange.path,
        });
      }
      emit({
        type: 'tool-result',
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        result: toJsonValue(outcome.output),
        isError: outcome.isError,
      });
      return toToolResultPart(call, outcome.output, outcome.isError);
    }

    // Host tool: hand the call to `HarnessAgent`, which runs `tool.execute`
    // and feeds the value back through `submitToolResult`.
    emit({
      type: 'tool-call',
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      input: rawInput,
      providerExecuted: false,
    });
    const result = await this.awaitHostToolResult(turn, call.toolCallId);
    emit({
      type: 'tool-result',
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      result: toJsonValue(result.output),
      isError: result.isError,
    });
    return toToolResultPart(call, result.output, result.isError === true);
  }

  private awaitHostToolResult(
    turn: ActiveTurn,
    toolCallId: string,
  ): Promise<{ output: unknown; isError?: boolean }> {
    return new Promise((resolve, reject) => {
      const { signal } = turn.abortController;
      if (signal.aborted) {
        reject(signal.reason ?? new Error('Aborted'));
        return;
      }
      turn.pendingHostToolResults.set(toolCallId, resolve);
      signal.addEventListener(
        'abort',
        () => {
          if (turn.pendingHostToolResults.delete(toolCallId)) {
            reject(signal.reason ?? new Error('Aborted'));
          }
        },
        { once: true },
      );
    });
  }

  private isBuiltinToolActive(toolName: string): boolean {
    return (
      Object.hasOwn(deepSeekBuiltinTools, toolName) &&
      isHarnessV1BuiltinToolIncluded({
        toolName,
        toolFiltering: this.builtinToolFiltering,
      })
    );
  }

  private activeBuiltinToolNames(): string[] {
    return Object.keys(deepSeekBuiltinTools).filter(name => this.isBuiltinToolActive(name));
  }

  private buildToolSet(hostTools: ReadonlyArray<HarnessV1ToolSpec>): ToolSet {
    const tools: ToolSet = {};
    for (const [name, builtin] of Object.entries(deepSeekBuiltinTools)) {
      if (!this.isBuiltinToolActive(name)) continue;
      tools[name] = tool({
        description: builtin.description,
        // The builtin schemas form a union with no single INPUT; each tool is
        // sent to the model on its own, so a record type is enough here.
        inputSchema: builtin.inputSchema as unknown as FlexibleSchema<
          Record<string, unknown>
        >,
      });
    }
    for (const spec of hostTools) {
      if (Object.hasOwn(tools, spec.name)) continue;
      tools[spec.name] = tool({
        ...(spec.description != null ? { description: spec.description } : {}),
        inputSchema:
          spec.inputSchema != null ? jsonSchema(toPlainJsonSchema(spec.inputSchema)) : z.object({}),
      });
    }
    return tools;
  }

  private async materializeSkills(
    skills: ReadonlyArray<HarnessV1Skill>,
    abortSignal?: AbortSignal,
  ): Promise<void> {
    const fingerprint = JSON.stringify(
      skills.map(skill => [
        skill.name,
        skill.description,
        skill.content,
        (skill.files ?? []).map(file => [file.path, file.content]),
      ]),
    );
    if (fingerprint === this.materializedSkillFingerprint) return;

    const homeDir = posix.dirname(posix.dirname(this.skillsDir));
    try {
      const result = await writeSkills({
        sandbox: this.sandbox,
        homePath: homeDir,
        skillsDir: posix.relative(homeDir, this.skillsDir),
        skills,
        abortSignal,
      });
      this.materializedSkillFingerprint = fingerprint;
      this.onNotice?.({
        type: 'skills-materialized',
        skillsDir: this.skillsDir,
        written: [...result.written],
        removed: [...result.removed],
        unchanged: [...result.unchanged],
      });
    } catch (error) {
      this.onNotice?.({
        type: 'warning',
        message: `Failed to materialize skills into the sandbox: ${describeError(error)}`,
      });
    }
  }

  private continueTurnState(): HarnessV1ContinueTurnState {
    return {
      type: 'continue-turn',
      harnessId: DEEPSEEK_HARNESS_ID,
      specificationVersion: 'harness-v1',
      data: this.serializeHistory(),
    };
  }

  private resumeSessionState(): HarnessV1ResumeSessionState {
    return {
      type: 'resume-session',
      harnessId: DEEPSEEK_HARNESS_ID,
      specificationVersion: 'harness-v1',
      data: this.serializeHistory(),
    };
  }

  private serializeHistory(): DeepSeekLifecycleData {
    return { messages: JSON.parse(JSON.stringify(this.history)) as JSONValue[] };
  }
}

function joinNonEmpty(...parts: ReadonlyArray<string | undefined>): string {
  return parts.filter(part => part != null && part.trim().length > 0).join('\n\n');
}

function restoreHistory(data: unknown): ModelMessage[] {
  if (data == null || typeof data !== 'object') return [];
  const messages = (data as { messages?: unknown }).messages;
  if (!Array.isArray(messages)) return [];
  return JSON.parse(JSON.stringify(messages)) as ModelMessage[];
}

function promptToText(prompt: HarnessV1Prompt): string {
  if (typeof prompt === 'string') return prompt;
  const { content } = prompt;
  if (typeof content === 'string') return content;
  return content
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map(part => part.text)
    .join('\n');
}

function throwIfAborted(turn: ActiveTurn): void {
  const { signal } = turn.abortController;
  if (signal.aborted) throw signal.reason ?? new Error('Aborted');
}

function asRecord(input: unknown): Record<string, unknown> {
  if (input == null) return {};
  if (typeof input !== 'object') return {};
  return input as Record<string, unknown>;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toToolResultPart(
  call: ModelToolCall,
  output: unknown,
  isError: boolean,
): ToolResultPart {
  return {
    type: 'tool-result',
    toolCallId: call.toolCallId,
    toolName: call.toolName,
    output: isError
      ? { type: 'error-text', value: stringifyOutput(output) }
      : { type: 'json', value: toJsonValue(output) },
  };
}

/**
 * `HarnessV1ToolSpec.inputSchema` arrives with a non-enumerable `~standard`
 * marker that would send `asSchema` down the Zod path. Copying the own
 * enumerable keys yields the bare JSON Schema, which is what `jsonSchema()`
 * expects.
 */
function toPlainJsonSchema(schema: JSONSchema7): JSONSchema7 {
  return { ...(schema as unknown as Record<string, unknown>) } as unknown as JSONSchema7;
}

/** JSON round-trip so arbitrary tool output satisfies the harness wire type. */
function toJsonValue(value: unknown): NonNullable<JSONValue> {
  const cloned: unknown = JSON.parse(JSON.stringify(value ?? null));
  return (cloned == null ? {} : cloned) as NonNullable<JSONValue>;
}

function stringifyOutput(output: unknown): string {
  if (typeof output === 'string') return output;
  try {
    return JSON.stringify(output);
  } catch {
    return String(output);
  }
}

function toHarnessFinishReason(raw: string): LanguageModelV4FinishReason {
  const unified =
    raw === 'stop' ||
    raw === 'length' ||
    raw === 'content-filter' ||
    raw === 'tool-calls' ||
    raw === 'error' ||
    raw === 'interrupted'
      ? raw
      : 'other';
  return { unified, raw };
}

function createZeroUsage(): LanguageModelV4Usage {
  return {
    inputTokens: { total: 0, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: 0, text: undefined, reasoning: undefined },
  };
}

function toHarnessUsage(usage: {
  inputTokens: number | undefined;
  inputTokenDetails: {
    noCacheTokens: number | undefined;
    cacheReadTokens: number | undefined;
    cacheWriteTokens: number | undefined;
  };
  outputTokens: number | undefined;
  outputTokenDetails: {
    textTokens: number | undefined;
    reasoningTokens: number | undefined;
  };
}): LanguageModelV4Usage {
  return {
    inputTokens: {
      total: usage.inputTokens,
      noCache: usage.inputTokenDetails.noCacheTokens,
      cacheRead: usage.inputTokenDetails.cacheReadTokens,
      cacheWrite: usage.inputTokenDetails.cacheWriteTokens,
    },
    outputTokens: {
      total: usage.outputTokens,
      text: usage.outputTokenDetails.textTokens,
      reasoning: usage.outputTokenDetails.reasoningTokens,
    },
  };
}

function addUsage(
  total: LanguageModelV4Usage,
  delta: LanguageModelV4Usage,
): LanguageModelV4Usage {
  return {
    inputTokens: {
      total: (total.inputTokens.total ?? 0) + (delta.inputTokens.total ?? 0),
      noCache: sumOptional(total.inputTokens.noCache, delta.inputTokens.noCache),
      cacheRead: sumOptional(total.inputTokens.cacheRead, delta.inputTokens.cacheRead),
      cacheWrite: sumOptional(total.inputTokens.cacheWrite, delta.inputTokens.cacheWrite),
    },
    outputTokens: {
      total: (total.outputTokens.total ?? 0) + (delta.outputTokens.total ?? 0),
      text: sumOptional(total.outputTokens.text, delta.outputTokens.text),
      reasoning: sumOptional(total.outputTokens.reasoning, delta.outputTokens.reasoning),
    },
  };
}

function sumOptional(left: number | undefined, right: number | undefined): number | undefined {
  if (left == null && right == null) return undefined;
  return (left ?? 0) + (right ?? 0);
}