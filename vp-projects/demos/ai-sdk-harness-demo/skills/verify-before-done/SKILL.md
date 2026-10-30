---
name: verify-before-done
description: Verification loop to run before declaring a coding task finished. Use after writing or editing code in this folder, especially when the user asks for a working program rather than a sketch.
---

# Verify before done

Never report success on unverified code.

1. Look for an existing check command: `package.json` scripts (`build`, `test`, `lint`, `typecheck`), a `Makefile`, or CI config.
2. Run the narrowest check that covers your change first, then widen.
3. If the project has no checks at all, run the code and read the output: `node <entry>`, or `node -e "..."` for a one-off check.
4. On failure, read the whole error, fix the root cause, and re-run. Do not patch symptoms.
5. Only then summarise: what changed, which command verified it, and anything still unverified.

Rules:

- At most three attempts at formatting or lint fixes; report the remainder instead of looping.
- Do not fix unrelated failures you stumble on; mention them in the summary.
- Quote the exact command you ran in the final summary.

## What this sandbox can run

`node` here is a QuickJS interpreter, not the host Node.js binary.

- It runs `.js`, `.mjs`, `.ts` and `.mts` directly; type annotations are stripped, so there is no `tsc` step and no way to type-check.
- There is no package manager and no `node_modules` resolution: `npm`, `npx`, `pnpm` and `git` do not exist. Do not plan a verification step around installing anything.
- `require()` only resolves built-in modules. To load a file from this project, use `import` from a `.mjs`, `.ts` or `.mts` entry point.
- `assert` is available, so a throwaway `node -e "..."` with `assert.strictEqual` is usually the fastest real check.
- Each execution gets 64 MB and 10 seconds.

If a check genuinely cannot run here, say so explicitly in the summary instead of implying it passed.