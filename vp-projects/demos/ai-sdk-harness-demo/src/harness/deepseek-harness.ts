import { createDeepSeek } from '@ai-sdk/deepseek';
import type { HarnessV1, HarnessV1StartOptions } from '@ai-sdk/harness';
import { getRestrictedSandboxSession, resolveSandboxHomeDir } from '@ai-sdk/harness/utils';

import { deepSeekBuiltinTools, type DeepSeekBuiltinTools } from './builtin-tools.ts';
import { DeepSeekHarnessSession } from './deepseek-session.ts';
import {
  DEFAULT_DEEPSEEK_MODEL,
  DEEPSEEK_HARNESS_ID,
  deepSeekLifecycleStateSchema,
  type DeepSeekModelResolver,
  type DeepSeekNoticeListener,
} from './types.ts';

export type DeepSeekHarnessSettings = {
  /** DeepSeek API key. Defaults to `process.env.MY_DS`. */
  readonly apiKey?: string;
  /** Environment variable the API key is read from, for error messages. */
  readonly apiKeyEnvVar?: string;
  readonly baseURL?: string;
  readonly defaultModel?: string;
  /** Upper bound on model steps per turn. */
  readonly maxSteps?: number;
  /** Absolute host path behind the sandbox mount, surfaced in the system prompt. */
  readonly hostFolder?: string;
  /** Extra facts about the sandbox runtime, appended to the system prompt. */
  readonly sandboxNotes?: string;
  /** Inject a different model factory, e.g. a mock model in tests. */
  readonly createModel?: DeepSeekModelResolver;
  readonly onNotice?: DeepSeekNoticeListener;
};

const DEFAULT_MAX_STEPS = 24;

/**
 * `HarnessV1` adapter that drives DeepSeek through `@ai-sdk/deepseek`.
 *
 * The runtime is host-resident: the model loop runs in this process and the
 * sandbox is used as a remote filesystem and shell, so `getBootstrap()` is
 * intentionally absent and nothing is installed inside the sandbox.
 */
export function createDeepSeekHarness(
  settings: DeepSeekHarnessSettings = {},
): HarnessV1<DeepSeekBuiltinTools> {
  const defaultModel = settings.defaultModel ?? DEFAULT_DEEPSEEK_MODEL;
  const resolveModel =
    settings.createModel ?? createDeepSeekModelResolver(settings, defaultModel);
  const maxSteps = settings.maxSteps ?? DEFAULT_MAX_STEPS;

  return {
    specificationVersion: 'harness-v1',
    harnessId: DEEPSEEK_HARNESS_ID,
    builtinTools: deepSeekBuiltinTools,
    supportsBuiltinToolFiltering: true,
    lifecycleStateSchema: deepSeekLifecycleStateSchema,
    doStart: async (options: HarnessV1StartOptions) => {
      const sandbox = getRestrictedSandboxSession(options.sandboxSession);
      const homeDir = await resolveSandboxHomeDir({
        sandbox,
        abortSignal: options.abortSignal,
      });
      return new DeepSeekHarnessSession({
        startOptions: options,
        sandbox,
        homeDir,
        hostFolder: settings.hostFolder ?? options.sessionWorkDir,
        resolveModel,
        maxSteps,
        sandboxNotes: settings.sandboxNotes,
        onNotice: settings.onNotice,
      });
    },
  };
}

function createDeepSeekModelResolver(
  settings: DeepSeekHarnessSettings,
  defaultModel: string,
): DeepSeekModelResolver {
  const envVar = settings.apiKeyEnvVar ?? 'MY_DS';
  let provider: ReturnType<typeof createDeepSeek> | undefined;

  return (modelId?: string) => {
    if (provider == null) {
      const apiKey = settings.apiKey ?? process.env[envVar];
      if (apiKey == null || apiKey.trim().length === 0) {
        throw new Error(
          `Missing DeepSeek API key. Set the ${envVar} environment variable (or copy .env.example to .env).`,
        );
      }
      provider = createDeepSeek({
        apiKey,
        ...(settings.baseURL != null ? { baseURL: settings.baseURL } : {}),
      });
    }
    return provider(modelId ?? defaultModel);
  };
}

export { DEEPSEEK_HARNESS_ID, DEFAULT_DEEPSEEK_MODEL, deepSeekBuiltinTools };
export type { DeepSeekBuiltinTools, DeepSeekModelResolver, DeepSeekNoticeListener };