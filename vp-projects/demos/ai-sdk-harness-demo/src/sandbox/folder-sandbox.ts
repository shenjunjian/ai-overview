import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createJustBashNetworkSandboxSessionFromNativeSandbox } from '@ai-sdk/sandbox-just-bash';
import type { HarnessV1NetworkSandboxSession } from '@ai-sdk/harness';
import { Bash, InMemoryFs, MountableFs, ReadWriteFs, Sandbox } from 'just-bash';

import { describeJavaScriptRuntime, registerJavaScriptRuntime } from './javascript-runtime.ts';

/** Virtual path inside the sandbox that is backed by the host folder. */
export const WORKSPACE_MOUNT_POINT = '/workspace';

/** Virtual `$HOME`. Backed by memory, so harness state never lands on disk. */
export const SANDBOX_HOME_DIR = '/home/user';

export type FolderSandbox = {
  readonly session: HarnessV1NetworkSandboxSession;
  /** Absolute host path the agent is allowed to touch. */
  readonly hostFolder: string;
  /** Virtual path that maps to `hostFolder`. */
  readonly mountPoint: string;
  readonly homeDir: string;
  /** Extra facts about the sandbox runtime, appended to the system prompt. */
  readonly runtimeNotes: string;
};

export type CreateFolderSandboxOptions = {
  readonly folder: string;
  readonly mountPoint?: string;
  readonly homeDir?: string;
  readonly abortSignal?: AbortSignal;
};

/**
 * Creates a `just-bash` sandbox whose only disk-backed path is the folder the
 * user picked. `$HOME` and every other virtual path live in an in-memory
 * filesystem, which keeps harness state, skills and secrets out of the project
 * folder and keeps the agent from reaching anything else on the machine.
 *
 * The native `Sandbox` is built here rather than by
 * `createJustBashNetworkSandboxSession` so a QuickJS runtime can be registered
 * on its shell before the session wraps it.
 */
export async function createFolderSandbox(
  options: CreateFolderSandboxOptions,
): Promise<FolderSandbox> {
  const mountPoint = options.mountPoint ?? WORKSPACE_MOUNT_POINT;
  const homeDir = options.homeDir ?? SANDBOX_HOME_DIR;
  const hostFolder = path.resolve(options.folder);

  options.abortSignal?.throwIfAborted();
  await mkdir(hostFolder, { recursive: true });

  const filesystem = new MountableFs({ base: new InMemoryFs() });
  filesystem.mount(mountPoint, new ReadWriteFs({ root: hostFolder }));

  const env = { HOME: homeDir };
  const sandbox = await Sandbox.create({ fs: filesystem, cwd: mountPoint, env });

  // `Sandbox.create` does not forward `javascript`, so the QuickJS interpreter
  // lives in a second `Bash`. Both share `filesystem`, which means a script's
  // writes are immediately visible to the shell, to the file tools and to the
  // host folder.
  const javaScriptRuntime = new Bash({
    fs: filesystem,
    cwd: mountPoint,
    env,
    javascript: true,
  });
  registerJavaScriptRuntime({ shell: sandbox.bashEnvInstance, runtime: javaScriptRuntime });

  const session = createJustBashNetworkSandboxSessionFromNativeSandbox(sandbox);

  return {
    session,
    hostFolder,
    mountPoint,
    homeDir,
    runtimeNotes: describeJavaScriptRuntime(),
  };
}