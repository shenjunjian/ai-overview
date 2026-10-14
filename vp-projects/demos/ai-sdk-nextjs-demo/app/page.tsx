"use client";

import { useChat } from "@ai-sdk/react";
import { MessageSquare } from "lucide-react";
import { Suspense, useState } from "react";

import {
  Attachment,
  AttachmentPreview,
  AttachmentRemove,
  Attachments,
} from "@/components/ai-elements/attachments";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputActionAddAttachments,
  PromptInputActionAddScreenshot,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuTrigger,
  PromptInputBody,
  PromptInputFooter,
  PromptInputHeader,
  type PromptInputMessage,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  usePromptInputAttachments,
} from "@/components/ai-elements/prompt-input";

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

// PromptInput 生成的附件 url 是 blob URL，只在本页面有效。
// 转成 data URL 后后端才能拿到真正的图片内容。
async function toDataUrl(url: string): Promise<string> {
  if (!url.startsWith("blob:")) {
    return url;
  }

  const blob = await fetch(url).then((response) => response.blob());

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// 在输入框上方展示已选择的图片附件（内联缩略图 + 移除按钮）
function PromptInputAttachments() {
  const attachments = usePromptInputAttachments();

  if (attachments.files.length === 0) {
    return null;
  }

  return (
    <Attachments variant="inline">
      {attachments.files.map((file) => (
        <Attachment
          key={file.id}
          data={file}
          onRemove={() => attachments.remove(file.id)}
        >
          <AttachmentPreview />
          <AttachmentRemove />
        </Attachment>
      ))}
    </Attachments>
  );
}

export function Chat() {
  const [input, setInput] = useState("");
  const { messages, sendMessage, status } = useChat();

  const handleSubmit = async (message: PromptInputMessage) => {
    const text = message.text.trim();

    if (!text && message.files.length === 0) {
      return;
    }

    const files = await Promise.all(
      message.files.map(async (file) => ({
        ...file,
        url: await toDataUrl(file.url),
      }))
    );

    sendMessage({
      text: text || "（图片）",
      files,
    });
    setInput("");
  };

  return (
    <div className="mx-auto flex h-dvh w-full max-w-4xl flex-col p-4">
      <Conversation>
        <ConversationContent>
          {messages.length === 0 ? (
            <ConversationEmptyState
              icon={<MessageSquare className="size-12" />}
              title="开始对话"
              description="输入消息，或点击输入框左侧按钮上传图片"
            />
          ) : (
            messages.map((message) => (
              <Message key={message.id} from={message.role}>
                <MessageContent>
                  {message.parts.map((part, i) => {
                    switch (part.type) {
                      case "text":
                        return (
                          <MessageResponse key={`${message.id}-${i}`}>
                            {part.text}
                          </MessageResponse>
                        );
                      case "file":
                        // 对话列表中的图片预览
                        return (
                          <Attachments
                            key={`${message.id}-${i}`}
                            variant="grid"
                            className="max-w-72"
                          >
                            <Attachment
                              data={{ ...part, id: `${message.id}-${i}` }}
                            >
                              <AttachmentPreview />
                            </Attachment>
                          </Attachments>
                        );
                      case "tool-weather":
                      case "tool-convertFahrenheitToCelsius":
                        return (
                          <pre
                            key={`${message.id}-${i}`}
                            className="whitespace-pre-wrap rounded-lg bg-muted p-2 text-xs"
                          >
                            {JSON.stringify(part, null, 2)}
                          </pre>
                        );
                      default:
                        return null;
                    }
                  })}
                </MessageContent>
              </Message>
            ))
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <PromptInput
        onSubmit={handleSubmit}
        className="mt-4"
        accept="image/*"
        multiple
        maxFiles={4}
        maxFileSize={MAX_FILE_SIZE}
        onError={(err) => console.warn("PromptInput error:", err.message)}
      >
        <PromptInputHeader>
          <PromptInputAttachments />
        </PromptInputHeader>
        <PromptInputBody>
          <PromptInputTextarea
            value={input}
            onChange={(e) => setInput(e.currentTarget.value)}
            placeholder="输入消息，或上传图片后发送…"
          />
        </PromptInputBody>
        <PromptInputFooter>
          <PromptInputTools>
            <PromptInputActionMenu>
              <PromptInputActionMenuTrigger />
              <PromptInputActionMenuContent>
                <PromptInputActionAddAttachments />
                <PromptInputActionAddScreenshot />
              </PromptInputActionMenuContent>
            </PromptInputActionMenu>
          </PromptInputTools>
          <PromptInputSubmit status={status} />
        </PromptInputFooter>
      </PromptInput>
    </div>
  );
}

// useChat 在渲染时生成随机 id（Math.random），静态预渲染不允许不稳定值。
// 用 Suspense 延迟渲染聊天子树，避免 blocking-prerender-random-client 构建错误。
export default function Page() {
  return (
    <Suspense
      fallback={
        <div className="flex h-dvh items-center justify-center text-muted-foreground">
          加载中…
        </div>
      }
    >
      <Chat />
    </Suspense>
  );
}
