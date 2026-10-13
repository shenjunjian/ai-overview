import { streamText, UIMessage, convertToModelMessages, createUIMessageStreamResponse, toUIMessageStream } from "ai";
import { createDeepSeek } from "@ai-sdk/deepseek";

const deepSeek = createDeepSeek({
  apiKey: process.env.MY_DS ?? "",
});

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();

  const result = streamText({
    model: deepSeek("deepseek-v4-flash"),
    messages: await convertToModelMessages(messages),
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({ stream: result.stream }),
  });
}
