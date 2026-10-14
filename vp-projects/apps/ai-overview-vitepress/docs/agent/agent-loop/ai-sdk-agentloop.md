# ai-sdk agent loop 研究

## 一、基础

### prompts / 消息

```js
generateText({
  prompt: "问题....", // string | Array<SystemModelMessage | UserModelMessage | AssistantModelMessage | ToolModelMessage>

  messages: [], // Array<SystemModelMessage | UserModelMessage | AssistantModelMessage | ToolModelMessage>

  instructions: "系统提示词", // Instructions

  allowSystemInMessages: true, // boolean
});
```

默认情况下，prompt 或 messages 中的系统消息会被拒绝；使用 instructions 属性设置系统指令，或在需要发送包含系统消息的现有消息历史时，`明确设置 allowSystemInMessages: true` 。

### tool

```js
import { tool } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";

const weatherTool = tool({
  description: "Get the weather in a location",
  inputSchema: z.object({
    location: z.string().describe("The location to get the weather for"),
  }),
  execute: async ({ location }) => {
    // Your implementation
    return { temperature: 72, conditions: "sunny" };
  },
});

generateText({
  model: anthropic("claude-opus-4-5"),
  tools: {
    web_search: openai.tools.webSearch(),
    weatherTool: weatherTool,
  },
  prompt: "List files in the current directory",
});
```

experimental_refineToolInput: { } // 精炼函数在执行之前，对解析的工具输入进行规范化

有很多开源的工具集：

@tavily/ai-sdk - 为企业级代理提供搜索、提取、爬取和映射工具，以实时探索网络。
Stripe 代理工具 - 用于与 Stripe 交互的工具。
StackOne 工具集 - 为数百个 企业 SaaS 平台提供代理集成。
代理 - 一套包含 20 多个工具，可连接外部 API，如 Exa 或 E2B。
Composio - 250+ 工具，如 GitHub、Gmail、Salesforce 和 更多 。
JigsawStack - 提供超过 30+个针对特定用途的小型定制微调模型。
AI Tools Registry - AI SDK 兼容的工具定义和组件注册中心。
bash-tool - 为 AI 代理提供 bash、readFile 和 writeFile 工具。支持 @vercel/sandbox 实现完整的虚拟机隔离

### AI SDK UI 框架

AI SDK UI 提供了一套与框架无关的钩子

useChat
useCompletion
useObject
MCP Apps

### Next.js 应用

后台

```js
export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();

  const result = streamText({
    model: "anthropic/claude-sonnet-5.5",
    messages: await convertToModelMessages(messages),
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({ stream: result.stream }),
  });
}
```

UI

```jsx
"use client";

import { useChat } from "@ai-sdk/react";
import { useState } from "react";

export default function Chat() {
  const [input, setInput] = useState("");
  const { messages, sendMessage } = useChat();
  return (
    <div className="flex flex-col w-full max-w-md py-24 mx-auto stretch">
      {messages.map((message) => (
        <div key={message.id} className="whitespace-pre-wrap">
          {message.role === "user" ? "User: " : "AI: "}
          {message.parts.map((part, i) => {
            switch (part.type) {
              case "text":
                return <div key={`${message.id}-${i}`}>{part.text}</div>;
            }
          })}
        </div>
      ))}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          sendMessage({ text: input });
          setInput("");
        }}
      >
        <input
          className="fixed dark:bg-zinc-900 bottom-0 w-full max-w-md p-2 mb-8 border border-zinc-300 dark:border-zinc-800 rounded shadow-xl"
          value={input}
          placeholder="Say something..."
          onChange={(e) => setInput(e.currentTarget.value)}
        />
      </form>
    </div>
  );
}
```

## 二、 ToolLoopAgent 类

### 代理状态和上下文 && 工具上下文

代理通常需要服务器端状态，这些状态不应直接放在提示中，例如租户设置、请求 ID、功能标志、凭证或任务进度。 用于区别用户，计费等。

将 runtimeContext 作为代理的共享运行时状态。它通过代理循环流动，在 prepareStep 和生命周期回调中可用，并且可以在步骤之间更新。使用 toolsContext 用于每个工具的值，例如 API 密钥或作用域权限；每个工具仅根据其 contextSchema 接收自己的类型化的 context。

```js
const result = await generateText({
  model: "anthropic/claude-sonnet-5.5",
  prompt: "Help the user plan their trip.",
  runtimeContext: {
    tenantId: "tenant_123",
    plan: "enterprise",
    requestId: "req_abc",
  },
  prepareStep: async ({ runtimeContext }) => {
    if (runtimeContext.plan === "enterprise") {
      return { temperature: 0.2 };
    }

    return {};
  },
});
```

工具上下文， 就是工具定义时，接收一个 contextSchema 定义。 在代理agent调用工具时，可以传入不同的 toolsContext 。

比如：查询个人账户余额的工具， 就可以定义一个, 然后在执行查询时，从请求体中

```js
const queryAccount = tool({
  description: "查询余额",
  contextSchema: z.object({
    userId: z.string(),
  }),
  execute: async ({}, { context }) => {
    context.userId; // 工具执行时，取得用户信息
  },
});

const result = await generateText({
  tools: { queryAccount },
  toolsContext: {
    queryAccount: {
      userId: "u_123456", // 从请求体中，获取用户信息
    },
  },
  prompt: "What is the weather in San Francisco?",
});
```

### callOptionsSchema 调用选项

非常类似于运行上下文和工具上下文的复合体。 就是Agent 定义时，接收一个 callOptionsSchema 定义。 在代理agent调用工具时，可以传入不同的 option ， 在 prepareCall 阶段中接收 option。

注意是prepareCall， 不是prepareStep， 这是专门为`调用选项`增加的参数。 似乎可以覆盖更多的参数，比如覆盖tool。 但它也是一次性的调用了， 每一次 agent.generate 时call一次。

我认为，它是服务于选项修改的场景， 比如用户选择强度：低，中，高， 是否快速等。 智能体开发时，不可能开发多个agnet对应每一个型号配置
。 它只开发一个agent, 在调用时，传入：低，中，高， 是否快速 的场景

### ToolLoopAgent 类

1. `generateText` 等函数， `函数的弊端是每次调用，都要定义大批量的属性`, 它是一次性的。
2. 使用Agent 类， 预先定义全局的代理对象， 使用时只需要传入 prompt messages等就好了
3. 可以定义多个Agents 配合使用， 每个agent 有不同的model, tools, 生命周期等。

- 减少样板代码 - 管理循环和消息数组
- 提高可重用性 - 一旦定义，可在整个应用程序中使用
- 简化维护 - 单一位置更新代理配置

```js
const agent = new ToolLoopAgent({
  .......
})

const result = agent.generate({prompt:'问题'})
```

### 使用实验性沙盒的工具

示例一直都没有讲如何定义一个沙盒， 只给了一个type 和 调用方法。

皮卡鱼的项目， AI 自定义了一个本地沙箱： vp-projects\demos\pikafish-agent\src\lib\sandbox\local-network-sandbox.ts
可以参考一下。

```js
import type { Experimental_SandboxSession } from "ai"

experimental_sandbox: sandbox as Experimental_SandboxSession
```

### prepareStep

prepareStep 回调在每个循环步骤之前运行，如果你不返回任何更改，则默认为初始设置。使用它来修改设置、管理上下文或根据执行历史实现动态行为。

它接收当前步骤的 messages，当您需要区分原始输入与早期步骤中累积的助手/工具消息时，还会接收 initialMessages 和 responseMessages。将 messages 视为循环的当前消息状态：如果您返回一个 messages 的覆盖值，该覆盖值将作为后续步骤的基础，并与每个已完成步骤的响应消息一起保留。

管理当前步骤的 `模型，参数（温度等） 消息体, 工具 (activeTools) `

### OUTPUT 强制输出模式

```js
import { ToolLoopAgent, Output } from "ai";
import { z } from "zod";

const analysisAgent = new ToolLoopAgent({
  model: "anthropic/claude-sonnet-5.5",
  // ---------  定义  --------------------------
  output: Output.object({
    schema: z.object({
      sentiment: z.enum(["positive", "neutral", "negative"]),
      summary: z.string(),
      keyPoints: z.array(z.string()),
    }),
  }),
});

// --------  获取  ------------
const { output } = await analysisAgent.generate({
  prompt: "Analyze customer feedback from the last quarter",
});
```

### 生命周期

```js
const result = await myAgent.generate({
  prompt: "Research and summarize the latest AI trends",

  onStart({ modelId }) {
    console.log("Agent started", { modelId });
  },

  onStepStart({ stepNumber, modelId }) {
    console.log(`Step ${stepNumber} starting`, { modelId });
  },

  onToolExecutionStart({ toolCall }) {
    console.log(`Tool call starting: ${toolCall.toolName}`);
  },

  onToolExecutionEnd({ toolCall, toolExecutionMs, toolOutput }) {
    console.log(`Tool call finished: ${toolCall.toolName} (${toolExecutionMs}ms)`, {
      success: toolOutput.type === "tool-result",
    });
  },

  onStepEnd({ stepNumber, usage, performance, finishReason, toolCalls }) {
    console.log(`Step ${stepNumber} completed:`, {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      outputTokensPerSecond: performance.effectiveOutputTokensPerSecond,
      stepTimeMs: performance.stepTimeMs,
      finishReason,
      toolsUsed: toolCalls?.map((tc) => tc.toolName),
    });
  },

  onEnd({ usage, steps }) {
    console.log("Agent finished:", {
      totalSteps: steps.length,
      totalTokens: usage.totalTokens,
    });
  },
});
```

### 记忆 Mem

1、提供商的记忆

```js
const memory = anthropic.tools.memory_20250818({
  execute: async (action) => {},
});

const agent = new ToolLoopAgent({
  model: "anthropic/claude-haiku-5.5",
  tools: { memory }, // ---- 每一次对话都查询和更新记忆
});
```

2、平台提供记忆

tools: {
core_memory_append: lettaCloud.tool('core_memory_append'),
memory_insert: lettaCloud.tool('memory_insert'),
memory_replace: lettaCloud.tool('memory_replace'),
},
model: mem0('gpt-6-astra', { user_id: 'user-123' }),
tools: supermemoryTools(process.env.SUPERMEMORY_API_KEY!),
tools: createHindsightTools({ client, bankId: 'user-123' }),
tools: mongodbMemory({ userId: 'alice', sessionId: 'sess-001' }),

3、 自定义记忆，最灵活

有两种常见模式：

- 结构化操作 ：你定义明确的操作（view，create，update，search），并自行处理结构化输入。由于你控制每个操作，因此设计上更安全。

- 基于 Bash：你为模型提供一个沙盒化的 bash 环境，用于组合 shell 命令（cat，grep，sed，echo），以实现灵活的内存访问。功能更强大，但需要命令验证以确保安全。

## WorkflowAgent / HarnessAgent
