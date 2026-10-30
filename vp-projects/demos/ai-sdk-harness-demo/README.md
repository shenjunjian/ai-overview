# ai-sdk-harness-demo

A console coding agent built on `HarnessAgent` from `@ai-sdk/harness`. You point it at a folder, then develop inside that folder by talking to it. The model is DeepSeek via `@ai-sdk/deepseek`; everything is printed to stdout. No `@ai-sdk/tui`, no web UI.

It demonstrates the four things a harness needs to be useful:

- **Sandbox** - the folder you choose is mounted into a `just-bash` virtual filesystem. Nothing else on the machine is reachable.
- **Builtin tools** - `bash`, `read`, `write`, `edit`, `grep`, `glob`, `ls`, executed by the adapter inside the sandbox.
- **Host tools** - five simulated tools executed by the application, returned to the model through `submitToolResult`.
- **Skills** - `SKILL.md` bundles materialized into the sandbox `$HOME`, which the model reads on demand.

## Quick start

```bash
cd vp-projects/demos/ai-sdk-harness-demo
pnpm install
cp .env.example .env      # then put your real key in MY_DS
pnpm start -- --folder ./workspace
```

`--folder` is created if it does not exist yet. The API key is read from `process.env.MY_DS`. A `.env` file in this folder (or the current working directory) is loaded for any variable that is not already set, so exporting `MY_DS` in your shell works too.

One-shot mode runs a single turn and exits:

```bash
pnpm start -- --folder D:/code/my-app --prompt "add a /health endpoint and test it"
```

Pipe a whole conversation in:

```bash
printf 'list the folder\nadd a README\n/exit\n' | pnpm start -- --folder ./workspace
```

## Options

| Option | Meaning |
| --- | --- |
| `-f, --folder <path>` | Folder the agent may develop in. Default `./workspace`. |
| `-m, --model <id>` | DeepSeek model id. Default `deepseek-v4-flash`. |
| `-p, --prompt <text>` | Run one turn and exit instead of starting the REPL. |
| `--instructions <text>` | Extra instructions appended to the system prompt. |
| `--skills-dir <path>` | Directory of `<name>/SKILL.md` bundles. Default `./skills`. |
| `--max-steps <n>` | Model steps per turn. Default `24`. |
| `--reasoning` | Print reasoning deltas as well as text. |
| `--api-key-env <name>` | Env var holding the key. Default `MY_DS`. |

REPL commands: `/help`, `/tools`, `/skills`, `/reset`, `/exit`. `/reset` starts a fresh conversation and a fresh session; files already written stay on disk. `Ctrl-C` once aborts the running turn, twice exits.

## Architecture

```
index.ts  ->  HarnessAgent (@ai-sdk/harness)
                  |  instructions, skills, host tools, sandboxConfig
                  v
        createDeepSeekHarness  ->  HarnessV1 adapter (src/harness)
                  |  doStart / doPromptTurn / emit(HarnessV1StreamPart)
                  v
        DeepSeekHarnessSession
            |                       |
            | streamText loop       | builtin tools
            v                       v
   @ai-sdk/deepseek        just-bash sandbox session
                                     |
                        MountableFs(InMemoryFs)
                        + ReadWriteFs(root = your folder)
```

The adapter is **host-driven**: the model loop runs in this Node process and the sandbox is used purely as a remote filesystem and shell. There is no bridge process and no `getBootstrap()`, which is why an arbitrary AI SDK `LanguageModel` can back a `HarnessV1`. The published harness adapters (`harness-codex`, `harness-claude-code`, ...) each drive their own CLI and only accept a model *id*, not a model instance.

Per turn, `DeepSeekHarnessSession.driveTurn` emits `stream-start`, then for each step `text-*` / `reasoning-*` / `tool-input-*` / `tool-call` / `file-change` / `tool-result` / `finish-step`, and finally `finish` with the accumulated `totalUsage`. Host tools are emitted with `providerExecuted: false`; `HarnessAgent` runs them and calls `submitToolResult`. Builtin tools are emitted with `providerExecuted: true` and run in the sandbox.

Conversation history is the adapter's own lifecycle state (`lifecycleStateSchema`), so `doSuspendTurn` / `doContinueTurn` survive a restart by re-driving from the persisted messages.

## Sandbox

`src/sandbox/folder-sandbox.ts` builds a `just-bash` `Sandbox`:

- `MountableFs({ base: new InMemoryFs() })` - everything is in memory by default.
- `/workspace` is mounted as `ReadWriteFs({ root: <your folder> })` - the only path that touches real disk.
- `$HOME` is `/home/user`, in memory. Harness state and materialized skills live there, so they never pollute your project folder.
- Network is not configured, so `curl` and `fetch` are refused.

`resolveProjectPath` is the second boundary: `read`, `write`, `edit`, `grep`, `glob` and `ls` refuse any path that resolves outside the project root. Read-only tools additionally accept the skills directory, because skills are materialized under `$HOME` and the model has to be able to open them.

### The JavaScript runtime

`just-bash` ships a QuickJS (WebAssembly) interpreter behind its `javascript` option, but `Sandbox.create` does not forward that option. `src/sandbox/javascript-runtime.ts` works around it: a second `Bash` created with `javascript: true` shares the same `MountableFs`, and `js-exec` plus a `node` alias are registered on the sandbox shell via `defineCommand` and delegate to it. Scripts really execute, they only see the sandbox filesystem, and files they write appear on your disk immediately.

That matters because a coding agent that cannot run what it wrote cannot verify anything. QuickJS is not host Node.js, so `describeJavaScriptRuntime()` spells out the differences in the system prompt: ESM only for local imports, `require()` for built-ins only, no package manager, no TTY, 64 MB and 10 s per execution.

## Host tools (simulated)

`src/tools/mock-tools.ts` - `getCurrentTime`, `getWeather`, `searchKnowledgeBase`, `createIssue`, `deployPreview`. They run in this process, add a little fake latency, and derive their answers from a hash of the input so repeated calls are stable. Every result carries `simulated: true` (except `getCurrentTime`, which returns the real host clock and says so), and the system prompt tells the model to report simulated values as simulated.

## Skills

`skills/<name>/SKILL.md` with YAML frontmatter (`name`, `description`). Sibling files such as `references/style.md` are attached as `skill.files`. `loadSkillsFromDirectory` parses them, `HarnessAgent` passes them to the adapter, and `writeSkills` from `@ai-sdk/harness/utils` materializes them at `/home/user/.ai-sdk-harness/skills` before the first turn. The system prompt lists each skill with its path and instructs the model to `read` the `SKILL.md` when it is relevant - skills are not injected wholesale.

Shipped skills: `nodejs-cli-conventions` (entry point, argument parsing, output and dependency rules) and `verify-before-done` (the verification loop, including what this sandbox can and cannot run).

## Gotchas worth knowing

- **`HarnessV1ToolSpec.inputSchema` breaks `asSchema`.** The spec arrives as JSON Schema carrying a non-enumerable `~standard` marker with `vendor: 'zod'` but no `_zod`, so `asSchema()` routes it into the Zod v3 converter and throws `Cannot read properties of undefined (reading 'typeName')`. `toPlainJsonSchema()` copies the own enumerable keys and hands the result to `jsonSchema()` from `ai`.
- **`ai@7` rejects `role: 'system'` in `messages`.** The system prompt goes through `streamText({ instructions })`.
- **`ai@7` usage is flat.** `finish` carries `{ inputTokens, outputTokens, totalTokens }`, while the provider-level `LanguageModelV4Usage` is nested. The adapter converts in `toHarnessUsage`.
- **`readline/promises.question()` never settles on piped stdin.** The REPL queues `line` events instead (`readStdinLines`), so interactive and piped runs behave the same.
- **Notices overtake the stream.** `onNotice` is a direct callback, so it fires before the renderer has drained the parts already emitted. `ConsoleRenderer.queueNotice` holds them until the turn's `finish` part.
- **Tool output is a token budget.** Results are replayed into the model context on every following step, so `MAX_OUTPUT_CHARS` is 6000. Raising it multiplies per-turn cost.
- **`pnpm start -- --folder x` forwards the `--`.** pnpm does not strip the separator, so `parseArgs` ignores it.
- **`Sandbox.create` whitelists its options.** Passing `javascript: true` to `createJustBashNetworkSandboxSession` is silently dropped, which is why the QuickJS runtime is bridged in by hand.

## Limitations

- `doCompact()` and a JSON `responseFormat` throw `HarnessCapabilityUnsupportedError`; start a new session instead of compacting.
- `doSuspendTurn` / `doContinueTurn` re-drive from persisted messages, so an interrupted turn restarts rather than resuming mid-step.
- The sandbox exposes no ports, so bridge-backed harness adapters that need `getPortEndpoint` cannot use it.
- QuickJS has no `node_modules` resolution, so the agent cannot install or run third-party packages.
- History is unbounded within a session; long conversations grow the prompt until the provider rejects it.
- QuickJS swallows a literal `--help` in script arguments, has no `process.stdout` / `process.stderr`, and ignores `process.exitCode`. `describeJavaScriptRuntime()` puts all of this in the system prompt so the model plans around it instead of discovering it.
- A busy turn re-sends the whole history on every step, so a 20-step turn costs roughly 20x a single call. Lower `--max-steps` for cheap experiments.

## Layout

```
src/index.ts                     CLI entry, REPL, banner
src/cli.ts                       argument parsing, .env loading, usage text
src/console/renderer.ts          stream-part -> stdout, ANSI with TTY + NO_COLOR guard
src/sandbox/folder-sandbox.ts    folder-mounted just-bash sandbox
src/sandbox/javascript-runtime.ts QuickJS bridge (js-exec / node)
src/skills/load-skills.ts        SKILL.md frontmatter + sibling files
src/tools/mock-tools.ts          simulated host tools
src/harness/types.ts             harness id, lifecycle schema, notice types
src/harness/builtin-tools.ts     commonTool() specs for the sandbox tools
src/harness/execute-builtin-tool.ts  sandbox executors and path confinement
src/harness/system-prompt.ts     workspace / tools / skills / working-style prompt
src/harness/deepseek-session.ts  HarnessV1Session: the model loop
src/harness/deepseek-harness.ts  createDeepSeekHarness() -> HarnessV1
```

## Scripts

```bash
pnpm start -- [options]   # REPL
pnpm demo                 # REPL against ./workspace
pnpm oneshot              # single-turn example
pnpm typecheck            # tsc --noEmit
```