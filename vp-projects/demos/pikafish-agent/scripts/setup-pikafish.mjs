import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, createWriteStream, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

import { findPackageRoot, resolveEnginePaths } from "../src/lib/pikafish/binary-path.ts";
import {
  localUniversalBinaryName,
  parse7zList,
  selectEngineAssets,
} from "../src/lib/pikafish/release-assets.ts";

const releaseApi = "https://api.github.com/repos/official-pikafish/Pikafish/releases/latest";

function baseName(entry) {
  return entry.split("/").pop() ?? entry;
}

function run7za(path7za, args) {
  const result = spawnSync(path7za, args, { encoding: "utf8" });
  if (result.error) {
    throw new Error(`无法运行 7za：${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "").trim();
    throw new Error(detail || `7za 退出码 ${result.status}`);
  }
  return result.stdout ?? "";
}

async function path7za() {
  const imported = await import("7zip-bin");
  const resolved = imported.path7za ?? imported.default?.path7za;
  if (typeof resolved !== "string" || resolved.length === 0) {
    throw new Error("7zip-bin 没有提供 path7za。");
  }
  return resolved;
}

async function downloadLatestArchive(destination) {
  const response = await fetch(releaseApi, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "pikafish-agent-setup",
    },
  });
  if (!response.ok) {
    throw new Error(`读取皮卡鱼发布信息失败：HTTP ${response.status}`);
  }
  const release = await response.json();
  const asset = (release.assets ?? []).find((item) => item.name?.endsWith(".7z"));
  if (!asset?.browser_download_url) {
    throw new Error(`发布 ${release.tag_name ?? ""} 里没有 .7z 资源。`);
  }

  console.log(`下载 ${release.tag_name}：${asset.name}`);
  const fileResponse = await fetch(asset.browser_download_url, {
    headers: { "User-Agent": "pikafish-agent-setup" },
    redirect: "follow",
  });
  if (!fileResponse.ok || !fileResponse.body) {
    throw new Error(`下载 ${asset.name} 失败：HTTP ${fileResponse.status}`);
  }
  await pipeline(Readable.fromWeb(fileResponse.body), createWriteStream(destination));
  return asset.name;
}

function targetsReady(paths) {
  for (const filePath of [paths.binaryPath, paths.nnuePath]) {
    if (!statSync(filePath, { throwIfNoEntry: false })?.isFile()) return false;
  }
  return true;
}

async function main() {
  const force = process.argv.includes("--force");
  const packageRoot = findPackageRoot(path.dirname(fileURLToPath(import.meta.url)));
  const paths = resolveEnginePaths(packageRoot);
  if (!force && targetsReady(paths)) {
    console.log(`引擎已在 ${paths.directory}，跳过下载。要覆盖请加 --force。`);
    return;
  }

  const bundledName = localUniversalBinaryName(process.platform);
  const bundledBinary = bundledName ? path.join(paths.directory, bundledName) : undefined;
  if (
    !force &&
    bundledBinary &&
    statSync(bundledBinary, { throwIfNoEntry: false })?.isFile() &&
    statSync(paths.nnuePath, { throwIfNoEntry: false })?.isFile()
  ) {
    copyFileSync(bundledBinary, paths.binaryPath);
    if (process.platform !== "win32") chmodSync(paths.binaryPath, 0o755);
    console.log(`已从本地通用二进制写入 ${paths.binaryPath}`);
    console.log(`权重已在 ${paths.nnuePath}`);
    return;
  }

  const workDir = mkdtempSync(path.join(tmpdir(), "pikafish-setup-"));
  try {
    const archivePath = path.join(workDir, "pikafish.7z");
    await downloadLatestArchive(archivePath);
    const sevenZip = await path7za();
    const entries = parse7zList(run7za(sevenZip, ["l", "-slt", archivePath]), archivePath);
    const selected = selectEngineAssets(entries, process.platform);
    const extractDir = path.join(workDir, "out");
    run7za(sevenZip, ["e", archivePath, `-o${extractDir}`, "-y", selected.binary, selected.nnue]);

    copyFileSync(path.join(extractDir, baseName(selected.binary)), paths.binaryPath);
    copyFileSync(path.join(extractDir, baseName(selected.nnue)), paths.nnuePath);
    if (process.platform !== "win32") chmodSync(paths.binaryPath, 0o755);
    console.log(`已写入 ${paths.binaryPath}`);
    console.log(`已写入 ${paths.nnuePath}`);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
