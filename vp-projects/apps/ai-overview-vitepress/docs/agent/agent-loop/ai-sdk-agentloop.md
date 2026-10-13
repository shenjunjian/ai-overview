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
