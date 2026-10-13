import { spawn, type ChildProcess } from "node:child_process";
import { statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { findPackageRoot, resolveEnginePaths } from "./binary-path";
import { finishSearch, goCommand, parseUciLine, positionCommand, type Analysis } from "./uci";

export type { Analysis, AnalysisScore, AnalysisWdl } from "./uci";

export type AnalyzeInput = {
  fen: string;
  moves?: string[];
  movetimeMs?: number;
  depth?: number;
};

export type PikafishEngineOptions = {
  command?: string;
  args?: string[];
  cwd?: string;
  searchSlackMs?: number;
  depthTimeoutMs?: number;
  handshakeTimeoutMs?: number;
  stopTimeoutMs?: number;
};

const defaultMovetimeMs = 1000;
const defaultSearchSlackMs = 30_000;
const defaultDepthTimeoutMs = 120_000;
const defaultHandshakeTimeoutMs = 30_000;
const defaultStopTimeoutMs = 5_000;
const uciMove = /^[a-i][0-9][a-i][0-9]$/;

type NormalizedInput = {
  fen: string;
  moves?: string[];
  movetimeMs: number;
  depth?: number;
};

function isFile(filePath: string): boolean {
  return statSync(filePath, { throwIfNoEntry: false })?.isFile() === true;
}

export function engineAvailabilityError(paths: {
  binaryPath: string;
  nnuePath: string;
}): string | undefined {
  if (!isFile(paths.binaryPath)) {
    return `找不到皮卡鱼二进制：${paths.binaryPath}。`;
  }
  if (!isFile(paths.nnuePath)) {
    return `找不到与引擎配套的 pikafish.nnue：${paths.nnuePath}。`;
  }
  return undefined;
}

function positiveInteger(value: number): boolean {
  return Number.isInteger(value) && value >= 1;
}

function hasControlChar(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) < 32) return true;
  }
  return false;
}

export function normalizeAnalyzeInput(input: AnalyzeInput): NormalizedInput {
  const fen = input.fen.trim();
  if (fen.length === 0) throw new Error("局面 FEN 不能为空。");
  if (hasControlChar(fen)) throw new Error("局面 FEN 不能包含换行或控制字符。");

  const moves = input.moves
    ?.map((move) => move.trim().toLowerCase())
    .filter((move) => move.length > 0);
  if (moves?.some((move) => !uciMove.test(move))) {
    throw new Error("历史着法必须是 UCI 坐标，例如 h2e2。");
  }
  if (input.movetimeMs != null && !positiveInteger(input.movetimeMs)) {
    throw new Error("movetimeMs 必须是正整数毫秒。");
  }
  if (input.depth != null && !positiveInteger(input.depth)) {
    throw new Error("depth 必须是正整数。");
  }

  return {
    fen,
    movetimeMs: input.movetimeMs ?? defaultMovetimeMs,
    ...(moves && moves.length > 0 ? { moves } : {}),
    ...(input.depth != null ? { depth: input.depth } : {}),
  };
}

class UciTimeoutError extends Error {
  constructor() {
    super("等待皮卡鱼输出超时。");
    this.name = "UciTimeoutError";
  }
}

class LineQueue {
  private readonly pending: string[] = [];
  private readonly waiters: Array<(line: string | null) => void> = [];
  private ended = false;

  push(line: string): void {
    if (this.ended) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter(line);
    else this.pending.push(line);
  }

  end(): void {
    if (this.ended) return;
    this.ended = true;
    const waiters = this.waiters.splice(0);
    for (const waiter of waiters) waiter(null);
  }

  read(timeoutMs: number): Promise<string | null> {
    const queued = this.pending.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    if (this.ended) return Promise.resolve(null);
    if (timeoutMs <= 0) return Promise.reject(new UciTimeoutError());

    return new Promise((resolve, reject) => {
      let settled = false;
      const deliver = (line: string | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(line);
      };
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        const index = this.waiters.indexOf(deliver);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(new UciTimeoutError());
      }, timeoutMs);
      this.waiters.push(deliver);
    });
  }
}

class UciSession {
  readonly recent: string[] = [];
  exited = false;
  exitCode: number | null = null;
  private exitFired = false;
  spawnError: Error | undefined;

  private readonly queue = new LineQueue();
  private stdoutRest = "";
  private stderrRest = "";
  private finished = false;

  private constructor(
    private readonly child: ChildProcess,
    private readonly stdin: NodeJS.WritableStream,
  ) {}

  static start(command: string, args: string[], cwd: string): UciSession {
    const child = spawn(command, args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    if (!child.stdin || !child.stdout || !child.stderr) {
      child.kill();
      throw new Error("无法启动皮卡鱼：没有标准输入输出。");
    }
    const session = new UciSession(child, child.stdin);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      session.stdoutRest = session.ingest(session.stdoutRest, chunk);
    });
    child.stderr.on("data", (chunk: string) => {
      session.stderrRest = session.ingest(session.stderrRest, chunk);
    });
    child.stdin.on("error", () => {
      // 进程先退出时，后续写入会得到 EPIPE。读循环负责报告退出原因。
    });
    child.on("error", (error: Error) => {
      session.spawnError = error;
      session.finish();
    });
    child.on("exit", (code) => {
      session.exitCode = code;
      session.exitFired = true;
    });
    child.on("close", () => {
      session.finish();
    });
    return session;
  }

  send(command: string): void {
    if (this.exited) return;
    this.stdin.write(`${command}\n`);
  }

  readLine(timeoutMs: number): Promise<string | null> {
    return this.queue.read(timeoutMs);
  }

  describeFailure(fallback: string): string {
    const critical = this.recent.find((line) => line.includes("CRITICAL ERROR"));
    if (critical) {
      return `皮卡鱼无法分析这个局面：${critical.replace(/^info string\s+/, "")}`;
    }
    const details = [
      this.spawnError?.message,
      this.exitCode != null ? `退出码 ${this.exitCode}` : undefined,
      this.recent.slice(-5).join("\n") || undefined,
    ].filter((part): part is string => part != null && part.length > 0);
    if (details.length === 0) return fallback;
    return `${fallback}${details.join("；")}`;
  }

  async waitExit(timeoutMs: number): Promise<void> {
    if (this.exited || this.exitFired) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.child.kill();
        resolve();
      }, timeoutMs);
      this.child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      if (this.exited) {
        clearTimeout(timer);
        resolve();
      }
    });
  }

  async dispose(): Promise<void> {
    if (!this.exited) this.child.kill();
    await this.waitExit(1_000);
    this.finish();
  }

  private ingest(rest: string, chunk: string): string {
    const text = rest + chunk;
    const parts = text.split(/\n/);
    const nextRest = parts.pop() ?? "";
    for (const part of parts) this.accept(part.endsWith("\r") ? part.slice(0, -1) : part);
    return nextRest;
  }

  private accept(line: string): void {
    this.recent.push(line);
    if (this.recent.length > 20) this.recent.shift();
    this.queue.push(line);
  }

  private finish(): void {
    if (this.finished) return;
    this.finished = true;
    this.exited = true;
    if (this.stdoutRest.length > 0) this.accept(this.stdoutRest);
    if (this.stderrRest.length > 0) this.accept(this.stderrRest);
    this.stdoutRest = "";
    this.stderrRest = "";
    this.queue.end();
  }
}

export class PikafishEngine {
  private readonly command: string;
  private readonly args: string[];
  private readonly cwd: string;
  private readonly searchSlackMs: number;
  private readonly depthTimeoutMs: number;
  private readonly handshakeTimeoutMs: number;
  private readonly stopTimeoutMs: number;
  private session: UciSession | null = null;
  private chain: Promise<void> = Promise.resolve();
  private closed = false;
  private closeTask: Promise<void> | undefined;
  private awaitingBestMove = false;
  private stopForClose = false;

  constructor(options: PikafishEngineOptions = {}) {
    this.searchSlackMs = options.searchSlackMs ?? defaultSearchSlackMs;
    this.depthTimeoutMs = options.depthTimeoutMs ?? defaultDepthTimeoutMs;
    this.handshakeTimeoutMs = options.handshakeTimeoutMs ?? defaultHandshakeTimeoutMs;
    this.stopTimeoutMs = options.stopTimeoutMs ?? defaultStopTimeoutMs;

    if (options.command) {
      if (!isFile(options.command)) {
        throw new Error(`找不到皮卡鱼二进制：${options.command}。`);
      }
      this.command = options.command;
      this.args = options.args ?? [];
      this.cwd = options.cwd ?? process.cwd();
      return;
    }

    const packageRoot = findPackageRoot(path.dirname(fileURLToPath(import.meta.url)));
    const paths = resolveEnginePaths(packageRoot);
    const problem = engineAvailabilityError(paths);
    if (problem) throw new Error(problem);
    this.command = paths.binaryPath;
    this.args = [];
    this.cwd = paths.directory;
  }

  analyze(input: AnalyzeInput): Promise<Analysis> {
    if (this.closed) return Promise.reject(new Error("皮卡鱼引擎已关闭。"));
    return this.enqueue(() => this.runAnalyze(input));
  }

  close(): Promise<void> {
    if (this.closeTask) return this.closeTask;
    this.closed = true;
    this.stopForClose = true;
    this.sendStop();
    this.closeTask = this.enqueue(() => this.quitSession());
    return this.closeTask;
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.chain.then(task);
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async ensureSession(): Promise<UciSession> {
    if (this.session && !this.session.exited) return this.session;
    this.session = null;
    const session = UciSession.start(this.command, this.args, this.cwd);
    this.session = session;
    try {
      await this.handshake(session);
      return session;
    } catch (error) {
      if (this.session === session) this.session = null;
      await session.dispose();
      throw error;
    }
  }

  private async handshake(session: UciSession): Promise<void> {
    session.send("uci");
    await this.readToken(session, "uciok", "皮卡鱼握手超时，没有收到 uciok。");
    // 确认命令层能接收局面。ucinewgame 只清置换表，不在握手里发送。
    session.send("isready");
    await this.readToken(session, "readyok", "皮卡鱼握手超时，没有收到 readyok。");
  }

  private async readToken(
    session: UciSession,
    token: string,
    timeoutMessage: string,
  ): Promise<void> {
    const deadline = Date.now() + this.handshakeTimeoutMs;
    while (Date.now() < deadline) {
      const line = await this.readHandshakeLine(session, deadline - Date.now(), timeoutMessage);
      if (line.trim() === token) return;
    }
    throw new Error(timeoutMessage);
  }

  private async readHandshakeLine(
    session: UciSession,
    timeoutMs: number,
    timeoutMessage: string,
  ): Promise<string> {
    try {
      const line = await session.readLine(timeoutMs);
      if (line == null) throw new Error(session.describeFailure("皮卡鱼在握手完成前退出。"));
      const event = parseUciLine(line);
      if (event.kind === "critical") throw new Error(`皮卡鱼无法分析这个局面：${event.message}`);
      return line;
    } catch (error) {
      if (error instanceof UciTimeoutError) throw new Error(timeoutMessage);
      throw error;
    }
  }

  private async runAnalyze(input: AnalyzeInput): Promise<Analysis> {
    const normalized = normalizeAnalyzeInput(input);
    const session = await this.ensureSession();
    const lines: string[] = [];
    session.send(positionCommand(normalized.fen, normalized.moves));
    session.send(goCommand(normalized));
    this.awaitingBestMove = true;
    if (this.stopForClose) this.sendStop();

    const timeoutMs =
      normalized.depth != null ? this.depthTimeoutMs : normalized.movetimeMs + this.searchSlackMs;
    const deadline = Date.now() + timeoutMs;
    try {
      while (true) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) return await this.recoverOrTimeout(session, lines);
        let line: string | null;
        try {
          line = await session.readLine(remaining);
        } catch (error) {
          if (error instanceof UciTimeoutError) return await this.recoverOrTimeout(session, lines);
          throw error;
        }
        const outcome = await this.consumeSearchLine(session, lines, line);
        if (outcome) return outcome;
      }
    } finally {
      this.awaitingBestMove = false;
    }
  }

  private async consumeSearchLine(
    session: UciSession,
    lines: string[],
    line: string | null,
  ): Promise<Analysis | undefined> {
    if (line == null) {
      this.session = null;
      throw new Error(session.describeFailure("皮卡鱼在返回 bestmove 前退出。"));
    }
    lines.push(line);
    const event = parseUciLine(line);
    if (event.kind === "critical") {
      this.session = null;
      await session.dispose();
      throw new Error(`皮卡鱼无法分析这个局面：${event.message}`);
    }
    if (event.kind === "bestmove") return finishSearch(lines);
    return undefined;
  }

  private async recoverOrTimeout(session: UciSession, lines: string[]): Promise<Analysis> {
    if (!session.exited) this.sendStop();
    const recovered = await this.readUntilBestMove(session, lines, this.stopTimeoutMs);
    if (recovered) return recovered;
    if (this.session === session) this.session = null;
    await session.dispose();
    throw new Error("皮卡鱼搜索超时。");
  }

  private async readUntilBestMove(
    session: UciSession,
    lines: string[],
    timeoutMs: number,
  ): Promise<Analysis | undefined> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      let line: string | null;
      try {
        line = await session.readLine(Math.max(1, deadline - Date.now()));
      } catch (error) {
        if (error instanceof UciTimeoutError) return undefined;
        throw error;
      }
      try {
        const outcome = await this.consumeSearchLine(session, lines, line);
        if (outcome) return outcome;
      } catch (error) {
        if (this.session === session) this.session = null;
        await session.dispose();
        throw error;
      }
    }
    return undefined;
  }

  private sendStop(): void {
    if (!this.awaitingBestMove || !this.session || this.session.exited) return;
    this.session.send("stop");
  }

  private async quitSession(): Promise<void> {
    const session = this.session;
    this.session = null;
    if (!session || session.exited) return;
    session.send("quit");
    await session.waitExit(2_000);
    if (!session.exited) await session.dispose();
  }
}
