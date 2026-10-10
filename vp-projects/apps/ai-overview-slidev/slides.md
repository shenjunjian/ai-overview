---
theme: default
title: AI 概览地图
info: |
  AI 的三个层次：大模型层、智能体开发、AI 应用。
  用于明确 AI 学习与研究的方向：模型层是底座，智能体开发是杠杆，AI 应用是出口。
transition: slide-left
---

# AI 概览地图

AI 的三个层次，一张图讲清楚

<div class="mt-6 flex justify-center gap-3 text-lg">

<span class="chip chip-amber">大模型层</span>
<span class="chip chip-green">智能体开发</span>
<span class="chip chip-blue">AI 应用</span>

</div>

<div class="mt-10 text-base opacity-70">
普通程序员的位置在哪里？ <carbon:arrow-right />
</div>

---

## 总览：一个倒漏斗

<div class="grid grid-cols-5 gap-6 mt-2 items-center">
<div class="col-span-2">

<AiFunnel />

</div>
<div class="col-span-3 leading-7">

- <span class="chip chip-blue">AI 应用</span> 漏斗最宽处：借助智能体能力可以产出的成果方向
- <span class="chip chip-green">智能体开发</span> 中间工程层：把模型能力变成可用生产力的地方
- <span class="chip chip-amber">大模型层</span> 漏斗最窄处：堆叠硬件与算法，普通程序员接触不到

<div class="mt-4 opacity-80">

层越窄，门槛越高；层越宽，成果越多。普通程序员的主战场在漏斗的中上部。

</div>

</div>
</div>

---

## 第一层 · 大模型层：堆叠硬件与算法

<div class="grid grid-cols-5 gap-6 mt-2 items-center">
<div class="col-span-2">

<AiFunnel highlight="model" />

</div>
<div class="col-span-3 leading-7">

- **硬件**：算力、GPU 集群、能源与供应链的堆叠
- **算法**：预训练、对齐、强化学习的持续演进
- **门槛**：算力 + 数据 + 研究团队，是巨头的游戏
- **普通程序员接触不到**：把它当黑盒，通过访问层获取能力

<div class="mt-4 opacity-80">

图中大模型层的出口只指向一处：<span class="chip chip-blue">硬件/算法</span>。

</div>

</div>
</div>

---

## 第二层 · 智能体开发：普通程序员的主战场

<div class="grid grid-cols-5 gap-3 mt-6">

<div class="card card-green">

**① LLM 访问层**<br><span class="text-sm">对话型与非对话型 API 的统一入口</span>

</div>

<div class="card card-green">

**② AgentLoop**<br><span class="text-sm">智能体的核心循环</span>

</div>

<div class="card card-green">

**③ harness**<br><span class="text-sm">环绕循环的工程能力总和</span>

</div>

<div class="card card-green">

**④ Agent UI**<br><span class="text-sm">TUI / Robot UI / Gen UI</span>

</div>

<div class="card card-green">

**⑤ 产品/龙虾**<br><span class="text-sm">成熟的智能体产品</span>

</div>

</div>

<div class="mt-8 leading-7">

自下而上：先接上模型，再让循环跑起来，用 harness 加固，用 UI 交付，最后沉淀为产品。

</div>

---

## ① LLM 访问层：智能体的感官

<div class="grid grid-cols-2 gap-6 mt-4">

<div class="card">

**对话型 API**

- OpenAI：Chat Completions API、Response API
- Claude：原生 Messages API
- Google Gemini：GenerateContent

</div>

<div class="card">

**非对话型 API**

- 实时对话
- Jev / laya-ai / Decides API

</div>

</div>

<div class="mt-6 opacity-80">

智能体的一切能力从这里开始：先把「调用模型」统一成一层访问层。

</div>

---

## ② AgentLoop：智能体的最小核心

```mermaid
flowchart LR
  A["用户意图 / 任务"] --> B["LLM 推理"]
  B --> C["工具 / 动作调用"]
  C --> D["结果写回上下文"]
  D --> B
  B -- 任务完成 --> E["最终输出"]
```

- 循环很小：推理 → 行动 → 观察，不断重复
- 循环也很重要：智能体的其他一切，都围绕这个循环生长

---

## ③ harness：环绕循环的工程能力总和

<div class="mt-6 text-base leading-9">

<span class="chip">prompt</span>
<span class="chip">mcp/tools</span>
<span class="chip">RAG</span>
<span class="chip">skills</span>
<span class="chip">会话</span>
<span class="chip">缓存优化</span>
<span class="chip">子 AGENT</span>
<span class="chip">记忆/长期记忆</span>
<span class="chip">shell</span>
<span class="chip">本地沙箱</span>
<span class="chip">云端沙箱</span>
<span class="chip">项目索引</span>

</div>

<div class="mt-8 leading-7">

harness 决定智能体的上限：同样的模型、同样的循环，不同的 harness 就是不同级别的能力。

</div>

---

## ③ harness：重点项与生态

<div class="grid grid-cols-2 gap-8 mt-4">

<div>

**重点项演进**

<div class="map-row mt-3">
<span class="chip">mcp/tools</span> <carbon:arrow-right /> <span class="chip">mcp v2.0</span><span class="chip">mcp app</span><span class="chip">mcp events</span>
</div>

<div class="map-row mt-3">
<span class="chip">skills</span> <carbon:arrow-right /> <span class="chip">编写通用 skill</span>
</div>

<div class="map-row mt-3">
<span class="chip">项目索引</span> <carbon:arrow-right /> <span class="chip">codegraph</span>
</div>

</div>

<div>

**代表智能体框架**

- Pi 2.0
- DSH <span class="chip">基于插件</span>
- Ai-SDK
- Mastra <span class="chip">基于文件</span>
- STRANDS-AGENTS

</div>

</div>

<div class="mt-6 opacity-80">

能力会沉淀为生态：选框架，就是选一套现成的 harness 形态。

</div>

---

## ④ Agent UI：能力的最后一米

<div class="grid grid-cols-3 gap-4 mt-6">

<div class="card card-green">

**TUI**<br><span class="text-sm">终端 UI，开发工具类智能体的默认形态</span>

</div>

<div class="card card-green">

**Robot UI**<br><span class="text-sm">机器人 / 实体硬件的交互</span>

</div>

<div class="card card-green">

**Gen UI**<br><span class="text-sm">生成式 UI，界面由模型按任务即时生成</span>

</div>

</div>

<div class="mt-8 leading-7">

UI 决定「谁来用、怎么用智能体」：同一个循环，可以是终端里的一行命令，也可以是机器人的一张脸。

</div>

---

## ⑤ 产品/龙虾：成熟的智能体产品

<div class="grid grid-cols-2 gap-6 mt-4">

<div class="card">

**开发工具类**

- opencode / reasonix 等

</div>

<div class="card">

**龙虾产品**

- muse、grok bot、workbuddy、chatgpt

</div>

</div>

<div class="mt-6 opacity-80">

成熟产品是最佳实践的证明：先用好它们，再谈自己造。

</div>

---

## 第三层 · AI 应用：六个成果方向

<div class="grid grid-cols-3 gap-4 mt-6">

<div class="card card-blue">

开源软件

</div>

<div class="card card-blue">

业务应用

</div>

<div class="card card-blue">

APP / 小程序 / 硬件 / 机器人

</div>

<div class="card card-blue">

游戏开发、3D 软件控制

</div>

<div class="card card-blue">

数学证明

</div>

<div class="card card-blue">

制作文章、图片、音乐、电影

</div>

</div>

<div class="mt-8 leading-7">

漏斗最宽处：以智能体能力为杠杆，成果出口面向所有方向。

</div>

---

## AI 应用：以开源软件为例

<div class="map-row mt-8 text-lg">
<span class="chip chip-blue">开源软件</span>
<carbon:arrow-right />
<span class="chip">组件库</span><span class="chip">图表</span><span class="chip">3D</span><span class="chip">GIS</span><span class="chip">wasm</span><span class="chip">WebGPU</span>
<carbon:arrow-right />
<span class="chip">rust 工具</span>
</div>

<div class="mt-10 leading-7">

- 向上：AI 参与组件库、图表、3D、GIS 等开源基础设施
- 向下：wasm / WebGPU 把开源成果带进浏览器与设备
- 再往下：rust 工具链成为新一代开源工具的标配

</div>

---

## 总结：选择你的位置

<div class="grid grid-cols-3 gap-4 mt-6">

<div class="card card-amber">

**大模型层**<br><span class="text-sm">尊重堆叠，当作黑盒</span>

</div>

<div class="card card-green">

**智能体开发**<br><span class="text-sm">深入 harness，建立自己的杠杆</span>

</div>

<div class="card card-blue">

**AI 应用**<br><span class="text-sm">选一个方向，产出成果</span>

</div>

</div>

<div class="mt-10 text-xl">

核心是循环，杠杆是 harness，出口是应用。

</div>
