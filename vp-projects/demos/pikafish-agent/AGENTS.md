当前工程为一个象棋分析智能体，底层为皮卡鱼引擎， 智能体使用 `ai-sdk` 全套框架来开发，使用 @ai-sdk/harness @ai-sdk/harness-opencode 为harness层，使用 Next.js 为服务端，前端使用 `@ai-sdk/react`,聊天组件使用 `ai-elements`, 大模型使用 DeepSeek： deepseek-v4-flash， apiKey使用环境变量的 MY_DS的值即可。

中国象棋渲染的UI组件，请自行选择一个合适的网页能使用的组件，然后更新到这里。

以下为重要的文档网站：

https://elements.ai-sdk.dev/docs
https://ai-sdk.dev/docs/ai-sdk-harnesses/overview
https://ai-sdk.dev/providers/ai-sdk-providers
皮卡鱼引擎指南： https://www.pikafish.com/wiki/reference/engine-runtime.html

皮卡鱼引擎位于： `/pikafish-engine` 目录中。
