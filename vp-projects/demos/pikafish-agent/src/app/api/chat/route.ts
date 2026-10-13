import { getHarnessErrorMessage, HarnessError } from "@ai-sdk/harness/agent";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  toUIMessageStream,
  type UIMessage,
} from "ai";

import { getXiangqiAgent } from "@/lib/agent";
import { resumeOrCreateSession } from "@/lib/session-store";

export const runtime = "nodejs";

type ChatRequest = {
  id?: string;
  messages?: UIMessage[];
};

async function readChatRequest(
  request: Request,
): Promise<{ ok: true; chatId: string; messages: UIMessage[] } | { ok: false; message: string }> {
  let body: ChatRequest;
  try {
    body = (await request.json()) as ChatRequest;
  } catch {
    return { ok: false, message: "请求体必须是包含 id 和 messages 的 JSON。" };
  }
  if (!body.id) return { ok: false, message: "缺少 chat id。" };
  if (!Array.isArray(body.messages)) return { ok: false, message: "请求体必须包含 messages。" };
  return { ok: true, chatId: body.id, messages: body.messages };
}

export async function POST(request: Request) {
  const parsed = await readChatRequest(request);

  return createUIMessageStreamResponse({
    stream: createUIMessageStream({
      execute: async ({ writer }) => {
        if (!parsed.ok) throw new HarnessError({ message: parsed.message });
        const messages = await convertToModelMessages(parsed.messages);
        if (!messages.some((message) => message.role === "user")) {
          throw new HarnessError({ message: "缺少用户消息。" });
        }

        const agent = getXiangqiAgent();
        const turn = await resumeOrCreateSession({
          agent,
          chatId: parsed.chatId,
          abortSignal: request.signal,
        });
        const onAbort = () => {
          void turn.finish();
        };
        request.signal.addEventListener("abort", onAbort, { once: true });

        try {
          const result = await agent.stream({
            session: turn.session,
            messages,
            abortSignal: request.signal,
          });
          writer.merge(
            toUIMessageStream({
              stream: result.stream,
              onError: getHarnessErrorMessage,
              onEnd: async () => {
                request.signal.removeEventListener("abort", onAbort);
                await turn.finish();
              },
            }),
          );
        } catch (error) {
          request.signal.removeEventListener("abort", onAbort);
          await turn.finish();
          throw error;
        }
      },
      onError: getHarnessErrorMessage,
    }),
  });
}
