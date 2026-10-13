import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "vite-plus/test";

import { resolveEnginePaths } from "../src/lib/pikafish/binary-path.ts";
import {
  engineAvailabilityError,
  normalizeAnalyzeInput,
  PikafishEngine,
} from "../src/lib/pikafish/engine.ts";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fakeScript = path.join(packageRoot, "tests", "fake-uci.mjs");
const opening = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w";
const enginePaths = resolveEnginePaths(packageRoot);
const engineReady =
  statSync(enginePaths.binaryPath, { throwIfNoEntry: false })?.isFile() === true &&
  statSync(enginePaths.nnuePath, { throwIfNoEntry: false })?.isFile() === true;

function readLog(logPath: string): string {
  return readFileSync(logPath, "utf8");
}

async function withFake(
  run: (ctx: { engine: PikafishEngine; logPath: string }) => Promise<void>,
  options?: {
    mute?: boolean;
    searchSlackMs?: number;
    stopTimeoutMs?: number;
    handshakeTimeoutMs?: number;
  },
): Promise<void> {
  const dir = mkdtempSync(path.join(tmpdir(), "pikafish-uci-"));
  const logPath = path.join(dir, "commands.log");
  writeFileSync(logPath, "");
  const engine = new PikafishEngine({
    command: process.execPath,
    args: [fakeScript, logPath, options?.mute ? "mute" : ""],
    cwd: dir,
    ...(options?.searchSlackMs != null ? { searchSlackMs: options.searchSlackMs } : {}),
    ...(options?.stopTimeoutMs != null ? { stopTimeoutMs: options.stopTimeoutMs } : {}),
    ...(options?.handshakeTimeoutMs != null
      ? { handshakeTimeoutMs: options.handshakeTimeoutMs }
      : {}),
  });
  try {
    await run({ engine, logPath });
  } finally {
    await engine.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

test("analyze returns the final info from one search", async () => {
  await withFake(async ({ engine }) => {
    const fen = "4k4/9/9/9/9/9/9/9/9/4K4 w - - 0 1";
    const result = await engine.analyze({ fen, moves: ["H2E2", "b9c7"], movetimeMs: 200 });
    expect(result).toEqual({
      bestMove: "h2e2",
      score: { type: "cp", value: 24 },
      pv: ["h2e2", "h9g7", "b0c2"],
      wdl: { win: 410, draw: 500, loss: 90 },
      depth: 2,
    });
  });
});

test("serializes searches and restarts after a critical error", async () => {
  await withFake(async ({ engine, logPath }) => {
    const first = engine.analyze({ fen: "slow", movetimeMs: 50 });
    const second = engine.analyze({ fen: "next", movetimeMs: 50, depth: 3 });
    expect(await Promise.all([first, second])).toHaveLength(2);

    await expect(engine.analyze({ fen: "invalid", movetimeMs: 50 })).rejects.toThrow(
      /无法分析这个局面：CRITICAL ERROR: Command failed\. Reason: invalid fen/,
    );
    expect((await engine.analyze({ fen: "ok", movetimeMs: 50 })).bestMove).toBe("h2e2");

    const text = readLog(logPath);
    expect(text.indexOf("OUT bestmove")).toBeLessThan(text.indexOf("IN position fen next"));
    expect(text.match(/IN go movetime 50/g)?.length).toBeGreaterThanOrEqual(1);
    expect(text).toContain("IN go depth 3");
    expect(text.match(/^IN uci$/gm)).toHaveLength(2);
  });
});

test("stops a search that misses its deadline and returns bestmove", async () => {
  await withFake(
    async ({ engine, logPath }) => {
      const result = await engine.analyze({ fen: "hold", movetimeMs: 30 });
      expect(result.bestMove).toBe("h2e2");
      expect(result.score).toEqual({ type: "cp", value: 24 });
      expect(readLog(logPath)).toContain("IN stop");
      expect((await engine.analyze({ fen: "ok", movetimeMs: 30 })).depth).toBe(2);
      expect(readLog(logPath).match(/^IN uci$/gm)).toHaveLength(1);
    },
    { searchSlackMs: 40 },
  );
});

test("kills a search that ignores stop", async () => {
  await withFake(
    async ({ engine }) => {
      await expect(engine.analyze({ fen: "frozen", movetimeMs: 20 })).rejects.toThrow(/搜索超时/);
    },
    { searchSlackMs: 50, stopTimeoutMs: 200 },
  );
});

test("close stops the in-flight search before quit", async () => {
  await withFake(async ({ engine, logPath }) => {
    const pending = engine.analyze({ fen: "hold", movetimeMs: 10_000 });
    await engine.close();
    await expect(pending).resolves.toMatchObject({ bestMove: "h2e2" });
    const text = readLog(logPath);
    expect(text.indexOf("IN stop")).toBeLessThan(text.indexOf("IN quit"));
  });
});

test("rejects illegal input before starting the engine", async () => {
  await withFake(async ({ engine, logPath }) => {
    await expect(engine.analyze({ fen: "  " })).rejects.toThrow(/FEN 不能为空/);
    await expect(engine.analyze({ fen: "abc\nquit" })).rejects.toThrow(/不能包含换行/);
    await expect(engine.analyze({ fen: "abc", movetimeMs: 0 })).rejects.toThrow(/movetimeMs/);
    await expect(engine.analyze({ fen: "abc", depth: 1.5 })).rejects.toThrow(/depth/);
    await expect(engine.analyze({ fen: "abc", moves: ["h2e2", "nope"] })).rejects.toThrow(
      /UCI 坐标/,
    );
    expect(readLog(logPath)).toBe("");
  });
});

test("defaults movetime and lowercases history moves", () => {
  expect(normalizeAnalyzeInput({ fen: "  abc  " })).toEqual({ fen: "abc", movetimeMs: 1000 });
  expect(normalizeAnalyzeInput({ fen: "abc", moves: [" H2E2 ", ""], depth: 4 })).toEqual({
    fen: "abc",
    moves: ["h2e2"],
    movetimeMs: 1000,
    depth: 4,
  });
});

test("names the missing binary and nnue", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "pikafish-missing-"));
  const binaryPath = path.join(dir, "pikafish.exe");
  const nnuePath = path.join(dir, "pikafish.nnue");
  try {
    expect(engineAvailabilityError({ binaryPath, nnuePath })).toMatch(/找不到皮卡鱼二进制/);
    writeFileSync(binaryPath, "");
    expect(engineAvailabilityError({ binaryPath, nnuePath })).toMatch(/pikafish\.nnue/);
    writeFileSync(nnuePath, "");
    expect(engineAvailabilityError({ binaryPath, nnuePath })).toBeUndefined();
    expect(() => new PikafishEngine({ command: path.join(dir, "missing.exe") })).toThrow(
      /找不到皮卡鱼二进制/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("handshake timeout is readable", async () => {
  await withFake(
    async ({ engine }) => {
      await expect(engine.analyze({ fen: opening, movetimeMs: 50 })).rejects.toThrow(
        /没有收到 uciok/,
      );
    },
    { mute: true, handshakeTimeoutMs: 300 },
  );
});

test.skipIf(!engineReady)(
  "analyzes the opening with movetime 200",
  async () => {
    const engine = new PikafishEngine();
    try {
      const result = await engine.analyze({ fen: opening, movetimeMs: 200 });
      expect(result.bestMove).toMatch(/^[a-i][0-9][a-i][0-9]$/);
      expect(["cp", "mate"]).toContain(result.score.type);
      expect(Number.isInteger(result.score.value)).toBe(true);
      expect(result.pv.length).toBeGreaterThan(0);
      expect(result.pv[0]).toBe(result.bestMove);
      expect(result.depth).toBeGreaterThan(0);
    } finally {
      await engine.close();
    }
  },
  30_000,
);
