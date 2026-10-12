# Jev Decisions 总结

## 时间线

最早的Jev, 一个线上服务， 后来出现Laya 本地服务，后来有许多新闻讲可以通过插件，或提示词将其它大语言模型转换为`Jev`模式， 但这个我认为不科学，只是接口模拟了，但本质上，Jev的模型训练方式和优化方向是不一样的方案，所以速度和效果应该比不上Jev.

随后2周，open ai 推出 Decisions API beta, **这个可能成为未来的标准API** , 但现在仅支持gpt6 luna,未来几周将GA,支持更多模型。 baseurl: `v1/decisions`，

微软于 2026 年 10 月 9–10 日正式发布结构化决策模型 [Microsoft‑Decision‑1](https://www.sohu.com/a/1085765556_122066678)，其在微软公布的 36 项基准测试中准确率最高，P50 延迟比 GPT‑6 Sol 快约 35 倍，输入定价为每百万 token 0.042 美元、输出免费。它基于 Qwen3.5‑9B 进行后训练，可在 Microsoft Foundry 使用，并计划接入 OpenRouter。

## JEV的使用：

npm install @typesafe-ai/sdk

请求体

```json
{
  "state": "Hi, I've been trying to connect my Stripe account for 3 days and the integration keeps failing. I'm losing sales. Please help ASAP.",
  "model": "jev-latest",
  "questions": {
    "department": {
      "type": "choice",
      "instructions": "Which team should handle this",
      "criteria": {
        "billing": "Payment or subscription issues",
        "technical": "Bugs or integration problems",
        "sales": "Pricing or account questions"
      }
    },
    "frustration": {
      "type": "score",
      "instructions": "How frustrated the customer appears",
      "criteria": ["Calm, just stating facts", "Frustrated but civil", "Very angry, strong language"]
    },
    "is_urgent": {
      "type": "noul",
      "instructions": "The message conveys urgency or time-sensitivity"
    }
  }
}
```

响应体

```json
{
  "model": "jev-1.13.0",
  "answers": {
    "department": {
      "type": "choice",
      "choice": "technical",
      "confidence": 0.78,
      "probabilities": {
        "technical": 0.85,
        "sales": 0.0,
        "billing": 0.15
      }
    },
    "frustration": {
      "type": "score",
      "score": 1.0,
      "confidence": 1.0,
      "legend": {
        "0": "Calm, just stating facts",
        "1": "Frustrated but civil",
        "2": "Very angry, strong language"
      },
      "probabilities": {
        "0": 0.0,
        "1": 1.0,
        "2": 0.0
      }
    },
    "is_urgent": {
      "type": "noul",
      "noul": 1.0
    }
  },
  "usage": {
    "input_tokens": 392,
    "output_tokens": 65
  }
}
```

## 配合Jev Skill 使用

typesafe-ai/skills

## Laya的使用

可本地部署或网页中运行, 三个模型

- laya：英文任务先从这里开始。
- laya-multilingual：非英文和多语言任务。
- laya-typed-decisions：和其微调工作流相近的 typed-decision 任务。

### 使用方法

1.  python

        `pip install laya`

Router 会自动选模型：英文交给 laya，其他语言交给 laya-multilingual。部署成服务时，用 Router(preload=True) 一次性加载好，这样请求不用等模型加载。

```python

    from laya import Router
    router = Router(preload=True)

    # 或加载单个模型import laya
    # import laya
    # agent = laya.load("convaiinnovations/laya")
    # result = agent.predict(state, questions)

    state = {
        "body": "I was charged twice. Please refund the duplicate."
    }

    questions = {
        "department": {
            "type": "choice",
            "instructions": "Which department should handle this?",
            "criteria": {
                "billing": "payments and refunds",
                "technical": "bugs and outages"
            }
        },
        "refund_requested": {
            "type": "noul",
            "instructions": "Does the user explicitly request a refund?"
        }
    }

    result = router.predict(state, questions)
    print(result)

```

2. 命令行 --- 自部署为服务或 mcp服务的方案

https://laya-ai.com/zh/guides/self-host-laya

```bash
pip install "laya[serve]"                     # 额外安装 fastapi、uvicorn、python-multipart
LAYA_DEVICE=cuda LAYA_PRELOAD=1 laya-serve    # 监听 0.0.0.0:8000，预加载全部 3 个 checkpoint

# 或者启动一个FASTAPI的 web服务  http://127.0.0.1:8000
python examples/server.py         # https://github.com/NandhaKishorM/laya/blob/main/examples/server.py
```

或部署为mcp服务

```json
pip install "laya[mcp]"
laya-mcp-server
{
  "mcpServers": {
    "laya": {
      "command": "laya-mcp-server",
      "env": { "LAYA_DEVICE": "cpu" }
    }
  }
}
```

3. Nodejs运行时

npm install @receptron/laya

Node.js 20 或更高版本。
ONNX 权重（约 1.7 GB，fp32）首次使用时从 Hugging Face 下载，缓存在 ~/.cache/receptron-laya（可用 LAYA_CACHE 修改）。
模型加载后约需 2 GB 内存，每批问题再额外占用几百 MB。

```js
import { Laya } from "@receptron/laya";

const laya = await Laya.load();

const result = await laya.systemOne(
  { subject: "Refund not received", body: "I cancelled two weeks ago and still have no refund..." },
  {
    department: {
      type: "choice",
      instructions: "Which team should handle this ticket?",
      criteria: { billing: "payments, refunds, invoices", support: "product help and bugs" },
    },
    churn_risk: { type: "noul", instructions: "Is the customer likely to cancel or dispute?" },
  },
);

result.answers.department.choice; // "billing"
result.answers.churn_risk.noul; // P(true)
await laya.close();
```

4. HTTP直接调用
