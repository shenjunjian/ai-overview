import { createServer } from "node:net";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { HarnessV1NetworkSandboxSession } from "@ai-sdk/harness";
import {
  HarnessError,
  type HarnessAgentResumeSessionState,
  type HarnessAgentSession,
} from "@ai-sdk/harness/agent";

import type { XiangqiAgent } from "./agent";
import { findPackageRoot } from "./pikafish/binary-path";
import {
  createLocalNetworkSandboxSession,
  resumeLocalNetworkSandboxSession,
} from "./sandbox/local-network-sandbox";

export type PersistedSession = {
  port: number;
  resumeFrom: HarnessAgentResumeSessionState;
};

export type SessionStoreOptions = {
  dataDir?: string;
};

type LiveSandbox = {
  sandbox: HarnessV1NetworkSandboxSession;
  port: number;
  resumeFrom?: HarnessAgentResumeSessionState;
};

const liveSandboxes = new Map<string, LiveSandbox>();
const turnGates = new Map<string, Promise<void>>();

function sessionKey(dataDir: string, chatId: string): string {
  return `${dataDir}\0${chatId}`;
}

function defaultDataDir(): string {
  return path.join(findPackageRoot(path.dirname(fileURLToPath(import.meta.url))), ".data");
}

function resolveDataDir(options?: SessionStoreOptions): string {
  return options?.dataDir ?? defaultDataDir();
}

export function assertChatId(chatId: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(chatId)) {
    throw new HarnessError({
      message: "chat id 只能包含字母、数字、点、下划线和连字符。",
    });
  }
}

function sessionFilePath(dataDir: string, chatId: string): string {
  assertChatId(chatId);
  return path.join(dataDir, "sessions", `${chatId}.json`);
}

function isPersistedSession(value: unknown): value is PersistedSession {
  if (value == null || typeof value !== "object") return false;
  const record = value as { port?: unknown; resumeFrom?: { type?: unknown } };
  return (
    typeof record.port === "number" &&
    Number.isInteger(record.port) &&
    record.resumeFrom != null &&
    typeof record.resumeFrom === "object" &&
    record.resumeFrom.type === "resume-session"
  );
}

export async function readPersistedSession(
  chatId: string,
  options?: SessionStoreOptions,
): Promise<PersistedSession | undefined> {
  const filePath = sessionFilePath(resolveDataDir(options), chatId);
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new HarnessError({ message: "会话文件无法读取。" });
  }
  if (!isPersistedSession(parsed)) {
    throw new HarnessError({ message: "会话文件无法读取。" });
  }
  return parsed;
}

export async function writePersistedSession(
  chatId: string,
  record: PersistedSession,
  options?: SessionStoreOptions,
): Promise<void> {
  const filePath = sessionFilePath(resolveDataDir(options), chatId);
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(record), "utf8");
  await rename(temporary, filePath);
}

function allocateLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", () => {
      reject(new HarnessError({ message: "无法分配本机端口。" }));
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address == null || typeof address === "string") {
        server.close();
        reject(new HarnessError({ message: "无法分配本机端口。" }));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) reject(new HarnessError({ message: "无法分配本机端口。", cause: error }));
        else resolve(port);
      });
    });
  });
}

function acquireTurn(dataDir: string, chatId: string): Promise<() => void> {
  const key = sessionKey(dataDir, chatId);
  const previous = turnGates.get(key) ?? Promise.resolve();
  let releaseGate!: () => void;
  const current = new Promise<void>((resolve) => {
    releaseGate = resolve;
  });
  const tail = previous.then(() => current);
  turnGates.set(key, tail);
  return previous.then(() => () => {
    releaseGate();
    if (turnGates.get(key) === tail) turnGates.delete(key);
  });
}

async function openSandbox(
  chatId: string,
  dataDir: string,
  agent: XiangqiAgent,
  persisted: PersistedSession | undefined,
): Promise<LiveSandbox> {
  const key = sessionKey(dataDir, chatId);
  const live = liveSandboxes.get(key);
  if (live) return live;

  const rootDir = path.join(dataDir, "sandboxes");
  const remember = (next: LiveSandbox) => {
    liveSandboxes.set(key, next);
    return next;
  };
  try {
    if (persisted) {
      const sandbox = await resumeLocalNetworkSandboxSession({
        sandboxId: chatId,
        rootDir,
        ports: [persisted.port],
      });
      return remember({ sandbox, port: persisted.port, resumeFrom: persisted.resumeFrom });
    }
    const port = await allocateLoopbackPort();
    const template = await agent.getSandboxTemplate();
    try {
      const sandbox = await createLocalNetworkSandboxSession({
        sandboxId: chatId,
        rootDir,
        ports: [port],
        ...(template ? { template } : {}),
      });
      return remember({ sandbox, port });
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("工作目录已存在")) throw error;
      const sandbox = await resumeLocalNetworkSandboxSession({
        sandboxId: chatId,
        rootDir,
        ports: [port],
      });
      return remember({ sandbox, port });
    }
  } catch (error) {
    if (HarnessError.isInstance(error)) throw error;
    if (error instanceof Error) {
      throw new HarnessError({ message: error.message, cause: error });
    }
    throw error;
  }
}

export async function resumeOrCreateSession({
  agent,
  chatId,
  abortSignal,
  dataDir,
}: {
  agent: XiangqiAgent;
  chatId: string;
  abortSignal?: AbortSignal;
  dataDir?: string;
}): Promise<{ session: HarnessAgentSession; finish: () => Promise<void> }> {
  assertChatId(chatId);
  const resolvedDataDir = dataDir ?? defaultDataDir();
  const release = await acquireTurn(resolvedDataDir, chatId);
  let finished = false;
  const releaseOnce = () => {
    if (finished) return;
    finished = true;
    release();
  };

  const hadLiveSandbox = liveSandboxes.has(sessionKey(resolvedDataDir, chatId));
  try {
    abortSignal?.throwIfAborted();
    const persisted = hadLiveSandbox
      ? undefined
      : await readPersistedSession(chatId, { dataDir: resolvedDataDir });
    const live = await openSandbox(chatId, resolvedDataDir, agent, persisted);
    const resumeFrom = live.resumeFrom ?? persisted?.resumeFrom;
    let session: HarnessAgentSession;
    try {
      session = await agent.createSession({
        sessionId: chatId,
        sandboxSession: live.sandbox,
        ...(resumeFrom ? { resumeFrom } : {}),
        abortSignal,
      });
    } catch (error) {
      if (!hadLiveSandbox && !persisted) {
        liveSandboxes.delete(sessionKey(resolvedDataDir, chatId));
        try {
          await live.sandbox.destroy();
        } catch (destroyError) {
          console.error(destroyError instanceof Error ? destroyError.message : destroyError);
        }
      }
      throw error;
    }

    let finishing: Promise<void> | undefined;
    const finish = () => {
      finishing ??= (async () => {
        try {
          const nextResume = await session.detach();
          const current = liveSandboxes.get(sessionKey(resolvedDataDir, chatId));
          if (current) current.resumeFrom = nextResume;
          await writePersistedSession(
            chatId,
            { port: live.port, resumeFrom: nextResume },
            { dataDir: resolvedDataDir },
          );
        } catch (error) {
          console.error(error instanceof Error ? error.message : error);
        } finally {
          releaseOnce();
        }
      })();
      return finishing;
    };
    return { session, finish };
  } catch (error) {
    releaseOnce();
    throw error;
  }
}
