import { statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "vite-plus/test";

import {
  engineBinaryName,
  findPackageRoot,
  resolveEnginePaths,
} from "../src/lib/pikafish/binary-path.ts";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const engineDirectory = path.join(packageRoot, "pikafish-engine");

test("engine binary names follow the platform", () => {
  expect(engineBinaryName("win32")).toBe("Pikafish-Windows-x86-64-universal.exe");
  expect(engineBinaryName("linux")).toBe("Pikafish-Linux-x86-64-universal");
  expect(() => engineBinaryName("darwin")).toThrow(/不支持的系统/);
});

test("engine paths stay inside pikafish-engine", () => {
  expect(resolveEnginePaths(packageRoot, "win32")).toEqual({
    directory: engineDirectory,
    binaryName: "Pikafish-Windows-x86-64-universal.exe",
    binaryPath: path.join(engineDirectory, "Pikafish-Windows-x86-64-universal.exe"),
    nnuePath: path.join(engineDirectory, "pikafish.nnue"),
  });
  expect(resolveEnginePaths("/opt/app", "linux").binaryPath).toBe(
    path.join("/opt/app", "pikafish-engine", "Pikafish-Linux-x86-64-universal"),
  );
});

test("package root walks up to pikafish-agent", () => {
  expect(findPackageRoot(path.join(packageRoot, "src", "lib"))).toBe(packageRoot);
  expect(() => findPackageRoot(path.parse(packageRoot).root)).toThrow(/找不到 pikafish-agent/);
});

test("pikafish-engine ships the universal binaries and nnue", () => {
  for (const name of [
    "Pikafish-Windows-x86-64-universal.exe",
    "Pikafish-Linux-x86-64-universal",
    "Pikafish-MacOS-universal",
    "Pikafish-Android-arm64-universal",
    "pikafish.nnue",
  ]) {
    expect(statSync(path.join(engineDirectory, name)).isFile()).toBe(true);
  }
});
