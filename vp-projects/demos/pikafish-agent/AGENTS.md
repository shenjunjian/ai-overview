# 皮卡鱼分析智能体

象棋分析。FEN 是局面的唯一事实来源。着法、评分和 PV 只写入皮卡鱼返回的结果；模型编排任务并解释该结果。

## 改动

1. 选定 seam，改动只穿过它的小接口。
   - `PikafishEngine`：`analyze`。UCI 进程、握手、`info` 解析留在实现内。
   - `createLocalNetworkSandboxSession`：返回 `HarnessV1NetworkSandboxSession`，由调用方传给 `HarnessAgent.createSession({ sandboxSession })`。本机 workspace、端口、进程留在实现内。
   - `HarnessAgent`：会话、skill、host tool。`analyzePosition` 在 Node 进程执行。
   - 棋盘：`react-xiangqiboard`，用它的 FEN 与箭头画出当前局面和 PV。
     完成：调用方不依赖 seam 内部的进程、协议或端口。
2. 界面上的 bestmove、cp 或 mate、pv 指回同一次 `analyze` 返回值。
   完成：每条着法、评分和 PV 都能对上这次皮卡鱼结果。
3. 命中文末指针时，先读那份文档再改。
   完成：改动与该文档里的约定一致。

## 栈

- 服务端：Next.js App Router
- Harness：`@ai-sdk/harness` + `@ai-sdk/harness-opencode`
- 前端：`@ai-sdk/react` 的 `useChat`
- 模型：DeepSeek `deepseek-v4-flash`；`apiKey` 读环境变量 `MY_DS`
- 本包的 Next.js 源文件按本包自己的 tsconfig 与 lint 检查
- 引擎二进制与 `.nnue` 在仓库的 `pikafish-engine/` 中

Harness 与 `useChat` 的类型以已安装的 `node_modules/ai/docs` 和 `@ai-sdk/harness` 为准。

## 指针

- 会话：改栈或会话时读 `docs/architecture.md`。
- 协议：改引擎协议时读 `docs/uci.md`。
- 命令：本包是 Next.js 应用。开发与构建走 `package.json` 里的 Next scripts；`vp test` 只跑纯 TS 模块。
