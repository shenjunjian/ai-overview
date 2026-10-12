# 大模型连接

首先不同的大模型有不同的接口，只是大多数目前以 OpenAi的接口为标准

1. Chat Completes API
2. Response API
3. Claude原生Messages API
4. Google Gemini的GenerateContent
5. 文件型API (文/图/音/视) ： 可能在前面接口上支持上传或下载文件的功能
6. 非对话型接口
   1. 实时语音： websocket, 各家不同
   2. 决策型对话： Jev / Laya, Decisions API,微软

## 分析现状

目前国内大模型，都是支持Chat Completes API， 或部分支持Response API， Messages API。 比如Deepseek, 最先支持Chat Completes API， 后来支持 另外2种，但是都极度阉割了许多用法， 目的是方便接入 codex, claude-code 等，[无缝使用](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/claude_code)。

但是Deepseek的 [Response API 的精髓](https://api-docs.deepseek.com/zh-cn/guides/responses_api)却并未实现，比如`previous_response_id` `store` `tools` 等，本质仍是无状态的大模型。 不过File API 基本都实现了。

Qwen 大模型，也是建议使用 "openai" 包， 然后自己仅推出 python, java的 `DashScope sdk`。

Grok : https://docs.x.ai 在国内打不开，它也是建议使用 ai-sdk 的 @ai-sdk/xai 或 "openai" 包

## 其它文章

[Jev Decisions 总结](./decisions.md)
