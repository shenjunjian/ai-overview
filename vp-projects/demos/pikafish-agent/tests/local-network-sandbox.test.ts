import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, test } from "vite-plus/test";

import {
  createLocalNetworkSandboxSession,
  resumeLocalNetworkSandboxSession,
} from "../src/lib/sandbox/local-network-sandbox.ts";

test("getPortEndpoint returns 127.0.0.1 for an exposed port", async () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), "pikafish-sandbox-"));
  const session = await createLocalNetworkSandboxSession({
    rootDir,
    ports: [4000],
    sandboxId: "ports",
  });
  try {
    expect(await session.getPortEndpoint({ port: 4000, protocol: "ws" })).toEqual({
      url: "ws://127.0.0.1:4000",
    });
    expect(await session.getPortEndpoint({ port: 4000 })).toEqual({
      url: "http://127.0.0.1:4000",
    });
    expect(await session.getPortEndpoint({ port: 4000, protocol: "https" })).toEqual({
      url: "https://127.0.0.1:4000",
    });
    await expect(session.getPortEndpoint({ port: 9 })).rejects.toThrow(/4000/);
  } finally {
    await session.destroy();
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("createLocalNetworkSandboxSession keeps a resumable working directory", async () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), "pikafish-sandbox-"));
  const session = await createLocalNetworkSandboxSession({ rootDir, sandboxId: "game-1" });
  try {
    expect(path.posix.isAbsolute(session.defaultWorkingDirectory)).toBe(true);
    expect(session.defaultWorkingDirectory.endsWith("/game-1")).toBe(true);
    expect(statSync(path.join(rootDir, "game-1")).isDirectory()).toBe(true);

    const home = await session.run({ command: 'printf "%s" "$HOME"' });
    expect(home.exitCode).toBe(0);
    expect(home.stdout).toBe(session.defaultWorkingDirectory);

    const nested = `${session.defaultWorkingDirectory}/child`;
    const made = await session.run({
      command: 'mkdir -p "$WORK_DIR"',
      env: { WORK_DIR: nested },
    });
    expect(made.exitCode).toBe(0);
    expect(statSync(path.join(rootDir, "game-1", "child")).isDirectory()).toBe(true);

    await session.writeTextFile({ path: "note.txt", content: "fen" });
    await session.stop();

    const resumed = await resumeLocalNetworkSandboxSession({
      rootDir,
      sandboxId: "game-1",
    });
    expect(resumed.defaultWorkingDirectory).toBe(session.defaultWorkingDirectory);
    expect(await resumed.readTextFile({ path: "note.txt" })).toBe("fen");
    expect(readFileSync(path.join(rootDir, "game-1", "note.txt"), "utf8")).toBe("fen");

    await resumed.destroy();
    await expect(resumeLocalNetworkSandboxSession({ rootDir, sandboxId: "game-1" })).rejects.toThrow(
      /game-1/,
    );
  } finally {
    await session.destroy();
    rmSync(rootDir, { recursive: true, force: true });
  }
});
