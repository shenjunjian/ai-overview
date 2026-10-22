# 记忆管理

根据ai-sdk， [它的记忆有3种模式](../../agent-loop/ai-sdk-agentloop.md)

1. 大模型提供商提供记忆能力 anthropic.tools.memory_20250818
2. 专业平台提供的记忆能力 createHindsightTools mem0 lettaCloud
3. 自己编写记忆的工具来实现记忆 view，create，update，search

今天看到有记忆大模型： MemT1.0 , 记忆系统架构团队开源， 36B。
**记忆原生模型** 把经验转成内部状态，再训练， 让状态经记忆分支参与后续的计算。 它比**外部记忆**有很大优势。
