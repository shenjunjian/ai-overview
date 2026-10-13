import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const packageName = "pikafish-agent";

export function engineBinaryName(platform: NodeJS.Platform = process.platform): string {
  if (platform === "win32") return "Pikafish-Windows-x86-64-universal.exe";
  if (platform === "linux") return "Pikafish-Linux-x86-64-universal";
  throw new Error(
    `不支持的系统 ${platform}。引擎路径只探测 Windows（Pikafish-Windows-x86-64-universal.exe）和 Linux（Pikafish-Linux-x86-64-universal）。`,
  );
}

export function resolveEnginePaths(
  packageRoot: string,
  platform: NodeJS.Platform = process.platform,
): { directory: string; binaryName: string; binaryPath: string; nnuePath: string } {
  const binaryName = engineBinaryName(platform);
  const directory = path.join(packageRoot, "pikafish-engine");
  return {
    directory,
    binaryName,
    binaryPath: path.join(directory, binaryName),
    nnuePath: path.join(directory, "pikafish.nnue"),
  };
}

export function findPackageRoot(start: string = process.cwd()): string {
  let current = path.resolve(start);
  for (;;) {
    const manifestPath = path.join(current, "package.json");
    if (existsSync(manifestPath)) {
      const manifest: { name?: string } = JSON.parse(readFileSync(manifestPath, "utf8"));
      if (manifest.name === packageName) return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error("找不到 pikafish-agent 包目录。请在该包内运行。");
    }
    current = parent;
  }
}
