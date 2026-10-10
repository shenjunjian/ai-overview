import { defineConfig } from "vitepress";

// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: "AI 概览地图",
  description: "AI 世界的开发地图",
  themeConfig: {
    // https://vitepress.dev/reference/default-theme-config
    nav: [
      { text: "Home", link: "/" },
      { text: "智能体开发", link: "/agent" },
    ],

    sidebar: [
      {
        text: "智能体开发",
        link: "/agent/",
        items: [
          { text: "大模型连接", link: "/agent/llms/" },

          {
            text: "代理循环",
            link: "/agent/agent-loop/",
            items: [
              {
                text: "7 种主流 AI Agent 架构全解析",
                link: "/agent/agent-loop/7-agent-pattern",
              },
            ],
          },
          {
            text: "Harness 执行框架",
            link: "/agent/harness/",
            items: [
              { text: "提示词", link: "/agent/harness/prompts/" },
              { text: "MCP ", link: "/agent/harness/mcp/" },
              { text: "RAG ", link: "/agent/harness/RAG/" },
              { text: "技能", link: "/agent/harness/skill/" },
              { text: "会话", link: "/agent/harness/session/" },
              { text: "缓存优化/压缩", link: "/agent/harness/cache/" },
              { text: "子代理", link: "/agent/harness/sub-agent/" },
              { text: "记忆", link: "/agent/harness/memory/" },
              { text: "Shell 命令执行", link: "/agent/harness/shell/" },
              { text: "沙箱", link: "/agent/harness/sandbox/" },
              { text: "代码索引", link: "/agent/harness/code-index/" },
            ],
          },
          { text: "智能体 UI", link: "/agent/agent-ui/" },
          { text: "智能体产品", link: "/agent/product/" },
        ],
      },
      {
        text: "AI 应用",
        link: "/ai-app/",
        items: [
          { text: "移动 App / 小程序 / 小游戏", link: "/ai-app/app/" },
          { text: "通用工作", link: "/ai-app/common-work/" },
          { text: "游戏开发", link: "/ai-app/game/" },
          { text: "硬件", link: "/ai-app/hardware/" },
          { text: "数学证明", link: "/ai-app/math/" },
          { text: "新应用", link: "/ai-app/new-app/" },
          { text: "开源软件", link: "/ai-app/open-soft/" },
        ],
      },
    ],

    socialLinks: [{ icon: "github", link: "https://github.com/shenjunjian/ai-overview" }],
  },
});
