"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  boardFen,
  formatScore,
  movePiece,
  openingFen,
  pvToArrows,
  questionWithPosition,
  readAnalysis,
  removePiece,
  sideToMove,
  withSide,
  type ShownAnalysis,
} from "@/lib/xiangqi/position";
import { XiangqiBoard } from "@/components/XiangqiBoard";

type XiangqiTools = {
  analyzePosition: {
    input: { fen: string; moves?: string[]; movetimeMs?: number };
    output: ShownAnalysis;
  };
};

type XiangqiUIMessage = UIMessage<unknown, never, XiangqiTools>;
type AnalyzePart = Extract<XiangqiUIMessage["parts"][number], { type: "tool-analyzePosition" }>;

function inputFen(input: unknown): string | undefined {
  if (input == null || typeof input !== "object") return undefined;
  const fen = (input as { fen?: unknown }).fen;
  return typeof fen === "string" && fen.length > 0 ? fen : undefined;
}

function latestAnalysis(
  messages: XiangqiUIMessage[],
): { id: string; analysis: ShownAnalysis } | undefined {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const parts = messages[messageIndex]?.parts ?? [];
    for (let partIndex = parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = parts[partIndex];
      if (part?.type !== "tool-analyzePosition" || part.state !== "output-available") continue;
      const analysis = readAnalysis(part.output);
      if (!analysis) continue;
      return { id: part.toolCallId, analysis };
    }
  }
  return undefined;
}

function AnalyzePositionPart({ part }: { part: AnalyzePart }) {
  if (part.state === "output-available") {
    const analysis = readAnalysis(part.output);
    if (!analysis) return <p>皮卡鱼返回了无法显示的结果。</p>;
    return (
      <div className="rounded-md border border-zinc-200 px-3 py-2 dark:border-zinc-800">
        <p className="mb-2 text-xs font-medium tracking-wide text-zinc-500">皮卡鱼</p>
        <dl className="grid grid-cols-[4.5rem_1fr] gap-y-1 text-sm">
          <dt className="text-zinc-500">局面</dt>
          <dd className="font-mono text-xs break-all">{analysis.fen}</dd>
          {analysis.moves ? (
            <>
              <dt className="text-zinc-500">历史</dt>
              <dd className="font-mono">{analysis.moves.join(" ")}</dd>
            </>
          ) : null}
          <dt className="text-zinc-500">最佳着法</dt>
          <dd className="font-mono">{analysis.bestMove}</dd>
          <dt className="text-zinc-500">评分</dt>
          <dd className="font-mono">{formatScore(analysis.score)}</dd>
          <dt className="text-zinc-500">深度</dt>
          <dd>{analysis.depth}</dd>
          <dt className="text-zinc-500">主要变化</dt>
          <dd className="font-mono">{analysis.pv.join(" ") || "（无）"}</dd>
          {analysis.wdl ? (
            <>
              <dt className="text-zinc-500">胜负和</dt>
              <dd>
                胜 {analysis.wdl.win} · 和 {analysis.wdl.draw} · 负 {analysis.wdl.loss}
                （千分比）
              </dd>
            </>
          ) : null}
        </dl>
      </div>
    );
  }

  if (part.state === "output-error") {
    return <p className="text-sm text-red-700 dark:text-red-400">皮卡鱼没有完成分析：{part.errorText}</p>;
  }

  if (part.state === "output-denied") return <p className="text-sm">这次分析被拒绝。</p>;

  const fen = inputFen(part.input);
  return <p className="text-sm text-zinc-500">{fen ? `正在让皮卡鱼分析：${fen}` : "正在让皮卡鱼分析…"}</p>;
}

function MessageView({ message }: { message: XiangqiUIMessage }) {
  const label = message.role === "user" ? "你" : "助手";
  return (
    <article className="space-y-2">
      <p className="text-xs font-medium text-zinc-500">{label}</p>
      {message.parts.map((part, index) => {
        const key = `${message.id}-${index}`;
        if (part.type === "text") {
          return (
            <p key={key} className="whitespace-pre-wrap">
              {part.text}
            </p>
          );
        }
        if (part.type === "reasoning") {
          if (!part.text) return null;
          return (
            <details
              key={key}
              className="rounded-md bg-zinc-100 px-3 py-2 text-sm text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400"
            >
              <summary className="cursor-pointer">思考</summary>
              <p className="mt-2 whitespace-pre-wrap">{part.text}</p>
            </details>
          );
        }
        if (part.type === "tool-analyzePosition") return <AnalyzePositionPart key={key} part={part} />;
        return null;
      })}
    </article>
  );
}

export function AnalysisDesk() {
  const [chatId] = useState(() => crypto.randomUUID());
  const transport = useMemo(() => new DefaultChatTransport({ api: "/api/chat" }), []);
  const { messages, sendMessage, status, error, stop, clearError } = useChat<XiangqiUIMessage>({
    id: chatId,
    transport,
  });
  const [fen, setFen] = useState(openingFen);
  const [draft, setDraft] = useState(openingFen);
  const [arrows, setArrows] = useState<[string, string, string][]>([]);
  const [fenError, setFenError] = useState<string | undefined>();
  const [input, setInput] = useState("");
  const editingFen = useRef(false);
  const appliedAnalysis = useRef<string | undefined>(undefined);
  const bottomRef = useRef<HTMLDivElement>(null);
  const side = sideToMove(fen);
  const busy = status === "submitted" || status === "streaming";

  useEffect(() => {
    if (!editingFen.current) setDraft(fen);
  }, [fen]);

  useEffect(() => {
    const found = latestAnalysis(messages);
    if (!found || found.id === appliedAnalysis.current) return;
    appliedAnalysis.current = found.id;
    const next = boardFen(found.analysis.fen);
    if (!next) return;
    setFen(next);
    setFenError(undefined);
    setArrows(pvToArrows(found.analysis.pv));
  }, [messages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages, status]);

  function replaceFen(next: string) {
    setFen(next);
    setArrows([]);
    setFenError(undefined);
  }

  function applyDraft() {
    const next = boardFen(draft);
    if (!next) {
      setFenError("这不是棋盘能摆的中国象棋 FEN。需要 10 行、每行 9 路，以及行棋方 w 或 b。");
      return;
    }
    setDraft(next);
    if (next !== fen) replaceFen(next);
    else setFenError(undefined);
  }

  function submitQuestion(question: string) {
    const text = question.trim();
    if (!text || busy) return;
    if (error) clearError();
    void sendMessage({ text: questionWithPosition(fen, text) });
    setInput("");
  }

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-6 lg:flex-row">
      <section className="space-y-4 lg:w-[29rem] lg:shrink-0">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">皮卡鱼分析</h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            拖动棋子摆局面，拖出棋盘可以拿走。红方在下方。
          </p>
        </div>
        <div className="overflow-x-auto">
          <XiangqiBoard
            fen={fen}
            arrows={arrows}
            onMove={(from, to) => {
              const next = movePiece(fen, from, to);
              if (!next || next === fen) return next === fen;
              replaceFen(next);
              return true;
            }}
            onRemove={(square) => {
              const next = removePiece(fen, square);
              if (next) replaceFen(next);
            }}
          />
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm aria-pressed:bg-zinc-900 aria-pressed:text-white dark:border-zinc-700 dark:aria-pressed:bg-zinc-100 dark:aria-pressed:text-zinc-900"
            aria-pressed={side === "w"}
            onClick={() => {
              const next = withSide(fen, "w");
              if (next && next !== fen) replaceFen(next);
            }}
          >
            红方走
          </button>
          <button
            type="button"
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm aria-pressed:bg-zinc-900 aria-pressed:text-white dark:border-zinc-700 dark:aria-pressed:bg-zinc-100 dark:aria-pressed:text-zinc-900"
            aria-pressed={side === "b"}
            onClick={() => {
              const next = withSide(fen, "b");
              if (next && next !== fen) replaceFen(next);
            }}
          >
            黑方走
          </button>
          <button
            type="button"
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700"
            onClick={() => replaceFen(openingFen)}
          >
            恢复开局
          </button>
        </div>
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            applyDraft();
          }}
        >
          <label className="block text-sm" htmlFor="fen">
            局面 FEN
          </label>
          <textarea
            id="fen"
            value={draft}
            rows={3}
            spellCheck={false}
            className="w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 font-mono text-xs dark:border-zinc-700"
            onFocus={() => {
              editingFen.current = true;
            }}
            onBlur={() => {
              editingFen.current = false;
            }}
            onChange={(event) => {
              setDraft(event.target.value);
              setFenError(undefined);
            }}
          />
          {fenError ? <p className="text-sm text-red-700 dark:text-red-400">{fenError}</p> : null}
          <button
            type="submit"
            className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm text-white dark:bg-zinc-100 dark:text-zinc-900"
          >
            应用 FEN
          </button>
        </form>
      </section>

      <section className="flex min-h-[32rem] min-w-0 flex-1 flex-col lg:h-[calc(100vh-3rem)]">
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          {messages.length === 0 ? (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              问这步好不好、怎么走，或要一个评估。着法和评分来自皮卡鱼。
            </p>
          ) : (
            messages.map((message) => <MessageView key={message.id} message={message} />)
          )}
          {busy ? <p className="text-sm text-zinc-500">正在分析…</p> : null}
          <div ref={bottomRef} />
        </div>
        {error ? <p className="mt-3 text-sm text-red-700 dark:text-red-400">{error.message}</p> : null}
        <form
          className="mt-3 space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            submitQuestion(input);
          }}
        >
          <label className="sr-only" htmlFor="question">
            问题
          </label>
          <textarea
            id="question"
            value={input}
            rows={3}
            placeholder="问这步好不好、怎么走，或要一个评估"
            className="w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700"
            onChange={(event) => setInput(event.target.value)}
          />
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={busy || input.trim().length === 0}
              className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
            >
              发送
            </button>
            <button
              type="button"
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm disabled:opacity-50 dark:border-zinc-700"
              disabled={busy}
              onClick={() => submitQuestion("评估这个局面")}
            >
              评估这个局面
            </button>
            {busy ? (
              <button
                type="button"
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700"
                onClick={() => stop()}
              >
                停止
              </button>
            ) : null}
          </div>
        </form>
      </section>
    </main>
  );
}
