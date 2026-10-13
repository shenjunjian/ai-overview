import path from "node:path";

const nnueFileName = "pikafish.nnue";
const windowsBinary = /pikafish-windows-x86-64-universal\.exe$/i;
const linuxBinary = /pikafish-linux-x86-64-universal$/i;

function entryBaseName(entry: string): string {
  return entry.split("/").pop() ?? entry;
}

function pickBinary(entries: string[], platform: NodeJS.Platform): string {
  if (platform === "win32") {
    const matches = entries.filter((entry) => windowsBinary.test(entryBaseName(entry)));
    if (matches.length === 1) return matches[0] ?? "";
    if (matches.length > 1) {
      throw new Error(`发布包里有多份 Windows 通用二进制：\n${matches.join("\n")}`);
    }
  } else if (platform === "linux") {
    const matches = entries.filter((entry) => linuxBinary.test(entryBaseName(entry)));
    if (matches.length === 1) return matches[0] ?? "";
    if (matches.length > 1) {
      throw new Error(`发布包里有多份 Linux 通用二进制：\n${matches.join("\n")}`);
    }
  } else {
    throw new Error(`不支持的系统 ${platform}。下载脚本只拉取 Windows 与 Linux 的通用二进制。`);
  }

  throw new Error(`发布包里没有当前系统的通用二进制。条目：\n${entries.join("\n") || "（空）"}`);
}

function pickNnue(entries: string[]): string {
  const nnues = entries.filter((entry) => entryBaseName(entry).toLowerCase().endsWith(".nnue"));
  const preferred = nnues.filter((entry) => entryBaseName(entry).toLowerCase() === nnueFileName);
  if (preferred.length === 1) return preferred[0] ?? "";
  if (preferred.length > 1) {
    throw new Error(`发布包里有多份 ${nnueFileName}：\n${preferred.join("\n")}`);
  }
  if (nnues.length === 1) return nnues[0] ?? "";
  if (nnues.length === 0) {
    throw new Error(
      "发布包里没有 .nnue。引擎需要与该版本配套的 pikafish.nnue，不能改用 master 网络。",
    );
  }
  throw new Error(`发布包里有多份 .nnue，且没有 ${nnueFileName}：\n${nnues.join("\n")}`);
}

export function localUniversalBinaryName(platform: NodeJS.Platform): string | undefined {
  if (platform === "win32") return "Pikafish-Windows-x86-64-universal.exe";
  if (platform === "linux") return "Pikafish-Linux-x86-64-universal";
  return undefined;
}

export function selectEngineAssets(
  entries: string[],
  platform: NodeJS.Platform,
): { binary: string; nnue: string } {
  const files = entries.filter((entry) => entry.length > 0 && !entry.endsWith("/"));
  return {
    binary: pickBinary(files, platform),
    nnue: pickNnue(files),
  };
}

export function parse7zList(stdout: string, archivePath: string): string[] {
  const archiveName = path.basename(archivePath);
  const records = stdout.split(/\r?\n\r?\n/);
  const parsed: string[] = [];
  for (const record of records) {
    const lines = record.split(/\r?\n/).filter((line) => line.length > 0);
    const pathLine = lines.find((line) => line.startsWith("Path = "));
    if (!pathLine) continue;
    const entryPath = pathLine.slice("Path = ".length).replaceAll("\\", "/");
    if (!entryPath || path.basename(entryPath) === archiveName) continue;
    if (lines.some((line) => line === "Folder = +")) continue;
    parsed.push(entryPath);
  }
  return parsed;
}
