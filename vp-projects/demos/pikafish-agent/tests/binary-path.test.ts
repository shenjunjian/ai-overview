import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "vite-plus/test";

import {
  engineBinaryName,
  findPackageRoot,
  resolveEnginePaths,
} from "../src/lib/pikafish/binary-path.ts";
import {
  localUniversalBinaryName,
  parse7zList,
  selectEngineAssets,
} from "../src/lib/pikafish/release-assets.ts";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const releaseEntries = [
  "Pikafish-Linux-x86-64-universal",
  "Pikafish-Windows-x86-64-universal.exe",
  "Pikafish-MacOS-universal",
  "Pikafish-Android-arm64-universal",
  "pikafish.nnue",
  "Wiki/Home.md",
  "README.md",
];

test("local universal binary names match the GitHub release layout", () => {
  expect(localUniversalBinaryName("win32")).toBe("Pikafish-Windows-x86-64-universal.exe");
  expect(localUniversalBinaryName("linux")).toBe("Pikafish-Linux-x86-64-universal");
  expect(localUniversalBinaryName("darwin")).toBeUndefined();
});

test("engine binary names follow the platform", () => {
  expect(engineBinaryName("win32")).toBe("pikafish.exe");
  expect(engineBinaryName("linux")).toBe("pikafish");
  expect(() => engineBinaryName("darwin")).toThrow(/不支持的系统/);
});

test("engine paths stay inside pikafish-engine", () => {
  expect(resolveEnginePaths(packageRoot, "win32")).toEqual({
    directory: path.join(packageRoot, "pikafish-engine"),
    binaryName: "pikafish.exe",
    binaryPath: path.join(packageRoot, "pikafish-engine", "pikafish.exe"),
    nnuePath: path.join(packageRoot, "pikafish-engine", "pikafish.nnue"),
  });
  expect(resolveEnginePaths("/opt/app", "linux").binaryPath).toBe(
    path.join("/opt/app", "pikafish-engine", "pikafish"),
  );
});

test("package root walks up to pikafish-agent", () => {
  expect(findPackageRoot(path.join(packageRoot, "src", "lib"))).toBe(packageRoot);
  expect(() => findPackageRoot(path.parse(packageRoot).root)).toThrow(/找不到 pikafish-agent/);
});

test("release selection keeps the universal binary and nnue", () => {
  expect(selectEngineAssets(releaseEntries, "win32")).toEqual({
    binary: "Pikafish-Windows-x86-64-universal.exe",
    nnue: "pikafish.nnue",
  });
  expect(selectEngineAssets(["nested/" + releaseEntries[0], "nested/other.nnue"], "linux")).toEqual(
    {
      binary: "nested/Pikafish-Linux-x86-64-universal",
      nnue: "nested/other.nnue",
    },
  );
  expect(() => selectEngineAssets(releaseEntries, "darwin")).toThrow(/不支持的系统/);
  expect(() => selectEngineAssets(["README.md"], "win32")).toThrow(/没有当前系统的通用二进制/);
  expect(() => selectEngineAssets(["Pikafish-Windows-x86-64-universal.exe"], "win32")).toThrow(
    /没有 \.nnue/,
  );
});

test("7z listing skips the archive itself and directories", () => {
  const stdout = [
    "Path = C:/tmp/Pikafish.2026-09-06.7z",
    "Type = 7z",
    "",
    "----------",
    "Path = Pikafish-Windows-x86-64-universal.exe",
    "Size = 10",
    "Folder = -",
    "",
    "----------",
    "Path = Wiki",
    "Folder = +",
    "",
    "----------",
    "Path = pikafish.nnue",
    "Size = 20",
    "",
  ].join("\n");

  expect(parse7zList(stdout, "C:/tmp/Pikafish.2026-09-06.7z")).toEqual([
    "Pikafish-Windows-x86-64-universal.exe",
    "pikafish.nnue",
  ]);
});
