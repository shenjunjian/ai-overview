# 栈与会话

一回合从浏览器的 `useChat` 进入 `POST /api/chat`。路由把 chat id 当作 harness `sessionId`，调用 `HarnessAgent.stream`，再用 `toUIMessageStream` 把流返回给 UI。Harness UI：https://ai-sdk.dev/docs/ai-sdk-harnesses/ui

`toUIMessageStream` 是这条会话路由的响应形状。`createAgentUIStreamResponse` 不携带这套 session。

## 会话

1. 新 chat：创建 session，然后流式返回。
2. 已有 chat id：`resume` 同一个 session。
3. 回合结束：`session.detach()` 将会话写到本机文件。demo 持久化到本机文件即可。
   完成：同一个 chat id 再次请求时恢复的是该会话。

## 运行时

OpenCode 是 bridge-backed harness，需要能暴露端口的 network sandbox。`LocalNetworkSandbox` 提供会话目录、本机 `exec` / `spawn`，`getPortEndpoint` 返回 `127.0.0.1:<port>`。这是 Harness V1 的本机 adapter，不是虚拟机隔离。

DeepSeek 走 OpenCode 的 OpenAI-compatible 通道：

- `OPENAI_API_KEY` 取 `MY_DS`
- `OPENAI_BASE_URL=https://api.deepseek.com`
- `provider: 'openai'`
- model `deepseek-v4-flash`（API 仍接受此 id，实际路由到当前 Flash）

`analyzePosition({ fen, moves?, movetimeMs })` 是 host tool，在 Next.js 进程里调用 `PikafishEngine`。返回值形状见 `docs/uci.md`。OpenCode 的 `bash` 与 `write` 用 `inactiveTools` 或 `permissionMode` 收紧，使编码 agent 留在分析任务里。

实现前对照已安装的 `@ai-sdk/harness` 类型与 `node_modules/ai/docs`。
完成：路由、session、sandbox、host tool 的用法能对上当前安装的类型。

## 落点

- `src/app/page.tsx` — `useChat` 与棋盘
- `src/components/XiangqiBoard.tsx` — `react-xiangqiboard`（FEN + PV 箭头）
- `src/app/api/chat/route.ts` — 流式路由
- `src/lib/agent.ts` — `HarnessAgent` 工厂（module scope）
- `src/lib/session-store.ts` — resume / detach
- `src/lib/sandbox/local-network-sandbox.ts` — `LocalNetworkSandbox`
- `src/lib/pikafish/engine.ts` — `PikafishEngine`
- `src/lib/tools/analyze-position.ts` — host tool
- `skills/xiangqi-analysis.md` — 如何读评分、如何向棋手解释、何时再搜
- `scripts/setup-pikafish.mjs` — 下载当前系统的通用二进制与 `.nnue`
- `.env.example` — `MY_DS=`
