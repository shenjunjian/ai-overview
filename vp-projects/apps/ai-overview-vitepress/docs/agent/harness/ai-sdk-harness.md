# 一、ai-sdk Agents 与 Harness 功能上有什么区别，分别在什么时候使用它们

## 核心区别

### Agents（`ToolLoopAgent`）

[`ToolLoopAgent`](https://ai-sdk.dev/docs/agents/building-agents) 是你**自己构建**的代理：你提供模型、系统指令（instructions）和工具，AI SDK 替你管理工具循环（agent loop），让模型可以连续多次调用工具完成复杂任务。你可以完全控制：

- 模型选择和模型调用设置（如 `temperature`、`toolChoice`）
- 自定义工具（`tool()` 定义）、工具审批（`toolApproval`）
- 循环控制（`stopWhen`、`prepareStep`）
- 结构化输出（`Output.object`）
- 生命周期回调、运行时上下文（`runtimeContext` / `toolsContext`）

### Harness（`HarnessAgent`）

[Harness](https://ai-sdk.dev/docs/ai-sdk-harnesses/overview) 是指通过 AI SDK 统一接口运行**已有的完整代理运行时**，例如 Claude Code、Codex、Cursor、Pi 等。Harness 拥有比单次模型调用更大的能力范围：

- 工作区访问、内置编码工具
- 原生会话状态（session）、对话历史压缩（compaction）
- 权限流程和运行时专属配置
- 可在沙箱（sandbox）中运行

两者是**解耦的抽象**：Provider/Model 把模型暴露给 `generateText`/`streamText`，而 Harness 把代理运行时暴露给 `HarnessAgent`。不过它们的输出流是兼容的——Harness 的流会被投射为 AI SDK 的流类型，可以传给 `toUIMessageStream` 并用 `useChat` 渲染。

> 注意：Harness 包目前是**实验性（experimental）** 的，版本间可能有破坏性变更。

## 什么时候用哪个

按文档的建议：

**使用 Harness** 当你希望由现成的代理运行时驱动任务时：

- 需要检查和修改沙箱工作区的编码代理
- 需要运行时自带的内置工具和权限模型
- 多轮会话中由运行时管理对话历史
- 希望保留 Harness 的原生行为，而不是用工具循环重新实现

**使用 Providers/Models + `ToolLoopAgent`** 当你需要直接控制：

- 模型调用本身和模型设置
- 工具循环（tool loop）
- 结构化输出
- 自定义代理架构

## 相关文档

- [Building Agents（ToolLoopAgent）](https://ai-sdk.dev/docs/agents/building-agents)
- [Harnesses Overview](https://ai-sdk.dev/docs/ai-sdk-harnesses/overview)
- [Harness Adapters](https://ai-sdk.dev/docs/ai-sdk-harnesses/harness-adapters)
- [HarnessAgent API](https://ai-sdk.dev/docs/ai-sdk-harnesses/harness-agent)

# 二、不同的harness adapter 有什么不同

根据 [Harness Adapters 文档](/docs/ai-sdk-harnesses/harness-adapters)，答案可以分成两层来看：**对外契约是统一的，但内部实现并不一致**。

## 对外契约：统一

文档说明，harness adapter 是 "AI SDK model providers 在 harness 领域的对应物"——每个 adapter 包装一个特定的 agent 运行时（runtime），并将其以下内容**规范化（normalize）到统一的 harness 契约中**：

- 会话（sessions）
- 流事件（stream events）
- 工具（tools）
- 用量（usage）
- 生命周期状态（lifecycle state）
- 配置（configuration）

因此，无论使用哪个 adapter，您都通过同一套 [`HarnessAgent`](/docs/ai-sdk-harnesses/harness-agent) API（`generate()`、`stream()`、`createSession()`、instructions、[skills](/docs/ai-sdk-harnesses/skills) 等）来交互。

## 内部实现：不一致

各 adapter 包装的是**不同的底层运行时**（Claude Code、Codex、Cline、Cursor 等），其内部逻辑由各自的运行时决定，差异体现在：

### 运行时位置不同

- **Sandbox bridge**：Claude Code、Codex、Deep Agents、OpenCode（在沙箱内运行 bridge，通过 WebSocket 回传事件）
- **Host process**：Cline、Pi（作为宿主进程内的库运行）
- **Sandbox via ACP**：Cursor、fx、GitHub Copilot、Grok Build

### 能力支持不同

| Adapter        | 结构化输出 | 内置工具审批 | 内置工具过滤             | 历史访问 |
| -------------- | ---------- | ------------ | ------------------------ | -------- |
| Claude Code    | ✓          | ✓            | ✓                        | ✗        |
| Cline          | ✓          | ✓            | ✓                        | ✗        |
| Codex          | ✓          | ✗            | ✗                        | ✗        |
| Cursor         | ✗          | ✗            | ✗                        | ✗        |
| Deep Agents    | ✓          | ✓            | ✓（通过 auto-rejection） | ✗        |
| fx             | ✗          | ✓            | ✗                        | ✗        |
| GitHub Copilot | ✗          | ✗            | ✗                        | ✗        |
| Grok Build     | ✓          | ✗            | ✗                        | ✗        |
| OpenCode       | ✓          | ✓            | ✓（通过 auto-rejection） | ✗        |
| Pi             | ✗          | ✓            | ✓                        | ✗        |

（Custom tools 和 custom skills 所有 adapter 均支持。）

### 模型标识符也不同

[HarnessAgent 文档](/docs/ai-sdk-harnesses/harness-agent)指出："Model identifiers are specific to each harness"——模型标识符是各 harness 特有的，省略时使用该 harness 的默认模型。

**总结**：会话管理、系统提示词（instructions/skills）等在 AI SDK 这一层的**接口是一致的**，但底层由各运行时自己实现（运行位置、审批、过滤、结构化输出等能力各不相同），内部逻辑**并不一致**。另外请注意，文档提示 harness 相关包目前处于**实验阶段**，版本间可能有破坏性变更。
