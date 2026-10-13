import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { randomUUID } from "node:crypto";

import {
  HarnessCapabilityUnsupportedError,
  type HarnessV1NetworkSandboxSession,
  type HarnessV1PortEndpoint,
  type HarnessV1SandboxSessionCreateOptions,
  type HarnessV1SandboxSessionResumeOptions,
} from "@ai-sdk/harness";

export type LocalNetworkSandboxOptions = {
  rootDir?: string;
  ports?: readonly number[];
  shell?: string;
};

type Workspace = {
  id: string;
  hostDir: string;
  sandboxDir: string;
  ports: number[];
  processes: Set<ChildProcess>;
  stopped: boolean;
  destroyed: boolean;
};

const providerId = "local-network";

export async function createLocalNetworkSandboxSession(
  options: HarnessV1SandboxSessionCreateOptions<LocalNetworkSandboxOptions> = {},
): Promise<HarnessV1NetworkSandboxSession> {
  options.abortSignal?.throwIfAborted();
  const settings = resolveSettings(options);
  const id = options.sandboxId ?? randomUUID();
  assertSessionId(id);
  const hostDir = path.join(settings.rootDir, id);
  if (existsSync(hostDir)) {
    throw new Error(`会话 ${id} 的工作目录已存在。恢复请用 resumeLocalNetworkSandboxSession。`);
  }
  mkdirSync(settings.rootDir, { recursive: true });
  await mkdir(hostDir);
  const session = openSession(settings, id, hostDir);
  try {
    await options.template?.prepare({
      session: session.restricted(),
      abortSignal: options.abortSignal,
    });
  } catch (error) {
    await session.destroy();
    throw error;
  }
  return session;
}

export async function resumeLocalNetworkSandboxSession(
  options: HarnessV1SandboxSessionResumeOptions<LocalNetworkSandboxOptions>,
): Promise<HarnessV1NetworkSandboxSession> {
  options.abortSignal?.throwIfAborted();
  const settings = resolveSettings(options);
  assertSessionId(options.sandboxId);
  const hostDir = path.join(settings.rootDir, options.sandboxId);
  if (!existsSync(hostDir)) {
    throw new Error(`找不到会话 ${options.sandboxId} 的工作目录。`);
  }
  return openSession(settings, options.sandboxId, hostDir);
}

function resolveSettings(options: LocalNetworkSandboxOptions): {
  rootDir: string;
  ports: readonly number[];
  shell: string | undefined;
} {
  return {
    rootDir: options.rootDir ?? path.join(tmpdir(), "pikafish-local-sandbox"),
    ports: assertPorts(options.ports ?? []),
    shell: options.shell,
  };
}

function openSession(
  settings: { rootDir: string; ports: readonly number[]; shell: string | undefined },
  id: string,
  hostDir: string,
): LocalNetworkSandboxSession {
  return new LocalNetworkSandboxSession(
    {
      id,
      hostDir,
      sandboxDir: toSandboxPath(hostDir),
      ports: [...settings.ports],
      processes: new Set(),
      stopped: false,
      destroyed: false,
    },
    resolveShell(settings.shell),
  );
}

class LocalSandboxSession {
  constructor(
    protected readonly workspace: Workspace,
    protected readonly shell: string,
  ) {}

  get description(): string {
    const ports =
      this.workspace.ports.length === 0
        ? "无"
        : this.workspace.ports.map((port) => `127.0.0.1:${port}`).join(", ");
    return [
      `本机 sandbox（${this.workspace.id}）。`,
      `工作目录：${this.workspace.sandboxDir}`,
      `暴露端口：${ports}`,
      "进程在宿主机执行。",
    ].join("\n");
  }

  async readFile(options: {
    path: string;
    abortSignal?: AbortSignal;
  }): Promise<ReadableStream<Uint8Array> | null> {
    const bytes = await this.readBinaryFile(options);
    if (bytes == null) return null;
    return new ReadableStream({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    });
  }

  async readBinaryFile(options: {
    path: string;
    abortSignal?: AbortSignal;
  }): Promise<Uint8Array | null> {
    this.assertUsable(options.abortSignal);
    try {
      const bytes = await readFile(this.hostPath(options.path), { signal: options.abortSignal });
      return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async readTextFile(options: {
    path: string;
    encoding?: string;
    startLine?: number;
    endLine?: number;
    abortSignal?: AbortSignal;
  }): Promise<string | null> {
    const bytes = await this.readBinaryFile(options);
    if (bytes == null) return null;
    const text = Buffer.from(bytes).toString(bufferEncoding(options.encoding));
    return extractLines(text, options.startLine, options.endLine);
  }

  async writeFile(options: {
    path: string;
    content: ReadableStream<Uint8Array>;
    abortSignal?: AbortSignal;
  }): Promise<void> {
    const bytes = await readStreamBytes(options.content);
    await this.writeBinaryFile({
      path: options.path,
      content: bytes,
      abortSignal: options.abortSignal,
    });
  }

  async writeBinaryFile(options: {
    path: string;
    content: Uint8Array;
    abortSignal?: AbortSignal;
  }): Promise<void> {
    this.assertUsable(options.abortSignal);
    const hostPath = this.hostPath(options.path);
    await mkdir(path.dirname(hostPath), { recursive: true });
    await writeFile(hostPath, options.content, { signal: options.abortSignal });
  }

  async writeTextFile(options: {
    path: string;
    content: string;
    encoding?: string;
    abortSignal?: AbortSignal;
  }): Promise<void> {
    const bytes = Buffer.from(options.content, bufferEncoding(options.encoding));
    await this.writeBinaryFile({
      path: options.path,
      content: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
      abortSignal: options.abortSignal,
    });
  }

  async run(options: {
    command: string;
    workingDirectory?: string;
    env?: Record<string, string>;
    abortSignal?: AbortSignal;
  }): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    const child = await this.spawn(options);
    const [stdout, stderr, finished] = await Promise.all([
      readStreamText(child.stdout),
      readStreamText(child.stderr),
      child.wait(),
    ]);
    return { exitCode: finished.exitCode, stdout, stderr };
  }

  async spawn(options: {
    command: string;
    workingDirectory?: string;
    env?: Record<string, string>;
    abortSignal?: AbortSignal;
  }): Promise<{
    pid?: number;
    stdout: ReadableStream<Uint8Array>;
    stderr: ReadableStream<Uint8Array>;
    wait(): PromiseLike<{ exitCode: number }>;
    kill(): PromiseLike<void>;
  }> {
    this.assertUsable(options.abortSignal);
    const child = spawn(this.shell, ["-c", options.command], {
      cwd: this.hostPath(options.workingDirectory ?? this.workspace.sandboxDir),
      env: commandEnv(this.workspace, options.env),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.workspace.processes.add(child);
    const detach = () => {
      this.workspace.processes.delete(child);
    };
    child.once("exit", detach);
    child.once("error", () => {
      detach();
      child.stdout?.destroy();
      child.stderr?.destroy();
    });

    const onAbort = () => {
      killProcess(child);
    };
    options.abortSignal?.addEventListener("abort", onAbort, { once: true });

    const exit = new Promise<number>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code) => resolve(code ?? 1));
    });

    return {
      pid: child.pid,
      stdout: toWebStream(child.stdout),
      stderr: toWebStream(child.stderr),
      async wait() {
        try {
          const exitCode = await exit;
          if (options.abortSignal?.aborted) {
            throw abortReason(options.abortSignal);
          }
          return { exitCode };
        } finally {
          options.abortSignal?.removeEventListener("abort", onAbort);
        }
      },
      async kill() {
        killProcess(child);
      },
    };
  }

  protected assertUsable(abortSignal?: AbortSignal): void {
    abortSignal?.throwIfAborted();
    if (this.workspace.destroyed) throw new Error("会话已销毁。");
    if (this.workspace.stopped) throw new Error("会话已停止。");
  }

  private hostPath(sandboxPath: string): string {
    const absolute = isAbsoluteSandboxPath(sandboxPath)
      ? sandboxPath
      : path.posix.join(this.workspace.sandboxDir, sandboxPath);
    return fromSandboxPath(absolute);
  }
}

class LocalNetworkSandboxSession
  extends LocalSandboxSession
  implements HarnessV1NetworkSandboxSession
{
  readonly id: string;
  readonly defaultWorkingDirectory: string;

  constructor(workspace: Workspace, shell: string) {
    super(workspace, shell);
    this.id = workspace.id;
    this.defaultWorkingDirectory = workspace.sandboxDir;
  }

  get ports(): readonly number[] {
    return this.workspace.ports;
  }

  restricted(): LocalSandboxSession {
    return new LocalSandboxSession(this.workspace, this.shell);
  }

  async getPortEndpoint(options: {
    port: number;
    protocol?: "http" | "https" | "ws";
  }): Promise<HarnessV1PortEndpoint> {
    if (!this.workspace.ports.includes(options.port)) {
      throw new HarnessCapabilityUnsupportedError({
        harnessId: providerId,
        message: `端口 ${options.port} 没有暴露。当前暴露的端口：[${this.workspace.ports.join(", ")}]。`,
      });
    }
    const protocol = options.protocol ?? "http";
    return { url: `${protocol}://127.0.0.1:${options.port}` };
  }

  async getPortUrl(options: {
    port: number;
    protocol?: "http" | "https" | "ws";
  }): Promise<string> {
    return (await this.getPortEndpoint(options)).url;
  }

  async setPorts(ports: readonly number[], options?: { abortSignal?: AbortSignal }): Promise<void> {
    this.assertUsable(options?.abortSignal);
    this.workspace.ports = assertPorts(ports);
  }

  async stop(): Promise<void> {
    if (this.workspace.stopped || this.workspace.destroyed) return;
    this.workspace.stopped = true;
    const children = [...this.workspace.processes];
    for (const child of children) killProcess(child);
    await Promise.all(children.map(waitForExit));
  }

  async destroy(): Promise<void> {
    if (this.workspace.destroyed) return;
    await this.stop();
    this.workspace.destroyed = true;
    await rm(this.workspace.hostDir, { recursive: true, force: true });
  }
}

function assertSessionId(sessionId: string): void {
  if (
    sessionId.length === 0 ||
    sessionId.length > 200 ||
    sessionId === "." ||
    sessionId === ".." ||
    /[\\/\0]/.test(sessionId)
  ) {
    throw new Error(`会话 id 不能作为目录名：${sessionId}`);
  }
}

function assertPorts(ports: readonly number[]): number[] {
  return ports.map((port) => {
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`端口无效：${port}`);
    }
    return port;
  });
}

function resolveShell(explicit: string | undefined): string {
  if (explicit != null) {
    if (!existsSync(explicit)) throw new Error(`找不到 shell：${explicit}`);
    return explicit;
  }
  if (process.platform !== "win32") return "bash";

  const pathValue = process.env.Path ?? process.env.PATH ?? "";
  for (const entry of pathValue.split(path.delimiter)) {
    if (path.basename(entry).toLowerCase() !== "cmd") continue;
    const candidate = path.join(path.dirname(entry), "bin", "bash.exe");
    if (existsSync(candidate)) return candidate;
  }
  for (const root of [process.env.ProgramFiles, process.env["ProgramFiles(x86)"]]) {
    if (root == null || root === "") continue;
    const candidate = path.join(root, "Git", "bin", "bash.exe");
    if (existsSync(candidate)) return candidate;
  }
  throw new Error("找不到 Git Bash。LocalNetworkSandbox 需要 bash 才能执行 Harness 命令。");
}

function toSandboxPath(hostPath: string): string {
  const resolved = path.resolve(hostPath);
  if (process.platform !== "win32") return resolved;
  const drive = /^([A-Za-z]):[\\/](.*)$/.exec(resolved);
  if (drive == null) throw new Error(`无法把工作目录转换成 POSIX 路径：${resolved}`);
  const rest = drive[2].replaceAll("\\", "/").replace(/^\/+/, "").replace(/\/+$/, "");
  return rest === "" ? `/${drive[1].toLowerCase()}` : `/${drive[1].toLowerCase()}/${rest}`;
}

function fromSandboxPath(sandboxPath: string): string {
  if (process.platform !== "win32") return sandboxPath;
  const git = /^\/([A-Za-z])\/(.*)$/.exec(sandboxPath);
  if (git) return path.win32.join(`${git[1].toUpperCase()}:\\`, ...git[2].split("/"));
  const windows = /^([A-Za-z]):[\\/](.*)$/.exec(sandboxPath);
  if (windows) return path.win32.join(`${windows[1].toUpperCase()}:\\`, ...windows[2].split(/[\\/]/));
  return sandboxPath;
}

function isAbsoluteSandboxPath(sandboxPath: string): boolean {
  return path.posix.isAbsolute(sandboxPath) || /^[A-Za-z]:[\\/]/.test(sandboxPath);
}

function commandEnv(workspace: Workspace, overrides?: Record<string, string>): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HOME: workspace.sandboxDir,
    USERPROFILE: workspace.hostDir,
    ...overrides,
  };
}

function bufferEncoding(encoding = "utf-8"): BufferEncoding {
  if (encoding === "utf-8") return "utf8";
  return encoding as BufferEncoding;
}

function extractLines(text: string, startLine = 1, endLine?: number): string {
  if (startLine < 1) throw new Error("startLine 从 1 开始。");
  const lines = text.split("\n");
  const start = startLine - 1;
  const end = endLine == null ? lines.length : Math.min(lines.length, endLine);
  if (start >= lines.length) return "";
  return lines.slice(start, end).join("\n");
}

function isNotFound(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("This operation was aborted", "AbortError");
}

function killProcess(child: ChildProcess): void {
  if (child.exitCode != null || child.signalCode != null || child.pid == null) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
      windowsHide: true,
      stdio: "ignore",
    });
    return;
  }
  child.kill("SIGKILL");
}

function waitForExit(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    child.once("exit", () => resolve());
    child.once("error", () => resolve());
    if (child.exitCode != null || child.signalCode != null) resolve();
  });
}

function toWebStream(stream: Readable | null): ReadableStream<Uint8Array> {
  if (stream == null) {
    return new ReadableStream({
      start(controller) {
        controller.close();
      },
    });
  }
  return Readable.toWeb(stream) as ReadableStream<Uint8Array>;
}

async function readStreamBytes(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value == null) continue;
    chunks.push(value);
    total += value.byteLength;
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function readStreamText(stream: ReadableStream<Uint8Array>): Promise<string> {
  return new TextDecoder().decode(await readStreamBytes(stream));
}
