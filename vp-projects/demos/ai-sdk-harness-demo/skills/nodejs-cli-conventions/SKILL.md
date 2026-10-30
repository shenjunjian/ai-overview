---
name: nodejs-cli-conventions
description: Conventions for small Node.js + TypeScript command-line tools. Use when creating or changing a CLI entry point, argument parsing, or process exit behaviour in this folder.
---

# Node.js CLI conventions

Follow these when the folder contains (or is about to contain) a Node.js command-line tool.

## Entry point

- Keep the entry point thin: parse arguments, wire dependencies, call one `main()`.
- Register the top-level rejection handler once, at the bottom of the entry module.
- Exit with `0` on success and a non-zero code on failure; never call `process.exit()` on the happy path.

## Arguments

- Support both a short and a long form for every option that takes a value (`-f` / `--folder`).
- Always implement `--help` and print a usage block that lists every option with its default.
- Validate values as you parse them and fail fast with a message that names the offending option.

## Output

- Write results to stdout and diagnostics to stderr.
- Detect `process.stdout.isTTY` before emitting ANSI colours, and honour `NO_COLOR`.
- Never mix progress noise into machine-readable output.

## Dependencies

- Prefer `node:` built-ins (`node:path`, `node:fs/promises`, `node:readline/promises`) over packages.
- Set `"type": "module"` and use ESM `import`/`export` only.

See `references/style.md` for the naming and file-layout rules.