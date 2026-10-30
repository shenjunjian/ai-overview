import type { JSONValue, LanguageModelV4 } from '@ai-sdk/provider';
import { z } from 'zod';

/** Stable kebab-case identifier for this adapter. */
export const DEEPSEEK_HARNESS_ID = 'deepseek';

export const DEFAULT_DEEPSEEK_MODEL = 'deepseek-v4-flash';

/** Resolves the model id configured for a turn to a concrete AI SDK model. */
export type DeepSeekModelResolver = (modelId?: string) => LanguageModelV4;

/** Adapter-defined lifecycle payload: the conversation the runtime owns. */
export type DeepSeekLifecycleData = {
  messages: JSONValue[];
};

export const deepSeekLifecycleStateSchema = z.object({
  messages: z.array(z.unknown()),
});

/** Adapter-visible notices that are not part of the model stream. */
export type DeepSeekHarnessNotice =
  | {
      readonly type: 'skills-materialized';
      readonly skillsDir: string;
      readonly written: string[];
      readonly removed: string[];
      readonly unchanged: string[];
    }
  | { readonly type: 'warning'; readonly message: string };

export type DeepSeekNoticeListener = (notice: DeepSeekHarnessNotice) => void;