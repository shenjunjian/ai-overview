"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useEffect, useMemo, useRef, useState } from "react";

import { XiangqiBoard } from "@/components/XiangqiBoard";
import { playMove, scoreRows, sideInCheck, type MoveFault, type ScoreEntry } from "@/lib/xiangqi/play";
import {
  formatScore,
  openingFen,
  pvToArrows,
  questionWithPosition,
  readAnalysis,
  sideToMove,
  type ShownAnalysis,
} from "@/lib/xiangqi/position";

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

function faultMessage(fault: MoveFault, side: "w" | "b"): string {
  if (fault === "turn") return side === "w" ? "现在轮到红方。" : "现在轮到黑方。";
  if (fault === "check") return "这一步送将。";
  return "这一步不合规则。";
}

function ScoreSheet({ entries }: { entries: readonly ScoreEntry[] }) {
  const rows = scoreRows(entries);
  return (
    <div className="overflow-hidden rounded-md border border-zinc-300 dark:border-zinc-700">
      <table className="w-full text-sm">
        <thead className="bg-zinc-50 text-xs text-zinc-500 dark:bg-zinc-900">
          <tr>
            <th className="w-14 px-2 py-1 text-left font-medium">回合</th>
            <th className="px-2 py-1 text-left font-medium">红方</th>
            <th className="px-2 py-1 text-left font-medium">黑方</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td className="px-2 py-3 text-zinc-500" colSpan={3}>
                从开局开始，红方先走。
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={row.round} className="border-t border-zinc-200 dark:border-zinc-800">
                <td className="px-2 py-1 tabular-nums">{row.round}</td>
                <td className="px-2 py-1" style={{ fontFamily: "KaiTi, STKaiti, SimSun, serif" }}>
                  {row.red}
                </td>
                <td className="px-2 py-1" style={{ fontFamily: "KaiTi, STKaiti, SimSun, serif" }}>
                  {row.black}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
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
  const [moves, setMoves] = useState<ScoreEntry[]>([]);
  const [arrows, setArrows] = useState<[string, string, string][]>([]);
  const [moveFault, setMoveFault] = useState<string | undefined>();
  const [input, setInput] = useState("");
  const appliedAnalysis = useRef<string | undefined>(undefined);
  const bottomRef = useRef<HTMLDivElement>(null);
  const side = sideToMove(fen);
  const busy = status === "submitted" || status === "streaming";

  useEffect(() => {
    const found = latestAnalysis(messages);
    if (!found || found.id === appliedAnalysis.current) return;
    appliedAnalysis.current = found.id;
    setArrows(pvToArrows(found.analysis.pv));
  }, [messages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages, status]);

  function submitQuestion(question: string) {
    const text = question.trim();
    if (!text || busy) return;
    if (error) clearError();
    void sendMessage({ text: questionWithPosition(fen, text) });
    setInput("");
  }

  return (
    <main className="mx-auto flex min-h-full w-full min-w-[900px] max-w-6xl flex-1 flex-row gap-6 px-4 py-6">
      <section className="w-[29rem] shrink-0 space-y-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">皮卡鱼分析</h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            红方在下方。红黑轮流走子，不合规则的着法会回到原位。
          </p>
        </div>
        <XiangqiBoard
          fen={fen}
          side={side ?? "w"}
          arrows={arrows}
          onMove={(from, to) => {
            if (from === to) return false;
            const result = playMove(fen, from, to);
            if (!result.ok) {
              setMoveFault(faultMessage(result.fault, side ?? "w"));
              return false;
            }
            setMoveFault(undefined);
            setFen(result.move.fen);
            setArrows([]);
            setMoves((current) => [...current, { side: result.move.side, notation: result.move.notation }]);
            return true;
          }}
        />
        <div className="flex items-center gap-3">
          <p className="text-sm">
            {side === "b" ? "轮到黑方" : "轮到红方"}
            {sideInCheck(fen) ? "，将军" : ""}
          </p>
          <button
            type="button"
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700"
            onClick={() => {
              setFen(openingFen);
              setMoves([]);
              setArrows([]);
              setMoveFault(undefined);
            }}
          >
            恢复开局
          </button>
        </div>
        {moveFault ? <p className="text-sm text-red-700 dark:text-red-400">{moveFault}</p> : null}
        <ScoreSheet entries={moves} />
      </section>

      <section className="flex h-[calc(100vh-3rem)] min-h-[32rem] min-w-0 flex-1 flex-col">
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
