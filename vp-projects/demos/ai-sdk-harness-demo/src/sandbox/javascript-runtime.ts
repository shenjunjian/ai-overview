import { defineCommand, type Bash } from 'just-bash';

export type RegisterJavaScriptRuntimeOptions = {
  /** The shell the agent talks to (`Sandbox.bashEnvInstance`). */
  readonly shell: Bash;
  /** A second `Bash` created with `javascript: true`, sharing the same filesystem. */
  readonly runtime: Bash;
};

/**
 * `just-bash` ships a QuickJS (WebAssembly) interpreter behind its `javascript`
 * option, but `Sandbox.create` does not forward that option. Registering
 * `js-exec` and `node` on the sandbox shell and delegating to a second `Bash`
 * that shares the same `MountableFs` closes the gap without touching internals:
 * scripts really execute, and they only ever see the sandbox filesystem.
 */
export function registerJavaScriptRuntime(options: RegisterJavaScriptRuntimeOptions): void {
  const { shell, runtime } = options;
  shell.registerCommand(bridgeCommand('js-exec', 'js-exec', runtime, passthroughArgs));
  shell.registerCommand(bridgeCommand('node', 'js-exec', runtime, rewriteNodeArgs));
}

/** System-prompt text describing what the sandbox can actually run. */
export function describeJavaScriptRuntime(): string {
  return [
    'JavaScript runtime (QuickJS via WebAssembly, executed by `js-exec`; `node` is an alias):',
    '- `node script.ts`, `node script.mjs`, `node -e "code"` and `echo "code" | node` all work. Type annotations are stripped for `.ts` and `.mts`.',
    '- Nothing runs on the host machine. Scripts see only the sandbox filesystem, and network access is disabled.',
    '- `.mjs`, `.ts` and `.mts` are ES modules: use `import` / `export`. Plain `.js` runs as a script, where a static `import` fails - use `.mjs`, or `await import()` at the top level.',
    "- `require()` resolves built-in modules only (`fs`, `path`, `assert`, `util`, `os`, `url`, `events`, `buffer`, `stream`, `string_decoder`, `querystring`, `child_process`). It cannot load your own files or `node_modules`; use `import` for those.",
    '- Globals available: `console`, `process`, `Buffer`, `URL`, `URLSearchParams`, `fetch`. All file I/O is synchronous.',
    '- `process.argv` is `[scriptPath, ...args]` for a file and `["-c", ...args]` for `node -e`. `process.argv0` and `process.execPath` are empty strings, so do not assume the usual `[execPath, scriptPath, ...args]` layout.',
    '- `process.exit(n)` sets the shell exit code. Assigning `process.exitCode` is silently ignored, so call `process.exit(n)` on failure paths.',
    '- `process.stdout` and `process.stderr` do not exist. Write with `console.log` and `console.error`, and guard any `isTTY` colour detection so it degrades to plain text.',
    '- `process.platform` reports `linux` and `process.version` reports `v22.0.0`. Both are simulated.',
    '- A literal `--help` anywhere in the arguments is consumed by the runtime and prints its own help, so a script can never receive `--help`. Cover that path with `-h`, or by calling your `main()` from a test file.',
    '- `child_process.execSync` / `spawnSync` run commands in this same sandbox shell, not on the host.',
    '- `node -e` only runs synchronous code: a top-level `await` or a dynamic `import()` there exits 0 and prints nothing. To import one of your own modules, write a tiny `.mjs` entry file and run that instead.',
    '- Not available: `npm`, `npx`, `pnpm`, `tsc`, `tsx`, `git`, and native modules such as `crypto`, `http`, `net`, `tls`, `zlib`, `vm`, `worker_threads`, `readline`. Nothing can be installed, so write dependency-free code and prefer `node:` built-ins.',
    '- Limits: 64 MB of memory and a 10 second timeout per execution.',
    '- These behaviours are settled, so do not spend steps probing them. Write the code, run it once, and read the output.',
  ].join('\n');
}

function passthroughArgs(args: ReadonlyArray<string>): string[] {
  return [...args];
}

/** `node -e <code>` becomes `js-exec -c <code>`; everything else passes through. */
function rewriteNodeArgs(args: ReadonlyArray<string>): string[] {
  const [first, ...rest] = args;
  return first === '-e' || first === '--eval' ? ['-c', ...rest] : [...args];
}

function bridgeCommand(
  name: string,
  delegate: string,
  runtime: Bash,
  rewrite: (args: ReadonlyArray<string>) => string[],
) {
  const command = defineCommand(name, async (args, context) => {
    const commandLine = [delegate, ...rewrite(args).map(quoteSingle)].join(' ');
    const result = await runtime.exec(commandLine, {
      cwd: context.cwd,
      stdin: context.stdin,
      ...(context.signal !== undefined ? { signal: context.signal } : {}),
    });
    return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode };
  });
  // The body awaits a separate engine, so it needs the trusted async context.
  return { ...command, trusted: true };
}

/** Single-quotes an already-parsed argument so it survives re-parsing. */
function quoteSingle(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}