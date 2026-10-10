// 普通对话
// import { CopilotClient } from "@github/copilot-sdk";

// const client = new CopilotClient();
// const session = await client.createSession({ model: "auto" });

// const response = await session.sendAndWait({ prompt: "What is 2 + 2?" });
// console.log(response?.data.content);

// await client.stop();
// process.exit(0);

// 流方式对话
// import { CopilotClient } from "@github/copilot-sdk";

// const client = new CopilotClient();
// const session = await client.createSession({
//   model: "auto",
//   streaming: true,
// });

// // Listen for response chunks
// session.on("assistant.message_delta", (event) => {
//   process.stdout.write(event.data.deltaContent + "--");
// });
// session.on("session.idle", () => {
//   console.log(); // New line when done
// });

// await session.sendAndWait({ prompt: "Tell me a short joke" });

// await client.stop();
// process.exit(0);

// 测试自定义模型
// import { CopilotClient } from "@github/copilot-sdk";

// const client = new CopilotClient();
// const session = await client.createSession({
//   model: "deepseek-flash",
//   provider: {
//     type: "openai",
//     baseUrl: "https://api.deepseek.com",
//     apiKey: process.env.MY_DS,
//   },
//   streaming: true,
// });

// // Listen for response chunks
// session.on("assistant.message_delta", (event) => {
//   process.stdout.write(event.data.deltaContent + "--");
// });
// session.on("session.idle", () => {
//   console.log(); // New line when done
// });

// await session.sendAndWait({ prompt: "你是什么大模型" });

// await client.stop();
// process.exit(0);

// 测试工具 --------  失败，不调用工具
// import { CopilotClient, defineTool } from "@github/copilot-sdk";

// // Define a tool that Copilot can call
// const getWeather = defineTool("get_weather", {
//   description: "Get the current weather for a city",
//   parameters: {
//     type: "object",
//     properties: {
//       city: { type: "string", description: "The city name" },
//     },
//     required: ["city"],
//   },
//   handler: async (args: { city: string }) => {
//     const { city } = args;
//     const conditions = ["晴天", "多云", "rainy", "partly cloudy"];
//     const temp = Math.floor(Math.random() * 30) + 50;
//     const condition = conditions[Math.floor(Math.random() * conditions.length)];
//     return { city, temperature: `${temp} 度`, condition };
//   },
// });

// const client = new CopilotClient();
// const session = await client.createSession({
//   model: "auto",
//   streaming: true,
//   tools: [getWeather],
// });

// session.on("assistant.message_delta", (event) => {
//   process.stdout.write(event.data.deltaContent + "--");
// });

// session.on("session.idle", () => {
//   console.log(); // New line when done
// });

// await session.sendAndWait({
//   prompt: "What's the weather like in Seattle and Tokyo?",
// });

// await client.stop();
// process.exit(0);

// 测试自启动 cli:  先执行 pnpx copilot --headless --host 0.0.0.0 --port 4321
import { approveAll, CopilotClient, defineTool, RuntimeConnection } from "@github/copilot-sdk";

// Define a tool that Copilot can call
const getWeather = defineTool("get_weather", {
  description: "Get the current weather for a city",
  parameters: {
    type: "object",
    properties: {
      city: { type: "string", description: "The city name" },
    },
    required: ["city"],
  },
  handler: async (args: { city: string }) => {
    const { city } = args;
    const conditions = ["晴天", "多云", "rainy", "partly cloudy"];
    const temp = Math.floor(Math.random() * 30) + 50;
    const condition = conditions[Math.floor(Math.random() * conditions.length)];
    return { city, temperature: `${temp} 度`, condition };
  },
});

const client = new CopilotClient({
  connection: RuntimeConnection.forUri("localhost:4321"),
});
const session = await client.createSession({
  onPermissionRequest: approveAll, // 必须添加允许所有，才能调用tool 或 curl ps等命令
  model: "deepseek-flash",
  provider: {
    type: "openai",
    baseUrl: "https://api.deepseek.com",
    apiKey: process.env.MY_DS,
  },
  streaming: true,
  tools: [getWeather],
});

session.on("assistant.message_delta", (event) => {
  process.stdout.write(event.data.deltaContent);
});

session.on("session.idle", () => {
  console.log(); // New line when done
});

await session.sendAndWait({
  prompt: "What's the weather like in Seattle and Tokyo?",
});

await client.stop();
process.exit(0);
