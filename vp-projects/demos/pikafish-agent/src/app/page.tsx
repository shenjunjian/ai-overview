"use client";

import dynamic from "next/dynamic";

const AnalysisDesk = dynamic(
  () => import("@/components/AnalysisDesk").then((mod) => mod.AnalysisDesk),
  {
    ssr: false,
    loading: () => (
      <main className="flex flex-1 items-center justify-center px-6">
        <p className="text-zinc-600 dark:text-zinc-400">正在打开棋盘…</p>
      </main>
    ),
  },
);

export default function Home() {
  return <AnalysisDesk />;
}
