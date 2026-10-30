import { posix } from 'node:path';
import type { Experimental_SandboxSession as SandboxSession } from '@ai-sdk/provider-utils';

export type BuiltinToolFileChange = {
  readonly event: 'create' | 'modify' | 'delete';
  readonly path: string;
};

export type BuiltinToolOutcome = {
  readonly output: unknown;
  readonly isError: boolean;
  readonly fileChange?: BuiltinToolFileChange;
};

export type ExecuteBuiltinToolOptions = {
  readonly name: string;
  readonly input: Record<string, unknown>;
  readonly sandbox: SandboxSession;
  readonly workDir: string;
  /** Extra sandbox paths read-only tools may open, e.g. the materialized skills directory. */
  readonly readOnlyRoots?: ReadonlyArray<string>;
  readonly abortSignal?: AbortSignal;
};

/**
 * Tool results go back into the model context on every following step, so this
 * cap doubles as the per-turn token budget for shell output.
 */
const MAX_OUTPUT_CHARS = 6_000;
const MAX_LISTED_FILES = 300;

/** Single-quotes a value so it can be interpolated into a POSIX command line. */
export function quotePosix(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Resolves a model-supplied path against the session work directory and refuses
 * anything that would leave it. This is the sandbox boundary for file tools.
 */
export function resolveProjectPath(workDir: string, target: string): string {
  const resolved = posix.isAbsolute(target)
    ? posix.normalize(target)
    : posix.normalize(posix.join(workDir, target));

  if (resolved !== workDir && !resolved.startsWith(`${workDir}/`)) {
    throw new Error(
      `Path "${target}" resolves outside the sandboxed project folder "${workDir}".`,
    );
  }
  return resolved;
}

export type ResolvedReadTarget = {
  readonly path: string;
  /** Root the path was resolved against, used to render it back to the model. */
  readonly root: string;
};

/**
 * Like {@link resolveProjectPath}, but also accepts the extra read-only roots.
 * Skills are materialized under `$HOME` rather than in the project folder, and
 * the model has to be able to open them with `read`.
 */
export function resolveReadablePath(
  workDir: string,
  target: string,
  readOnlyRoots: ReadonlyArray<string> = [],
): ResolvedReadTarget {
  let lastError: unknown;
  for (const root of [workDir, ...readOnlyRoots]) {
    try {
      return { path: resolveProjectPath(root, target), root };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Cannot resolve path "${target}".`);
}

function truncate(value: string): string {
  if (value.length <= MAX_OUTPUT_CHARS) return value;
  return `${value.slice(0, MAX_OUTPUT_CHARS)}\n... [truncated ${value.length - MAX_OUTPUT_CHARS} chars]`;
}

function requireString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Missing required string argument "${key}".`);
  }
  return value;
}

function optionalPositiveInt(input: Record<string, unknown>, key: string): number | undefined {
  const value = input[key];
  if (value == null) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new Error(`Argument "${key}" must be a positive integer.`);
  }
  return value;
}

/** Converts a glob pattern into a matcher for project-relative POSIX paths. */
export function createGlobMatcher(pattern: string): (candidate: string) => boolean {
  const normalized = pattern.replace(/^\.\//, '');
  let source = '';
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index] as string;
    if (char === '*') {
      if (normalized[index + 1] === '*') {
        if (normalized[index + 2] === '/') {
          source += '(?:.*/)?';
          index += 2;
        } else {
          source += '.*';
          index += 1;
        }
      } else {
        source += '[^/]*';
      }
      continue;
    }
    if (char === '?') {
      source += '[^/]';
      continue;
    }
    source += '.+^${}()|[]\\'.includes(char) ? `\\${char}` : char;
  }
  const regexp = new RegExp(`^${source}$`);
  const matchBasenameOnly = !normalized.includes('/');
  return candidate =>
    regexp.test(candidate) || (matchBasenameOnly && regexp.test(posix.basename(candidate)));
}

/**
 * Runs one adapter-native tool against the sandbox. Everything here happens
 * inside the sandbox session, so the agent can only ever reach the mounted
 * project folder.
 */
export async function executeBuiltinTool(
  options: ExecuteBuiltinToolOptions,
): Promise<BuiltinToolOutcome> {
  const { name, input, sandbox, workDir, abortSignal } = options;
  const readOnlyRoots = options.readOnlyRoots ?? [];

  const run = async (command: string) =>
    sandbox.run({ command, workingDirectory: workDir, abortSignal });
  const relative = (absolute: string) => posix.relative(workDir, absolute) || '.';
  /** Project paths come back relative; other roots stay absolute so they round-trip. */
  const relativeTo = (target: ResolvedReadTarget) =>
    target.root === workDir ? relative(target.path) : target.path;
  const readable = (target: string) => resolveReadablePath(workDir, target, readOnlyRoots);
  /** Defaults to the project root, so read-only tools stay usable with no `path`. */
  const searchTarget = (raw: unknown): ResolvedReadTarget =>
    raw == null ? { path: workDir, root: workDir } : readable(String(raw));
  /** Project paths are shown relative to the root; other roots stay absolute. */
  const displayPath = (target: ResolvedReadTarget, absolute: string) =>
    target.root === workDir ? absolute.replace(`${workDir}/`, '') || '.' : absolute;

  try {
    switch (name) {
      case 'bash': {
        const command = requireString(input, 'command');
        const result = await run(command);
        return {
          output: {
            command,
            exitCode: result.exitCode,
            stdout: truncate(result.stdout),
            stderr: truncate(result.stderr),
          },
          isError: result.exitCode !== 0,
        };
      }

      case 'read': {
        const target = readable(requireString(input, 'file_path'));
        const filePath = target.path;
        const startLine = optionalPositiveInt(input, 'start_line');
        const endLine = optionalPositiveInt(input, 'end_line');
        const content = await sandbox.readTextFile({
          path: filePath,
          ...(startLine !== undefined ? { startLine } : {}),
          ...(endLine !== undefined ? { endLine } : {}),
          abortSignal,
        });
        if (content == null) {
          return { output: { error: `File not found: ${relativeTo(target)}` }, isError: true };
        }
        return {
          output: { path: relativeTo(target), content: truncate(content) },
          isError: false,
        };
      }

      case 'write': {
        const filePath = resolveProjectPath(workDir, requireString(input, 'file_path'));
        const content = requireString(input, 'content');
        const existed = (await sandbox.readTextFile({ path: filePath, abortSignal })) != null;
        const parent = posix.dirname(filePath);
        if (parent !== filePath) {
          await run(`mkdir -p ${quotePosix(parent)}`);
        }
        await sandbox.writeTextFile({ path: filePath, content, abortSignal });
        return {
          output: {
            path: relative(filePath),
            action: existed ? 'modify' : 'create',
            bytes: Buffer.byteLength(content, 'utf8'),
          },
          isError: false,
          fileChange: { event: existed ? 'modify' : 'create', path: filePath },
        };
      }

      case 'edit': {
        const filePath = resolveProjectPath(workDir, requireString(input, 'file_path'));
        const oldString = requireString(input, 'old_string');
        const newString = requireString(input, 'new_string');
        const replaceAll = input['replace_all'] === true;
        const current = await sandbox.readTextFile({ path: filePath, abortSignal });
        if (current == null) {
          return { output: { error: `File not found: ${relative(filePath)}` }, isError: true };
        }
        const occurrences = current.split(oldString).length - 1;
        if (occurrences === 0) {
          return {
            output: { error: `old_string was not found in ${relative(filePath)}.` },
            isError: true,
          };
        }
        if (occurrences > 1 && !replaceAll) {
          return {
            output: {
              error: `old_string matches ${occurrences} times in ${relative(filePath)}. Add more surrounding context, or set replace_all to true.`,
            },
            isError: true,
          };
        }
        const next = replaceAll
          ? current.split(oldString).join(newString)
          : current.replace(oldString, newString);
        await sandbox.writeTextFile({ path: filePath, content: next, abortSignal });
        return {
          output: {
            path: relative(filePath),
            replacements: replaceAll ? occurrences : 1,
          },
          isError: false,
          fileChange: { event: 'modify', path: filePath },
        };
      }

      case 'grep': {
        const pattern = requireString(input, 'pattern');
        const search = searchTarget(input['path']);
        const result = await run(
          `grep -rn -e ${quotePosix(pattern)} ${quotePosix(search.path)}`,
        );
        if (result.exitCode === 1) {
          return { output: { pattern, matches: [] }, isError: false };
        }
        if (result.exitCode !== 0) {
          return {
            output: { error: result.stderr.trim() || `grep exited with code ${result.exitCode}` },
            isError: true,
          };
        }
        return {
          output: {
            pattern,
            matches: truncate(result.stdout)
              .split('\n')
              .filter(line => line.length > 0)
              .map(line => displayPath(search, line))
              .slice(0, MAX_LISTED_FILES),
          },
          isError: false,
        };
      }

      case 'glob': {
        const pattern = requireString(input, 'pattern');
        const search = searchTarget(input['path']);
        const result = await run(`find ${quotePosix(search.path)} -type f`);
        if (result.exitCode !== 0) {
          return {
            output: { error: result.stderr.trim() || `find exited with code ${result.exitCode}` },
            isError: true,
          };
        }
        const matches = createGlobMatcher(pattern);
        const files = result.stdout
          .split('\n')
          .filter(line => line.length > 0)
          .map(absolute => displayPath(search, absolute))
          .filter(matches)
          .sort()
          .slice(0, MAX_LISTED_FILES);
        return { output: { pattern, files }, isError: false };
      }

      case 'ls': {
        const search = searchTarget(input['path']);
        const result = await run(`ls -la ${quotePosix(search.path)}`);
        if (result.exitCode !== 0) {
          return {
            output: { error: result.stderr.trim() || `ls exited with code ${result.exitCode}` },
            isError: true,
          };
        }
        return {
          output: { path: relativeTo(search), entries: truncate(result.stdout) },
          isError: false,
        };
      }

      default:
        return { output: { error: `Unknown built-in tool: ${name}` }, isError: true };
    }
  } catch (error) {
    return { output: { error: error instanceof Error ? error.message : String(error) }, isError: true };
  }
}