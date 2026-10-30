import { commonTool } from '@ai-sdk/harness';
import { tool, type ToolSet } from 'ai';
import { z } from 'zod';

/**
 * Tools the adapter runs itself, inside the sandbox. They are surfaced to
 * `HarnessAgent` as `builtinTools` so consumers see them in the typed
 * `tool-call` stream alongside their own host tools.
 */
export const deepSeekBuiltinTools = {
  bash: commonTool('bash', {
    nativeName: 'bash',
    toolUseKind: 'bash',
    description:
      'Run a bash command inside the sandboxed project folder. The working directory is the project root. Returns the exit code, stdout and stderr.',
    inputSchema: z.object({
      command: z.string().describe('The bash command line to execute.'),
    }),
  }),
  read: commonTool('read', {
    nativeName: 'read',
    toolUseKind: 'readonly',
    description: 'Read a UTF-8 text file from the project folder.',
    inputSchema: z.object({
      file_path: z.string().describe('Path relative to the project root.'),
      start_line: z
        .number()
        .int()
        .positive()
        .optional()
        .describe('Optional 1-based first line to return.'),
      end_line: z
        .number()
        .int()
        .positive()
        .optional()
        .describe('Optional 1-based last line to return.'),
    }),
  }),
  write: commonTool('write', {
    nativeName: 'write',
    toolUseKind: 'edit',
    description:
      'Create or overwrite a UTF-8 text file in the project folder. Parent directories are created automatically.',
    inputSchema: z.object({
      file_path: z.string().describe('Path relative to the project root.'),
      content: z.string().describe('Full file content to write.'),
    }),
  }),
  edit: commonTool('edit', {
    nativeName: 'edit',
    toolUseKind: 'edit',
    description:
      'Replace an exact string in an existing file. `old_string` must match uniquely unless `replace_all` is set.',
    inputSchema: z.object({
      file_path: z.string().describe('Path relative to the project root.'),
      old_string: z.string().describe('Exact text to replace, including indentation.'),
      new_string: z.string().describe('Replacement text.'),
      replace_all: z
        .boolean()
        .optional()
        .describe('Replace every occurrence instead of requiring a unique match.'),
    }),
  }),
  grep: commonTool('grep', {
    nativeName: 'grep',
    toolUseKind: 'readonly',
    description: 'Recursively search file contents with a regular expression.',
    inputSchema: z.object({
      pattern: z.string().describe('Regular expression to search for.'),
      path: z
        .string()
        .optional()
        .describe('File or directory to search. Defaults to the project root.'),
    }),
  }),
  glob: commonTool('glob', {
    nativeName: 'glob',
    toolUseKind: 'readonly',
    description: 'Find files matching a glob pattern such as `src/**/*.ts`.',
    inputSchema: z.object({
      pattern: z.string().describe('Glob pattern matched against project-relative paths.'),
      path: z.string().optional().describe('Directory to search. Defaults to the project root.'),
    }),
  }),
  ls: tool({
    description: 'List the entries of a directory in the project folder.',
    inputSchema: z.object({
      path: z.string().optional().describe('Directory to list. Defaults to the project root.'),
    }),
  }),
} as const satisfies ToolSet;

export type DeepSeekBuiltinTools = typeof deepSeekBuiltinTools;
export type DeepSeekBuiltinToolName = keyof DeepSeekBuiltinTools;

export const DEEPSEEK_BUILTIN_TOOL_NAMES = Object.keys(
  deepSeekBuiltinTools,
) as ReadonlyArray<DeepSeekBuiltinToolName>;