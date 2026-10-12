# Jev Decisions 总结

## 时间线

最早的Jev, 一个线上服务， 后来出现Laya 本地服务，后来有许多新闻讲可以通过插件，或提示词将其它大语言模型转换为`Jev`模式， 但这个我认为不科学，只是接口模拟了，但本质上，Jev的模型训练方式和优化方向是不一样的方案，所以速度和效果应该比不上Jev.

随后2周，open ai 推出 Decisions API beta, **这个可能成为未来的标准API** , 但现在仅支持gpt6 luna,未来几周将GA,支持更多模型。 baseurl: `v1/decisions`，

微软于 2026 年 10 月 9–10 日正式发布结构化决策模型 [Microsoft‑Decision‑1](https://www.sohu.com/a/1085765556_122066678)，其在微软公布的 36 项基准测试中准确率最高，P50 延迟比 GPT‑6 Sol 快约 35 倍，输入定价为每百万 token 0.042 美元、输出免费。它基于 Qwen3.5‑9B 进行后训练，可在 Microsoft Foundry 使用，并计划接入 OpenRouter。
