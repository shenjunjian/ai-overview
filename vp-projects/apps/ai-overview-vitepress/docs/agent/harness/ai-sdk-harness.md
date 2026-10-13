# 不同的harness adapter 有什么不同

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

## 关于子 Agent

文档中没有针对各 adapter 在"子 Agent（subagents）"内部实现上的对比说明，因此我无法基于文档对这一点给出确切回答。您可以查看各 adapter 的专属页面（如 [Claude Code](/providers/ai-sdk-harnesses/claude-code)、[Codex](/providers/ai-sdk-harnesses/codex)）了解各自运行时的具体行为。

**总结**：会话管理、系统提示词（instructions/skills）等在 AI SDK 这一层的**接口是一致的**，但底层由各运行时自己实现（运行位置、审批、过滤、结构化输出等能力各不相同），内部逻辑**并不一致**。另外请注意，文档提示 harness 相关包目前处于**实验阶段**，版本间可能有破坏性变更。
