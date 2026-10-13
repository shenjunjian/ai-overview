import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { getHarnessErrorMessage } from "@ai-sdk/harness/agent";
import { expect, test } from "vite-plus/test";

import type { XiangqiAgent } from "../src/lib/agent.ts";
import {
  assertChatId,
  readPersistedSession,
  resumeOrCreateSession,
  writePersistedSession,
  type PersistedSession,
} from "../src/lib/session-store.ts";

const resumeFrom: PersistedSession["resumeFrom"] = {
  type: "resume-session",
  harnessId: "opencode",
  specificationVersion: "harness-v1",
  data: { session: "game-1" },
};

function temporaryDataDir(): string {
  return mkdtempSync(path.join(tmpdir(), "pikafish-session-"));
}

test("persisted session round-trips for the same chat id", async () => {
  const dataDir = temporaryDataDir();
  try {
    await writePersistedSession("game-1", { port: 4312, resumeFrom }, { dataDir });
    await expect(readPersistedSession("game-1", { dataDir })).resolves.toEqual({
      port: 4312,
      resumeFrom,
    });
    await expect(readPersistedSession("other-game", { dataDir })).resolves.toBeUndefined();
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("a broken session file reports a readable error", async () => {
  const dataDir = temporaryDataDir();
  try {
    const filePath = path.join(dataDir, "sessions", "game-1.json");
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, "{", "utf8");
    await expect(readPersistedSession("game-1", { dataDir })).rejects.toThrow(/会话文件无法读取/);
    try {
      await readPersistedSession("game-1", { dataDir });
    } catch (error) {
      expect(getHarnessErrorMessage(error)).toBe("会话文件无法读取。");
    }
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("the same chat id reattaches the persisted sandbox", async () => {
  const dataDir = temporaryDataDir();
  mkdirSync(path.join(dataDir, "sandboxes", "game-1"), { recursive: true });
  await writePersistedSession("game-1", { port: 4312, resumeFrom }, { dataDir });

  const sandboxes: object[] = [];
  const seen: Array<PersistedSession["resumeFrom"] | undefined> = [];
  const resumed: PersistedSession["resumeFrom"] = {
    type: "resume-session",
    harnessId: "opencode",
    specificationVersion: "harness-v1",
    data: { session: "next" },
  };
  const agent = {
    async getSandboxTemplate() {
      return undefined;
    },
    async createSession(options: {
      resumeFrom?: PersistedSession["resumeFrom"];
      sandboxSession: { ports: readonly number[] };
    }) {
      seen.push(options.resumeFrom);
      sandboxes.push(options.sandboxSession);
      return {
        async detach() {
          return resumed;
        },
      };
    },
  };

  try {
    const first = await resumeOrCreateSession({
      agent: agent as unknown as XiangqiAgent,
      chatId: "game-1",
      dataDir,
    });
    await first.finish();
    const second = await resumeOrCreateSession({
      agent: agent as unknown as XiangqiAgent,
      chatId: "game-1",
      dataDir,
    });
    await second.finish();

    expect(seen).toEqual([resumeFrom, resumed]);
    expect(sandboxes[0]).toBe(sandboxes[1]);
    expect(sandboxes[0]).toMatchObject({ ports: [4312] });
    await expect(readPersistedSession("game-1", { dataDir })).resolves.toEqual({
      port: 4312,
      resumeFrom: resumed,
    });
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("chat id that cannot be a directory name stays readable", () => {
  expect(() => assertChatId("../secret")).toThrow(/chat id/);
  try {
    assertChatId("a/b");
  } catch (error) {
    expect(getHarnessErrorMessage(error)).toMatch(/chat id/);
  }
});
