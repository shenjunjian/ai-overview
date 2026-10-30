# ai-sdk-harness-demo

一个基于 `@ai-sdk/harness` 中 `HarnessAgent` 的控制台编码 agent。你指定一个文件夹，然后通过对话在这个文件夹里做开发。模型走 `@ai-sdk/deepseek`，所有内容都打印到 stdout。不使用 `@ai-sdk/tui`，也没有 Web 界面。

它演示了一个 harness 真正有用的四件事：

- **沙箱** —— 你选定的文件夹被挂载进 `just-bash` 的虚拟文件系统，机器上的其它任何位置都不可达。
- **内置工具** —— `bash`、`read`、`write`、`edit`、`grep`、`glob`、`ls`，由 adapter 在沙箱内执行。
- **宿主工具** —— 五个模拟工具，由应用进程执行，再通过 `submitToolResult` 把结果回传给模型。
- **Skills** —— `SKILL.md` 指令包被物化到沙箱的 `$HOME`，由模型按需读取。

> **语言约定**：面向用户的控制台输出全部是中文 —— 启动横幅、`--help`、REPL 命令回显、工具调用的 `沙箱` / `宿主` 标签、`✎ 新建` 之类的文件变更、以及 `— 结束（…）` 的用量统计。面向模型的文本则保持英文 —— 系统提示词、工具描述、返回给模型的工具报错、`SKILL.md` 内容、以及 `describeJavaScriptRuntime()` 的运行时说明，以免削弱指令遵循效果。模型会按你提问所用的语言作答，所以用中文提问就会得到中文回复。

## 快速开始

```bash
cd vp-projects/demos/ai-sdk-harness-demo
pnpm install
cp .env.example .env      # 然后把真实 key 填进 MY_DS
pnpm start -- --folder ./workspace
```

`--folder` 指定的目录如果不存在会自动创建。API key 从 `process.env.MY_DS` 读取。本目录（或当前工作目录）下的 `.env` 会被加载，但只填充尚未设置的变量，所以直接在 shell 里 export `MY_DS` 同样有效。

一次性模式：跑完一轮对话就退出。

```bash
pnpm start -- --folder D:/code/my-app --prompt "add a /health endpoint and test it"
```

也可以把整段对话用管道喂进去：

```bash
printf 'list the folder\nadd a README\n/exit\n' | pnpm start -- --folder ./workspace
```

## 命令行选项

| 选项 | 说明 |
| --- | --- |
| `-f, --folder <path>` | 允许 agent 开发的文件夹，默认 `./workspace`。 |
| `-m, --model <id>` | DeepSeek 模型 id，默认 `deepseek-v4-flash`。 |
| `-p, --prompt <text>` | 只跑一轮然后退出，不进入 REPL。 |
| `--instructions <text>` | 追加到系统提示词末尾的额外指令。 |
| `--skills-dir <path>` | 存放 `<name>/SKILL.md` 指令包的目录，默认 `./skills`。 |
| `--max-steps <n>` | 每轮对话允许的模型步数，默认 `24`。 |
| `--reasoning` | 除正文外同时打印推理增量。 |
| `--api-key-env <name>` | 存放 key 的环境变量名，默认 `MY_DS`。 |

REPL 命令：`/help`、`/tools`、`/skills`、`/reset`、`/exit`。`/reset` 会开启全新对话和全新 session，但已经写到磁盘上的文件保持不变。`Ctrl-C` 按一次中断当前轮次，按两次退出程序。

## 架构

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

这个 adapter 是**宿主驱动（host-driven）**的：模型循环跑在当前 Node 进程里，沙箱只被当作远程文件系统和 shell 使用。没有 bridge 进程，也没有 `getBootstrap()`，这正是任意 AI SDK `LanguageModel` 能够支撑一个 `HarnessV1` 的原因。官方发布的那些 harness adapter（`harness-codex`、`harness-claude-code` 等）各自驱动自己的 CLI，只接受模型 *id*，不接受模型实例。

每一轮里，`DeepSeekHarnessSession.driveTurn` 先发出 `stream-start`；随后每一步依次发出 `text-*` / `reasoning-*` / `tool-input-*` / `tool-call` / `file-change` / `tool-result` / `finish-step`；最后发出带累计 `totalUsage` 的 `finish`。宿主工具以 `providerExecuted: false` 发出，由 `HarnessAgent` 执行并回调 `submitToolResult`；内置工具以 `providerExecuted: true` 发出，在沙箱内执行。

对话历史属于 adapter 自己的 lifecycle state（`lifecycleStateSchema`），因此 `doSuspendTurn` / `doContinueTurn` 能在进程重启后依据持久化的消息重新驱动。

## 沙箱

`src/sandbox/folder-sandbox.ts` 构建了一个 `just-bash` 的 `Sandbox`：

- `MountableFs({ base: new InMemoryFs() })` —— 默认一切都放在内存里。
- `/workspace` 以 `ReadWriteFs({ root: <你的文件夹> })` 挂载 —— 这是唯一会落到真实磁盘的路径。
- `$HOME` 是 `/home/user`，位于内存中。harness 状态和物化后的 skills 都放在这里，因此绝不会污染你的项目文件夹。
- 没有配置网络，所以 `curl` 和 `fetch` 都会被拒绝。

`resolveProjectPath` 是第二道边界：`read`、`write`、`edit`、`grep`、`glob`、`ls` 会拒绝任何解析到项目根目录之外的路径。只读工具额外允许访问 skills 目录，因为 skills 被物化在 `$HOME` 下，模型必须能打开它们。

### JavaScript 运行时

`just-bash` 自带一个由 QuickJS（WebAssembly）实现的解释器，藏在它的 `javascript` 选项后面，但 `Sandbox.create` 并不会转发这个选项。`src/sandbox/javascript-runtime.ts` 绕过了这一点：另建一个开启 `javascript: true` 的 `Bash`，让它共享同一个 `MountableFs`，然后用 `defineCommand` 在沙箱 shell 上注册 `js-exec` 以及别名 `node`，把调用委托过去。脚本是真正被执行的，它们只能看到沙箱文件系统，而它们写出的文件会立刻出现在你的磁盘上。

这一点很关键：一个不能运行自己所写代码的编码 agent，什么都验证不了。QuickJS 不是宿主的 Node.js，所以 `describeJavaScriptRuntime()` 会把两者的差异写进系统提示词：本地导入只能用 ESM、`require()` 仅支持内置模块、没有包管理器、没有 TTY、每次执行 64 MB 内存和 10 秒超时。

## 宿主工具（模拟）

`src/tools/mock-tools.ts` —— `getCurrentTime`、`getWeather`、`searchKnowledgeBase`、`createIssue`、`deployPreview`。它们运行在本进程中，会加一点假延迟，并根据输入的哈希值生成结果，因此重复调用是稳定的。除 `getCurrentTime` 返回真实宿主时钟并明确标注之外，每个结果都带 `simulated: true`；系统提示词也要求模型如实说明哪些数值是模拟的。

## Skills

`skills/<name>/SKILL.md`，带 YAML frontmatter（`name`、`description`）。同级的附属文件（例如 `references/style.md`）会作为 `skill.files` 一起挂载。`loadSkillsFromDirectory` 负责解析，`HarnessAgent` 把它们传给 adapter，再由 `@ai-sdk/harness/utils` 的 `writeSkills` 在第一轮对话之前物化到 `/home/user/.ai-sdk-harness/skills`。系统提示词会列出每个 skill 及其路径，并指示模型在相关时用 `read` 打开对应的 `SKILL.md` —— skills 不会被整体注入上下文。

自带的两个 skill：`nodejs-cli-conventions`（入口文件、参数解析、输出与依赖规范）和 `verify-before-done`（收尾前的验证循环，包含本沙箱能跑什么、不能跑什么）。

## 值得知道的坑

- **`HarnessV1ToolSpec.inputSchema` 会让 `asSchema` 崩溃。** 传进来的 JSON Schema 上挂着一个不可枚举的 `~standard` 标记，`vendor` 是 `'zod'` 却没有 `_zod`，于是 `asSchema()` 把它送进 Zod v3 转换器，抛出 `Cannot read properties of undefined (reading 'typeName')`。`toPlainJsonSchema()` 只拷贝自身可枚举属性，再把结果交给 `ai` 的 `jsonSchema()`。
- **`ai@7` 拒绝 `messages` 里的 `role: 'system'`。** 系统提示词必须走 `streamText({ instructions })`。
- **`ai@7` 的 usage 是扁平的。** `finish` 里是 `{ inputTokens, outputTokens, totalTokens }`，而 provider 层的 `LanguageModelV4Usage` 是嵌套结构，adapter 在 `toHarnessUsage` 中做转换。
- **`readline/promises.question()` 在管道 stdin 下永远不会 settle。** REPL 改为排队消费 `line` 事件（`readStdinLines`），交互式运行和管道运行行为一致。
- **通知会插到流前面。** `onNotice` 是直接回调，会在渲染器消费完已发出的 part 之前触发。`ConsoleRenderer.queueNotice` 把它们暂存到本轮的 `finish` part 之前再输出。
- **工具输出就是 token 预算。** 结果在后续每一步都会被重放进模型上下文，所以 `MAX_OUTPUT_CHARS` 定为 6000。调大它会让每轮成本成倍上升。
- **`pnpm start -- --folder x` 会把 `--` 一起传进来。** pnpm 不会剥掉这个分隔符，所以 `parseArgs` 直接忽略它。
- **`Sandbox.create` 对选项做了白名单。** 给 `createJustBashNetworkSandboxSession` 传 `javascript: true` 会被静默丢弃，这也是 QuickJS 运行时必须手工桥接的原因。

## 已知限制

- `doCompact()` 和 JSON 形式的 `responseFormat` 会抛出 `HarnessCapabilityUnsupportedError`；想清理上下文请新建 session。
- `doSuspendTurn` / `doContinueTurn` 是依据持久化消息重新驱动的，因此被中断的一轮会重头开始，而不是从中间某一步续跑。
- 沙箱不暴露端口，所以依赖 `getPortEndpoint` 的 bridge 型 harness adapter 无法使用它。
- QuickJS 没有 `node_modules` 解析能力，agent 无法安装或运行第三方包。
- 单个 session 内的历史没有上限，对话越长提示词越大，直到 provider 拒绝请求。
- QuickJS 会吞掉脚本参数里字面量的 `--help`，没有 `process.stdout` / `process.stderr`，也会忽略 `process.exitCode`。`describeJavaScriptRuntime()` 把这些都写进了系统提示词，让模型提前规避而不是逐个踩坑。
- 繁忙的一轮里，每一步都要重发完整历史，所以 20 步的一轮大约相当于单次调用的 20 倍开销。做低成本试验时请调小 `--max-steps`。

## 目录结构

```
src/index.ts                     CLI 入口、REPL、启动横幅
src/cli.ts                       参数解析、.env 加载、用法文本
src/console/renderer.ts          stream part -> stdout，ANSI 受 TTY 与 NO_COLOR 约束
src/sandbox/folder-sandbox.ts    挂载指定文件夹的 just-bash 沙箱
src/sandbox/javascript-runtime.ts QuickJS 桥接（js-exec / node）
src/skills/load-skills.ts        SKILL.md frontmatter 与附属文件解析
src/tools/mock-tools.ts          模拟的宿主工具
src/harness/types.ts             harness id、lifecycle schema、通知类型
src/harness/builtin-tools.ts     沙箱工具的 commonTool() 定义
src/harness/execute-builtin-tool.ts  沙箱执行器与路径限制
src/harness/system-prompt.ts     workspace / tools / skills / 工作风格提示词
src/harness/deepseek-session.ts  HarnessV1Session：模型循环
src/harness/deepseek-harness.ts  createDeepSeekHarness() -> HarnessV1
```

## 脚本

```bash
pnpm start -- [options]   # REPL
pnpm demo                 # 针对 ./workspace 启动 REPL
pnpm oneshot              # 单轮示例
pnpm typecheck            # tsc --noEmit
```