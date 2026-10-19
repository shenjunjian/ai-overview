# AI SDK 概念全景总结（v7）

> 依据官方文档三大板块逐主题整理：
> - Agents：<https://ai-sdk.dev/docs/agents/overview>
> - AI SDK Core：<https://ai-sdk.dev/docs/ai-sdk-core/overview>
> - AI SDK Harnesses：<https://ai-sdk.dev/docs/ai-sdk-harnesses/overview>
>
> 每个主题给出：定位 → 核心概念 → 关键 API/选项 → 机制与规则 → 注意事项。

---

## 目录

- **0. 总体心智模型**（分层表 + Agent 定义）
- **1. Agents 板块** —— `ToolLoopAgent` 及其生态
  - 1.1 Overview — Agent 的组成与选型
  - 1.2 Building Agents — `ToolLoopAgent` 完整用法
  - 1.3 Workflow Patterns — 结构化工作流（非 Agent 循环）
  - 1.4 Loop Control — `stopWhen` 与 `prepareStep`
  - 1.5 Configuring Call Options — 类型安全的调用选项
  - 1.6 Memory — 持久记忆
  - 1.7 Tool Approvals — 工具调用审批
  - 1.8 Policy-Based Tool Approvals — `@ai-sdk/policy-opa`
  - 1.9 Subagents — 子 Agent
  - 1.10 WorkflowAgent — 持久化、可续跑的 Agent
  - 1.11 Terminal UI — `@ai-sdk/tui`
- **2. AI SDK Core 板块**
  - 2.1 Generating Text — `generateText` / `streamText`
  - 2.2 Generating Structured Data — `Output` 家族
  - 2.3 Settings — 模型调用与请求选项
  - 2.4 Prompt Engineering — 提示词开发与调试
  - 2.5 Reasoning — 顶层 `reasoning` 参数
  - 2.6 Runtime and Tool Context — 两种上下文与遥测过滤
  - 2.7 Tool Calling — 工具调用与多步执行
  - 2.8 MCP 三件套（Tools / Apps / Events）
  - 2.9 Code Mode — 用沙箱 JS/TS 编排工具
  - 2.10 Tool Search — 按需发现工具
  - 2.11 Language Model Middleware
  - 2.12 Batch — 异步批处理
  - 2.13 Provider & Model Management
  - 2.14 Error Handling
  - 2.15 Testing — mock providers
  - 2.16 Embeddings
  - 2.17 Reranking
  - 2.18 Decisions — `experimental_decide`
  - 2.19 Image Generation
  - 2.20 Realtime — 实时语音对话
  - 2.21 Transcription / Translation / Speech
  - 2.22 Video Generation
  - 2.23 File Uploads 与 Skill Uploads
  - 2.24 Telemetry — OpenTelemetry 集成
  - 2.25 DevTools
  - 2.26 Lifecycle Callbacks
- **3. AI SDK Harnesses 板块**
  - 3.1 HarnessAgent
  - 3.2 Harness Tools
  - 3.3 Harness Skills
  - 3.4 Harness Adapters（含能力矩阵）
  - 3.5 Workflow Utilities — 把 harness 轮次跑成持久 workflow
  - 3.6 Harness UI（`useChat` 路由）
  - 3.7 Harness Terminal UI
  - 3.8 Harness Tools 逐节细节（3.2 的展开）
- **4. 选型速查**（决策表 + 贯穿全篇的硬规则）

---

## 0. 总体心智模型

AI SDK 由几条**互相解耦但原语兼容**的抽象层组成：

| 层 | 面向对象 | 核心入口 | 说明 |
| --- | --- | --- | --- |
| Provider / Model | 语言模型 | `createOpenAI` 等 provider 工厂、模型字符串 `"anthropic/claude-sonnet-5.5"` | 把各家模型暴露给 Core 函数 |
| AI SDK Core | 单次模型调用 | `generateText` / `streamText` / `Output` / `tool` | 标准化 prompt、settings、tool calling、结构化输出 |
| Agents | 自主循环 | `ToolLoopAgent`（`ai` 包）、`WorkflowAgent`（`@ai-sdk/workflow`） | 把「LLM + Tools + Loop」封装成可复用组件 |
| Harnesses | 现成 Agent 运行时 | `HarnessAgent` + harness adapter + sandbox provider + session | 直接跑 Claude Code / Codex / Pi 等完整 harness |
| UI / RSC | 前端交互 | `useChat`、`createAgentUIStreamResponse`、`toUIMessageStream`、`ChatTransport` | 消费统一的 UI 消息流原语 |

一句话区分两条 Agent 路线：

- **`ToolLoopAgent`**：你自己围绕语言模型搭循环（模型、工具、停止条件、上下文都由你配）。
- **`HarnessAgent`**：你跑一个**已经搭好循环**的成熟 harness（Claude Code、Codex、Pi），只在外层做指令/工具/权限/沙箱定制。

Agent 的本质定义：**Agent = 使用工具的大语言模型，在一个循环里完成任务**。三个部件：

- **LLM** — 处理输入并决定下一步动作。
- **Tools** — 扩展文本生成之外的能力（读文件、调 API、写数据库）。
- **Loop** — 编排执行，内部包含两个职责：
  - **Context management**：维护消息历史，决定每一步模型看到什么输入。
  - **Stopping conditions**：判断循环（任务）何时完成。

---

## 1. Agents 板块（`ToolLoopAgent` 及其生态）

### 1.1 Overview — Agent 的组成与选型

**定位**：给出 Agents 板块的顶层心智模型与三种抽象的选型入口。

**`ToolLoopAgent` 类**：把上面三个部件收拢到一个类里。

```ts
import { ToolLoopAgent, tool } from 'ai';
import { z } from 'zod';

const weatherAgent = new ToolLoopAgent({
  model: 'anthropic/claude-sonnet-5.5',
  tools: {
    weather: tool({ description, inputSchema: z.object({ location: z.string() }), execute: async ({ location }) => ... }),
    convertFahrenheitToCelsius: tool({ ... }),
  },
});

const result = await weatherAgent.generate({ prompt: 'What is the weather in San Francisco in celsius?' });
result.text;   // agent 的最终回答
result.steps;  // agent 走过的步骤
```

该 agent 自动完成「调 `weather` → 调 `convertFahrenheitToCelsius` → 生成最终文本」的多步链路；循环、上下文管理、停止条件全部由 `ToolLoopAgent` 代管。

**为什么推荐 `ToolLoopAgent`**：减少样板（托管循环与 messages 数组）、提升复用（定义一次全应用使用）、便于维护（单点更新配置）。**需要显式控制每一步的复杂结构化工作流**时，才下沉到 core 函数 `generateText` / `streamText`。

**`HarnessAgent` 类**：当你要跑的是**预配置好的成熟 harness**（Claude Code、Codex、Pi）而不是自己搭循环时使用。Harness 是与 provider、model **不同层**的抽象，但输出仍流入 AI SDK 兼容的 result 与 UI 原语。

**Agent State 与 Context（重要）**：Agent 常需要**不该直接塞进 prompt** 的服务端状态 —— tenant 配置、request ID、feature flag、凭据、任务进度。

- `runtimeContext`：Agent 的**共享运行时状态**。贯穿整个 agent loop，可在 `prepareStep` 与生命周期回调中读取，并可在步骤之间更新。
- `toolsContext`：**按工具粒度**的值（API key、作用域权限）。每个工具只拿到依据自身 `contextSchema` 校验过的、属于自己那一份类型化 context。

**Terminal UI**：`@ai-sdk/tui` 可在交互式终端里跑 `ToolLoopAgent`（见 1.11）。

```ts
import { runAgentTUI } from '@ai-sdk/tui';
await runAgentTUI({ title: 'Weather Agent', agent: weatherAgent });
```

**Structured Workflows**：Agent 灵活但**非确定性**。需要可靠、可重复、显式控制流时，用 core 函数 + 结构化工作流模式组合：条件分支、普通函数复用、错误处理、显式流程控制（见 1.3）。

---

### 1.2 Building Agents — `ToolLoopAgent` 完整用法

**定位**：把 LLM 配置、工具、行为封装成可复用组件的完整指南。核心价值：**Reuse configurations / Maintain consistency / Simplify API routes / Type safety**。

**构造函数选项**（`ToolLoopAgent` 接受与 `generateText`、`streamText` **完全相同**的设置集）：

`model`、`instructions`、`tools`、`runtimeContext`、`toolsContext`、`prepareStep`、`stopWhen`、`toolChoice`、`output`、`toolApproval`、`experimental_sandbox`、`callOptionsSchema`、`prepareCall`，以及全部生命周期回调。

**工具定义**：`tool({ description, inputSchema, contextSchema, execute })`；`execute` 签名为 `execute(input, { context, abortSignal, experimental_sandbox })`。

**三种使用方式**：

1. `agent.generate({ prompt })` → `result.text` — 一次性生成。
2. `agent.stream({ prompt })` → `result.textStream`（`for await` 迭代）— 流式。
3. `createAgentUIStreamResponse({ agent, uiMessages })` — 在 API route 中产出 UI 消息流，供客户端 `useChat` 消费。

**System Instructions（`instructions`）**：定义 Agent 行为、人格与约束，为所有交互设定语境。文档给出五类写法：基础角色设定、详细行为准则、约束边界、工具使用指引、格式与风格控制。

**Loop Control 默认行为（关键规则）**：默认 `stopWhen: isStepCount(20)`。每一步模型**要么生成文本，要么调用工具**；生成文本即完成，调用工具则执行后触发新一轮生成。循环终止于以下四者之一：

1. 返回**非 `tool-calls`** 的 finish reason；
2. 被调用的工具**没有 `execute`** 函数；
3. 某次工具调用**需要审批**；
4. **命中停止条件**。

**`toolChoice` 取值**：`'none' | 'auto' | 'required' | { type: 'tool', toolName }`（最后一项可强制指定某个工具）。

**Structured Output**：`output: Output.object({ schema })`，结果取 `result.output`。

**生命周期回调（6 个，顺序固定）**：

| 回调 | 触发时机 | 收到的数据 |
| --- | --- | --- |
| `onStart` | 操作开始时、任何 LLM 调用之前（仅一次） | model 信息（含 `modelId`）、messages、settings、`runtimeContext` |
| `onStepStart` | 每一步（每次 LLM 调用）之前 | `stepNumber`、model、将要发送的 messages、tools、此前各步 |
| `onToolExecutionStart` | 工具 `execute` 运行前一刻 | `toolCall` 对象、messages、`toolContext` |
| `onToolExecutionEnd` | 工具 `execute` 完成或报错后 | `toolCall`、`toolExecutionMs`、`toolOutput` 判别联合（`type: 'tool-result'` 带 `output` / `type: 'tool-error'` 带 `error`） |
| `onStepEnd` | 每一步结束 | `usage.inputTokens/outputTokens`、`performance.effectiveOutputTokensPerSecond`、`performance.stepTimeMs`、`finishReason`、`toolCalls` |
| `onEnd` | 全部步骤完成、响应结束 | 所有 `steps`、总 `usage`、`runtimeContext` |

**构造级 vs 调用级回调**：所有回调**既可写在构造函数**（agent 全局追踪）**也可写在 `generate()`/`stream()`**（单次调用追踪），两者可同时存在 —— 都会执行，**先构造级、后调用级**。`ToolLoopAgent` 与 core 使用**同一批 generation lifecycle 事件类型**（见 2.32）。

**端到端类型安全**：`type MyAgentUIMessage = InferAgentUIMessage<typeof myAgent>`，客户端 `useChat<MyAgentUIMessage>()` 直接复用。

**注意事项**：

- `prepareStep` 返回的模型调用参数（如 `temperature`）**只作用于当前步**，后续步骤回落到 agent 顶层设置。
- `experimental_sandbox` 是 **per-call 值**，必须传给 `generate()` / `stream()` / UI stream helper。
- sandbox 的 `description` **不会自动进入 prompt**，需要模型了解环境时得自己写进 instructions。
- **传入 sandbox ≠ 工具被沙箱化**：工具必须显式把操作委派给 `experimental_sandbox.run(...)`。
- 每个工具的服务端凭据走 `toolsContext` + `contextSchema`，不要用顶层字段。

---

### 1.3 Workflow Patterns — 结构化工作流（非 Agent 循环）

**定位**：用 core 函数搭**确定性、可重复**的流程，替代自由 Agent 循环；模式源自 Anthropic《Building Effective Agents》。

**五种可组合模式**：

1. **Sequential Processing (Chains)** — 上一步输出拼进下一步 prompt，并在链中插入一次 LLM 质检调用，用布尔/阈值决定是否重生成。
2. **Routing** — 第一次调用只做**分类**（结构化输出），再用分类结果**选取第二次调用的 model 与 instructions**。
3. **Parallel Processing** — 同一输入分派给多个「专家角色」并发评审（`Promise.all`），再用**另一次**模型调用聚合成摘要。
4. **Orchestrator-Worker** — 编排者产出文件清单计划，`Promise.all` 按 `changeType` 派生 worker 提示词执行。
5. **Evaluator-Optimizer（反馈循环）** — `while (iterations < MAX_ITERATIONS)`，评估结构化输出达标则 `break`，否则带着 `specificIssues` / `improvementSuggestions` 重生成。

**选型四维**：Flexibility vs Control、Error Tolerance、Cost Considerations、Maintenance。

**涉及的 API**：`generateText({ model, prompt, instructions, output })`、`Output.object({ schema: z.object({...}) })`、解构 `const { text } = ...` / `const { output } = ...`、`Promise.all`。分类字段用 zod 枚举承载，例如 `type: z.enum(['general','refund','technical'])`、`complexity: z.enum(['simple','complex'])`、`changeType: z.enum(['create','modify','delete'])`、`riskLevel`/`impact: z.enum(['low','medium','high'])`、`qualityScore: z.number().min(1).max(10)`。

**示例取值**：`"anthropic/claude-sonnet-5.5"`；简单任务 `'openai/gpt-6-luna'`、复杂任务 `'openai/gpt-6-astra'`；手写循环上限 `MAX_ITERATIONS = 3`；达标判据示例 `qualityScore >= 8 && preservesTone && preservesNuance && culturallyAccurate`。

**注意事项**：

- **从最简方案开始**，复杂度只应因四件事引入：拆清晰步骤、加工具、加质检反馈、最后才多 Agent。层级越多 → LLM 调用数与成本越高、调试越难。
- 评估类步骤一定要用 `Output.object` 拿到**可比对的数值/布尔字段**，而不是解析自由文本。
- 每个自写循环都要**自己设死迭代上限**，否则成本失控。

---

### 1.4 Loop Control — `stopWhen` 与 `prepareStep`

**定位**：精细控制 Agent 循环「何时停」与「每步怎么跑」的两个参数。

#### `stopWhen`（停止条件）

控制「最后一步存在工具结果时」是否继续执行。

- 内置条件（三个）：
  - `isStepCount(count)` — 跑满指定步数后停止。
  - `hasToolCall(...toolNames)` — 调用其中**任意一个**工具即停止。
  - `isLoopFinished()` — **永不触发**，让循环跑到自然结束。
- `ToolLoopAgent` 默认 `isStepCount(20)`，这是**防止跑飞导致超额 API 费用**的安全措施。
- **若因该默认上限被截断，SDK 会打 warning 并提示配置 `stopWhen`；显式设置 `stopWhen`（即使仍是 `isStepCount(20)`）就不会产生该 warning。**
- **`WorkflowAgent` 不套用默认步数上限**，需要自己配 `isStepCount(20)`。
- 传**数组**时，**任一条件命中即停止**。
- 自定义条件类型 `StopCondition<typeof tools>`，签名 `({ steps }) => boolean`，可基于全步骤信息判断，例：`steps.some(s => s.text?.includes('ANSWER:'))`，或累加 `step.usage.inputTokens / outputTokens` 估算成本、超 $0.50 就停。

#### `prepareStep`（逐步改写）

在**每一步之前**运行；不返回任何改动则沿用初始设置。

**入参**：`model`、`stepNumber`（**0-based**）、`steps`（历史各步的 `toolCalls`/`toolResults`/`text`/`usage`）、`messages`、`initialMessages`、`responseMessages`、`runtimeContext`。

**可返回覆盖项**：`model`、`instructions`、`messages`、`activeTools`、`toolChoice`、`experimental_sandbox`，以及模型调用设置 `maxOutputTokens`、`temperature`、`topP`、`topK`、`presencePenalty`、`frequencyPenalty`、`stopSequences`、`seed`、`reasoning`。

**规则**：

- 这些模型调用覆盖**只作用于当前步**；省略或 `undefined` → 用顶层值。
- **显式假值会被保留**（`temperature: 0`、`seed: 0`、空 `stopSequences` 数组）。
- 返回的 `messages` 覆盖会**持久成为后续步骤的基础**，新的 assistant/tool 响应消息追加其后。若要从离散片段重建，用 `initialMessages`（原始输入）与 `responseMessages`（已累积的模型/工具响应）。
- 用途：动态模型选择、上下文压缩（compaction）、按阶段收窄 `activeTools`、消息改写、逐步切换 sandbox。

**`pruneMessages` 辅助函数**（内置裁剪，适合简单压缩）：

```ts
pruneMessages({ messages, reasoning: 'all', toolCalls: 'before-last-3-messages', emptyMessages: 'remove' })
```

**`prepareStep` 返回 `experimental_sandbox` 的特殊性**：**仅作用于该步的工具执行**，后续步骤回落顶层 —— 这一点与 `runtimeContext`/`toolsContext` 的行为不同。

#### Forced Tool Calling（强制工具调用范式）

`toolChoice: 'required'` + 一个**没有 `execute`** 的 `done` 工具：

- `toolChoice: 'required'` 强制模型每步都调工具而非直接生成文本 → 保证结构化流程。
- 无 `execute` 的 `done` 工具充当**终止信号**，调用它即停循环。
- 最终答案从 **`result.staticToolCalls[0].input.answer`** 取（`staticToolCalls` = **未被执行**的 tool calls）。

#### Manual Loop Control

用 core 函数自己写循环以获得完全控制：

```ts
while (step < maxSteps) {
  const result = await generateText({ model, messages, tools });
  messages.push(...result.responseMessages);
  if (result.text) break;
  step++;
}
```

可完全掌控：消息历史管理、逐步决策、自定义停止条件、动态工具与模型选择、错误处理与恢复。

**注意事项**：`isLoopFinished()` 有无限运行/烧钱风险；分阶段限工具靠 `activeTools` + `toolChoice: 'required'` 组合；压缩时机由自己决定（示例用 `JSON.stringify(messages).length / 4` 粗估 token，阈值 `100_000`）；同一套 `prepareStep` 压缩写法也适用于 `generateText` / `streamText`。

---

### 1.5 Configuring Call Options — 类型安全的调用选项

**定位**：让**同一段 Agent 定义**在每次调用时接收类型安全的结构化输入，从而动态改写任意 Agent 设置；免去为不同场景创建多个 Agent，或在 Agent 外另做配置逻辑。

**两个新选项**：

- `callOptionsSchema`（zod schema）：声明每次调用的参数形状，例如
  `z.object({ userId: z.string(), accountType: z.enum(['free','pro','enterprise']) })`。
- `prepareCall: ({ options, ...settings }) => ({ ...settings, /* 覆盖项 */ })`：**循环开始前调用一次**，可以是 async。

**三步流程**：定义 schema → `prepareCall` 用 `options` 生成设置 → 调用时传 `options`：

```ts
agent.generate({ prompt, options: { userId, accountType } });
agent.stream({ prompt, options: { ... } });
createAgentUIStreamResponse({ agent, messages, options: { userId, accountType } });
```

**可改写项**（文档中出现）：`instructions`、`model`、`tools`、`activeTools`、`providerOptions`，以及其余任意 agent 设置。

**典型用法**：

- 按 `complexity` 切模型：`simple → 'openai/gpt-6-luna'`，`complex → 'openai/gpt-6-astra'`。
- 按 `taskDifficulty`（`low|medium|high`）喂 `providerOptions.openai.reasoningEffort`，并用 `satisfies OpenAILanguageModelResponsesOptions`（来自 `@ai-sdk/openai`）保持类型。
- 动态启用 provider 自带工具：`openai.tools.webSearch({ searchContextSize: 'low', userLocation: { type: 'approximate', city, region, country } })`。
- 按 `userRole` 收窄工具面：admin 得 `['readDatabase','writeDatabase']`，普通用户仅 `['readDatabase']`，同时改写 `model` 与 `instructions`。
- RAG：`prepareCall` 内先 `vectorSearch` 再把检索结果拼进 `instructions`。

**注意事项与坑**：

- 一旦声明 `callOptionsSchema`，`options` 变为**必填且受类型检查**，漏传或类型错误直接 TS 报错。
- **`prepareCall` 的返回对象会替换调用设置**，因此必须先展开 `...settings` 再覆盖个别字段，否则其余配置全部丢失 —— 这是最常见错误。
- 「不升级」分支用 `settings.model` 以保留默认。
- `createAgentUIStreamResponse` 在本文用 `messages` 字段、Building Agents 用 `uiMessages`，两处示例字段名不一致，落地前按当前版本参考页确认。
- 权限裁剪要 `activeTools` + `instructions` 双管，别只靠提示词。

---

### 1.6 Memory — 持久记忆

**定位**：让 Agent 跨会话保存与召回信息，避免每次从零开始。三种路线及权衡：

| 方案 | Effort | Flexibility | Provider Lock-in |
| --- | --- | --- | --- |
| Provider-Defined Tools | 低 | 中 | 是 |
| Memory Providers | 低 | 低 | 取决于记忆服务 |
| Custom Tool | 高 | 高 | 否 |

**Provider-Defined Tools**：provider 定义 `inputSchema` 与 `description`，你只提供 `execute`。模型已被训练适配这些工具，性能通常优于自定义工具。

- **Anthropic Memory Tool**：`anthropic.tools.memory_20250818({ execute })`。工具接收结构化命令 **`view` / `create` / `str_replace` / `insert` / `delete` / `rename`**，每个命令的 `path` 限定在 `/memories` 下；`execute` 把命令映射到你的存储后端（文件系统/数据库），返回字符串。示例模型 `'anthropic/claude-haiku-5.5'`。**只对 Claude 有效（硬锁定）**。

**Memory Providers**（记忆存/取/注入全透明，你不定义任何工具）：

- **Letta**（包 `@letta-ai/vercel-ai-sdk-provider`）：`lettaCloud()` 作 model；`providerOptions: { letta: { agent: { id } } }`；内置记忆工具工厂 `lettaCloud.tool(name)`，名称 **`core_memory_append`、`memory_insert`、`memory_replace`**；平台侧负责 core / archival / recall memory，可云或自托管。
- **Mem0**（包 `@mem0/vercel-ai-provider`）：`createMem0({ provider, mem0ApiKey, apiKey })`；`model: mem0('gpt-6-astra', { user_id })`；显式记忆 API `addMemories(messages, { user_id })`、`retrieveMemories(prompt, { user_id })`；跨 OpenAI / Anthropic / Google / Groq / Cohere。
- **Supermemory**（包 `@supermemory/tools`，入口 `/ai-sdk`）：`tools: supermemoryTools(process.env.SUPERMEMORY_API_KEY!)`；暴露 `addMemory`、`searchMemories`，靠语义检索；可与任意 AI SDK provider 搭配。
- **Hindsight**（包 `@vectorize-io/hindsight-ai-sdk` + `@vectorize-io/hindsight-client`）：`new HindsightClient({ baseUrl })`；`createHindsightTools({ client, bankId })`；五个工具 **`retain`、`recall`、`reflect`、`getMentalModel`、`getDocument`**；可 Docker 自托管或云。`bankId` 是记忆库标识（通常是 user id）；多用户场景必须在**请求处理函数内**调用 `createHindsightTools`，保证每请求对应正确的 bank。
- **MongoDB**（包 `@mongodb-developer/vercel-ai-memory`）：`createMongoDBMemory({ uri, embedder })`（如 `embedder: openai.embedding('text-embedding-3-small')`）；`tools: mongodbMemory({ userId, sessionId })`；`stopWhen: isLoopFinished()`。**五层记忆：Session、Semantic、Procedural、Episodic、Scratchpad**；Atlas Vector Search + 自动建索引 + 按类型的 retention policy；peerDependencies `ai ^6.0.0`、`mongodb ^6.0.0`、`zod ^3.0.0`。

  - **Session 记忆两种模式**：**tool-driven**（LLM 自主决定读写，适合原型）与 **hook-driven**（运行时靠 `prepareCall` + `onEnd` 钩子每轮强制持久化，**生产推荐**）。其余四层（semantic / procedural / episodic / scratchpad）**始终由 LLM 控制且默认选择性写入**。

**Custom Tool**（最灵活、无锁定）两种范式：

- **Structured actions**：自定义 `view` / `create` / `update` / `search` 等显式操作，每个操作自控，**天然安全**。
- **Bash-backed**：给模型沙箱 bash，用 `cat` / `grep` / `sed` / `echo` 组合访问。**能力强但必须做命令校验**（参考配方含 AST 校验 + 文件系统持久化）。

**注意事项**：memory provider 由服务方掌控记忆行为，**对「存了什么、怎么检索」可见度低**，且引入外部服务依赖。MongoDB 集成面向 AI SDK v6（依赖 `ModelMessage`、`ToolLoopAgent`、`isLoopFinished()`），且 `createMongoDBMemory` 应在模块/服务级**只创建一次**，按请求只做 `{userId, sessionId}` 作用域。记忆工具若需先读后写，默认 `isStepCount(20)` 可能提前截断，示例改用 `isLoopFinished()`。Bash-backed 不做命令校验即为安全漏洞。

---

### 1.7 Tool Approvals — 工具调用审批

**定位**：默认情况下，**带 `execute` 的工具在模型调用时自动执行**。`toolApproval`（配在 `ToolLoopAgent` 上，也可配在 `generateText`/`streamText`）让你在**执行前**审查、批准或拒绝特定工具调用。适用于会**改数据、花钱、执行代码、发消息、访问私有数据**等敏感操作的工具。

> `toolApproval` **只作用于 AI SDK 执行的工具**；provider-executed tools 在 provider 侧运行，**不走 AI SDK 的审批机制**。

**四种审批状态**（审批规则返回其中之一，可以是字符串，也可以是带 `type` 字段的对象）：

| 状态 | 含义 |
| --- | --- |
| `'not-applicable'` | 正常执行，不带审批元数据（**默认**） |
| `'approved'` | 记录一次自动批准，然后执行工具 |
| `'denied'` | 记录一次自动拒绝，返回 denied 的工具输出 |
| `'user-approval'` | 发出审批请求，**等待显式响应** |

自动批准/拒绝时，若要附带理由，用**对象形式**。审批函数返回 `undefined` 视同 `'not-applicable'`。

**三种配置形态**：

1. **按工具映射**（每工具一条简单策略）：`toolApproval: { runCommand: 'user-approval' }`。当 `runCommand` 被调用，agent 返回 `tool-approval-request` 而**不执行**该工具。
2. **按工具输入的函数**：决策依赖解析后的工具入参。函数收到**类型化 input** 加 `toolCallId`、`messages`、`toolContext`、`runtimeContext`。示例：非 admin 自动拒绝、大额支付人工审批、小额 admin 支付正常执行。
3. **一个函数管全部工具（`GenericToolApprovalFunction`）**：把函数直接作为 `toolApproval` 传入。收到：
   - `toolCall` — 完整调用（`toolName`、`toolCallId`、`input`、是否 dynamic）
   - `tools` — 模型可用的全部工具
   - `toolsContext` — 所有工具的上下文
   - `messages` — 产生该工具调用的那一步发给模型的 messages
   - `runtimeContext` — 本次调用共享的运行时上下文

**按请求配置**：`toolApproval` 是 agent 设置，因此**也可以从 `prepareCall` 返回** —— 适合审批策略依赖 call options、租户策略或用户权限的场景。

**人工审批的完整流程（需要两次调用）**：

1. 带 `toolApproval` 调 `agent.generate()` / `agent.stream()`；
2. 从结果或 UI 流中读出 `tool-approval-request`；
3. 向用户或审批系统征求决定；
4. 往 messages 里追加 `tool-approval-response`；
5. 用更新后的 messages 再调一次 agent。

批准 → 工具在第二次调用中执行；拒绝 → 模型收到拒绝结果，可在**无工具输出**的情况下继续回应。建议在 instructions 里加一句「工具执行未获批准时不要重试」，避免对同一动作反复发审批请求。

**与 `useChat` 集成**：审批请求以 `state: 'approval-requested'` 的 tool part 出现在流里，客户端用 **`addToolApprovalResponse`** 回应。**只对人工审批调用它** —— 自动批准/拒绝的状态已包含在流中。带理由的人工审批可从 `part.approval.requestReason` 读取；通过 `addToolApprovalResponse` 提供的理由单独存为 `part.approval.reason`。

**Schema 变换与持久化审批**：当审批所依据的输入与 schema 原始输入不同时，审批请求会把**原始 schema 输入保留在 `inputSchemaInput`**。持久化 `responseMessages` 或 UI 消息时**必须保留该字段**（UI 消息转换函数会自动保留）。续跑时 SDK 会重建变换后的输入并校验它与被批准的输入一致，**绝不**用不同值替换已批准的值。若旧历史/投影历史缺少原始输入、且重新校验失败或会改变批准值，则被判为**非法工具输入**而拒绝。原始输入会进入持久化消息与 UI 审批流，**包括被 schema 变换删掉的字段** —— 变换删字段≠从审批元数据中脱敏。

**安全模型（务必读）**：标准 `useChat` 模式下，服务端每轮**根据客户端发来的消息重建对话**，不在请求之间持久化会话状态 → **消息历史是客户端可控输入**。从该历史重建的审批虽然会重新校验（工具入参过 schema、审批策略重新求值），但**没有额外保护时，客户端可以伪造一个「看起来合法」的审批绕过人工环节**。若工具做敏感操作，用 **`experimental_toolApprovalSecret`** 把审批**密码学绑定到签发它的服务端**。

**`experimental_toolApprovalSecret` 行为**：

- 提供服务端密钥后，服务器在**签发时对每条审批请求做 HMAC 签名**，审批被重放时**验签**；伪造或被篡改的审批在工具执行前被拒绝。
- 签名绑定**精确的工具名、tool call ID 与输入参数**，三者任一改动即失效。
- 配置方式：给 `ToolLoopAgent`（或直接给 `generateText` / `streamText`）传 `experimental_toolApprovalSecret`。
- 密钥准备：`openssl rand -base64 32` 生成高熵串（≥32 字节）→ 存进环境变量（如 `TOOL_APPROVAL_SECRET`）→ 让**所有服务端实例**共享。
- 行为要点：**无有效签名的审批请求一律拒绝（fail-closed）**；未配置密钥则与既往行为一致（向后兼容）；密钥**永不**发给客户端、**永不**出现在流里。
- `WorkflowAgent` 也支持它，在 workflow step 内签名后再写入持久化审批请求；应传**环境变量引用**（`{ environmentVariable: 'TOOL_APPROVAL_SECRET' }`），使原始密钥只在签名/验签步骤内读取；**只有签名**被持久化并送到客户端。

**关联 API 边界**：`toolApproval` 适用于 `ToolLoopAgent`、`generateText`、`streamText`；`@ai-sdk/policy-opa` 把规则写成代码策略（见 1.8）；`needsApproval` **只用于 `WorkflowAgent`**（审批会挂起并续跑持久化 workflow）；**subagent 工具不能用 `toolApproval`**（见 1.9）。

---

### 1.8 Policy-Based Tool Approvals — `@ai-sdk/policy-opa`

**定位**：把 `toolApproval` 里的判断从代码搬到 **[OPA](https://www.openpolicyagent.org/) 的 `.rego` 策略**里。收益：策略是可单独评审的产物、可在 CI 用 `opa test` 独立测试、可在不重新部署代码的情况下修改（由运行中的 OPA 提供时）。

**它完全建立在公开 `toolApproval` 回调之上，线上协议不变**：仍然是同样的 `tool-approval-request` / `tool-approval-response` 流程。

**可 enforcement 的类别**：安全与访问（scope、角色、权限、租户隔离、工具/主机/路径 allowlist）；业务规则（谁能在什么条件下对哪些资源做什么，例如超阈值支付需审批）；成本与用量（超预算、token 上限、每用户配额则拒绝或要求审批）；合规与变更控制（破坏性或受监管动作绑定到正确的审批人/环境/时间窗）。

**策略输入不止当前调用参数**：`input` 还携带 `messages`（本次运行的完整模型与工具调用历史），因此规则可以依赖「已经发生过什么」：先前工具调用、动作序列、跨对话累计值。例如：已执行 N 次写入后要求审批；同一对话中的第二个不可逆动作（push、delete）直接拒绝；跨步骤累计花费/ token 到顶即停。

**最佳适配：确定性检查** —— 策略从字段里取值比较，答案每次相同。强适配：scope、权限、数值阈值、allowlist、时间窗，以及计数/序列/累计值等历史感知检查。**弱适配**：基于内容或语义的过滤（"不要用脏话"、"拦截毒性内容"）—— 这类尽力而为、难验证、易绕过，应交给专门的 moderation/classification 步骤，策略只做其外围的确定性闸门。**经验法则**：若能指着 `input` 里某个字段写出精确检查，就用策略；若规则依赖判断自由文本语义，不要只靠策略。

**决策映射（每次工具派发前咨询）**：

| 策略决策 | 效果 |
| --- | --- |
| `allow` | 执行工具 |
| `deny` | 返回模型可读的 denied 结果（无需人工） |
| `requires-approval` | 挂起运行，等待人工 `tool-approval-response` |
| 无规则命中 | 归一化为 `not-applicable`，SDK 视为 allow。想默认拒绝请在策略里写 `default decision := { "decision": "deny" }` |

**Rego 与输入形状**：策略输出 decision 对象；`reason` 可选，会回灌给模型（`deny`）或人工审批者（`requires-approval`）—— 在 core 结果里暴露为 `reason`，在 UI 消息里暴露为 `approval.requestReason`。兼容旧的布尔形状 `{ "allow": true | false, "reason": "..." }`，存量规则无需重写。默认 `input` 形状是 `{ tool: { name }, args, messages, runtimeContext }`，可用 `toInput` 覆写。测试：`opa test policy.rego policy_test.rego`（无需 SDK）。

**错误一律 fail closed**：后端出错（服务不可达、WASM 故障、bundle 构建错误）→ `opaPolicy` 返回 `denied`，并把错误信息作为 reason；后端返回了但决策无法识别（未知 `decision` 值、非布尔的旧 `allow`）→ 同样 `denied`。错误**永不**从回调抛出、**永不**中止运行。后端宕机会**阻塞**受影响的调用而不是静默放行。注意这与「规则未命中」不同：`null`/`undefined` 归一化为 `not-applicable`（放行）；要让未命中也拒绝，就写 `default ... deny` 规则。

**两种策略加载方式**：

- **Option A：WASM（进程内）** —— 提前把 `.rego` 编译成 WASM，`wasmPolicyClient({ wasm, data? })`（async，进程内加载）。每次决策**无网络调用**；适合与 app 一起发布策略或启动时从对象存储拉取；热更新需重建 WASM 并重新实例化。
- **Option B：HTTP（运行中的 OPA server）** —— `httpPolicyClient({ url, headers? })`（sync）。每次决策一次 HTTP 往返；适合策略频繁变更、想不重新部署就热加载，或多个服务共用一个 OPA。传 `headers` 做 Styra DAS / EOPA 鉴权。

**外部数据与集成**：策略可基于角色→权限映射、IDP 组成员、entitlement 列表、allowlist 等外部数据决策，且这些数据可无需重新部署你的 app 地更新。数据如何进入 OPA 是 OPA 的事：`data`（`wasmPolicyClient({ wasm, data })` 交给 bundle 的 `setData`，策略以 `data.*` 读取）、bundle（HTTP 后端的 OPA server 指向 bundle 服务定期拉取新策略与数据）、求值时外部查找（策略在评估过程中回调外部服务）。本包只负责把最终决策映射成 SDK 的审批状态。

**Shadow mode 安全上线**：第一版策略几乎总会误杀。`shadow(approval, opts)` 会**评估并通过 `onDecision` 上报决策，但在 `enforce: true` 之前告诉 SDK 一切批准**。推荐流程：写策略 + `opa test` → 用 `shadow(...)`（`enforce: false` 为默认）包住并把 `onDecision` 接到日志/指标 → 在真实环境跑，检查 `decision.type` 为 `denied` / `user-approval` 的事件（就是策略本会改变行为的调用）→ 修策略迭代 → 只剩你想要的 denied/user-approval 事件时设 `enforce: true`。**遥测语义**：`onDecision` 是 fire-and-forget，慢或抛错的 logger 不会阻塞或破坏 enforcement，抛出的错误被吞；契约是**enforcement 优先、observability 其次**。若要反过来（enforcement 等审计日志），直接在底层 `toolApproval` 里写日志而不是走 `shadow`。每条 `PolicyDecisionEvent` 带工具调用、策略 `decision`（type 与 reason）、`enforced`、`effective`（SDK 实际执行的动作）—— 对比 `decision` 与 `effective` 可发现漂移。用 HTTP 后端时 OPA 还能原生发 decision logs。

**模型边界的 capability scoping**：`opaCapabilityMiddleware({ client, path, toInput? })` 比 `toolApproval` **更早**执行策略 —— 在模型被告知某工具存在**之前**就把工具面收窄（纵深防御 + 省 token + 提升越狱拒绝率）。它是一个 `LanguageModelV4Middleware`，把 `params.tools` 收窄为 allowlist：`path` 处的规则返回允许的工具名 `string[]` 或 `{ tools: string[] }`；不在 allowlist 的工具在模型看到之前就被丢弃；**fail closed** —— 响应畸形或求值器出错时把 `params.tools` 置为 `undefined`（模型被告知自己没有工具），想 fail-open 请在 Rego 里写兜底。

**已发现工具面的收口**：工具来自 MCP discovery 或插件注册表时无法预先写每工具规则，且**漏写的工具会被静默放行**。`wrapMcpTools(tools, approval, opts?)` 把审批在**发现的整个工具集上变成全函数**，未覆盖的工具走可配置默认值：`'user-approval'`（默认，要求人工）、`'denied'`（硬 allowlist，策略列举允许项其余拒绝）、`'approved'`（放行，仅在来源完全可信时）。尽管叫 Mcp，它对任意 `Record<string, Tool>` 有效。

**无策略时全放行**：`optionalOpaPolicy({ client, path, toInput? })` 在 `client` 为 `undefined` 时返回 `undefined`，等价于没传 `toolApproval`（SDK 批准一切）。适合本地开发/CI：`POLICY_WASM_PATH` 未设 → 全放行且 OPA 模块根本不加载；设了 → 加载并 enforcement。想要更严格（没策略就拒绝启动）就直接用 `opaPolicy`，让缺失的字节在启动时抛错。

**传递式 enforcement（组合/派发工具）**：`toolApproval` **只在模型直接调用工具时触发**。粗粒度派发工具（能跑 `git push` 的 `bash` 工具、HTTP 工具、MCP proxy）会让模型**绕过单动作规则**。修复办法写在派发器自己的 `toolApproval` 条目里：把派发器输入解析成一个逻辑 `(name, args)` 对，再用与直接工具相同的规则评估。指导：匹配逻辑集中在**一处**（共享 Rego helper 规则，两边都带同一 `path` 调 `opaPolicy`；或共享 TypeScript 谓词）；**无法归约为干净调用的输入一律 deny**（shell 输入天生难解析，"证明不了安全"就等于拒绝）。**诚实的局限**：这只在模型的调用边界做闸门，**无法阻止**一个工具在获批后做出输入未描述的额外副作用 —— 那要靠带外沙箱（Vercel Sandbox、Firecracker、容器）承载不可信执行，把沙箱当信任边界。SQL/HTTP/MCP/browser/shell 派发器的完整示例见包 README；`ai-sdk-slackbot` 示例展示端到端接线（域名限定的 web search、城市 allowlist 的天气工具、只读命令 allowlist 的 bash 工具，用 `POLICY_MODE` 一个环境变量切换 WASM/HTTP 后端）。

**API 清单（全部从包根 `@ai-sdk/policy-opa` 导出）**：

- 引擎无关核心：`shadow(approval, opts?)`、`wrapMcpTools(tools, approval, opts?)`、`PolicyClient`（每个后端实现 `evaluate(path, input)`，也是接入非 OPA 引擎的缝隙）、辅助类型 `PolicyDecision`、`WrappedMcpTools`、`PolicyDecisionEvent`。
- OPA 后端与适配器：`wasmPolicyClient({ wasm, data? })`、`httpPolicyClient({ url, headers? })`、`opaPolicy({ client, path, toInput? })`（返回 `toolApproval` 配置，fail closed）、`optionalOpaPolicy({ client, path, toInput? })`、`opaCapabilityMiddleware({ client, path, toInput? })`、`normalizeOpaDecision(result)`（自己调 OPA 时可独立使用的结果归一化）。

---

### 1.9 Subagents — 子 Agent

**定位**：subagent 是**父 agent 可以调用的 agent**。父 agent 通过一个工具委派工作，子 agent 自主执行后返回结果。核心价值是把**上下文消耗巨大的任务**隔离出去，让主 agent 保持聚焦。

**工作流程**：① 用独立的 model / instructions / tools 定义子 agent；② 为主 agent 创建一个在 `execute` 里调用它的工具；③ 子 agent 在**自己的上下文窗口**内独立运行；④ 返回结果（可选地把进度流式送到 UI）；⑤ 用 `toModelOutput` 控制**模型实际看到什么**。

**何时用（权衡表）**：适合 —— 任务需要探索海量 token、需要并行做独立调研、上下文可能超出模型上限、想按能力隔离工具访问。不适合 —— 任务简单聚焦、顺序处理已足够、上下文仍在可控范围、所有工具可安全共存。

**三大动机**：

1. **卸载上下文密集任务** —— 起一个专用 agent 消耗数十万 token，只让它返回约 1000 token 的聚焦摘要，主 agent 上下文保持干净连贯（子 agent 干重活，主 agent 负责编排）。
2. **并行独立工作** —— 多个子 agent 同时调研代码库不同区域，各自返回摘要，主 agent 合成，而不用付出全部探索的上下文成本。
3. **专业化编排** —— 主 agent 纯做编排：只读工具的 exploration 子 agent、带文件编辑的 coding 子 agent、对接特定平台的 integration 子 agent，形成清晰职责分离（较少见，但合法）。

**基础用法（无流式）**：`execute` 里直接调另一个 agent，工具调用**阻塞**直到子 agent 完成，返回最终文本。

**取消处理**：用户取消时 `abortSignal` 会传播到子 agent，**务必透传**以保证清理。abort 后子 agent 停止执行并抛 `AbortError`，主 agent 的工具执行失败，从而停住主循环。为避免后续消息里出现「不完整的工具调用」报错，用 **`convertToModelMessages` 的 `ignoreIncompleteToolCalls`** 过滤掉没有对应结果的工具调用。

**流式子 Agent 进度（preliminary tool results）**：把 `execute` 从普通函数改成 **async generator（`async function*`）**，每个 `yield` 向前端发送一次**初步结果**。关键规则：**每次 `yield` 完整替换前一次输出（不是追加）**，所以需要一个不断增长的完整消息 —— 用 **`readUIMessageStream`** 读取流的每个 chunk，累积成一个包含到目前为止所有 parts 的 `UIMessage`。于是每次 yield 的 `message` 都是含子 agent 迄今所有 parts（text、tool call、tool result）的完整 `UIMessage`，前端只需用新消息**替换**显示。

**控制模型看到的内容：`toModelOutput`** —— 完整 `UIMessage` 存入消息历史并在 UI 展示，但 `toModelOutput` 把工具输出映射成发给模型的 token：用户看到子 agent 的每一步执行，**模型只看到最终摘要文本**。子 agent 可能花 10 万 token 探索推理，主 agent 只消耗摘要。

> **必须为子 agent 写摘要指令**：若不在子 agent instructions 里明确要求「产出全面摘要」，它可能只回一句 "Done"，`toModelOutput` 就无内容可提取。

**UI 渲染（配合 `useChat`）**：检查工具 part 的 `state` 与 `preliminary` 标志。工具 part 状态：

| state | 含义 |
| --- | --- |
| `input-streaming` | 工具输入正在生成 |
| `input-available` | 工具已就绪待执行 |
| `output-available` | 工具已产出输出（**看 `preliminary` 判断是否仍在流**） |
| `output-error` | 工具执行失败 |

类型安全：与 agent 一起导出类型（如 `InferAgentUIMessage`），供 UI 组件同时渲染主 agent 消息与子 agent 流式输出。

**三条 Caveats**：

1. **子 agent 不能用工具审批** —— subagent 工具不能用 `toolApproval`（或已废弃的 `needsApproval`），所有工具必须无需用户确认自动执行。
2. **子 agent 上下文是隔离的** —— 每次调用从全新上下文窗口开始（这正是它能做重探索而不撑爆主对话的原因）。若确需让子 agent 看到对话历史，工具 `execute` 里除 `abortSignal` 外也能拿到 `messages`，但请**慎用**，传完整历史会削弱上下文隔离的收益。
3. **流式增加复杂度** —— 无流式的基础模式更简单、更好调试，只在需要实时展示进度时才加流式。

---

### 1.10 WorkflowAgent — 持久化、可续跑的 Agent

**定位**：`@ai-sdk/workflow` 的 `WorkflowAgent` 用于在 [workflow](https://vercel.com/docs/workflow) 内构建**持久化、可续跑**的 agent。它提供与 `ToolLoopAgent` **相同的 agent 循环**，但额外带来**自动状态持久化、工具 schema 序列化、能跨越 workflow step 边界的内置工具审批**。

**为什么需要持久化 agent**：标准 `ToolLoopAgent` 全在内存里跑，进程崩溃则进度尽失。生产级多次工具调用的 agent 会遇到：**Statefulness**（长循环需跨进程边界持久化）、**Resumability**（step 失败要从最后 checkpoint 重试而非从头开始）、**Human-in-the-loop**（需审批的工具要能暂停 agent 稍后续跑）、**Observability**（每次工具调用作为离散 workflow step 出现在看板）。`WorkflowAgent` 让每次工具执行成为**带自动重试的持久 step** 来解决这些。

**与 `ToolLoopAgent` 对比**：

| | `ToolLoopAgent` | `WorkflowAgent` |
| --- | --- | --- |
| 包 | `ai` | `@ai-sdk/workflow` |
| 运行时 | 内存 | Workflow |
| 持久性 | 崩溃即丢失 | 跨重启存活 |
| 工具重试 | 手动 | 自动（经 workflow steps） |
| 人工审批 | 内置 | 内置 + 跨挂起存活 |
| `generate()` | 可用 | 可用（持久化非流式模型调用） |
| `stream()` | 可用 | **主 API** |
| 流输出 | `streamText` 返回值 | `writable` 参数 + `ModelCallStreamPart` |

更简单、不需要持久化的场景仍用 `ai` 包的 `ToolLoopAgent`。

**安装依赖**：`@ai-sdk/workflow` 需要 **Workflow 5**，以及 `ai` 与 `zod` 的 peer 依赖；`workflow` 包提供 Workflow DevKit 运行时（`getWritable`、`'use workflow'`、`'use step'`）。

**在 workflow 中集成的三个要点**：① 函数标记 `'use workflow'`；② 把 `getWritable()` 传给 agent 的 `stream()`；③ 从 API route 启动 workflow。`model` 参数接受两种形态（预构建模型实例与模型字符串）。

**消息转换**：`WorkflowAgent.stream()` 期望 **`ModelMessage[]`**，不是 `UIMessage[]`；从客户端 `useChat` 收到的消息要先转换（`convertToModelMessages`）。

**Writable 流**：与 `ToolLoopAgent` 消费返回的流不同，`WorkflowAgent` 把原始 **`ModelCallStreamPart`** chunk 写入 workflow 运行时提供的 `writable`（`getWritable()`）。在响应边界用 **`createModelCallToUIChunkTransform()`** 转成 `UIMessageChunk` 发给客户端。该 transform 还会转发 `WorkflowAgent` 在重试时发出的 **`reset-step`** 事件；客户端在处理重试输出前会移除失败的模型调用 step 的 partial parts。

**可续跑流式：`WorkflowChatTransport`** —— workflow 函数可能超时或被网络故障中断。`WorkflowChatTransport` 是一个 `ChatTransport` 实现，**检测流在没有 `finish` 事件的情况下结束**并自动重连续跑。要求 POST endpoint 返回 **`x-workflow-run-id`** 响应头，并提供 `{api}/{runId}/stream` 的 GET endpoint 供重连。

> 索引一致性：`WorkflowChatTransport` 统计的是 `UIMessageChunk` 对象，而持久化的 `WorkflowAgent` 流存的是原始 `ModelCallStreamPart`。要从索引 `0` 重放原始流，并把非负 UI cursor 传给 `createModelCallToUIChunkTransform()`。**负数起始索引**要求持久流已经存的是 `UIMessageChunk`，不能与这种 raw→UI 转换混用。

**Tools as Workflow Steps**：给工具 execute 函数标记 **`'use step'`** 即成为持久 step，获得**自动重试（默认 3 次尝试）**、**结果跨进程重启持久化**、**看板里作为离散 step 的可观测性**。不加 `'use step'` 的工具仍可运行，但只是普通内存函数、没有持久性保证。

**工具审批：`needsApproval`（此处与 `ToolLoopAgent` 不同）** —— `WorkflowAgent` 的人工审批配在**工具定义**上的 `needsApproval`（`needsApproval` **是 `WorkflowAgent` 专属**；`generateText`/`streamText`/`ToolLoopAgent` 要用 `toolApproval`）。设置后 agent 暂停并把审批请求发到 writable 流，**workflow 挂起**直到用户批准或拒绝。因为 workflow 是持久的，审批请求**跨进程重启存活** —— 用户几小时后再批准 agent 仍会续跑。`needsApproval` 也接受 async 函数以按输入决定是否需要审批。

**签名审批** —— 客户端提供的消息历史可能在重放给 workflow 前被篡改。敏感工具请配 `experimental_toolApprovalSecret`：agent 对**审批 ID、tool call ID、工具名、已校验输入**做 HMAC 签名；重放已审批历史时签名缺失或非法则**阻止工具执行**。签名会贯穿持久模型调用流、`createModelCallToUIChunkTransform()`、`addToolApprovalResponse()`、`convertToModelMessages()`。要求：高熵密钥 ≥32 字节；**每个能签发或续跑审批的 worker 都要能拿到同一密钥**；**待批审批未决期间要保留旧密钥**（换密钥会使在途审批失效）。`WorkflowAgent` 只把**环境变量名**传入签名与验证步骤，各步骤在本地环境读取，**原始值永不**进入 step 参数、持久流 parts、回调或遥测事件。因此环境变量要在每个 worker 上配好，**不要把密钥值放进 `runtimeContext` 或 `toolsContext`**。也可以在 `agent.stream()` 传 `experimental_toolApprovalSecret`，流级值**覆盖**构造默认值。

**Loop Control 差异**：`WorkflowAgent` **不套用默认步数上限**；省略 `stopWhen` 时它会跑到模型不再调用工具或其他自然终止条件。反复调用工具的模型可产生**无限次模型调用**，需要限制运行时长与成本时必须配显式条件（如 `isStepCount(20)`）；`isLoopFinished()` 与「省略 `stopWhen`」对 `WorkflowAgent` **等价**，同样需谨慎。

**Structured Output**：用 `Output` 把响应解析成类型化对象，结果在 `result.output`。

**配置项**：接受与 `ToolLoopAgent` 相同的生成设置（`temperature`、`maxOutputTokens`、`topP` 等），另加 workflow 专属选项。

- **`runtimeContext` / `toolsContext`**（取代旧的 `experimental_context`）：`runtimeContext` 是贯穿 `prepareStep`、生命周期回调、`onEnd` 的共享状态，**视为不可变**，要更新就从 `prepareStep` 返回新值以作用于当前及其后步骤；`toolsContext` 是按工具名为键的映射，每个工具 `execute` 只看到自己那一份（声明了 `contextSchema` 的工具会在执行前校验）。两者也可**按调用**传给 `stream()` 并覆盖构造默认值。**序列化硬性要求**：context 值可能被持久化并在 workflow / step 边界之间重放，因此 `runtimeContext`、`toolsContext` 以及 `prepareStep` 返回的任何 context 必须**可序列化** —— 用字符串、数字、布尔、数组、普通对象、Date、URL、Map、Set 及其他 Workflow 支持的结构化数据；**不要**放函数、类实例、symbol、`WeakMap`、`WeakSet`、数据库客户端或 SDK 客户端，改为传标识符/配置数据，在 step 函数内部重建不可序列化资源。这与内存中运行的 `ToolLoopAgent`（单进程存活期间可携带更丰富的 JS 值）不同。
- **`experimental_sandbox`**：工具需要执行环境时传 sandbox session；它在工具的 description 函数与 `execute` 中作为 `experimental_sandbox` 可用，也可在 `prepareStep` 中按当前 step 覆写。**它是活的运行时句柄、不是持久化 context**：不要存进 `runtimeContext`/`toolsContext`；若工具作为独立 workflow step 运行，传**可序列化的 sandbox 标识符或配置**，在该 step 内重新 attach。
- **`prepareCall`**：循环开始前调用一次，可基于 runtime context 转换 model、instructions 或其他设置。
- **`prepareStep`**：每一步（每次 LLM 调用）前调用，可改设置、管理 context、动态注入消息。
- `prepareCall` 与 `prepareStep` **都可按调用**传给 `stream()`。
- **`toolCallConcurrency`**：限制**一个 step 内并发执行的本地工具调用数**，设 `1` 表示必须按模型顺序串行。该限制同时作用于 `generate()` 与 `stream()`（包括从消息历史续跑过来的已批准工具调用），必须是**正整数**；默认所有本地调用并发，**provider-executed 工具不受影响**。也可从 `prepareCall` 返回或传给 `generate()`/`stream()`，优先级：**显式调用选项 > `prepareCall` > 构造默认值**。

**生命周期回调**：与 `ToolLoopAgent` 同样可在构造器（全局）或 `stream()`（单次）定义，两者都存在则都触发（先构造级）。细节：

- 对具体工具集，`WorkflowAgentToolExecutionStartEvent` / `WorkflowAgentToolExecutionEndEvent` 保留了每个工具名与其 input、context、output 类型的关系；TS 可直接收窄嵌套 `toolCall`，但要按工具名收窄相关联的 `toolContext` 或 `output` 需用 `Extract` 或自定义类型守卫。
- **工具输入回调 `onInputStart` / `onInputDelta` / `onInputAvailable` 也被保留**。模型调用在持久 step 内运行，而回调函数留在 workflow 上下文（任意函数不能跨越 step 边界），所以 `WorkflowAgent` 在模型 step 期间**记录回调事件**，在该 step 完成后、工具执行与 step 生命周期回调之前**按序重放**。它们**不与模型生成并发**，**不能提供在途取消或背压**。每个回调收到该工具 `toolsContext` 条目（已过 `contextSchema` 校验）。
- 对高度碎片化的工具输入，`onInputDelta` 的重放数据属于持久模型 step 结果的一部分 —— **只在确实需要每个 delta 时才配 `onInputDelta`**，否则不要配以免保留 delta 重放数据。
- 已废弃别名 `experimental_onStart`、`experimental_onStepStart` 仍可用（向后兼容）；同一构造器或同一次 `stream()` 里同时提供稳定名与实验名时，**使用稳定回调**。

**类型推断**：同 `InferAgentUIMessage` 推出 UI message 类型供类型安全客户端组件使用。

**非流式生成 `agent.generate()`**：需要完整结果而不流式时使用。走 provider 的 `doGenerate()`，与流式相同的持久工具循环。**默认最多 20 步**（注意与 `stream()` 不同 —— `stream()` 除非设 `stopWhen` 否则无上限）。生成失败会 reject；流式模型错误保持既有 `result.error` 行为。结果使用 core 的「最终步 text + 全步骤 content、tool results、warnings、usage」语义；`responseMessages` 只含生成的消息；`output` 默认为 text，并支持构造或单次调用的 output 规格；**End 回调在完整 output 解析之前运行**。
**审批往返（无流式）**：`generate()` 与 `stream()` **即使没提供 writable 也会返回审批请求**。生成场景下保留 `result.responseMessages`、把请求的工具与输入展示给用户、再把用户决定追加到下一次调用。使用返回的 `tool-approval-request` 里的 `approvalId` 与用户的 `approved` 决定；存储对话时要**保留请求签名与原始工具调用输入**；两次调用都要用**同一环境变量引用**配置 `experimental_toolApprovalSecret`（密钥在持久签名/验证步骤内解析）。**本地工具仅在审批校验通过后执行；被拒绝的工具产生 execution-denied 结果**；provider-executed 审批转发给 provider；等待 Workflow hook 的工具在生成期间同样可以挂起与续跑。
**Deadline、取消与重放**：workflow 内 `timeout` 为模型调用设**绝对 deadline**。每个模型 step 在派发前、SDK 重试尝试前、provider 返回后各检查一次；工具挂起并续跑后**同一 deadline 仍有效**。SDK `maxRetries` 管模型重试，持久模型 step **不再叠加一层重试**。派发前过期 → 以 `TimeoutError` reject；SDK 重试退避期间过期 → 以 `AbortError` reject；两者都**不会启动新的重试**。模型 deadline **不会取消**正在等待 Workflow hook 的工具，运行可能在该 deadline 之后仍保持挂起；一旦 hook 续跑，其后任何模型调用若 deadline 已过则在派发前失败。要终止挂起的运行，用 Workflow 运行时的 **`run.cancel()`**；**取消不会撤销已发生的外部副作用**。Workflow 重放时会复用已完成的持久模型与工具 step，因此把外部副作用放进 step 函数，并在必要时使用外部服务的幂等机制（已完成 step 的重放**不保证**被中断尝试的 exactly-once 效果）。
**返回值边界**：生成文件与 result getter 只在 workflow 代码内可用；要回传的数据自行返回（例如通过 `run.returnValue` 选择**可序列化字段**）。**整个 result 类不是受支持的 `run.returnValue` 形状**。请求/响应 body 除非用 `include` 显式开启否则被省略；可用的响应头、时间戳、ID 与 provider 元数据会被保留。Workflow 使用既有回调形状与准备规则，且上报的是**模型响应耗时**而非完整的 tool/step 计时；它**不实现** `ToolLoopAgent` 的 `callOptionsSchema` 抽象，也没有 core 的实时流读取器与 HTTP 响应 helper。

**从 `DurableAgent` 迁移**（`WorkflowAgent` 取代 Workflow DevKit 的 `DurableAgent`）：

1. **改导入与类名**：`DurableAgent` 从 `workflow/ai` 导出；`WorkflowAgent` 从 `@ai-sdk/workflow` 导出（连同 helpers），需与 `workflow` 一起安装。
2. **写 `ModelCallStreamPart` 而不是 `UIMessageChunk`**：`DurableAgent` 直接把 `UIMessageChunk` 写进 `getWritable()`；`WorkflowAgent` 写更底层的 `ModelCallStreamPart`，把转换留给响应边界的 transform —— 让持久流保持 provider 形态，不把 UI 协议烤进 workflow payload。
3. **`maxSteps` → `stopWhen`**：改用 AI SDK 共享的停止条件，使同一套停止逻辑跨 `ToolLoopAgent`、`generateText`、`streamText` 通用。
4. **`experimental_output` → `output`**：返回值现在在 `result.output`（原 `result.experimental_output`）。
5. **人工审批改用 `needsApproval`**：`DurableAgent` 时代要在工具 `execute` 内部调 Hook；`WorkflowAgent` 把审批变成**一等工具属性** —— agent 发出审批请求、挂起 workflow、用户响应后自动续跑。
6. **`uiMessages` / `collectUIMessages` 移除**：`DurableAgent.stream()` 在 `collectUIMessages: true` 时返回累积 `uiMessages`；`WorkflowAgent.stream()` 改为在 `result.messages` 返回 `ModelMessage[]`。**持久化建议**：把 `UIMessage[]` 作为唯一真相源，传给 agent 前调 `convertToModelMessages`（即 Chatbot Message Persistence 模式）；**没有内置的 `ModelMessage` → `UIMessage` 转换**，若之后要在 UI 渲染对话，**不要**只持久化 `result.messages`。
7. **`experimental_context` → `runtimeContext` + `toolsContext`**：不再接受 `experimental_context`，拆成共享状态与按工具状态。
8. **其余**：`prepareStep`、`onStart`、`onStepStart`、`onStepEnd`、`onEnd`、`onError`、`toolChoice`、`activeTools`、`timeout`、`repairToolCall`、`experimental_sandbox` 及常规生成设置**同名沿用**；`WorkflowAgent` **额外新增** `prepareCall` 与 `onToolExecutionStart` / `onToolExecutionEnd`；`experimental_onStart`、`experimental_onStepStart` 别名仍可用。

---

### 1.11 Terminal UI — `@ai-sdk/tui`

**定位**：在终端里交互式跑 agent，用于本地开发、demo 与内部工具 —— 提供 prompt 输入、流式响应、tool cards、reasoning 区块、滚动、工具审批提示，而**不需要自己写界面**。

**入口**：`runAgentTUI({ title, agent, transport, sandbox, tools, reasoning, responseStatistics, contextSize })`；安装 `pnpm add @ai-sdk/tui ai @ai-sdk/openai`。

**本地 vs 远程**：传 `agent` 直接本地跑 `ToolLoopAgent`；传 `transport`（`new DefaultChatTransport({ api: 'https://example.com/api/chat' })`）即走远程 AI SDK UI-message endpoint，endpoint、鉴权、请求体行为由 transport 控制，TUI 的内部 chat id 与消息历史对 transport 契约保持私有。

**沙箱**：来自 `@ai-sdk/sandbox-just-bash` 的 `createJustBashNetworkSandboxSession({ cwd: '/home/user' })` → `sandboxSession.restricted()` 传给 TUI、`sandboxSession.destroy()` 放在 `finally` 释放。传 `sandbox` 时，TUI **把该 sandbox 以 `experimental_sandbox` 转发到每一次 agent 调用**，工具的 description 函数与 `execute` 可从 options 读取并委派命令/文件操作。

**审批交互**：`toolApproval` 支持策略函数，例如 `weather: ({ location }) => cond ? 'approved' : 'user-approval'`；命中 `user-approval` 时暂停并等待用户按键。

**选项取值**：

| 选项 | 取值 | 默认 |
| --- | --- | --- |
| `tools` | `'full'`（显示输入+输出）/ `'collapsed'`（只显示卡片）/ `'auto-collapsed'`（最新一条展开，直到出现其他可见区块）/ `'hidden'` | `'auto-collapsed'` |
| `reasoning` | 同上四值 | `'auto-collapsed'` |
| `responseStatistics` | `'outputTokensPerSecond'`（吞吐）/ `'outputTokenCount'`（输出 token 数） | `'outputTokensPerSecond'` |
| `contextSize` | 数值（如 `200_000`），提供后按模型上下文窗口百分比显示总 token 占用 | 无 |

**快捷键**：`Enter` 提交、`y`/`n` 批准或拒绝工具调用、`Up`/`Down` 滚动、`PageUp`/`PageDown` 整页滚动、`Ctrl+L` 重绘、`Esc` / `Ctrl+C` 退出。

**注意事项**：用 `agent` 选项时，agent **必须能被终端自由文本直接驱动** —— **不得依赖 per-call `options`（即不能用 `callOptionsSchema`）**，**不得使用 structured output**，因为 TUI 无法从自由 prompt 推断这些值；需要它们请改走 `transport`，或本地直接调 `agent.generate()` / `agent.stream()`。sandbox 的 description（工作目录、公网 hostname、暴露端口）**不会自动进入 prompt**，需手动写进 agent instructions。`restricted()` 与 `destroy()` 必须成对使用，否则沙箱泄漏。

---

## 2. AI SDK Core 板块

**定位**：Core 是对 LLM 的**标准化集成层** —— 统一的 prompt 结构、settings、结果形状，让上层（Agents/UI/RSC）不依赖具体厂商 API。

**Core 函数清单**（Overview 明确列出）：

- `generateText` — 生成文本与工具调用，适合非交互自动化（起草邮件、网页摘要）以及使用工具的 agent。
- `streamText` — 流式生成文本与工具调用，适合聊天机器人、内容流式输出等交互场景。
- 两者都通过 `output` 属性支持结构化输出（`Output.object()`、`Output.array()`），用于信息抽取、合成数据生成、分类任务与流式生成 UI。

其余 Core 能力按工具（Tool Calling、MCP、Code Mode、Tool Search）、上下文（runtime/tool context）、设置（Settings、Prompt Engineering）、推理（Reasoning、Decisions）、模态（Embeddings、Reranking、图像/视频/语音/转写/翻译、File/Skill Uploads、Realtime）、工程化（Middleware、Batch、Provider & Model Management、Error Handling、Testing、Telemetry、DevTools、Lifecycle Callbacks）分组展开。

### 2.1 Generating Text — `generateText` 与 `streamText`

**`generateText` 结果字段**（`result.*`）：`content`（所有步骤生成的内容）、`text`（**最终一步**的文本）、`files`（所有步骤生成的文件）、`sources`（所有步骤引用的来源，仅部分模型可用）、`toolCalls`、`toolResults`、`finishReason`、`rawFinishReason`（来自 provider 的原始原因）、`usage`（多步骤总量）、`warnings`（provider 警告，如不支持的设置）、`steps`（各步详情）、`finalStep`、`output`（按 `output` 规格产出的结构化结果）。原始响应头/ body 通过 `finalStep.response` 访问。

**每步 `performance` 指标**：`effectiveOutputTokensPerSecond`（`outputTokens / requestSeconds`）、`outputTokensPerSecond`（流式专用，首个输出 chunk 之后 `outputTokens / outputStreamSeconds`；`generateText` 中为 `undefined`）、`inputTokensPerSecond`（流式专用，首 chunk 之前 `inputTokens / ttftSeconds`；`generateText` 为 `undefined`）、`effectiveTotalTokensPerSecond`、`stepTimeMs`（含模型响应与工具执行总耗时）、`responseTimeMs`、`toolExecutionMs`（**按 tool call ID 为键**）、`timeToFirstOutputMs`（流式专用）、`timeBetweenOutputChunksMs`（≥2 个 chunk 时的间隔统计，含 `min`/`p10`/`median`/`avg`/`p90`/`max`）。

**`streamText` 要点**：`result.textStream` **同时是 `ReadableStream` 与 `AsyncIterable`**。`streamText` **立即开始流式并抑制错误**（避免服务端崩溃），错误日志用 `onError`。它**使用背压（backpressure），只在被请求时生成 token —— 必须消费流才能结束**。与 UI/RSC 集成的 helper：`createUIMessageStreamResponse({ stream: toUIMessageStream({ stream: result.stream }) })`、`pipeUIMessageStreamToResponse({...})`、`createTextStreamResponse({ stream: toTextStream({ stream: result.stream }) })`、`pipeTextStreamToResponse({...})`。流结束时才 resolve 的一组 promise 与 `generateText` 字段同构（`content`/`text`/`finalStep`/`files`/`sources`/`toolCalls`/`toolResults`/`finishReason`/`rawFinishReason`/`usage`/`warnings`/`steps`）；**`result.totalUsage` 已废弃，改用 `result.usage`**。

**`onChunk` 收到的全部 stream part 类型**（26 种，构成 AI SDK 流协议词汇表）：`start`、`start-step`、`text-start`、`text-delta`、`text-end`、`reasoning-start`、`reasoning-delta`、`reasoning-end`、`custom`、`source`、`file`、`reasoning-file`、`tool-call`、`tool-input-start`、`tool-input-delta`、`tool-input-end`、`tool-result`、`tool-error`、`tool-output-denied`、`tool-approval-request`、`tool-approval-response`、`finish-step`、`finish`、`abort`、`error`、`raw`。

**生命周期回调**：`onEnd`（稳定，最后一步结束后触发，含 text、usage、finishReason、messages、steps 等）；另有标注 **experimental** 的一组（会随小版本破坏性变更）：`onStart`、`onStepStart`、`onLanguageModelCallStart`、`onLanguageModelCallEnd`、`onToolExecutionStart`、`onToolExecutionEnd`、`onStepEnd`。其中 `onLanguageModelCallEnd` 在**模型响应已归一化解析之后、任何客户端工具执行之前**触发，收到模型调用的 content parts、usage、finishReason、provider metadata。

**关键差异：core 的 lifecycle 回调比 `ToolLoopAgent` 多出 `onLanguageModelCallStart` / `onLanguageModelCallEnd`**（agent 侧只有 6 个）。core 生命周期回调内**抛出的错误会被静默捕获，不会打断生成/流式**。

**流转换**：`experimental_transform` 选项；**转换在回调被调用、promise 被 resolve 之前应用**（例如把文本全转大写的转换，`onEnd` 收到的就是转换后文本）。内置 `smoothStream` 平滑 text 与 reasoning 流。自定义转换函数接收模型可用 tools 并返回转换函数。可用 **`stopStream`** 提前停止流（如模型护栏被违反）；调用 `stopStream` 时**必须手动模拟 `finish-step` 与 `finish` 事件**，否则流不成形、回调不被调用。可提供**多个转换，按提供顺序应用**。

**Sources 与 Citations**：Perplexity、Google 等 provider 会返回来源；`url` 类型 source 含 `id`、`url`、`title`（可选）、`providerMetadata`。OpenAI Responses 与 Anthropic web search 的 sources 是**检索到的引用全集**（可能多于模型实际引用的条数）；OpenAI file-search 结果也作为 document sources 暴露；检索数据不可用时，退化为 citation 派生的引用以保持兼容。**Citations** 是挂在每个 `text` content part 上的可选数组（`Citation` 类型从 `ai` 导出）：`source`（URL 或 document，含可用时的 title，其 ID 标识被引用资源，**不一定**与 `result.sources` 的 ID 对应）、`startIndex`/`endIndex`（provider 提供的可选偏移，**end 不含**，各 provider 字符索引惯例不同且 SDK **原样保留**）、`citedText`（来自 source 的支撑段落，是 source 文本而非生成答案里的偏移）。

> 用 citations 渲染内联引用，用 `result.sources` 列检索全集。JS 的 `slice()` 按 **UTF-16 code unit** 计数，文本含 emoji 等非 BMP 字符时 provider offset 可能需要换算；offset 缺失或不可靠时把引用与整个文本块一起渲染，不要猜范围。Anthropic 给的是支撑段落与 document 位置**而非输出文本偏移**，细节留在 provider metadata；OpenAI file-search 的 citation `index` 保留在 provider metadata，**不作为输出文本范围解释**。源 URL 的 query 与 fragment 要保留（可能标识特定版本/页/段落）；同一 source 可在不同位置被多次引用。`streamText` 下 citations 出现在 `text-end` 事件（关联该文本块 `id`）与完成的 `result.content` 文本 parts 上，并能在 `toUIMessageStream` 后作为 `TextUIPart.citations` 存活（即使禁用 source 事件）；citation fallback source 事件可能在 provider 流末尾到达。原始 OpenAI annotations 与 Anthropic citations 仍保留在 text 的 provider metadata；其他 provider 可能省略 `citations`，**省略不代表其 sources 是完整检索集**。

### 2.2 Generating Structured Data — `Output` 家族

**定位**：文本生成之外，实际业务更需要**结构化数据**（信息抽取、分类、合成数据）。许多模型支持 "JSON modes" / "tools"，但你要手工提供 schema 并校验结果，因为 LLM 会产生**不正确或不完整**的结构化数据。AI SDK 通过 `generateText` / `streamText` 的 **`output`** 属性跨 provider 标准化了结构化输出；schema 可用 **Zod**（`zod-schema`）、**Valibot**（`valibot-schema`）或 **JSON Schema**（`json-schema`）。

**与工具同请求可组合**：结构化输出属于 `generateText`/`streamText` 流程的一部分，可与 tool calling 同时使用。**关键规则：生成结构化输出本身算作一步**（多轮执行模型中每次模型调用或工具执行是一步），因此与工具组合时要在 `stopWhen` 里为**工具执行和输出生成都留够步数**。

**五种 Output 类型**：

| 类型 | 用法 | 校验行为 |
| --- | --- | --- |
| `Output.text()` | 生成纯文本 | **不施加任何 schema**，直接返回字符串；**不指定 `output` 时的默认行为** |
| `Output.object({ schema })` | 按 schema 生成对象 | 结果做类型校验，确保匹配 schema |
| `Output.array({ element, minItems, maxItems })` | 生成类型化对象数组 | 每个元素须符合 `element`；边界限制元素数量 |
| `Output.choice({ options })` | 从给定字符串选项中**选一个**（分类、固定枚举答案） | 校验结果必须是选项之一，非法则**抛错** |
| `Output.json()` | 生成并解析**无 schema 的自由 JSON** | **只检查是否为合法 JSON**，不校验结构与类型；需要 schema 校验请用 `.object` / `.array` |

`Output.array` 的边界规则：`minItems`、`maxItems` **必须是非负整数**，且 `minItems` 不得大于 `maxItems`；两者取相同值即要求**精确长度**。边界在 provider 支持时会作为结构化输出 schema 的一部分发送，同时 **AI SDK 独立校验最终输出**。

**流式结构化输出**：结构化数据复杂度带来不可接受的响应时延，`streamText` + `output` 可在生成过程中流式返回；客户端用 **`useObject`** hook 消费。

- **partial 无法校验**：流式过程中的部分输出**不能**对照 schema 校验，因为不完整数据未必符合期望结构。
- **`elementStream`**：流式数组时逐个接收**已完成并通过 element schema 校验**的元素。与 `partialOutputStream` 不同 —— 后者流的是**含未完成元素的整个部分数组**。若模型生成超过 `maxItems`，`elementStream` 会在发出第一个超额元素前**报错**；这**不会自动中断 provider 生成**，而最终的 `output` promise 会 **reject**。
- **流中错误**：`streamText` 立即开始流式，错误成为流的一部分而非抛出异常（防崩溃），用 `onError` 处理。

**Property Descriptions**：给 schema 单个属性加 `.describe("...")` 可向模型提示该属性用途，提升结构化数据质量与准确率。特别适合：澄清含糊的属性名、指定期望格式或约定、为复杂嵌套结构提供上下文。

**`name` 与 `description`**：可为输出指定可选的 `name` 与 `description`，部分 provider 用它做额外引导（例如作为 tool 名或 schema 名）。支持于 `Output.object({ name, description, schema })`、`Output.array({ name, description, element, minItems, maxItems })`、`Output.choice({ name, description, options })`、`Output.json({ name, description })`。

**Accessing Reasoning**：结果的 **`reasoningText`** 属性提供模型生成该对象时的思考过程字符串（若可用）。

**Error Handling（两种方式）**：

1. 模型响应**无法解析或校验失败** → `generateText` 以 **`AI_NoObjectGeneratedError`** reject。
2. `generateText` 返回了结果但**没有 output** → 访问 `result.output` 抛 **`AI_NoOutputGeneratedError`**（例如最终一步不是以 `stop` 结束，而是以 `tool-calls` 结束）。因为 `output` 是 **getter**，**解构它同样触发**该访问。

`NoObjectGeneratedError` 保留便于排障的信息：`text`（模型生成的文本，按对象生成模式可能是原始文本或 tool call 文本）、`response`（语言模型响应元数据：响应 id、时间戳、模型）、`usage`（本次请求 token 用量）、`cause`（错误成因，如 JSON 解析错误）。

**原始响应访问**：`response` 属性（`generateText` 结果）可取 provider 完整响应头与 body。

---

### 2.3 Settings — 模型调用与请求选项

**定位**：跨 provider 统一的设置入口，分为**语言模型调用选项**与**请求选项**两组。

**Language Model Call Options**：`maxOutputTokens`、`temperature`、`topP`、`topK`、`presencePenalty`、`frequencyPenalty`、`stopSequences`、`seed`、`reasoning`。另有 **`providerOptions`** 用于传递 provider 专属参数（配合其类型，如 `OpenAILanguageModelResponsesOptions`）。

**Request Options**：`maxRetries`（失败重试次数）、`abortSignal`（`AbortSignal`，可用 `AbortSignal.timeout()` 构造）、`timeout`、`headers`（附加到请求的 HTTP 头）。

**不支持的设置通过 `warnings` 上报**：provider 返回的警告（如不支持某设置）在 `result.warnings` 中，跨步骤汇总（见 2.1、2.4）。

> 这些设置同时是 `ToolLoopAgent` 的顶层设置，并可被 `prepareStep` 逐步覆盖（覆盖只作用于当前步，显式假值如 `temperature: 0` 会被保留，见 1.4）。

---

### 2.4 Prompt Engineering — 提示词开发与调试

**定位**：Core 对提示词工程提供的不是 DSL 而是**约定与可观测性**：`prompt`/`messages` 结构、工具描述、以及调试时查看真实请求内容的手段。

- **Tips** 与 **Prompts for Tools**：为工具写清 `description`（模型据此决定是否调用），并用 schema 的字段描述约束输入（与 2.2 的 `.describe()` 呼应）。
- **Tool & Structured Data Schemas**：把期望形状放进 schema，而不是塞进自然语言指令。
- **Debugging** 三条路径：
  - **Inspecting Warnings** — 检查 `result.warnings`，发现 provider 忽略了哪些设置。
  - **Request Messages** — 通过 `request.messages`（结果中携带的**实际发给模型的消息**）核对拼装结果；可在生成函数上启用 **`include: { requestMessages: true }`** 之类选项让 SDK 保留请求消息。
  - **HTTP Request Bodies** — 通过 `finalStep.request.body` 查看发给 provider 的**原始 HTTP 请求体**。

> 这三层（模型输入消息 → 原始 HTTP body → provider warnings）正好覆盖「我的提示词到底以什么形式进了模型」的排障链路；`ToolLoopAgent` 的 `steps` 也暴露同样的每步信息。

---

### 2.5 Reasoning — 顶层 `reasoning` 参数

**定位**：用**一个 provider 无关的顶层 `reasoning` 参数**统一控制推理模型的思考行为，取代散落在各家 `providerOptions` 里的写法。

- **Basic Usage / Streaming**：`generateText` 与 `streamText` 都接受 `reasoning`；流式下推理内容以 `reasoning-start` / `reasoning-delta` / `reasoning-end` part 出现（见 2.1 的 part 列表），并可用 `reasoningText`（见 2.2）取文本。
- **Precedence Rules**：顶层 `reasoning` 与各 provider 的 `providerOptions` 之间存在优先级规则，迁移时需注意覆盖关系。
- **Provider Support**：并非所有 provider 都支持；文档为**不支持**的情况定义了行为（对应 `warnings`）。
- **Migrating from `providerOptions`**：文档给出三组 before/after 对照 —— **Anthropic**、**Google（`includeThoughts`）**、**OpenAI（`reasoningSummary`）**：把原先写在 `providerOptions.anthropic` / `providerOptions.google.includeThoughts` / `providerOptions.openai.reasoningSummary` 的开关，改为使用统一的顶层 `reasoning`；对**较老的 Anthropic 模型**另有专门的迁移示例。

---

### 2.6 Runtime and Tool Context — 两种上下文与遥测过滤

**定位**：把服务端状态传出给 Agent/工具，同时**不把它写进 prompt**，并控制它在遥测中的可见性。

**Context Types**：

- **Runtime Context（`runtimeContext`）**：整个调用的**共享运行时状态**（示例中的 `requestId`、`region` 等）。贯穿 loop，可在 `prepareCall`、`prepareStep`、生命周期回调与最终结果中读取。
- **Tool Context（`toolsContext`）**：**按工具名为键**的映射；每个工具用 **`contextSchema`** 声明自己需要的形状，`execute` 只拿到**自己那一份已校验的 `context`**（示例：`customerLookup` 工具拿自己的凭据/区域配置）。

**Telemetry Context Filtering**：context 可能含敏感值，因此遥测默认受控；文档提供 **`telemetry.includeToolsContext`** 开关来决定工具上下文是否进入遥测数据。

**Where Context Is Available**：`runtimeContext` / `toolsContext` 在 `ToolLoopAgent`、`generateText`、`streamText` 以及 `callOptionsSchema` + `prepareCall`（每次调用注入）、`prepareStep`（逐步更新）、`needsApproval`（审批判断时也可读取）中可用 —— 与 1.1/1.2/1.5 的描述一致。

**Choosing the Right Context**：**跨工具共享、描述"这次运行"** → `runtimeContext`；**只属于某个工具的凭据/作用域** → `toolsContext` + `contextSchema`（最小可见面 + 独立校验）。

---

### 2.7 Tool Calling — 工具调用与多步执行

**定位**：工具是**可被模型调用以执行特定任务的对象**。Function tools 与 dynamic tools 共享四个核心要素：

- **`description`** — 可选的工具描述，会影响工具被选中的时机。可以是字符串，也可以是**从工具 context 与 experimental sandbox 派生描述的函数**。
- **`inputSchema`** — 定义输入参数的 **Zod schema** 或 **JSON schema**；它既被 LLM 消费，也用于**校验 LLM 产生的工具调用**。
- **`execute`** — 可选的 async 函数，以工具调用的输入为参调用，产出泛型 `RESULT` 类型。之所以可选，是因为你可能想把工具调用**转发给客户端或队列**，而不在本进程执行。
- **`strict`** — 可选布尔，provider 支持时启用严格工具调用。

用 **`tool()`** helper 可推断 `execute` 参数类型。`generateText` / `streamText` 的 **`tools`** 参数是「工具名为键、工具为值」的对象（`ToolSet`）。模型使用工具称为 **tool call**，工具的输出称为 **tool result**。工具调用不限于文本生成，也可用于渲染 UI（Generative UI）。

**Dynamic Descriptions**：描述可以是固定字符串或函数。当发给模型的描述应取决于当前工具 context 或 experimental sandbox（tenant、project、environment、workspace）时用函数。**解析时机**：description 函数在**每个生成步骤把工具定义发给模型之前**解析；它收到来自 `toolsContext` 的匹配 `context` 与当前 `experimental_sandbox`（若提供）。若 `prepareStep` 更新了 `toolsContext` 或 `experimental_sandbox`，**下一步使用更新后的值**。

**Strict Mode**：启用后，支持严格工具调用的 provider **只会产生符合 `inputSchema` 的工具调用**，提升可靠性；但并非所有 schema 都被严格模式支持，且支持范围取决于具体 provider。**默认关闭**，可**逐工具**设 `strict: true`。不支持严格模式的 provider/模型会**忽略**该选项。

**Input Examples**：为工具提供示例输入以引导模型理解数据结构；当 JSON schema 未能完全表达用法或存在可选值时尤其有用（配合 `inputExamples`）。**只有 Anthropic provider 原生支持工具输入示例**，其他 provider 忽略该设置。

**Tool Execution Approval**：默认带 `execute` 的工具在模型调用时自动执行；在 `generateText`、`streamText` 或 `ToolLoopAgent` 上用 **`toolApproval`** 配置审批。`toolApproval` 可以是：

- 处理所有工具调用的 **`GenericToolApprovalFunction`**；
- **逐工具**的状态映射和/或 **`SingleToolApprovalFunction`** 回调（两者都可返回 `undefined`，效果等同 `'not-applicable'`）。

工具定义上较旧的 **`needsApproval`** 属性**已废弃** —— 存量代码仍可用，但新代码应把审批逻辑移到 `toolApproval`（注意：`needsApproval` 目前**仍是 `WorkflowAgent` 的正式用法**，见 1.10）。四种状态与 1.7 相同；对象形式可带 reason：**自动批准/拒绝的 reason 发在 approval response 上，人工审批的 reason 发在 approval request 上**以便展示给审批人。Generic 函数收到 `toolCall`、`tools`、`toolsContext`、`messages`、`runtimeContext`（`runtimeContext` 的类型是 `ToolApprovalConfiguration` 的第二个类型参数，默认 `Context`）；逐工具函数收到工具输入 + `toolCallId`、`messages`、`toolContext`（与工具执行的 `context` 同形，但**不含 `abortSignal`**）、`runtimeContext`。

**错误类型**（工具相关）：`NoSuchToolError`（模型调了不存在的工具）、`InvalidToolInputError`（输入不符合 schema）、`ToolChoiceViolationError`（违反 `toolChoice` 约束）、`ToolCallRepairError`。配合 **`repairToolCall`** 可修复不合法的工具调用（如工具名拼错、参数格式偏差）。

**Multi-Step Calls（`stopWhen`）**：`generateText` / `streamText` 也支持多步执行 —— 每步是一次模型调用或工具执行；用 `stopWhen` 决定继续到第几步（与 1.4 同一套停止条件），步详情在 `result.steps`，含每步 `performance`，并有 **`onStepEnd`** 回调。

**Tool call execution concurrency**：用 **`toolCallConcurrency`** 限制一步内并发执行的工具调用数（`1` = 按模型顺序串行），与 1.10 的 workflow 侧同名选项一致。

**Response Messages**：结果提供 **`responseMessages`**（本次生成产生的消息），便于把对话状态推进到下一轮；配合 `initialMessages` / `options.messages` 与 **`pruneMessages`** 做上下文管理。

**Dynamic Tools / `dynamicTool`**：运行时才提供的工具；可做**类型安全处理**（Type-Safe Handling），并支持多模态结果（`toModelOutput` 控制模型看到的输出表示，见 1.9）。

**Preliminary Tool Results**：`execute` 可为 async generator，多次 `yield` 部分结果 —— 子 agent 流式进度的底层机制（见 1.9）。相关工具输入回调：**`onInputStart`、`onInputDelta`、`onInputAvailable`**。

**Tool Choice**：`'auto' | 'none' | 'required' | { type: 'tool', toolName }`，配合 `activeTools` 收窄工具面。

**Experimental Sandbox**：`experimental_sandbox` 提供命令/代码执行环境（类型 `Experimental_SandboxSession`），暴露 `experimental_sandbox.description`、`run`、`workingDirectory`、`env` 等；`execute` 中可通过 `options` 取用。文档强调**传 sandbox 不等于工具被沙箱化**，工具必须显式委派（见 1.2）；`telemetry.includeToolsContext` 控制工具上下文是否进入遥测（见 2.6）。

**与 UI 集成**：`toUIMessageStream` 把工具 parts 送到前端，客户端用 **`addToolApprovalResponse`** 回应审批、**`addToolOutput`** 提交客户端工具结果（配合 `useChat`）。

---

### 2.8 MCP 三件套（Tools / Apps / Events）

#### 2.8.1 Model Context Protocol (MCP)

**定位**：连接 MCP server 并使用其工具/资源/补全/prompt。

- **初始化**：**`createMCPClient()`**；transport 四种：**HTTP（推荐）**、**SSE**、**Stdio（本地 server）**、**Custom Transport**（`MCPTransport`、`StreamableHTTPClientTransport`）。初始化细节涉及 `initialize`、`initialInitializeResult`、`initialSessionId`、`terminateSessionOnClose`、`onSessionExpired`。
- **OAuth**：`auth` / `authProvider` / `authorization` 凭据流；**共享 OAuth 凭据存储**、**Authorization Server 校验**（`validateAuthorizationServerURL`、`iss`）、**Callback Issuer 校验**（`callbackIssuer`）、**动态客户端凭据恢复**（`clientMetadata`、`redirect_uris`、`application_type`）。相关错误类：`MCPClientError`、`MCPClientOAuthError`、`UnauthorizedError`（OAuth 错误码 `invalid_client`、`invalid_grant`、`unauthorized_client`、`statusCode`）。
- **瞬时工具失败重试**：`maxRetries`。
- **使用 MCP 工具**：**Schema Discovery**（发现工具 schema）、`onDiscovery` / `onDynamicallyRegistered`、**Tool Annotations 与审批**（`metadata.annotations` 含 `readOnlyHint`、`destructiveHint`、`idempotentHint`、`openWorldHint`，可与 `toolApproval` 联动）、**Schema Definition**、**Typed Tool Outputs**（`outputSchema`、`structuredContent`、`CallToolResult`、`isError`、`content`）。工具漂移检测：`detectToolDrift`、`fingerprintTools`。Provider 侧集成示例：`openai.tools.mcp`。用户交互请求回调 `onElicitationRequest`（`context.arguments`、`context.tokens`）。
- **MCP Resources**：Listing Resources、Reading Resource Contents、Listing Resource Templates（`uri`、`title`、`schemas`）。
- **MCP Completions**：`complete`、`capabilities.completions`。
- **MCP Prompts**：使用 server 侧 prompt 模板。

#### 2.8.2 MCP Apps — 交互式工具 UI

**定位**：连接 MCP Apps 并渲染**可交互的工具 UI**。要点：

- **Host Flow**：宿主（你的应用）承载 App 渲染。
- **Connect With MCP Apps Support**：用 **`mcpAppClientCapabilities`** 声明支持（`native` 能力）。
- **Expose Only Model-Visible Tools**：用 **`splitMCPAppTools`** 把工具面拆成**模型可见**（`modelVisible`）与仅 App 可见两类，避免把 UI 专用工具暴露给模型。
- **Read App Resources**：**`readMCPAppResource`**（`resourceUri`）。
- **Proxy App-Visible Tool Calls**：App 发起的调用需代理，并用 **`client.callTool`**；结果含 `structuredContent`、`content`。
- **Render With React**：**`experimental_MCPAppRenderer`** + `fallback` 渲染。
- 另有 Best Practices 与 Reference 小节。

#### 2.8.3 MCP Events — Webhook 事件契约

**定位**：理解 MCP webhook 事件契约以及订阅/验签/接收的 AI SDK API。

- **Choose who manages subscriptions**：由应用或 MCP server 管理订阅。
- **机制**：`client.experimental_events` 提供事件面；**`createAdapter`** 适配 webhook；**`Experimental_MCPEventStore`** 存储事件；接口包含 `get`、`getById`、`set`、`update`、`delete`、`onEvent`。
- **可靠性字段**：`cursor`、`gap.cursor`（**缺口检测**）、`truncated`、`delivery.secret`（验签）、`termination.error`、`ttlMs`、`refreshBefore`、`messageId`、`eventStore`。
- 文档提供 Connect the webhook and client 步骤与 Runnable example、API Reference。

---

### 2.9 Code Mode — 用沙箱 JS/TS 编排工具

**定位**：让模型**以沙箱内的 JavaScript/TypeScript 程序编排 AI SDK 工具**，而不是逐个发起 tool call —— 适合需要循环、条件、`Promise.all`、`JSON.parse`/`JSON.stringify` 等组合逻辑的场合。

- **安装**后，在 `generateText` / `streamText` / `ToolLoopAgent` 上启用：**`experimental_runCodeMode`**（亦见 `runCodeMode`），并配 **`experimental_toolCallers`**。
- **Discovering Tools Through Conversation** / **Searching Deferred Tools**：配合 `toolDiscovery` 与 `deferLoading`（见 2.10），模型可先发现再使用工具；`getInventory`、`getDemand` 提供工具清单与需求视图。
- **Writing Code Mode Programs / Direct Execution**：程序以 `code_mode` 方式执行；对无法在代码内完成的调用，可回退为 **`DIRECT_TOOL_CALL`**。
- **Tool Approval**：Code Mode 下的工具审批仍走 `toolApproval` 语义。
- **Execution Limits**（`executionPolicy`，全部为可配置上限）：`timeoutMs`、`maxBridgeRequests`、`maxInFlightBridgeRequests`、`maxResultBytes`、`maxSourceBytes`、`maxStackSizeBytes`、`maxToolInputBytes`、`maxToolOutputBytes`、`maxConsoleOutputBytes`、`memoryLimitBytes`，以及 **`experimental_setMaxWorkers`**（并发 worker 数）。
- **Isolation and Tool Access**：沙箱内可访问的能力（`fetch`、`process`、`module`、`require`、`console.log/debug/info/error`、`Promise.all`、`eval`）与隔离边界由执行策略决定；工具通过 `execute`、`inputExamples` 暴露。

### 2.10 Tool Search — 按需发现工具

**定位**：`toolSearch()` 让模型**按需找到所需工具**，而不必把每个工具定义都塞进初始上下文。

- 用法：把工具注册为 **`deferLoading: true`**；搜索匹配工具的 **name 与 description**，并让它们在**下一个模型步骤**可用。
- 适用于 `generateText`、`streamText`、`ToolLoopAgent`、以及 `@ai-sdk/workflow` 的 `WorkflowAgent`；模型提供搜索查询，工厂可选接受应用自定义的 **`search`** 回调与 **`maxResults`** 上限。
- **两种模式**：**Direct Tool Calling** —— 模型初始只看到 `search`，搜索后把匹配定义加入 provider 工具列表并由模型直接调用（**这会改变工具定义，可能使已缓存的 prompt 前缀失效**）；**Code Mode** —— 支持**保留缓存**的 code mode（见 2.9），`WorkflowAgent` 支持直接工具调用。
- 与 `activeTools` 配合控制每步工具面。

---

### 2.11 Language Model Middleware

**定位**：在**不改变调用方代码**的前提下增强语言模型行为 —— 包装模型后仍是一个标准 `LanguageModelV4`。

- **入口**：**`wrapLanguageModel({ model, middleware })`**；单个 middleware 可实现 **`transformParams`**、**`wrapGenerate`**、**`wrapStream`**（分别拦截参数与 `doGenerate` / `doStream` 调用）。类型名 **`LanguageModelV4Middleware`**；也可用 `createToolMiddleware` 构造工具侧 middleware。
- **多个 middlewares**：可组合成链。
- **内置 middleware**：
  - `extractReasoningMiddleware({ ... })` — 从文本中抽取推理（选项含 `startWithReasoning`、`reasoning`）。
  - `extractJsonMiddleware()` — 从文本中抽取 JSON。
  - `simulateStreamingMiddleware()` — 把非流式模型模拟成流式。
  - `defaultSettingsMiddleware({ ... })` — 补默认设置。
  - `defaultInstructionsMiddleware({ ... })` — 补默认指令。
  - `addToolInputExamplesMiddleware({ ... })` — 为工具补输入示例（与 2.7 的 `inputExamples` 呼应）。
  - Provider 专用工具格式 middleware：**`gemmaToolMiddleware`**、**`hermesToolMiddleware`**（把工具调用文本按各家格式解析，配合 `format`、`prefix`、`onVersion`）。
- **Community Middleware**：社区提供的 middleware；文档示例含**自定义 tool call parser**。
- **实现要点**：`SystemModelMessage` 的处理与 **`allowSystemInMessages`**（某些模型不接受 system 消息，需要把 system 折叠进首条消息，配合 `findSources`、`getLastUserMessageText` 之类的辅助逻辑）。
- **典型自建场景**：Logging、Caching、RAG（检索增强）、**Guardrails**、以及**按请求配置自定义 metadata**（`providerOptions`）。

---

### 2.12 Batch — 异步批处理

**定位**：以 provider 的批量接口**异步处理大批请求**（成本与时延通常优于逐条调用）。

- **Supported providers**：OpenAI、Anthropic、Google、xAI 等（不支持时抛 **`UnsupportedFunctionalityError`**）。
- **核心 API**：**`experimental_startBatch`**（提交批次，含 `instructions`、`messages`、`providerOptions` 等常规字段，以及 **`requests` / `requestCounts`**）、**`experimental_getBatchStatus`** / `getBatchStatus`、**`experimental_getBatchResults`** / `getBatchResults`、**`experimental_cancelBatch`** / `cancelBatch`、**`experimental_listBatches`** / `listBatches`。
- **状态与分页**：状态取值 **`pending` / `completed` / `failed`**；列表用 `cursor` / `nextCursor`；每条请求含 `id`、`customId`、`completionWindow`、`createdAt`、`expiresAt`；provider 原始状态在 **`rawStatus`**，结果条目含 `error`、`response`、`usage`、`finishReason` / `rawFinishReason`、`providerMetadata`；webhook 通知字段 `webhookUrl`。
- **Image requests / Batch tools**：批量不仅限于文本 —— 图像请求（`generateImage` 相关，`images`、`size`、`aspectRatio`）与作为 batch 请求的**工具调用**（工具在批处理结果中以 `execute` 执行，产出 `GeneratedFile` 等）。
- **Request controls**：单条请求可带 `abortSignal`、`maxRetries`、`headers`、`timeout` 及生成设置（`maxOutputTokens`、`temperature`、`topP`、`topK`、`presencePenalty`、`frequencyPenalty`、`stopSequences`、`seed`、`reasoning`）。
- **Retrieving results**：结果检索与逐条响应解析（`content`、`text`、`files`、`providerMetadata`）。

---

### 2.13 Provider & Model Management

**定位**：多 provider、多模型的统一入口与治理，避免每处调用都手写 provider 实例。

- **Custom Providers**：**`customProvider({ ... })`** —— 自定义 provider 以适配非标准模型；文档示例四类：**custom model settings**（按模型名注入设置）、**model name alias**（别名映射）、**limit available models**（限制可用模型）、**files and skills interfaces**（暴露文件/技能能力，见 2.24、2.25）。
- **Provider Registry**：**`createProviderRegistry({ ... })`**，把多个 provider 注册进一个注册表并**用统一字符串选模型**。Setup 支持 **Custom Separator**（自定义 `provider/model` 分隔符）。可按能力取模型：**`languageModel`**、**`embeddingModel`**（文中示例使用文本 embedding 模型）、**`imageModel`**、**`videoModel`**、**`files`**、**`skills`**、**`decisionModel` / `decisionModels`**（见 2.16）。
- **Combining Custom Providers, Provider Registry, and Middleware**：三者可叠加 —— 注册表出模型，middleware 包装行为。
- **Global Provider Configuration** / **Customizing the Global Provider**：配置全局默认 provider（`fallbackProvider`），使模型字符串（如 `"anthropic/claude-sonnet-5.5"`）可直接工作；文档含 **Experimental decision models** 的注册方式。
- Anthropic 专属选项示例类型：`AnthropicLanguageModelOptions`。

---

### 2.14 Error Handling

**定位**：区分**常规错误**与**流式错误**两套处理方式。

- **Handling regular errors**：`generateText` 等一次性调用以异常 reject；用 try/catch 并配合 `maxRetries` 控制 provider 错误重试。
- **Handling streaming errors (simple streams)**：简单文本流不含 error part，错误需在 `onError` 中处理。
- **Handling streaming errors (streaming with `error` support)**：完整流协议里 **`error` 是流的一种 part**（见 2.1 的 part 列表），错误成为流的一部分而非抛出，避免服务端崩溃；`result.stream` / `fullStream` 可观察到 `error`。
- **Retrying provider errors after streaming starts**：流已开始后重试 provider 错误的能力有限，文档给出 **`StreamProviderError`**、**`isRetryable`** 与 **`streamRetries`** 的语义（配合 `onLanguageModelCallStart` / `onLanguageModelCallEnd` / `onStepStart` / `steps` 观察每次尝试）。
- **Handling stream aborts**：`abortSignal`（含 `AbortSignal.timeout()`）触发时用 **`onAbort`** 处理；`abort` 也是流的一种 part。

---

### 2.15 Testing — mock providers

**定位**：用 AI SDK Core 的**mock provider** 做无网络的单元测试。

- **`MockLanguageModelV4`** — 语言模型 mock；文档示例覆盖 `generateText`、`streamText`、`generateText with Output`、`streamText with Output`、**`ToolLoopAgent`**（agent 也可整体 mock）。
- **`MockEmbeddingModelV4`** — embedding 模型 mock（配 `embed` / `embedMany`）。
- 辅助：**`simulateReadableStream`**（把固定 chunk 列表变成流，驱动 `streamText`）、**`mockId`**（固定工具调用/块 id，避免快照抖动）、**`mockValues`**（固定随机/时间等值）。
- **Simulate UI Message Stream Responses** — 模拟整条 UI 消息流，用于测试前端消费侧。

### 2.16 Embeddings

**定位**：把文本/数据转成向量，用于检索、聚类、相似度匹配。

- **核心 API**：**`embed({ model, value })`**（单值）、**`embedMany({ model, values })`**（批量）、**`cosineSimilarity({ a, b })`**（相似度计算）。
- **Token Usage**：`embedMany` 返回 `usage`（token 用量）；单值同理。
- **Settings**：provider 无关设置 **`dimensions`**（输出维度）、`providerOptions`（如 `providerOptions.google.content` 传 content 类型配置）。
- **工程选项**：**`maxParallelCalls`**（并行请求数）、**`maxRetries`**（重试）、**`abortSignal`** 与 **`timeout`**（`AbortSignal.timeout()`）、**`headers`**（自定义请求头）。
- **Response Information**：`rawResponse`（`body`）保留 provider 原始响应；`providerMetadata` 保留各家元数据。
- **Embedding Middleware**：用 **`wrapEmbeddingModel`** 包装 embedding 模型（类型 `EmbeddingModelMiddleware`），与 2.11 的 `wrapLanguageModel` 同构。
- **Embedding Providers & Models**：各家 embedding 模型通过 provider 工厂获取（也可经 Provider Registry，见 2.13）。

---

### 2.17 Reranking

**定位**：对候选文档按与查询的相关性**重新排序**，常用于检索管线第二段。

- **核心 API**：**`experimental_rerank({ model, query, documents })`**（文中亦称 `rerank`）；结果字段 **`ranking`**（每项含 **`index`**、**`relevanceScore` / `score`**、并可用 **`originalIndex`** 回指原数组下标）、`query`、`documents`、`model`、`usage`（`totalTokens`）。
- **Working with Object Documents**：文档可以是字符串，也可以是对象（`document`）。
- **Understanding the Results**：`ranking` 按相关性降序，`index` 指向传入 documents 的位置。
- **Settings**：**`topN`**（只返回前 N 条）。
- **工程选项**：`maxRetries`、`abortSignal`、`timeout`、`headers`；`rawResponse`（`body`）与 `providerMetadata`。
- 与 Embeddings 组合即为典型 RAG 检索：`embedMany` → 相似度召回 → `experimental_rerank` 精排。

---

### 2.18 Decisions — `experimental_decide`

**定位**：让模型对**结构化问题**（选择题、打分、布尔判断）基于**共享状态**给出答案，并返回**概率/置信度** —— 比自由文本更适合做判定门、分类、评估。

- **核心 API**：**`experimental_decide({ model, questions, state, options })`**，返回 `answers`。
- **Question types**：三类 —— **`choice`**（从选项选一个）、**`score`**（打分）、**`boolean`**。类型 **`Experimental_DecisionQuestion`**；`supportedQuestionTypes` 描述模型支持哪些题型。
- **Multimodal state**：判定可基于多模态状态，状态类型 **`Experimental_DecisionState`** / **`Experimental_DecisionStatePart`**，复用内容 part（**`TextPart`**、**`FilePart`**；文档示例含 `bottom`/`box`/`left`/`right`/`top` 等图像定位语义）。
- **Probabilities and confidence**：返回 **`probabilities`** / **`probability`**；**`rounding`** 选项含 **`probabilityDecimals`**、**`scoreDecimals`** 控制位数。
- **Provider models / Model aliases and registries / Default-provider strings**：决策模型可直接实例、走 Provider Registry（`createProviderRegistry`、`customProvider`、`decisionModel`、`decisionModels`、自定义 `separator`），或用默认 provider 字符串；AI Gateway 场景（`AI_GATEWAY_API_KEY`、`providerOptions.gateway.models`）。
- **Errors and cancellation**：`InvalidArgumentError`、`InvalidResponseDataError`、`NoSuchModelError`、`NoSuchProviderError`、`UnsupportedModelVersionError`、**`Experimental_DecisionRefusalError`**（模型拒绝作答）；支持 `abortSignal`、`headers`。
- **Scope and examples**：文档给出 `typeSafeAi` 用法与 **`Experimental_DecisionMockModelV4`**（测试用 mock），以及回调 **`experimental_onDecisionModelCallStart` / `experimental_onDecisionModelCallEnd`**（见 2.20）。
- 与 2.2 的 `Output.choice()` 区别：`Output.choice` 是**文本生成流程**里的输出模式，`experimental_decide` 是**独立 API**，带状态、概率与拒绝语义。

---

### 2.19 Image Generation

**定位**：文生图与图像编辑的统一 API。

- **核心 API**：**`generateImage({ model, prompt })`**，结果含 **`image`**（首图）与 **`images`**（多图）；文件形式为 `GeneratedFile`（`uint8Array` / `base64`、`mediaType`）。
- **Settings**：**`size`**（如 provider 支持的具体尺寸）、**`aspectRatio`**、**`seed`**（可复现）、**`n`/`count`**（多图）、**`maxImagesPerCall`**（每次调用上限）、provider 专属 `providerOptions`。
- **Generating Multiple Images** / **Image-to-Image Editing**：文档含多图画与编辑支持检测 **`supportsFileInputs`**、**`supportsMaskInputs`**（判断模型能否接受输入文件与蒙版）。
- **工程选项**：`maxRetries`、`abortSignal`、`timeout`、`headers`、`warnings`（不支持的设置）、`providerMetadata`、`usage`。
- **Underlying calls**：模型调用底层是 `doGenerate` / `doStream`（provider 侧接口）。
- **Error Handling**：无法产出图像时抛 **`AI_NoImageGeneratedError`**（`cause`、`images`、`usage`、`warnings`）。
- **Image Middleware**：**`wrapImageModel`**（类型 `ImageModelV4Middleware`）包装图像模型。
- **Generating Images with Language Models**：也可通过语言模型的工具/多模态输出产生 images（见 2.1 的 `files`）。

---

### 2.20 Realtime — 实时语音对话

**定位**：构建**实时（音频双向）对话**。

- **Setup Endpoint** — 服务端建立 realtime 会话（示例 id 前缀 `vcst_`）。
- **AI Gateway** — 可经 AI Gateway 接入 realtime 模型。
- **Client Session** — 客户端会话管理；React 侧 hook **`experimental_useRealtime`**，用 `useMemo` 建立 session，**`api.session`** 暴露会话 API。
- **Tool Calling / Server-Backed Tool Endpoint / Client Tool Handler** — realtime 会话内也支持工具调用：服务端提供 tool endpoint，客户端用 **`onToolCall`** 处理并回写 **`addToolOutput`**。
- **Supported Providers** — 文档列出支持的 realtime provider。

---

### 2.21 Transcription / Translation / Speech

**Transcription（语音转文本）**

- **核心 API**：**`transcribe({ model, audio })`**，结果含 `text`；音频输入可为 `ArrayBuffer`、`Uint8Array`、`Buffer`、文件、URL（`URL`）。
- **Streaming Transcription**：**`experimental_streamTranscribe`**，含 `fullStream`（流 part）与 `text` promise；相关事件回调 `experimental_onStreamTranscriptionStart` / `experimental_onStreamTranscriptionEnd`；实时模型示例 `scribe_v2_realtime`。
- **Settings**：**`inputAudioFormat`**、**`language`**、**`providerOptions`**（各家参数）。
- **Download Size Limits**：**`createDownload`** 与下载大小限制（超限抛 **`DownloadError`**）。
- **工程选项**：`maxRetries`、`abortSignal`、`timeout`、`headers`、`warnings`；**错误** `AI_NoTranscriptGeneratedError`（`cause`）；`onError`、`telemetry`。
- **Transcription Models**（文中出现）：OpenAI `whisper`、Deepgram `nova`/`telephony`，AssemblyAI `universal`，Google `chirp_2`/`chirp_3`，ElevenLabs `scribe_v1`/`scribe_v1_experimental`/`scribe_v2`，以及 `wizper`、`enhanced`、`full`、`machine`、`low_cost` 等模型变体。

**Translation（语音翻译）**

- **核心 API**：**`experimental_transcribe`** 之外的 **`experimental_translate`**（文中亦简称 translation），结果含 **`translationText`** 与音频输出。
- **Stream parts**：**`experimental_streamTranslate`**，`fullStream` 支持文本与音频 chunk，可用 **`includeRawChunks`** 保留 provider 原始 chunk（`raw`）。
- **Settings**：**`sourceLanguage`**、**`targetLanguage`**、**`inputAudioFormat`**、**`outputAudioFormat`**、`providerOptions`。
- **工程选项**：`abortSignal`、`headers`、`maxRetries`；**错误** `AI_NoTranslationGeneratedError`（`cause`、`error`）；`response`。

**Speech（文本转语音）**

- **核心 API**：**`generateSpeech({ model, text })`**，结果含音频（`Uint8Array`/base64、`mediaType`）。
- **Telemetry**、`providerOptions`（各家音色/稳定性/输出格式）、`warnings`、`headers`、`maxRetries`、`abortSignal`、`timeout`。
- **Error Handling**：**`AI_NoSpeechGeneratedError`**（`cause`）。
- **Speech Models**（文中出现）：ElevenLabs `eleven_v3`、`eleven_turbo_v2`/`eleven_turbo_v2_5`、`eleven_flash_v2`/`eleven_flash_v2_5`、`eleven_multilingual_v2`，以及 `default` 音色配置。

---

### 2.22 Video Generation

**定位**：文生视频与图生视频。

- **核心 API**：**`experimental_generateVideo({ model, prompt })`**，结果含 **`video`** / **`videos`**（`GeneratedFile`：`uint8Array`、`base64`、`url`）。
- **Settings**：**`aspectRatio`**、**`resolution`**、**`durationSeconds`**（时长）、**`fps`**（帧率）、**`generateAudio`**（是否生成音频）、**`seed`**、**`maxVideosPerCall`**、`providerOptions`。
- **Image-to-Video Generation / First and Last Frame**：用 **`image`**、**`lastFrame`**、**`frameImages`** 控制起止帧。
- **Reference Inputs**：**`inputReferences`**（参考图/素材）。
- **Polling（关键机制）**：视频生成通常是异步任务 —— **`poll`** 选项含 **`poll.delay`**（`intervalMilliseconds`）与 **`poll.timeoutMs`**；也支持 **`createWebhook`** 走 webhook 通知（`webhook`、`received`）。
- **工程选项**：`maxRetries`、`abortSignal`、`timeout`、`headers`、`warnings`、`providerMetadata`、`usage`；**错误** `AI_NoVideoGeneratedError`（`cause`）；`body`、`responses`、`mediaType`。

---

### 2.23 File Uploads 与 Skill Uploads

**File Uploads（文件上传与 provider 引用）**

- **核心 API**：**`uploadFile({ data, mediaType, name, purpose })`**；结果字段 `files`、`id`、`bytes`、**`byteSize`**、`createdAt`、`expiresAt`、`api`、`providerMetadata`。
- **Provider References**：返回 **`ProviderReference`**，可在后续推理调用中**引用已上传文件而无需重复上传**，跨 provider 使用（**Multi-Provider Usage**）；`purpose` 决定文件用途（各家取值不同）。
- **Supported File Types / Provider-Specific Options / Streaming Uploads**：支持类型、各家选项（`providerOptions`）、以及流式上传（避免整体载入内存）。
- 不支持时抛 **`UnsupportedFunctionalityError`**；`abortSignal`、`headers` 可用。

**Skill Uploads（技能上传）**

- **定位**：把 **Agent Skill**（`SKILL.md` 目录包）上传到 provider，之后在推理调用中以引用方式使用。
- **核心 API**：**`uploadSkill({ skill })`**，结果类型 **`UploadSkillResult`**（字段 `id`、`name`、`description`、**`displayTitle`**、**`latestVersion`**、`expiresAt`、`sha256Hash`、`size`、`source`、`path`、`api`、`warnings`、`providerMetadata`）。
- **Skill Files**：技能由文件集合构成（示例用 `fs.readFileSync` 读 `SKILL.md`，内容可为字符串或 `Uint8Array`）。
- **Using Skills in Inference Calls**：Anthropic 走 **`providerOptions.anthropic.container.skills`**；OpenAI 走 **`providerOptions.openai.skills`**；`content` 中 `type: 'skill'` 引用。
- 与 Harnesses 的 Skills（见 3.3）是不同层：这里是**把技能上传到 provider 容器**，那里是**给 harness 运行时装配技能**。

---

### 2.24 Telemetry — OpenTelemetry 集成

**定位**：把生成/embedding/rerank/工具调用变成 OTel span，接入现有可观测性栈。

- **Enabling telemetry（两步）**：**Step 1** 在 instrumentation 文件（如 `instrumentation.ts`）里 **`registerTelemetry(...)`** 注册 OpenTelemetry 集成；**Step 2** 在调用上开启 **`experimental_telemetry: { isEnabled: true }`**。**Opting out** —— 默认关闭，也可逐调用禁用。
- **Telemetry Metadata**：**`functionId`**（区分同应用内不同调用，写入 `ai.telemetry.functionId`）、**`metadata`**（自定义属性）、**`captureContent`**（是否记录输入输出内容，默认不记录敏感内容）。
- **上下文可见性**：**`telemetry.includeRuntimeContext`**、**`telemetry.includeToolsContext`**（默认**不**把 context 放进 span，见 2.6）。
- **Custom Tracer**：可传自定义 **`tracer`**（`Tracer` / `TracerProvider`）而非全局默认。
- **Telemetry Integrations**：**Registering integrations globally**（`registerTelemetry`）、**Per-call integrations**（`telemetry.integrations`）、**Tracing channel**（多通道）。
- **Building a custom integration**：实现集成的 **Available lifecycle methods**（`onStart`、`onStepStart`、`onToolExecutionStart`、`onToolExecutionEnd`、`onStepEnd`、`onEnd`、`onError`、`onAbort` 等），并可 **`enrichSpan`**；span 类型 **`spanType`** 取值 **`CLIENT` / `INTERNAL`**；`recordInputs` / `recordOutputs` 控制内容记录；工具种类区分 `FunctionTool`、`DynamicTool`、`ProviderDefinedTool`、`ProviderExecutedTool`。
- **GenAI Semantic Conventions（新语义约定）**：`gen_ai.operation.name`、`gen_ai.provider.name`、`gen_ai.request.model`、`gen_ai.response.model`、`gen_ai.response.id`、`gen_ai.response.finish_reasons`、`gen_ai.usage.input_tokens` / `gen_ai.usage.output_tokens` / `gen_ai.usage.characters` / `gen_ai.usage.seconds`、`gen_ai.input.messages` / `gen_ai.output.messages` / `gen_ai.output.type` / `gen_ai.system_instructions`、`gen_ai.tool.name` / `gen_ai.tool.type` / `gen_ai.tool.definitions` / `gen_ai.tool.call.id` / `gen_ai.tool.call.arguments` / `gen_ai.tool.call.result`、`gen_ai.client.operation.duration`、`gen_ai.execute_tool.duration`、`gen_ai.agent.name`、`gen_ai.evaluation.result`、`gen_ai.system`。
- **Legacy AI SDK Spans（`LegacyOpenTelemetry`）**：AI SDK 自有属性命名空间 `ai.*`：`ai.operationId`、`ai.model.id`、`ai.model.provider`、`ai.prompt`（`ai.prompt.messages`、`ai.prompt.tools`、`ai.prompt.toolChoice`）、`ai.request.text`、`ai.response.id` / `ai.response.model` / `ai.response.text` / `ai.response.object` / `ai.response.toolCalls` / `ai.response.usage` / `ai.response.finishReason` / `ai.response.providerMetadata` / `ai.response.timestamp` / `ai.response.msToFirstChunk` / `ai.response.msToFinish`、`ai.stream.firstChunk` / `ai.stream.finish`、`ai.settings.maxOutputTokens` / `ai.settings.maxRetries` / `ai.settings.output`、`ai.usage.promptTokens` / `ai.usage.completionTokens` / `ai.usage.tokens`、`ai.value` / `ai.values`、`ai.toolCall.id` / `name` / `args` / `result`、`ai.telemetry.functionId`，以及 span 名：`ai.generateText`、`ai.generateText.doGenerate`、`ai.streamText`、`ai.streamText.doStream`、`ai.generateObject`、`ai.generateObject.doGenerate`、`ai.streamObject`、`ai.streamObject.doStream`、`ai.embed`、`ai.embed.doEmbed`、`ai.embedMany`、`ai.embedMany.doEmbed`、`ai.embedding`、`ai.embeddings`、`ai.generateSpeech`、`ai.transcribe`、`ai.streamTranscribe`、`ai.rerank`、`ai.reranking`、`ai.decide`。

---

### 2.25 DevTools

**定位**：本地调试与检查 AI SDK 应用 —— 捕获真实请求/响应/步骤/媒体并在专用 viewer 里回放。

- **Installation & Requirements**：安装 DevTools 包并满足 Node 版本与 OTel 前提。
- **Register the integration**：把 DevTools 作为一个 **telemetry integration** 注册（与 2.24 的 `registerTelemetry` 同一扩展点），因此**任何走 telemetry 的调用都能被捕获** —— 覆盖 `generateText`、`streamText`、`generateObject`、`streamObject`、`ToolLoopAgent` 等。
- **Launch the viewer**：用 **`npx`** 启动 viewer（http/https 本地端口）；**Choose a viewer theme**。
- **Monorepo usage**：monorepo 下的注册与端口共享方式。
- **Captured data**：一次 **run** 与其中每个 **step**（消息、工具调用与结果、usage、finishReason）、**Media previews**（图片/音频等媒体预览，用 `include` / `media` 选项控制），并支持 `toModelOutput` 的表示形式。
- **How it works**：靠 telemetry span 上报 → 存储 → viewer 读取。
- **Security considerations**：DevTools 捕获的是**真实输入输出（可能含敏感数据）**，只应在本地/受控环境启用，不要把捕获数据当作生产遥测出口（内容记录由 2.24 的 `captureContent`、`telemetry.includeRuntimeContext` / `includeToolsContext` 控制）。

---

### 2.26 Lifecycle Callbacks

**定位**：官方统一文档，覆盖 **`generateText`、`streamText`、`embed`、`embedMany`、`rerank`、`experimental_decide`** 六类调用的生命周期事件（`ToolLoopAgent` 复用同一批 generation 事件类型，见 1.2）。

- **Use Cases**：Request Logging、**Measuring Model Performance**（用 `performance`，含 `stepTimeMs`、`responseTimeMs`、`toolExecutionMs`、`timeToFirstOutputMs` 等，见 2.1）、**Debugging Multi-Step Tool Calls**（`steps`、`stepNumber`）、Monitoring Tool Execution（`toolCall`、`toolContext`）、Observing Embeddings and Reranking。
- **Generation Lifecycle（事件顺序）**：`onStart` → 每步 [`onStepStart` → `onLanguageModelCallStart` → `onLanguageModelCallEnd` → （每个工具）`onToolExecutionStart` → `onToolExecutionEnd`] → `onStepEnd` → `onEnd`；流式另有 `onError`、`onAbort`（`streamText` 的 `onChunk` 更细粒度，见 2.1）；工具输入侧 `onInputStart` / `onInputDelta` / `onInputAvailable`。
- **`generateText` 与 `streamText`**：上表全部回调；`streamText` 特有 `onChunk`、`onError`。
- **`embed` 与 `embedMany`**：`onStart` / `onEnd`，事件含 `value`/`values`、`embedding`/`embeddings`、`usage`（**`EmbeddingModelUsage`**）、`model`、`provider`、`response`。
- **`rerank`**：`onStart` / `onEnd`，事件含 `query`、`documents`、`ranking`、`topN`、`usage`。
- **`experimental_decide`**：**`experimental_onDecideStart` / `experimental_onDecideEnd`**（事件类型 `Experimental_DecideStartEvent` / `Experimental_DecideEndEvent`），并有 **`onQuestion` / `onAnswer`**、模型调用级 `onModelCallStartEvent` / `onModelCallEndEvent`（亦见 2.18 的 `experimental_onDecisionModelCallStart` / `End`）；事件含 `questions`、`answers`、`state`、`finishReason`、`usage`、`callId`。
- **Event Data Reference**：各事件的公共数据类型 —— `StepResult`、`StepResultPerformance`、`LanguageModelUsage`、`LanguageModelCallPerformance`、`LanguageModelRequestMetadata`、`LanguageModelResponseMetadata`、`TypedToolCall`、`FinishReason`、`ProviderOptions`、`activeTools`、`toolChoice`、`instructions`、`messages`、`modelId`、`providerOptions`、`maxRetries`、`headers`、`timeout`、`responseMessages`、`finalStep`、`warnings`、`operationId`、`runtimeContext`（**`RUNTIME_CONTEXT`** / **`CONTEXT`**）、`toolOutput` 判别联合（`type`、`output`、`error`）、`toolExecutionMs`、`stepNumber`、`steps`、`toolCalls`/`toolResults`、`content`、`text`、`finishReason`。
- **Runtime and Tool Context**：回调里可读 `runtimeContext` 与 `toolContext`；结合 `telemetry.includeRuntimeContext` / `telemetry.includeToolsContext` 决定是否进入 span（见 2.6、2.24）。

---

## 3. AI SDK Harnesses 板块

**定位**：harness 抽象让你**通过统一的 AI SDK 界面运行成熟的 agent harness**。**Harness = 完整的 agent 运行时**（如 Claude Code、Codex、Pi），它拥有的能力**大过一次模型调用**：workspace 访问、内置编码工具、原生 session 状态、**compaction（压缩）**、权限流程、以及运行时专属配置。Harness adapter 可以让运行时在 sandbox 中执行，但**各 adapter 的执行环境不同 —— 使用前务必读该 adapter 的运行时位置与安全指引**。

**与 provider/model 的关系（关键区分）**：harness 抽象**独立于 provider/model 抽象** —— **provider 向 Core 函数（`generateText`、`streamText`）暴露模型；harness 向 `HarnessAgent` 暴露 agent 运行时**。两者解耦但**尽量使用兼容原语**：harness 输出被**投影进 AI SDK 的流与响应类型**，因此消费模型流的地方也能消费 harness 流（例如把 `HarnessAgent` 的 stream 交给 `toUIMessageStream` 并用 `useChat` 渲染）。API 设计力求让 AI SDK 用户熟悉，但 harness 运行时的概念确实与底层语言模型不同：配置在契合处沿用 AI SDK 惯例，在 harness 行为不同处**有意分叉**。

> **Harness 包是实验性的**，早期 API 在版本之间**预期会有破坏性变更**。

**何时用 harness**：需要现成 agent 运行时驱动任务时 —— 能检查和修改沙箱 workspace 的编码 agent；自带内置工具与权限模型的运行时；由运行时**自己掌握对话历史**的多轮会话；希望保留 harness 原生行为而不是用 tool loop 重造的工作流。**反过来**：需要直接控制模型调用、工具循环、模型设置、结构化输出或自定义 agent 架构时，用 provider + model。

**四个核心部件**：

1. **`HarnessAgent`** —— 应用代码里使用的 AI SDK agent 实现。
2. **Harness adapter** —— 连接具体运行时的包，例如 `@ai-sdk/harness-claude-code`。
3. **Sandbox provider** —— harness 运行所在的隔离文件系统与进程环境。
4. **Session** —— 一次 harness 运行的**活动对话与 workspace 状态**。

**Compatible Streams**：`HarnessAgent.generate()` 返回 AI SDK 的 **`GenerateTextResult`**，`HarnessAgent.stream()` 返回 **`StreamTextResult`**，因此可以消费熟悉字段：`result.text`、`result.stream`、`result.steps`、`result.usage`、`result.responseMessages`。harness 专属事件被翻译成兼容 stream part —— text、reasoning、tool calls、tool results、usage、finish reasons 尽量用 AI SDK 同形结构；**没有一等公民 part 的事件（如 workspace 文件变更、compaction）以 dynamic provider-executed tool parts 的形式呈现**（见 3.2 与 3.8）。

**Sessions Matter（最关键的差异）**：与语言模型调用不同，**harness session 拥有状态** —— 它承载 harness 运行时、sandbox、工作目录、原生对话历史、待处理审批。**跑每一轮之前要先创建 session**：

```ts
const session = await agent.createSession();
try {
  const result = await agent.generate({ session, prompt: 'Inspect the repository and summarize the test setup.' });
  console.log(result.text);
} finally {
  await session.destroy();
}
```

服务端路由要用**稳定的 `sessionId`**，并持久化 **`session.detach()` 或 `session.stop()`** 返回的 resume 状态。

### 3.1 HarnessAgent

**定位**：Harnesses 板块的主 API —— 由 harness adapter 支撑的 AI SDK **`Agent` 实现**，提供 `generate()` 与 `stream()`，返回 **AI SDK 兼容的结果**，而实际推理由预先配置好的 harness 完成。

**Installation**：core harness 包 + 一个 harness adapter + 一个 sandbox adapter。**Bridge-backed harness（Claude Code、Codex 等）必须使用真实网络 sandbox**，如 `@ai-sdk/sandbox-vercel`；**host-runtime harness（如 Pi）也可用 `@ai-sdk/sandbox-just-bash`**，因为它不需要 sandbox-exposed port。并确保环境变量里备好 sandbox 与 harness 凭据。

**Create an Agent**：在 **module scope** 构造 agent —— **它持有配置，不持有 live session**，live state 属于 **`HarnessAgentSession`**。sandbox session 单独创建后传给 **`agent.createSession()`**。**`model`** 指定 harness runtime 使用的模型，**模型标识符是各 harness 专属的**；省略则用 harness 默认模型；**model 按轮应用**，因此 `prepareCall` 可以在轮次之间替换它。

**Run a Turn**：**`generate()` 排空整轮**并返回 `GenerateTextResult`；**`stream()`** 用于增量输出。

**Lifecycle Callbacks**：在 `HarnessAgent` 上配置回调以观察 **agent 调用、模型步骤与工具执行**。**单次 `generate()` / `stream()` 上传入的回调会额外执行，且构造器级回调先跑**；**回调异常会被忽略，不会改变 agent 执行**。harness runtime 在内部执行其内置工具，对这些工具而言 **`onToolExecutionStart` / `onToolExecutionEnd` 描述的是 runtime 上报结果之后的逻辑工具生命周期**，回调仍在工具结果发布到结果流之前送达。

**Runtime Context**：`runtimeContext` 让应用上下文对**每一轮**可用；用 `prepareCall` 为新 prompt 轮替换它。准备好的 context 在 `generate()` / `stream()` 中可用，并在内存内续跑（`continueGenerate()` / `continueStream()`）期间**保持不变**；生命周期回调收到**完整** context，结果里也有 `finalStep.runtimeContext`。**runtime context 默认被排除在遥测之外**，用 **`telemetry.includeRuntimeContext`** 逐个顶层属性加白（**只有设为 `true` 的属性**才发给遥测集成）；由于回调与结果仍拿到完整 context，**不要存放这些消费方不该访问的密钥**。

**Generate Structured Output**：构造时设 `output`，则**每一轮都要求同一个类型化输出**；agent 把输出规格**转成 JSON Schema** 交给 harness adapter、校验完成的响应、并通过 **`result.output`** 返回解析值。`stream()` 下读 **`partialOutputStream`** 拿增量解析值，`await result.output` 拿校验后的最终值。**结构化数据同时仍以 JSON 存在于普通文本与流表面；adapter 不会把它加进 `finish` part**。Harness 结构化输出**要求 schema** —— 无 schema 的 `Output.json()`，以及无法强制 schema 的 adapter 或运行时配置，都会抛 **`HarnessCapabilityUnsupportedError`**。

**Messages and History**：**harness session 拥有自己的原生对话历史**。传 `messages` 或消息数组形式的 `prompt` 时，`HarnessAgent` **只取最新的 user message 作为本轮新输入，不会把既往对话重放进 harness**。但**末尾的 tool message 另当别论**：tool approval response 与客户端提供的 tool result 会**继续产生对应请求/调用的那个未完成 harness turn**。这与模型调用不同（模型调用通常由应用发送完整历史）—— **聊天路由应持久化并 resume harness session，而不是依赖消息重放**。

**Reading the Runtime's Own History**：runtime 的对话可能在你进程之外增长（例如同一会话在 agent 自己的 CLI 里被交互续写），实时事件流**看不到**那些交换。能访问 runtime 存储的 adapter 通过 **`session.readHistory()`** 暴露它。历史读取是 adapter 特定的：adapter **未实现**历史读取时抛 `HarnessCapabilityUnsupportedError`；实现了但**当前环境无法触及** runtime 存储（例如存储位于远程 sandbox 内）时抛 **`HarnessHistoryUnavailableError`**；**尚无消息的对话不算错误**，resolve 为空 `messages` 数组。

**Session Lifecycle（每轮之后务必显式收尾）**：

- **`session.destroy()`** 停止 runtime 并**丢弃可续跑性**。
- **`session.detach()`** 停靠（park）runtime、返回 resume 状态，并**让传入的 sandbox 继续运行以便之后 attach**；若轮次未完成，resume 状态**包含 continuation 状态**。
- **`session.stop()`** 先保存 resume 状态再停止 runtime；轮次未完成时同样包含 continuation 状态。
- **`session.suspendTurn()`** 面向**跨进程边界继续活动轮次**的高级场景。
- **`session.hasUnfinishedTurn()`** 报告当前轮次是否必须先继续或挂起，session 才能接受新 prompt。

一次性脚本与测试用 `destroy()`；需要多轮连续性的 HTTP 路由用 `detach()` 或 `stop()`。

**Change Settings Between Turns**：用 `callOptionsSchema` + `prepareCall` 派生每轮的 **`model`、`skills`、`instructions`、`tools`、`runtimeContext`**（与 `ToolLoopAgent` 同一套 call-options 模式）。`prepareCall` 在新 prompt 且其自定义 options 校验完成后运行，**其设置随后整轮固定**；若该轮因工具结果、审批、停止条件或进程交接而暂停，**续跑复用同一套设置、不会再次调用 `prepareCall`**（防止轮内设置漂移）。**改 `model` 不会创建新 harness session**：每个 adapter 在下一个 prompt 前切换/重配 runtime 并保留 session 的对话历史。但 **Codex adapter 在 skills、instructions 或工具目录变化时会启动全新的原生 Codex thread**（因为 `codex exec resume` 保留原始原生 thread bootstrap）—— harness session 仍可用，但既往原生上下文不会跨越这个设置变化边界；设置未变的轮次继续现有原生 thread。**`abortSignal` 直接传给 `generate()` / `stream()`**（它本就是 per-call 设置，不属于 `prepareCall`）；**`output` 也固定在 agent 上**（响应格式绑定 agent 的 output schema）。把 `sandboxSession` 传给 `agent.createSession()` 时**调用方保有该 sandbox 的所有权**：`session.stop()` / `session.destroy()` 只结束 harness runtime，**不会停止或销毁传入的 sandbox session**，此时 agent 构造器**无需 `sandbox` provider**。

**Resuming**：持久化不透明的 resume 状态。示例里 harness `sessionId` 就是 `chatId`，sandbox ID 从同一已知 ID 派生；若应用无法派生 sandbox ID，就改为**持久化 `sandboxSession.id`** 连同 harness `sessionId` 与 resume 状态。**重新 attach sandbox 之后再让 agent resume**。创建时指定的 **`sandboxId` 命名一个「新的」live sandbox，永不查找已有**；用同一 ID 复用会在该 sandbox 已存在时失败 —— **只有 resume 函数会执行查找**。`HarnessAgent` 在把 resume 状态交给 runtime 之前会**校验它出自同一个 harness adapter**。若 resume 状态包含未完成轮次，**先调用 `continueStream()` / `continueGenerate()` 再发新 prompt**。Vercel 的 resume 函数在 sandbox detach 后仍在运行、或被停止但留有可恢复快照时都能重新 attach；**`sandboxSession.destroy()` 删除之后该 ID 无法再 resume**。

**Continue a Suspended Turn**：需要跨进程边界交接活动轮次时，先挂起轮次并持久化 continuation 状态。**只有来自 `suspendTurn()` 的原始 continuation 状态时，用 `continueFrom` resume，然后不发新 prompt 地继续该轮**：`continueStream()` 取增量输出，`continueGenerate()` 排空续跑的轮次并返回 `GenerateTextResult`。**`toolsContext` 与 `runtimeContext` 有意不写进 continuation 状态**（它们可能含凭据或不可序列化的宿主对象）；若被挂起的轮次使用了 `prepareCall` 派生的 context，**把同样的值传给 `createSession` 以在续跑进程中重新绑定**；未重新绑定的进程 resume 会**回落到 agent 构造器级的 `runtimeContext` 与 `toolsContext`**。

**Stop After a Harness Step**：用 `stopWhen` 进入语义步骤边界。谓词**在真实的 harness 工具步骤之后**运行（这些步骤还能继续进入下一个模型步骤），并收到**当前调用已完成的 steps**。谓词命中时，**返回的 result 结束，而底层轮次仍未完成**；相反，**终结性的纯文本步骤**会消费该轮的 `finish` 事件并自然收尾。**`stopWhen` 没有默认值**：省略时 `HarnessAgent` 持续运行到轮次自然结束或停下等待宿主输入，保留无步骤控制时的 agent 行为。传一个谓词或数组，**任一命中即结束当前 result slice**；被停止的轮次用 `createSession({ continueFrom })` + `continueStream()` / `continueGenerate()` 恢复。

**Prepare the Sandbox（`sandboxConfig`）**：在 harness 启动之前准备 sandbox。

- **`sandboxConfig.onBootstrap`** 在 **sandbox 模板创建期间**运行，时机在 harness adapter 自身 bootstrap 之后、支持快照的 provider 发布快照之前；用于**应被未来 session 复用的昂贵设置**。提供 `onBootstrap` 就**必须同时提供 `bootstrapHash`**，并在 bootstrap 产物应当使可复用快照失效时改变 hash。
- **`sandboxConfig.onSession`** 在每个 sandbox session 被获取且其工作目录就绪之后运行（**包括被 resume 的 session**）；用于 per-session 文件或轻量配置。
- **`workDir` 可选**：提供时必须**相对于 sandbox 的默认工作目录**，并用作 session 工作目录；设为 `'.'` 即直接使用 sandbox 默认工作目录本身。省略时普通 session 使用默认的 **`<harnessId>-<sessionId>`** 目录，而 `onBootstrap` 收到的是 sandbox 的默认工作目录。

**Prepare Reusable Sandboxes**：用 **`agent.getSandboxTemplate()`** 在创建 sandbox 之前解析某个 harness 的 bootstrap recipe（配合 `sandboxConfig.onBootstrap`）；模板身份在 sandbox 创建前即已知，Vercel 会持久化准备好的快照并由它创建 live sandbox，**相同的调用复用该快照**。多个 harness 共享同一个调用方 bootstrap 钩子时，可从所有 adapters 构建**一个**模板：**重复的 `harnessId` 以最后一个为准，且 recipe 身份在哈希前排序**；**`onSession` 不属于模板**，仍会在每个获取的 session 上单独执行。派生模板的 cache key 含**源快照 ID**，因此同 source + 同 template 的重复调用会复用准备好的快照 —— 依赖缓存模板时要**固定可变的 Git revision、镜像 tag 与源 URL**。`sandboxId` 命名的是 **live sandbox，不是其可复用模板**；原有的原生 **`name`** 选项同样命名 live sandbox，**两者都提供时其值必须一致**。

**Settings（`HarnessAgent` 主要设置项）**：`harness`（adapter 实例）、`model`（可选，harness 专属标识符）、**`id`**（可选的稳定 agent 标识符）、`instructions`（支持时**追加到 runtime 的 system/developer prompt**，否则**前置到 user prompt**）、`headers`（**构造期固定**；**不允许 `authorization`、`x-api-key`、`user-agent`、`x-client-app`**）、`callOptionsSchema` + `prepareCall`、`output`、`stopWhen`、`tools`（harness 调用时由宿主执行的 AI SDK 工具）、`runtimeContext`、`activeTools` / `inactiveTools`、`skills`、`permissionMode`、`toolApproval`、`sandboxConfig`、以及 `telemetry` / `debug` / `onLog`（可观测性与诊断；用 `telemetry.includeRuntimeContext` 给 runtime context 属性加白）。**遥测报告每轮解析出的 model、instructions 与 active 的宿主定义工具；skills 属于 adapter 上下文，没有对应的 AI SDK 遥测字段，因此不包含在标准遥测事件中**。**adapter 专属设置放在 adapter 工厂上**，例如 `createCodex({ reasoningEffort: 'high' })`。

**Custom Sandbox Orchestration**：应用自己创建与管理 sandbox 时，先准备网络 sandbox session，再把**同一个 session** 传给 `agent.createSession()`；agent 既不创建 sandbox，也不会停止或销毁**调用方拥有的 sandbox**。**Basic Sandbox Sessions Without Network Control**：只暴露文件系统与进程 API 的受限 basic session **只在项目无法暴露完整网络 session 时才用**（官方强烈建议传完整网络 session）；agent 仍把 sandbox 生命周期留给调用者，且对 bridge-backed harness **必须在 adapter 上配置 bridge 端口及其外部可达 endpoint**，因为 basic session 无法解析它们。

**错误类型**：**`HarnessCapabilityUnsupportedError`**（adapter/运行时不支持该能力：结构化输出缺 schema、历史读取未实现、审批模式不受支持）、**`HarnessHistoryUnavailableError`**（实现了历史读取但当前环境无法访问 runtime 存储）。

### 3.2 Harness Tools

**定位**：harness 有**三类工具面** —— ① 底层 harness runtime 暴露的 built-in tools（文件读写、shell、web search 等）；② 你通过 **`tools`** 设置传给 `HarnessAgent` 的 AI SDK 工具；③ 通过 harness adapter 的 **`mcpServers`** 设置接入的外部 **MCP 工具**。本页只讲 harness 特有行为，通用工具概念见 Core（2.7）。**逐节细节**（内置工具的 `providerExecuted: true` 与跨 harness 通用名、宿主工具 `toolsContext` 的类型推导与校验、客户端工具的挂起/续跑、`activeTools` 与 `inactiveTools` 的运行时差异、受限 sandbox、`permissionMode` 与 `toolApproval` 两条通道、`fileChange` / `compaction` 投影）**见 3.8**。

- **Built-in Tools** —— harness 自带的运行时工具：文档列举 `bash`、`read`、`edit`、`write`、`glob`、`grep`、`webSearch` 等；**`permissionMode`** 控制范围：**`allow-all`**、**`allow-edits`**、**`allow-reads`**。
- **Host-Executed Tools** —— 由宿主（AI SDK）执行的工具，用 `agent.tools` / `tools` 传入 AI SDK `tool()` 定义，`execute`、`contextSchema`、`toolsContext` 沿用 Core 语义（见 2.7）。
- **Client-Side Tools** —— **省略 `execute`** 即表示由浏览器/用户交互/外部进程提供结果，客户端用 **`addToolOutput`** 回写（配合 `useChat`，见 3.6）；此时 result slice 在 tool-call 步骤处结束，`session.hasUnfinishedTurn()` 保持 `true`。
- **Tool Filtering** —— `activeTools`（允许列表）/ `inactiveTools`（禁止列表）按名筛选合并工具集；**两者只能传其一**。
- **MCP Tools** —— 外部 MCP 工具通过 **adapter 的 `mcpServers`** 设置接入（不是 Core 的 `createMCPClient` 路径）。
- **Sandbox in Tool Execution** —— 宿主工具通过 `experimental_sandbox` 收到 **session 的 sandbox（受限 sandbox session）**：能读写文件、执行命令，但**无法停止网络沙箱或修改其网络策略**。
- **Tool Approvals（两条互不相通的通道）** —— harness **区分**内置工具的**权限**与宿主工具的**审批**：内置用 `permissionMode`，宿主用 **`toolApproval`**（状态 `not-applicable` / `approved` / `denied` / `user-approval`，见 1.7），需要审批时流在 `tool-approval-request` 之后**暂停**。**宿主工具的审批由 `HarnessAgent` 负责因而跨 adapter 可用；内置审批则由 adapter 决定，不支持的 adapter 会在指定该模式时报错**（详见 3.8）。
- **File Changes and Compaction** —— workspace 文件变更与 compaction **没有一等公民 part**，因此以 **dynamic provider-executed tool parts**（`part.dynamic`）投影到流中。

### 3.3 Harness Skills

**定位**：**Skills**（<https://agentskills.io/>）是**可复用的指令包**，用于项目约定、工作流指引、领域特定流程等「应当被底层 harness 运行时发现」的指令。可以为 `HarnessAgent` 配置 skills，**也可以在已完成的轮次之间替换它们**。

- **Define Skills**：通过 **`skills`** 设置传入。每个 skill 有四项：**`name`**（稳定标识符）、**`description`**（面向模型的简短摘要）、**`content`**（完整指令内容）、**`files`**（可选的、随 skill 打包的**附加文本文件**）。附加文件使用**相对 skill 根的 POSIX 路径**，例如 `reference.md`、`references/codes.md`、`templates/config.json`；当希望 agent 去读它们时，**在 `content` 里引用这些路径**。
- **When to Use Skills（与 instructions 的分界）**：skills 用于**按需可用**的可复用指令，而不是像常规 `instructions` 那样**始终加载进 agent 上下文**；**`instructions` 用于宽泛的 agent 行为与当前会话优先级**。
- 可在**已完成的轮次之间**更换 skills，通过 `callOptionsSchema` + `prepareCall` 实现（见 3.1 的 Change Settings Between Turns）。
- 与 Core 的 **Skill Uploads**（2.23）不同：这里面向 harness 运行时的技能装配，那里是把技能上传给 provider 容器。

### 3.4 Harness Adapters

**定位**：harness adapter 把 `HarnessAgent` 连接到具体 agent 运行时 —— 它们是 **AI SDK model provider 在 harness 世界的对应物**：每个 adapter 包装一个运行时，并把它的 sessions、stream 事件、工具、usage、生命周期状态与配置**归一化进 harness 契约**。

**已提供的 adapter（10 个）**：Claude Code（`@ai-sdk/harness-claude-code`）、Cline（`@ai-sdk/harness-cline`）、Codex（`@ai-sdk/harness-codex`）、Cursor（`@ai-sdk/harness-cursor`）、Deep Agents（`@ai-sdk/harness-deepagents`）、fx（`@ai-sdk/harness-fx`）、GitHub Copilot（`@ai-sdk/harness-github-copilot`）、Grok Build（`@ai-sdk/harness-grok-build`）、OpenCode（`@ai-sdk/harness-opencode`）、Pi（`@ai-sdk/harness-pi`）。
**Coming Soon**：Amp（`@ai-sdk/harness-amp`）、Goose（`@ai-sdk/harness-goose`）、Mastra（`@ai-sdk/harness-mastra`）。

**Adapter Capabilities（官方能力矩阵，选型时逐项核对）**：

| Adapter | Runtime location | Custom tools | Custom skills | Structured output | Built-in tool approval | Built-in tool filtering | History access |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Claude Code | Sandbox bridge | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ |
| Cline | Host process | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ |
| Codex | Sandbox bridge | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ |
| Cursor | Sandbox via ACP | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| Deep Agents | Sandbox bridge | ✓ | ✓ | ✓ | ✓ | ✓（via auto-rejection） | ✗ |
| fx | Host process | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ |
| GitHub Copilot | Sandbox via ACP | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| Grok Build | Sandbox via ACP | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ |
| OpenCode | Sandbox bridge | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ |
| Pi | Host process | ✓ | ✓ | ✗ | ✓ | ✓ | ✗ |

读表要点：**所有已发布 adapter 都不支持 History access**（`session.readHistory()` 目前无一可用）；**Structured output 在 Cursor、GitHub Copilot、Pi 上不可用**（要求 schema 的 `output` 会抛 `HarnessCapabilityUnsupportedError`）；**Built-in tool approval 与 filtering 只有 Claude Code / Cline / Deep Agents / fx / OpenCode 支持**（Deep Agents 的过滤通过 auto-rejection 实现）—— 因此 `permissionMode` 非默认值与内置工具过滤在不支持的 adapter 上会报错；**Runtime location 分三类**：Sandbox bridge（Claude Code、Codex、Deep Agents、OpenCode）、Sandbox via ACP（Cursor、GitHub Copilot、Grok Build）、Host process（Cline、fx、Pi）—— **执行位置决定安全边界，用前必须读该 adapter 的运行时位置与安全指引**（Overview 明确警告）。

### 3.5 Workflow Utilities — 把 harness 轮次跑成持久 workflow

**定位**：**`@ai-sdk/workflow-harness`** 提供在 [workflow](https://vercel.com/docs/workflow) 内运行 `HarnessAgent` 轮次的 helper —— 包内提供**可序列化的状态机**，以及 **time-sliced** 与 **semantic agent step** 两种轮次的 runner；**你从自己的 `'use workflow'` / `'use step'` 函数里调用相应 runner**。核心 harness 与 workflow 文件是**框架无关**的，示例中的 HTTP handler 只是以 Next.js 为例（用 Next.js 需先按 Workflow SDK 文档配置项目）。安装时除 workflow 专用包外，还需 core harness 包、一个 harness adapter 与一个 sandbox adapter。

**Configuring the Harness Agent（两种模式的关键差异）**：agent 大体可按常规配置；**使用 semantic agent steps 时把 `stopWhen` 设为 `isStepCount(1)`，使一次 `stream()` 恰好完成一个 agent step**；**使用 time slices 时省略 `stopWhen`**。

**Using Semantic Agent Steps**：在每个 agent step 之后持久化 harness 轮次。

- **Defining the Agent Step**：把 Workflow step 放在**自己的模块**里，并**在 step body 内动态 import agent** —— 这样 agent、sandbox adapter 及其它 Node.js 依赖不会进入 workflow bundle。从 Workflow step 调用 **`runHarnessAgentStep()`**。
- **Defining the Semantic Agent Step Workflow**：创建 workflow state，**只要 agent 还有工作就持续调度 `agentStep()`**。每个 **`ready_for_next_step`** 结果都携带 **`continueFrom`**，让下一个 Workflow step 继续同一个未完成轮次；轮次完成时 **`finalizeHarnessWorkflow()`** 返回其结果，**workflow 失败时抛出**。
- **Starting the Semantic Agent Step Workflow**：从服务端代码启动。**传转换后的消息，才能让 `HarnessAgent` 区分「新的 user turn」与 tool approval / tool result 续跑**。workflow state 的 **`sessionId`** 标识 harness session；step 在首次创建 sandbox 之前从中派生 **`sandboxId`**，并在后续 steps 用同一 ID reattach —— **state 不序列化 live sandbox**。把 `agent.ts`、`agent-step.ts`、`workflow.ts` 与 route 保持在**分离模块**中。
- 该示例只覆盖 workflow 执行基础；**多轮对话必须在多次 workflow run 之间持久化 harness session 的 `resumeFrom` 状态**。

**Using Time Slices**：按 **wall-clock 边界**持久化长时间运行的 harness 轮次（适合单步很长的编码任务）。

- 省略 shared agent 上的 `stopWhen`，从 Workflow step 调用 **`runHarnessAgentTimeSlice()`**；**默认使用 750 秒预算**，传 **`timeSliceSeconds`** 选择不同预算。
- **Defining the Time Slice Step**：与 semantic agent step 相同 —— step 独立成模块、body 内动态 import。
- **Defining the Time-Sliced Workflow**：同样创建 workflow state 并持续调度 `timeSliceStep()`；`ready_for_next_step` 携带 `continueFrom`，结束时由 `finalizeHarnessWorkflow()` 返回结果或抛错。
- **销毁时机（重要）**：**`destroyOnFinish` 销毁 harness session，但永不销毁 supplied sandbox**；调用方可以在**没有后续 step 需要 reattach** 时显式 `sandboxSession.destroy()`；**绝不要在后续 step 必须 resume 的时间片边界销毁它**。若不从 `sessionId` 派生 `sandboxId`，就必须单独持久化 `sandboxSession.id` 才能跨 steps reattach。

**Resume Persistence**：**workflow 会自动持久化每个 step 返回的 `HarnessWorkflowState`（含 `continueFrom`），作用域是当前这次 workflow run**；要跨**多次 user-turn workflow run** 继续原生 harness session，需**按 `sessionId` 持久化不透明的 `resumeFrom` 状态**。存储实现对两种 workflow 方式**完全相同**；示例把文件读写放在 Workflow step 里，因为**文件系统访问必须留在 workflow 函数之外**；生产环境改用持久存储而非本地文件。**接入点：在创建 workflow state 之前 load 上一次 `resumeFrom`，在执行循环之后 persist 更新后的值。**

### 3.6 Harness UI（`useChat` 路由）

**定位**：harness 流**与 AI SDK UI message streams 兼容** —— 客户端用 `useChat()`，服务端路由流式输出 `HarnessAgent` 的结果。**与基于模型的聊天路由最重要的差异是 session 管理**：harness 拥有自己的对话状态，因此**路由应按 chat id 去 resume 或创建 `HarnessAgentSession`，而不是把整段 UI 消息历史重放进模型**。

- **Client / Agent**：客户端照常 `useChat()`；**`HarnessAgent` 定义在服务器上**。
- **Session Store**：持久化 **`session.detach()` 返回的不透明 resume 状态**；若该轮因审批暂停或被其它方式打断，**这个 resume 状态内部就携带了 continuation 状态**。**chat id 可以直接当 harness `sessionId`**；示例从已知的 chat id 派生稳定的 **`sandboxId`**，若不派生则必须**单独持久化返回的 `sandboxSession.id`**。生产环境用**持久存储**而不是内存 map。**creator 总是创建新 sandbox，并在 `sandboxId` 冲突时失败；只有 resume 函数会 reattach 已存在的那个**（与 3.1 一致）。
- **Route**：三步 —— 把 UI messages 转成 model messages、运行 harness 轮次、再把结果流转回 UI message stream。**在获取 session 之前先创建 UI message stream**，这样 **sandbox、bootstrap 与 harness 启动失败会作为 UI error parts 发出，而不是变成通用 HTTP 错误**。**`getHarnessErrorMessage` 保留已审阅的、客户端安全的 harness 消息，并掩盖未知服务端错误**。⚠️ **不要把 `createAgentUIStreamResponse` 直接用在 `HarnessAgent` 上**，除非你包装 agent 以注入所需 session —— **`HarnessAgent.stream()` 每次调用都要求 `session`**。
- **Detach or Stop**：想把 harness runtime 停靠并**让 sandbox 保持温暖**以供下个请求时用 **`detach()`**（bridge-backed adapters 通常能高效 reattach 或 replay；轮次未完成时 `detach()` 的 resume 状态含 turn continuation 状态）。**`stop()`** 保存 resume 状态并停止 harness runtime，但**不会停止 supplied sandbox** —— **该 network session 归调用方所有，应在聊天结束时调用它的 `destroy()`，而不是在后续请求还需要 reattach 时**；跨进程保留所选 `sandboxId`。
- **Rendering Harness Parts**：harness 输出使用与 AI SDK model streams **相同的 UI message part 形状** —— `text` 与 `reasoning` parts；类型化 tool parts（**`tool-bash`、`tool-read`**，或宿主工具 **`tool-weather`**）；**`dynamic-tool` parts** 承载 `fileChange`、`compaction` 等动态事件。**类型化 harness 内置工具按渲染普通 AI SDK tool parts 的方式渲染**，并检查 **`part.state`** 的 `input-streaming` / `input-available` / `output-available`。
- **Type-Safe Tool Parts**：**在 `HarnessAgent` 的 session options 进入基础 `Agent` 调用参数之前，从 `agent.tools` 推断 UI tools**，然后客户端用 **`useChat<HarnessMessage>()`**。

### 3.7 Harness Terminal UI

**定位**：**`@ai-sdk/tui` 可以在终端渲染 harness streams、tool calls、reasoning sections 与 approval prompts**。关键约束：**因为 `HarnessAgent` 的 `generate` 与 `stream` 都要求 session，所以要用一个小的 `AgentTUIAgent` adapter 包装它，为终端 UI 的整个生命周期注入同一个 session**。

- 终端持续运行直到用户用 **`Esc` 或 `Ctrl+C`** 退出（与 1.11 一致）。
- **每次终端运行使用一个 session**；若使用长生命周期的终端工具且之后需要 resume，**持久化 `session.detach()` 或 `session.stop()` 返回的状态**。
- 相关：Agents 板块的 Terminal UI（1.11，面向 `ToolLoopAgent`）、`runAgentTUI` API Reference、HarnessAgent（3.1）。

### 3.8 Harness Tools 逐节细节（对 3.2 的展开，同一篇官方文档）

**Built-in Tools**：每个 adapter 声明自己的 runtime **可原生调用**的内置工具；`HarnessAgent` 把它们与你的宿主工具**合并**，合并后的工具集通过 **`agent.tools`** 暴露。内置调用**由 harness runtime 执行，不在你的应用进程内**，因此流 parts 在 runtime 已执行时带 **`providerExecuted: true`**。adapter 尽量使用**跨 harness 通用名**：`read`、`write`、`edit`、`bash`、`grep`、`glob`、`webSearch`；没有通用名的原生工具**按原生名出现**。

**Host-Executed Tools**：像给 `ToolLoopAgent` 传工具一样传给 `HarnessAgent`；harness 调用 `weather` 时，**由 `HarnessAgent` 在宿主进程执行**，再把结果**提交回 harness runtime**。宿主工具可声明 **`contextSchema`** 并通过 **`toolsContext`** 接收**轮次作用域（turn-scoped）**的上下文；用 `prepareCall` 在依赖自定义 call options 时替换 `toolsContext`。**`toolsContext` 的类型由工具集推导**：没有任何工具声明 context schema 时**拒绝传入**；有工具要求 context 对象时**必填**；所有 context 对象都可选时**可选**。执行前 `HarnessAgent` 会**逐个按该工具的 `contextSchema` 校验**，并把配置好的 map 暴露在 step 结果与生命周期回调里。**工具 context 仅存在于宿主侧，不会被序列化进挂起轮次的状态** —— 为未完成的轮次重建 session 时**必须显式重新绑定**。缺失或非法 context 会在宿主工具执行**之前**校验失败；**返回给 harness runtime 的校验错误被刻意做成通用信息**，以免把宿主侧 context 值与 schema 细节泄露给模型。

**Client-Side Tools**：省略 `execute` 表示由浏览器、用户交互或其他外部进程提供结果。harness 调用**没有 `execute`** 的工具时，返回的 result slice **在 tool-call 步骤处结束**，而底层轮次等待结果；**`session.hasUnfinishedTurn()` 保持 `true`**，**`session.suspendTurn()`** 会把 pending 工具调用**包含进可序列化的续跑状态**。UI 流程中，把 `addToolOutput` 之后产生的模型消息传给下一次 `stream()` / `generate()`，`HarnessAgent` 会**提取末尾的 tool result 并自动继续暂停的轮次**。直接调用 agent 时，把原始结果传给 **`continueStream()` / `continueGenerate()`**；外部工具失败时设 **`isError: true`**。要跨进程继续：`suspendTurn()` → 用 **`continueFrom`** 重建 session → 把结果交给 `continueStream()` / `continueGenerate()`。

**Tool Filtering**：**`activeTools`** 是允许列表，**`inactiveTools`** 是禁止列表，两者都接受**合并工具集**里的名字（adapter 声明的内置 + `tools` 传入的 AI SDK 工具）。**二者只能传其一**：TypeScript 设置类型禁止同时出现，运行时也会抛错。对**宿主工具**，inactive 的**不会传给底层 harness runtime**；若 runtime 仍尝试调用，`HarnessAgent` 返回**execution-denied** 结果。对**内置工具**，是否支持**取决于 adapter**：有的可原生过滤；有的通过其内置工具审批机制**在执行前拒绝** inactive 调用且**不发审批 request/response parts**；两者都不支持的 adapter **在你对内置工具做过滤时抛错**。

**Sandbox in Tool Execution**：宿主工具通过与其它 AI SDK 工具相同的 **`experimental_sandbox`** 执行选项**收到 session 的 sandbox**；该值是**受限的 sandbox session** —— 工具可读写文件、执行命令，但**无法停掉网络沙箱或修改其网络策略**。

**Tool Approvals（两条独立通道）**：harness 区分**内置工具的权限**与**宿主工具的审批**。
- 内置工具用 **`permissionMode`**：**`allow-all`**（允许读、编辑、shell 命令，**默认**）、**`allow-edits`**（允许读与编辑，adapter 支持内置审批时**对 shell 命令请求审批**）、**`allow-reads`**（只允许读，adapter 支持时**对编辑与 shell 命令请求审批**）。
- 宿主工具用 **`toolApproval`**，接受与 AI SDK 状态对象相同的取值：**`not-applicable`、`approved`、`user-approval`、`denied`**。
- 需要审批时**流在 `tool-approval-request` 之后暂停**；继续同一 session 的方式是**发送 tool approval response 消息** —— UI 流程里 `useChat` 在你添加审批结果时**自动代发**；直接调用时把审批响应作为下一次 `stream()` / `generate()` 的 **`messages`**。

**Built-in Approval Support**：多数 adapter 可暂停内置工具调用等待审批；**不支持的 adapter 在指定了不受支持的审批模式时会报错**。**宿主工具的审批由 `HarnessAgent` 负责，因此跨 adapter 都可用**。

**File Changes and Compaction**：部分 harness 事件**不是普通工具调用**；为兼容 UI，`HarnessAgent` 把它们投影为 **dynamic、provider-executed 的 tool parts**：**`fileChange`**（不透明的 workspace 文件变更）、**`compaction`**（runtime 压缩上下文）。**先检查 `part.dynamic` 再假定某个 tool part 属于你的类型化工具集**。

---

## 4. 选型速查

| 需求 | 选择 |
| --- | --- |
| 一次模型调用（文本/结构化/工具） | Core：`generateText` / `streamText` + `Output.*` + `tool()` |
| 自主循环、多次工具调用、可复用 agent | **`ToolLoopAgent`**（默认 `stopWhen: isStepCount(20)`） |
| 循环需要跨进程持久化、失败重试、审批跨挂起存活 | **`WorkflowAgent`**（`@ai-sdk/workflow`，`needsApproval`） |
| 要跑成熟编码运行时（Claude Code/Codex/Pi），保留其原生行为 | **`HarnessAgent`** + adapter + sandbox + session |
| 需要确定性、可重复的多段流程 | core 函数 + Workflow Patterns（链/路由/并行/编排-worker/评估-优化） |
| 敏感动作需要人工放行 | `toolApproval`（+ 策略化用 `@ai-sdk/policy-opa`；服务端信任用 `experimental_toolApprovalSecret`） |
| 上下文会被大量探索污染 | Subagents + `toModelOutput` |
| 工具太多、prompt 缓存吃紧 | `toolSearch()` + `deferLoading`，或 Code Mode |
| 前端聊天 | `useChat` + `createAgentUIStreamResponse` / `toUIMessageStream` + `ChatTransport`（**`HarnessAgent` 例外**：`stream()` 每次调用都要求 `session`，直接套用 `createAgentUIStreamResponse` 需先包装 agent 注入 session，见 3.6） |
| 本地快速验证 | `@ai-sdk/tui`（`runAgentTUI`） |

**贯穿全篇的几条硬规则**：

1. 服务端状态走 `runtimeContext`（共享）/ `toolsContext` + `contextSchema`（按工具），**不要塞进 prompt**；Workflow 场景下这些值必须**可序列化**。
2. `ToolLoopAgent` 默认 `stopWhen: isStepCount(20)`，**被该默认限制截断时 SDK 会记录 warning**；`WorkflowAgent` 的 `generate()` 默认最多 20 步、`stream()` **无上限**（除非显式设置）；`HarnessAgent` 的 `stopWhen` **没有默认值** —— 省略时一直跑到轮次自然结束或停下等待宿主输入。
3. 审批只在 **AI SDK 执行**的工具上生效，provider-executed 工具例外；`useChat` 模式下消息历史是**客户端可控输入**，敏感工具必须签名字段。
4. `prepareStep` 的改写**只作用于当前步**（`messages` 覆盖除外，它会**持久成为后续基础**）。
5. `prepareCall` 返回对象**替换**调用设置 —— **必须先展开 `...settings`**。
6. 生成结构化输出**也算一步**，与工具同用时给 `stopWhen` 留够步数。
7. 生命周期回调里的异常被吞；遥测默认不记录 context 与内容，需显式开关。
8. `experimental_*` 前缀的接口（sandbox、MCP events、batch、rerank、code mode、decide、realtime、transcribe/translate、generateVideo、toolApprovalSecret、transform、MCPAppRenderer）**随时可能破坏性变更**；Harnesses 整块处于实验期。

> **来源**：AI SDK v7 官方文档 Agents（11 篇）、AI SDK Core（32 篇）、AI SDK Harnesses（8 篇）三个板块的**全部 51 个子主题页面**，抓取于 <https://ai-sdk.dev/docs>（任意页面 URL 加 `.md` 后缀可直接取纯 Markdown 版本；全站索引见 <https://ai-sdk.dev/llms.txt>）。
>
> **精度说明**：第 0、1 章（Agents 11 篇）与第 3 章（Harnesses 8 篇）已按原文**逐篇精读并校订**；Core 板块 **2.9–2.26** 以各页官方小节标题与 API 标识清单为依据整理 —— 命名与取值均出自原文，但**未逐条复核每个可选参数的默认值**。若某个 API 细节对你的实现关键，请按「本文小节 → 对应文档页面」回原文确认（各节标题即官方页面标题）。

